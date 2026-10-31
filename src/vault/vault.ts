import type { KeysJson } from "../../shared/schemas/keys.ts";
import type { Envelope } from "../../shared/schemas/envelope.ts";
import type { RecordKind } from "../../shared/schemas/vault.ts";
import {
  changePassphrase,
  checkPassphrase,
  createKeys,
  CryptoError,
  CURRENT_KDF_PARAMS,
  decryptRecord,
  deviceSlotFromJson,
  deviceSlotToJson,
  encryptRecord,
  type KdfParams,
  kdfNeedsUpgrade,
  type KeyCheck,
  keyCheckFromJson,
  keyCheckToJson,
  type OnProgress,
  type PassphraseSlot,
  passphraseSlotFromJson,
  passphraseSlotToJson,
  type RecoverySlot,
  recoverySlotFromJson,
  recoverySlotToJson,
  replaceRecoveryKey,
  resetPassphrase,
  toBase64url,
  unlockWithDevice,
  unlockWithPassphrase,
  verifyKeyCheck,
} from "../crypto/index.ts";
import { ApiError, type VaultApi } from "./api.ts";
import type { DeviceKeyStore } from "./device-keys.ts";
import type { KeyValueStore } from "./storage.ts";
import type { KeyOffer, LockReason, Tabs } from "./tabs.ts";

/*
 * The state of this browser's key: whether the user has keys at all, whether
 * the data key is in memory, and every flow that changes that. The data key
 * never leaves this object: other code encrypts and decrypts through it.
 * See README.md and docs/ for the flows and the rules they keep.
 */

export type VaultState =
  /** Loading the keys and asking the other tabs. */
  | { status: "starting" }
  /** Not a secure context: WebCrypto is missing, nothing can be decrypted. */
  | { status: "insecure" }
  /** The keys could not be loaded (offline, server error): try again. */
  | { status: "failed" }
  /** Signed in for the first time: create a passphrase. */
  | { status: "no-keys" }
  /** The passphrase is needed; `idle` after the 15-minute lock. */
  | { status: "locked"; idle: boolean }
  | {
      status: "unlocked";
      remembered: boolean;
      /** Set right after setup, until the user says it is saved. */
      recoveryKey: string | null;
    };

export type VaultErrorCode =
  /** Another tab or device set up keys first; unlock with that passphrase. */
  | "already-set-up"
  /** Another tab or device replaced this key a moment ago; nothing was changed here. */
  | "changed-elsewhere"
  /** The flow needs a state the vault is not in (a bug, or a race with Lock). */
  | "wrong-state";

export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

export interface VaultDeps {
  api: VaultApi;
  deviceKeys: DeviceKeyStore;
  tabs: Tabs;
  /** localStorage in the browser: a Lock whose server half is still to delete. */
  local: KeyValueStore;
  /** sessionStorage in the browser: why the page reloaded locked. */
  session: KeyValueStore;
  isSecureContext: () => boolean;
  /** Starts the idle lock for this tab; returns a function that stops it. */
  watchIdle: (onIdle: () => void) => () => void;
  /**
   * After a Lock: the app forgets everything decrypted. `here` is false when
   * another tab locked; the page then reloads, whatever the reason.
   */
  afterLock: (reason: LockReason, here: boolean) => void;
  /** Argon2id settings for new passphrase slots; tests pass cheaper ones. */
  kdf?: KdfParams;
}

interface Keys {
  passphrase: PassphraseSlot;
  recovery: RecoverySlot;
  check: KeyCheck;
}

const IDLE_NOTE = "keyworth-locked-idle";
const FORGET_DEVICE = "keyworth-forget-device";
/** Upgrading Argon2 settings needs this much of the fresh sign-in left. */
const UPGRADE_MIN_FRESH_SECONDS = 60;

function parseKeys(json: NonNullable<KeysJson["keys"]>): Keys {
  return {
    passphrase: passphraseSlotFromJson(json.passphrase),
    recovery: recoverySlotFromJson(json.recovery),
    check: keyCheckFromJson(json.check),
  };
}

const ignore = () => undefined;

