import { afterEach, describe, expect, it } from "vitest";
import {
  CryptoError,
  CURRENT_KDF_PARAMS,
  passphraseSlotFromJson,
  unlockWithPassphrase,
} from "../../../src/crypto/index.ts";
import { derivePassphraseKek } from "../../../src/crypto/kdf.ts";
import { keySlotAad, unwrapDataKey } from "../../../src/crypto/keys.ts";
import { ApiError } from "../../../src/vault/api.ts";
import { VaultError } from "../../../src/vault/vault.ts";
import { ALICE, BOB } from "../crypto/fixtures.ts";
import {
  fakeBrowser,
  fakeServer,
  PASSPHRASE,
  settled,
} from "./fake-browser.ts";

/*
 * The vault's flows against a fake server with the real API's rules, and tabs
 * that talk over real BroadcastChannels. Argon2 runs with OWASP's minimum
 * settings (FAST_KDF) except where the production settings are the point.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function browser(server = fakeServer()) {
  const created = fakeBrowser(server);
  cleanups.push(() => {
    created.closeAll();
  });
  return created;
}

/** A browser whose user has set up keys; returns the recovery key too. */
async function withKeys() {
  const b = browser();
  const setup = b.openTab();
  await setup.vault.start(ALICE);
  await setup.vault.createKeys(PASSPHRASE);
  const state = setup.vault.getState();
  if (state.status !== "unlocked" || !state.recoveryKey) {
    throw new Error("Setup did not unlock.");
  }
  const recoveryKey = state.recoveryKey;
  setup.close();
  return { b, recoveryKey };
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CryptoError || error instanceof VaultError) {
      return error.code;
    }
    if (error instanceof ApiError) return `api:${error.code}`;
    throw error;
  }
  return "no error";
}

describe("first sign-in", () => {
  it("has no keys, sets them up, and shows the recovery key until it is saved", async () => {
    const b = browser();
    const tab = b.openTab();
    await tab.vault.start(ALICE);
    expect(tab.vault.getState()).toEqual({ status: "no-keys" });

    await tab.vault.createKeys(PASSPHRASE);

    const state = tab.vault.getState();
    expect(state).toMatchObject({ status: "unlocked", remembered: false });
    expect(state.status === "unlocked" && state.recoveryKey).toMatch(
      /^([0-9A-Z]{4}-){8}[0-9A-Z]{4}$/,
    );
    expect(b.server.keys).not.toBeNull();
    tab.vault.recoveryKeySaved();
    expect(tab.vault.getState()).toEqual({
      status: "unlocked",
      remembered: false,
      recoveryKey: null,
    });
  });

  it("refuses a passphrase that is not plain Latin before running Argon2", async () => {
    const tab = browser().openTab();
    await tab.vault.start(ALICE);

    expect(await code(tab.vault.createKeys("фиолетовый слон танцует"))).toBe(
      "not-latin",
    );
    expect(tab.vault.getState()).toEqual({ status: "no-keys" });
  });

  it("goes to unlock when another tab or device set up keys first", async () => {
    const server = fakeServer();
    const first = browser(server).openTab();
    const second = browser(server).openTab();
    await first.vault.start(ALICE);
    await second.vault.start(ALICE);

    await first.vault.createKeys(PASSPHRASE);

    expect(await code(second.vault.createKeys("another passphrase here"))).toBe(
      "already-set-up",
    );
    expect(second.vault.getState()).toEqual({ status: "locked", idle: false });
    await second.vault.unlock(PASSPHRASE);
    expect(second.vault.getState().status).toBe("unlocked");
  });

  it("counts a setup whose answer was lost as done, and shows the key", async () => {
    const b = browser();
    const tab = b.openTab();
    await tab.vault.start(ALICE);
    b.server.state.answerLost.add("setUpKeys");

    await tab.vault.createKeys(PASSPHRASE);

    expect(tab.vault.getState()).toMatchObject({ status: "unlocked" });
  });

  it("reports a setup that never reached the server", async () => {
    const b = browser();
    const tab = b.openTab();
    await tab.vault.start(ALICE);
    b.server.state.offline.add("setUpKeys");

    await expect(tab.vault.createKeys(PASSPHRASE)).rejects.toThrow(TypeError);
    expect(tab.vault.getState()).toEqual({ status: "no-keys" });
  });
});

describe("unlocking", () => {
  it("starts locked and opens only with the right passphrase", async () => {
    const { b } = await withKeys();
    const tab = b.openTab();
    await tab.vault.start(ALICE);
    expect(tab.vault.getState()).toEqual({ status: "locked", idle: false });

    expect(await code(tab.vault.unlock("not the passphrase at all"))).toBe(
      "wrong-secret",
    );
    expect(await code(tab.vault.unlock("short"))).toBe("wrong-secret");
    expect(await code(tab.vault.unlock("пароль на кириллице"))).toBe(
      "not-latin",
    );
    expect(tab.vault.getState().status).toBe("locked");

    await tab.vault.unlock(PASSPHRASE);
    expect(tab.vault.getState()).toEqual({
      status: "unlocked",
      remembered: false,
      recoveryKey: null,
    });
    expect(tab.watchingIdle).toBe(true);
  });

  it("refuses keys whose check value belongs to another account", async () => {
    const { b } = await withKeys();
    // A passphrase slot that opens, next to someone else's check value.
    const other = await withKeys();
    const keys = b.server.keys;
    if (!keys || !other.b.server.keys) throw new Error("Expected keys.");
    b.server.keys = { ...keys, check: other.b.server.keys.check };
    const tab = b.openTab();
    await tab.vault.start(ALICE);

    expect(await code(tab.vault.unlock(PASSPHRASE))).toBe("wrong-secret");
    expect(tab.vault.getState().status).toBe("locked");
  });

  it("is 'failed' when the keys cannot be loaded, and recovers on retry", async () => {
    const { b } = await withKeys();
    b.server.state.offline.add("keys");
    const tab = b.openTab();
    await tab.vault.start(ALICE);
    expect(tab.vault.getState()).toEqual({ status: "failed" });

    b.server.state.offline.clear();
    await tab.vault.retry();
    expect(tab.vault.getState().status).toBe("locked");
  });

  it("says when the page cannot do cryptography", async () => {
    const page = browser().openTab({ secure: false });
    await page.vault.start(ALICE);
    expect(page.vault.getState()).toEqual({ status: "insecure" });
  });
});