export class Vault {
  private state: VaultState = { status: "starting" };
  private readonly listeners = new Set<() => void>();
  private userId: string | null = null;
  private keys: Keys | null = null;
  private dataKey: CryptoKey | null = null;
  private remembered = false;
  /** The Lock epoch when this tab unlocked; a later Lock anywhere ends it. */
  private unlockEpoch = -1;
  private stopIdle: (() => void) | null = null;
  private started: Promise<void> | null = null;
  private readonly deps: VaultDeps;

  constructor(deps: VaultDeps) {
    this.deps = deps;
    deps.tabs.serve((userId) => this.offer(userId));
    deps.tabs.onLocked((reason) => {
      this.lockedElsewhere(reason);
    });
    deps.tabs.onUnlocked((userId) => {
      void this.unlockedElsewhere(userId);
    });
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): VaultState => this.state;

  private set(state: VaultState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  /**
   * Loads the keys for this user and opens the data key without a passphrase
   * when it can: from another tab, then from a remembered device. Runs once
   * per user; `retry` runs it again after a failure.
   */
  start(userId: string): Promise<void> {
    if (this.userId === userId && this.started) return this.started;
    this.forgetKey();
    this.userId = userId;
    this.keys = null;
    this.started = this.open(userId);
    return this.started;
  }

  retry(): Promise<void> {
    const userId = this.userId;
    if (!userId) return Promise.resolve();
    this.started = null;
    return this.start(userId);
  }

  private async open(userId: string): Promise<void> {
    if (!this.deps.isSecureContext()) {
      this.set({ status: "insecure" });
      return;
    }
    this.set({ status: "starting" });
    await this.finishForgettingDevice();
    // Asked at once, answered while the keys load.
    const offered = this.deps.tabs.requestKey(userId);
    let json: KeysJson["keys"];
    try {
      json = await this.deps.api.keys();
    } catch {
      this.set({ status: "failed" });
      return;
    }
    if (this.userId !== userId) return;
    if (!json) {
      this.set({ status: "no-keys" });
      return;
    }
    try {
      this.keys = parseKeys(json);
    } catch {
      this.set({ status: "failed" });
      return;
    }
    const offer = await offered;
    if (offer && (await this.accept(userId, offer))) return;
    if (await this.openWithDevice(userId)) return;
    if (this.userId !== userId || this.state.status === "unlocked") return;
    const idle = this.deps.session.get(IDLE_NOTE) !== null;
    this.deps.session.remove(IDLE_NOTE);
    this.set({ status: "locked", idle });
  }

  /** A key from another tab: used only if it is this account's (check value). */
  private async accept(userId: string, offer: KeyOffer): Promise<boolean> {
    if (!(await this.verified(userId, offer.dataKey))) return false;
    if (this.userId !== userId || this.state.status === "unlocked") {
      return this.state.status === "unlocked";
    }
    this.becomeUnlocked(offer.dataKey, offer.remembered, null);
    return true;
  }

  private async verified(userId: string, dataKey: CryptoKey) {
    if (!this.keys) return false;
    try {
      await verifyKeyCheck(dataKey, userId, this.keys.check);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * "Remember this device": the device key from IndexedDB and the server half
   * of this session. When only one half exists (the browser's data was
   * cleared, the server's half expired), both are dropped.
   */
  private async openWithDevice(userId: string): Promise<boolean> {
    const deviceKey = await this.deps.deviceKeys.load(userId).catch(() => null);
    let slot: unknown;
    try {
      slot = await this.deps.api.deviceSlot();
    } catch {
      return false; // Offline: the passphrase still works.
    }
    if (deviceKey && slot) {
      try {
        const dataKey = await unlockWithDevice({
          userId,
          deviceKey,
          deviceSlot: deviceSlotFromJson(slot),
        });
        if (await this.verified(userId, dataKey)) {
          if (this.userId === userId && this.state.status !== "unlocked") {
            this.becomeUnlocked(dataKey, true, null);
          }
          return true;
        }
      } catch {
        // A damaged or foreign half: forget both, below.
      }
    }
    if (deviceKey) await this.deps.deviceKeys.remove(userId).catch(ignore);
    if (deviceKey || slot) await this.forgetServerDevice();
    return false;
  }

  /** Also tells locked tabs of this user to ask for the key now. */
  private becomeUnlocked(
    dataKey: CryptoKey,
    remembered: boolean,
    recoveryKey: string | null,
  ) {
    const userId = this.userId;
    if (!userId) return;
    this.dataKey = dataKey;
    this.remembered = remembered;
    this.unlockEpoch = this.deps.tabs.epoch();
    this.stopIdle?.();
    this.stopIdle = remembered
      ? null
      : this.deps.watchIdle(() => void this.lock("idle"));
    this.set({ status: "unlocked", remembered, recoveryKey });
    this.deps.tabs.announceUnlocked(userId);
  }

  private offer(userId: string): KeyOffer | null {
    if (
      this.state.status !== "unlocked" ||
      this.userId !== userId ||
      !this.dataKey ||
      this.unlockEpoch !== this.deps.tabs.epoch()
    ) {
      return null;
    }
    return { dataKey: this.dataKey, remembered: this.remembered };
  }

  private async unlockedElsewhere(userId: string) {
    if (this.userId !== userId || this.state.status !== "locked") return;
    const offer = await this.deps.tabs.requestKey(userId, { announced: true });
    if (offer) await this.accept(userId, offer);
  }

  private forgetKey() {
    this.dataKey = null;
    this.remembered = false;
    this.unlockEpoch = -1;
    this.stopIdle?.();
    this.stopIdle = null;
    this.deps.tabs.leave();
  }

  /**
   * The page was frozen or restored from the back-forward cache: it may have
   * missed a Lock while it could not hear the other tabs.
   */
  wake() {
    if (
      this.state.status === "unlocked" &&
      this.unlockEpoch !== this.deps.tabs.epoch()
    ) {
      this.lockedElsewhere("lock");
    }
  }

  private lockedElsewhere(reason: LockReason) {
    const holding = this.state.status === "unlocked";
    // A locked tab has nothing to forget, unless the user signed out.
    if (!holding && reason !== "sign-out") return;
    this.forgetKey();
    if (reason === "idle") this.deps.session.set(IDLE_NOTE, "1");
    if (this.keys) this.set({ status: "locked", idle: reason === "idle" });
    this.deps.afterLock(reason, false);
  }

  /**
   * Lock, in every tab: a new epoch first (so no tab hands the key out
   * afterwards), then both halves of a remembered device, then the key in
   * memory. The app then forgets what it decrypted (`afterLock`).
   */
  async lock(reason: LockReason): Promise<void> {
    const userId = this.userId;
    const wasRemembered = this.remembered;
    this.deps.tabs.announceLocked(reason);
    this.forgetKey();
    if (reason === "idle") this.deps.session.set(IDLE_NOTE, "1");
    // Leaving for Google: the unlock screen would only flash before the page goes.
    if (this.keys && reason !== "reauthenticate") {
      this.set({ status: "locked", idle: reason === "idle" });
    }
    if (userId) await this.deps.deviceKeys.remove(userId).catch(ignore);
    // Signing out deletes the session, and the server half with it.
    if (wasRemembered && reason !== "sign-out") await this.forgetServerDevice();
    this.deps.afterLock(reason, true);
  }

  /** Deletes the server half; if that fails (offline), again at the next start. */
  private async forgetServerDevice() {
    try {
      await this.deps.api.forgetDevice();
      this.deps.local.remove(FORGET_DEVICE);
    } catch {
      this.deps.local.set(FORGET_DEVICE, "1");
    }
  }

  private async finishForgettingDevice() {
    if (this.deps.local.get(FORGET_DEVICE) === null) return;
    await this.forgetServerDevice();
  }

  private require(...statuses: VaultState["status"][]): {
    userId: string;
    keys: Keys;
  } {
    const { userId, keys } = this;
    if (!userId || !keys || !statuses.includes(this.state.status)) {
      throw new VaultError("wrong-state", `Expected ${statuses.join(" or ")}.`);
    }
    return { userId, keys };
  }

  /**
   * First sign-in: new keys, stored on the server, then the recovery key to
   * show. Shown only once the server has the slots it opens (a 201, or a
   * stored passphrase slot with this setup's IV after a lost answer).
   */
  async createKeys(passphrase: string, onProgress?: OnProgress): Promise<void> {
    const userId = this.userId;
    if (!userId || this.state.status !== "no-keys") {
      throw new VaultError("wrong-state", "Keys exist already.");
    }
    const made = await createKeys({
      userId,
      passphrase,
      kdf: this.deps.kdf ?? CURRENT_KDF_PARAMS,
      ...(onProgress && { onProgress }),
    });
    const body = {
      passphrase: passphraseSlotToJson(made.passphraseSlot),
      recovery: recoverySlotToJson(made.recoverySlot),
      check: keyCheckToJson(made.keyCheck),
    };
    try {
      await this.deps.api.setUpKeys(body);
    } catch (error) {
      // A 409, or an answer lost on the way: whose keys does the server hold?
      let stored: KeysJson["keys"];
      try {
        stored = await this.deps.api.keys();
      } catch {
        throw error;
      }
      if (stored?.passphrase.iv !== body.passphrase.iv) {
        if (!stored) throw error;
        this.keys = parseKeys(stored);
        this.set({ status: "locked", idle: false });
        throw new VaultError(
          "already-set-up",
          "Keys were set up in another tab or device.",
        );
      }
    }
    this.keys = {
      passphrase: made.passphraseSlot,
      recovery: made.recoverySlot,
      check: made.keyCheck,
    };
    // Made together with its check value: nothing to verify against yet.
    this.becomeUnlocked(made.dataKey, false, made.recoveryKey);
  }

  /** The user kept the recovery key shown after setup. */
  recoveryKeySaved() {
    if (this.state.status === "unlocked" && this.state.recoveryKey !== null) {
      this.set({ ...this.state, recoveryKey: null });
    }
  }

  /**
   * Unlocks with the passphrase; with `remember`, also remembers this device.
   * Returns whether the device is remembered: remembering can fail (offline,
   * storage blocked) while the unlock itself worked.
   */
  async unlock(
    passphrase: string,
    {
      remember = false,
      onProgress,
    }: { remember?: boolean; onProgress?: OnProgress } = {},
  ): Promise<{ remembered: boolean }> {
    const { userId, keys } = this.require("locked");
    const problem = checkPassphrase(passphrase);
    if (problem === "not-latin") {
      throw new CryptoError("not-latin", "Use plain Latin characters only.");
    }
    // Every stored passphrase passed checkPassphrase: this one cannot be it.
    if (problem) {
      throw new CryptoError("wrong-secret", "This passphrase cannot be right.");
    }
    const { dataKey, device } = await unlockWithPassphrase({
      userId,
      slot: keys.passphrase,
      passphrase,
      remember,
      ...(onProgress && { onProgress }),
    });
    if (!(await this.verified(userId, dataKey))) {
      throw new CryptoError(
        "wrong-secret",
        "The key does not match its check value.",
      );
    }
    await this.upgradeKdf(userId, passphrase);
    let remembered = false;
    if (device) {
      try {
        await this.deps.deviceKeys.save(userId, device.deviceKey);
        await this.deps.api.rememberDevice(deviceSlotToJson(device.deviceSlot));
        remembered = true;
      } catch {
        await this.deps.deviceKeys.remove(userId).catch(ignore);
      }
    }
    if (this.userId === userId) {
      this.becomeUnlocked(dataKey, remembered, null);
    }
    return { remembered };
  }

  /**
   * Rewraps the passphrase slot with the current Argon2 settings when the
   * stored ones are weaker. Replacing a slot needs a recent Google sign-in, so
   * this happens only at an unlock soon after one; otherwise at a later one.
   */
  private async upgradeKdf(userId: string, passphrase: string) {
    const keys = this.keys;
    if (!keys || !kdfNeedsUpgrade(keys.passphrase.kdf)) return;
    try {
      const me = await this.deps.api.me();
      if (me.freshForSeconds < UPGRADE_MIN_FRESH_SECONDS) return;
      const slot = await changePassphrase({
        userId,
        slot: keys.passphrase,
        currentPassphrase: passphrase,
        newPassphrase: passphrase,
        kdf: CURRENT_KDF_PARAMS,
      });
      await this.replaceSlot(slot);
    } catch {
      // Best effort: the old settings keep working.
    }
  }

  /** A forgotten passphrase: the recovery key opens the data, a new passphrase wraps it. */
  async resetPassphrase(
    recoveryKey: string,
    newPassphrase: string,
    onProgress?: OnProgress,
  ): Promise<void> {
    const { userId, keys } = this.require("locked");
    const { dataKey, passphraseSlot } = await resetPassphrase({
      userId,
      recoverySlot: keys.recovery,
      recoveryKey,
      newPassphrase,
      kdf: this.deps.kdf ?? CURRENT_KDF_PARAMS,
      ...(onProgress && { onProgress }),
    });
    if (!(await this.verified(userId, dataKey))) {
      throw new CryptoError(
        "wrong-secret",
        "The key does not match its check value.",
      );
    }
    await this.replaceSlot(passphraseSlot);
    if (this.userId === userId) {
      this.becomeUnlocked(dataKey, false, null);
    }
  }

  async changePassphrase(
    currentPassphrase: string,
    newPassphrase: string,
    onProgress?: OnProgress,
  ): Promise<void> {
    const { userId, keys } = this.require("unlocked");
    const slot = await changePassphrase({
      userId,
      slot: keys.passphrase,
      currentPassphrase,
      newPassphrase,
      kdf: this.deps.kdf ?? CURRENT_KDF_PARAMS,
      ...(onProgress && { onProgress }),
    });
    await this.replaceSlot(slot);
  }

  /** A new recovery key; the old one stops working. Returns the key to show once. */
  async createRecoveryKey(
    passphrase: string,
    onProgress?: OnProgress,
  ): Promise<string> {
    const { userId, keys } = this.require("unlocked");
    const { recoverySlot, recoveryKey } = await replaceRecoveryKey({
      userId,
      passphraseSlot: keys.passphrase,
      passphrase,
      ...(onProgress && { onProgress }),
    });
    await this.replaceSlot(recoverySlot);
    return recoveryKey;
  }

  /**
   * Replaces a slot on the server, naming the one it replaces by its IV. A
   * 409 that names this new slot's IV, or a stored slot with it after a lost
   * answer, means the write went through. Any other slot means someone else
   * replaced it first: nothing changed here, and the vault reloads the keys.
   */
  private async replaceSlot(
    slot: PassphraseSlot | RecoverySlot,
  ): Promise<void> {
    const { keys } = this.require("locked", "unlocked");
    const { kind } = slot;
    const expectedIv = toBase64url(keys[kind].iv);
    const iv = toBase64url(slot.iv);
    try {
      if (slot.kind === "passphrase") {
        await this.deps.api.replacePassphrase(
          expectedIv,
          passphraseSlotToJson(slot),
        );
      } else {
        await this.deps.api.replaceRecovery(
          expectedIv,
          recoverySlotToJson(slot),
        );
      }
    } catch (error) {
      const stored = await this.storedIv(kind, error);
      if (stored !== iv) {
        if (stored !== null) await this.reloadKeys();
        if (error instanceof ApiError && error.status === 409) {
          throw new VaultError(
            "changed-elsewhere",
            "This key was changed in another tab or device.",
          );
        }
        throw error;
      }
    }
    if (slot.kind === "passphrase") keys.passphrase = slot;
    else keys.recovery = slot;
  }

  /** The IV the server holds after a failed replace, when it can be known. */
  private async storedIv(
    kind: "passphrase" | "recovery",
    error: unknown,
  ): Promise<string | null> {
    if (error instanceof ApiError) {
      return error.status === 409 && typeof error.body.iv === "string"
        ? error.body.iv
        : null;
    }
    try {
      return (await this.deps.api.keys())?.[kind].iv ?? null;
    } catch {
      return null;
    }
  }

  private async reloadKeys() {
    try {
      const json = await this.deps.api.keys();
      if (json) this.keys = parseKeys(json);
    } catch {
      // Kept as they were; the next start reloads them.
    }
  }

  /** Encrypts a record for `PUT /api/vault/:id`; `revision` is the one it will be stored with. */
  async encrypt(
    kind: RecordKind,
    recordId: string,
    revision: number,
    value: unknown,
  ): Promise<Envelope> {
    const { userId } = this.require("unlocked");
    if (!this.dataKey) throw new VaultError("wrong-state", "Locked.");
    return encryptRecord(
      this.dataKey,
      { userId, kind, recordId, revision },
      value,
    );
  }

  async decrypt(
    kind: RecordKind,
    recordId: string,
    revision: number,
    envelope: unknown,
  ): Promise<unknown> {
    const { userId } = this.require("unlocked");
    if (!this.dataKey) throw new VaultError("wrong-state", "Locked.");
    return decryptRecord(
      this.dataKey,
      { userId, kind, recordId, revision },
      envelope,
    );
  }
}