describe("tabs", () => {
  it("a new tab gets the key from an unlocked one, without the passphrase", async () => {
    const { b } = await withKeys();
    const first = b.openTab();
    await first.vault.start(ALICE);
    await first.vault.unlock(PASSPHRASE);

    const second = b.openTab();
    await second.vault.start(ALICE);

    expect(second.vault.getState()).toEqual({
      status: "unlocked",
      remembered: false,
      recoveryKey: null,
    });
  });

  it("unlocking one tab unlocks the others that wait", async () => {
    const { b } = await withKeys();
    const first = b.openTab();
    const second = b.openTab();
    await first.vault.start(ALICE);
    await second.vault.start(ALICE);
    expect(second.vault.getState().status).toBe("locked");

    await first.vault.unlock(PASSPHRASE);

    await settled(second.vault, "unlocked");
  });

  it("Lock in one tab locks every tab", async () => {
    const { b } = await withKeys();
    const first = b.openTab();
    await first.vault.start(ALICE);
    await first.vault.unlock(PASSPHRASE);
    const second = b.openTab();
    await second.vault.start(ALICE);
    expect(second.vault.getState().status).toBe("unlocked");

    await first.vault.lock("lock");

    expect(first.vault.getState()).toEqual({ status: "locked", idle: false });
    expect(first.events).toEqual([{ reason: "lock", here: true }]);
    await settled(second.vault, "locked");
    expect(second.events).toEqual([{ reason: "lock", here: false }]);
    // A tab opened now finds nobody to ask.
    const third = b.openTab();
    await third.vault.start(ALICE);
    expect(third.vault.getState().status).toBe("locked");
  });

  it("a tab that slept through a Lock locks when it wakes up", async () => {
    const { b } = await withKeys();
    const tab = b.openTab();
    await tab.vault.start(ALICE);
    await tab.vault.unlock(PASSPHRASE);
    tab.vault.wake();
    expect(tab.vault.getState().status).toBe("unlocked");

    // Another tab locked while this one was frozen and heard nothing.
    b.local.set("keyworth-lock-epoch", "7");
    tab.vault.wake();

    expect(tab.vault.getState().status).toBe("locked");
    expect(tab.events).toEqual([{ reason: "lock", here: false }]);
  });

  it("a tab signed in as someone else does not answer", async () => {
    const { b } = await withKeys();
    const bob = b.openTab({ api: fakeServer(BOB).api });
    await bob.vault.start(BOB);
    await bob.vault.createKeys(PASSPHRASE);

    const alice = b.openTab();
    await alice.vault.start(ALICE);

    expect(alice.vault.getState().status).toBe("locked");
  });

  describe("an answer from elsewhere on the channel", () => {
    /** Plays an unlocked tab of Alice's that answers with the given key and epoch. */
    function impostor(
      b: ReturnType<typeof browser>,
      dataKey: CryptoKey,
      epoch: number,
    ) {
      let release: () => void = () => undefined;
      void b.locks.request(
        `keyworth-unlocked:${ALICE}`,
        { mode: "shared" },
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const channel = new BroadcastChannel(b.channelName);
      channel.onmessage = (event: MessageEvent) => {
        const message = event.data as { type: string; nonce: string };
        if (message.type !== "need-key") return;
        channel.postMessage({
          type: "key",
          nonce: message.nonce,
          userId: ALICE,
          epoch,
          dataKey,
          remembered: false,
        });
      };
      cleanups.push(() => {
        release();
        channel.close();
      });
    }

    async function alicesKey(b: ReturnType<typeof browser>) {
      const { dataKey } = await unlockWithPassphrase({
        userId: ALICE,
        slot: passphraseSlotFromJson(b.server.keys?.passphrase),
        passphrase: PASSPHRASE,
      });
      return dataKey;
    }

    it("is taken when its key and epoch are right", async () => {
      const { b } = await withKeys();
      impostor(b, await alicesKey(b), 0);
      const tab = b.openTab();
      await tab.vault.start(ALICE);
      expect(tab.vault.getState().status).toBe("unlocked");
    });

    it("is refused when it was made before the latest Lock", async () => {
      const { b } = await withKeys();
      b.local.set("keyworth-lock-epoch", "3");
      impostor(b, await alicesKey(b), 2);
      const tab = b.openTab();
      await tab.vault.start(ALICE);
      expect(tab.vault.getState().status).toBe("locked");
    });

    it("is refused when the key is not this account's (check value)", async () => {
      const { b } = await withKeys();
      const foreign = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
      impostor(b, foreign, 0);
      const tab = b.openTab();
      await tab.vault.start(ALICE);
      expect(tab.vault.getState().status).toBe("locked");
    });

    it("is refused when the key could be read out (extractable), even the right one", async () => {
      const { b } = await withKeys();
      const slot = passphraseSlotFromJson(b.server.keys?.passphrase);
      const kek = await derivePassphraseKek(PASSPHRASE, slot.salt, slot.kdf);
      const extractable = await unwrapDataKey(
        slot,
        kek,
        keySlotAad(ALICE, "passphrase"),
        { extractable: true },
      );
      impostor(b, extractable, 0);
      const tab = b.openTab();
      await tab.vault.start(ALICE);
      expect(tab.vault.getState().status).toBe("locked");
    });
  });
});

describe("Remember this device", () => {
  it("opens after a reload without the passphrase, and Lock forgets both halves", async () => {
    const { b } = await withKeys();
    const tab = b.openTab();
    await tab.vault.start(ALICE);

    expect(await tab.vault.unlock(PASSPHRASE, { remember: true })).toEqual({
      remembered: true,
    });
    expect(tab.watchingIdle).toBe(false);
    expect(b.deviceKeys.keys.has(ALICE)).toBe(true);
    expect(b.server.device).not.toBeNull();
    tab.close();

    const reloaded = b.openTab();
    await reloaded.vault.start(ALICE);
    expect(reloaded.vault.getState()).toEqual({
      status: "unlocked",
      remembered: true,
      recoveryKey: null,
    });

    await reloaded.vault.lock("lock");
    expect(b.deviceKeys.keys.has(ALICE)).toBe(false);
    expect(b.server.device).toBeNull();
  });

  it("drops a device key whose server half is gone, and a server half without its key", async () => {
    const { b } = await withKeys();
    const tab = b.openTab();
    await tab.vault.start(ALICE);
    await tab.vault.unlock(PASSPHRASE, { remember: true });
    tab.close();

    const halfAndHalf = b.server.device;
    b.server.device = null; // Expired after 14 days, or signed out elsewhere.
    const reloaded = b.openTab();
    await reloaded.vault.start(ALICE);
    expect(reloaded.vault.getState().status).toBe("locked");
    expect(b.deviceKeys.keys.has(ALICE)).toBe(false);
    reloaded.close();

    b.server.device = halfAndHalf; // The browser's storage was cleared.
    const again = b.openTab();
    await again.vault.start(ALICE);
    expect(again.vault.getState().status).toBe("locked");
    expect(b.server.device).toBeNull();
  });

  it("still unlocks when remembering fails, and keeps no device key", async () => {
    const { b } = await withKeys();
    b.server.state.offline.add("rememberDevice");
    const tab = b.openTab();
    await tab.vault.start(ALICE);

    expect(await tab.vault.unlock(PASSPHRASE, { remember: true })).toEqual({
      remembered: false,
    });
    expect(tab.vault.getState()).toMatchObject({ status: "unlocked" });
    expect(b.deviceKeys.keys.has(ALICE)).toBe(false);
    expect(tab.watchingIdle).toBe(true);
  });

  it("deletes the server half at the next start when Lock was offline", async () => {
    const { b } = await withKeys();
    const tab = b.openTab();
    await tab.vault.start(ALICE);
    await tab.vault.unlock(PASSPHRASE, { remember: true });
    b.server.state.offline.add("forgetDevice");

    await tab.vault.lock("lock");
    expect(b.server.device).not.toBeNull();

    b.server.state.offline.clear();
    const reloaded = b.openTab();
    await reloaded.vault.start(ALICE);
    expect(b.server.device).toBeNull();
    expect(reloaded.vault.getState().status).toBe("locked");
  });
});

describe("idle lock", () => {
  it("locks every tab and says so after the reload", async () => {
    const { b } = await withKeys();
    const first = b.openTab();
    await first.vault.start(ALICE);
    await first.vault.unlock(PASSPHRASE);
    const second = b.openTab();
    await second.vault.start(ALICE);

    first.goIdle();

    await settled(first.vault, "locked");
    expect(first.vault.getState()).toEqual({ status: "locked", idle: true });
    await settled(second.vault, "locked");
    const reloaded = b.openTab({ session: first.session });
    await reloaded.vault.start(ALICE);
    expect(reloaded.vault.getState()).toEqual({ status: "locked", idle: true });
    // Said once: the next reload is a plain one.
    const later = b.openTab({ session: first.session });
    await later.vault.start(ALICE);
    expect(later.vault.getState()).toEqual({ status: "locked", idle: false });
  });
});

describe("changing keys", () => {
  it("resets a forgotten passphrase with the recovery key, which keeps working", async () => {
    const { b, recoveryKey } = await withKeys();
    const tab = b.openTab();
    await tab.vault.start(ALICE);
    b.server.state.freshForSeconds = 600;

    expect(
      await code(
        tab.vault.resetPassphrase(
          "0000-0000-0000-0000-0000-0000-0000-0000-0000",
          "a brand new passphrase",
        ),
      ),
    ).toMatch(/mistyped|wrong-secret/);
    await tab.vault.resetPassphrase(recoveryKey, "a brand new passphrase");
    expect(tab.vault.getState().status).toBe("unlocked");
    await tab.vault.lock("lock");
    b.server.state.freshForSeconds = 0;

    const next = b.openTab();
    await next.vault.start(ALICE);
    expect(await code(next.vault.unlock(PASSPHRASE))).toBe("wrong-secret");
    await next.vault.unlock("a brand new passphrase");
    await next.vault.lock("lock");

    b.server.state.freshForSeconds = 600;
    const again = b.openTab();
    await again.vault.start(ALICE);
    await again.vault.resetPassphrase(recoveryKey, "yet another passphrase");
    expect(again.vault.getState().status).toBe("unlocked");
  });

  it("changes the passphrase", async () => {
    const { b } = await withKeys();
    const tab = b.openTab();
    await tab.vault.start(ALICE);
    await tab.vault.unlock(PASSPHRASE);
    b.server.state.freshForSeconds = 600;

    expect(
      await code(
        tab.vault.changePassphrase("a wrong current one", "the new passphrase"),
      ),
    ).toBe("wrong-secret");
    await tab.vault.changePassphrase(PASSPHRASE, "the new passphrase");
    await tab.vault.lock("lock");
    b.server.state.freshForSeconds = 0;

    const next = b.openTab();
    await next.vault.start(ALICE);
    await next.vault.unlock("the new passphrase");
    expect(next.vault.getState().status).toBe("unlocked");
  });

  it("refuses the change when another device replaced the passphrase first", async () => {
    const { b } = await withKeys();
    const here = b.openTab();
    await here.vault.start(ALICE);
    await here.vault.unlock(PASSPHRASE);
    const elsewhere = browser(b.server).openTab();
    await elsewhere.vault.start(ALICE);
    await elsewhere.vault.unlock(PASSPHRASE);
    b.server.state.freshForSeconds = 600;
    await elsewhere.vault.changePassphrase(PASSPHRASE, "changed elsewhere");

    expect(
      await code(here.vault.changePassphrase(PASSPHRASE, "changed here too")),
    ).toBe("changed-elsewhere");
    // The keys were reloaded: the change made elsewhere is what counts.
    await here.vault.changePassphrase("changed elsewhere", "changed here too");
  });

  it("counts a change whose answer was lost as done", async () => {
    const { b } = await withKeys();
    const tab = b.openTab();
    await tab.vault.start(ALICE);
    await tab.vault.unlock(PASSPHRASE);
    b.server.state.freshForSeconds = 600;
    b.server.state.answerLost.add("replacePassphrase");

    await tab.vault.changePassphrase(PASSPHRASE, "the new passphrase");

    b.server.state.answerLost.clear();
    await tab.vault.changePassphrase("the new passphrase", "and once more");
  });

  it("refuses a replace without a recent sign-in", async () => {
    const { b } = await withKeys();
    const tab = b.openTab();
    await tab.vault.start(ALICE);
    await tab.vault.unlock(PASSPHRASE);

    expect(
      await code(tab.vault.changePassphrase(PASSPHRASE, "the new passphrase")),
    ).toBe("api:session_not_fresh");
  });

  it("creates a new recovery key; the old one stops working", async () => {
    const { b, recoveryKey } = await withKeys();
    const tab = b.openTab();
    await tab.vault.start(ALICE);
    await tab.vault.unlock(PASSPHRASE);
    b.server.state.freshForSeconds = 600;

    const newKey = await tab.vault.createRecoveryKey(PASSPHRASE);
    expect(newKey).not.toBe(recoveryKey);
    await tab.vault.lock("lock");

    const next = b.openTab();
    await next.vault.start(ALICE);
    expect(
      await code(next.vault.resetPassphrase(recoveryKey, "a brand new one")),
    ).toBe("wrong-secret");
    await next.vault.resetPassphrase(newKey, "a brand new one");
  });

  it(
    "upgrades weaker Argon2 settings at an unlock right after a sign-in only",
    { timeout: 30_000 },
    async () => {
      const { b } = await withKeys();
      const kdfNow = () =>
        passphraseSlotFromJson(b.server.keys?.passphrase).kdf;
      b.server.state.freshForSeconds = 0;
      const stale = b.openTab();
      await stale.vault.start(ALICE);
      await stale.vault.unlock(PASSPHRASE);
      expect(kdfNow()).not.toEqual(CURRENT_KDF_PARAMS);
      // Locked, so the next tab cannot get the key from this one.
      await stale.vault.lock("lock");
      stale.close();

      b.server.state.freshForSeconds = 600;
      const fresh = b.openTab();
      await fresh.vault.start(ALICE);
      await fresh.vault.unlock(PASSPHRASE);
      expect(kdfNow()).toEqual(CURRENT_KDF_PARAMS);
    },
  );
});

describe("records", () => {
  it("only an unlocked vault encrypts or decrypts", async () => {
    const { b } = await withKeys();
    const tab = b.openTab();
    await tab.vault.start(ALICE);

    expect(
      await code(tab.vault.encrypt("settings", crypto.randomUUID(), 1, {})),
    ).toBe("wrong-state");
  });
});
