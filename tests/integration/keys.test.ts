import { describe, expect, it } from "vitest";
import { KDF_LIMITS } from "../../shared/schemas/keys.ts";
import {
  changePassphrase,
  createKeys,
  deviceSlotFromJson,
  deviceSlotToJson,
  type KdfParams,
  passphraseSlotFromJson,
  passphraseSlotToJson,
  recoverySlotToJson,
  unlockWithDevice,
  unlockWithPassphrase,
} from "../../src/crypto/index.ts";
import {
  api,
  fetchWorker,
  query,
  signedIn,
  signInWithGoogle,
} from "./helpers.ts";

// OWASP's minimum: the cheapest Argon2 settings the code accepts.
const FAST_KDF: KdfParams = {
  alg: "argon2id",
  version: 19,
  memoryKiB: KDF_LIMITS.minMemoryKiB,
  passes: KDF_LIMITS.minPasses,
  parallelism: 1,
};
const PASSPHRASE = "purple elephant dances at noon";

async function setUp(label: string) {
  const user = await signedIn(label);
  const keys = await createKeys({
    userId: user.userId,
    passphrase: PASSPHRASE,
    kdf: FAST_KDF,
  });
  const body = {
    passphrase: passphraseSlotToJson(keys.passphraseSlot),
    recovery: recoverySlotToJson(keys.recoverySlot),
  };
  return { user, keys, body };
}

async function storedKeys(cookie: string) {
  const response = await api("/api/keys", { cookie });
  expect(response.status).toBe(200);
  return (
    await response.json<{
      keys: { passphrase: unknown; recovery: unknown } | null;
    }>()
  ).keys;
}

describe("/api/keys", () => {
  it("needs a session", async () => {
    expect((await fetchWorker("/api/keys")).status).toBe(401);
  });

  it("has no keys before setup", async () => {
    const user = await signedIn("fresh");

    expect(await storedKeys(user.cookie)).toBeNull();
  });

  it("stores both slots once, and they still open the data key", async () => {
    const { user, body } = await setUp("setup");

    const created = await api("/api/keys", {
      cookie: user.cookie,
      method: "POST",
      body,
    });
    const stored = await storedKeys(user.cookie);
    const again = await api("/api/keys", {
      cookie: user.cookie,
      method: "POST",
      body,
    });

    expect(created.status).toBe(201);
    expect(stored).toEqual(body);
    expect(again.status).toBe(409);
    const { dataKey } = await unlockWithPassphrase({
      userId: user.userId,
      slot: passphraseSlotFromJson(stored?.passphrase),
      passphrase: PASSPHRASE,
    });
    expect(dataKey.extractable).toBe(false);
  });

  it("refuses malformed slots and Argon2 settings below OWASP's minimum", async () => {
    const { user, body } = await setUp("malformed");

    for (const bad of [
      { ...body, recovery: undefined },
      { ...body, passphrase: { ...body.passphrase, iv: "AAAA" } },
      {
        ...body,
        passphrase: { ...body.passphrase, kdf: { ...FAST_KDF, passes: 1 } },
      },
      { ...body, extra: "field" },
    ]) {
      const response = await api("/api/keys", {
        cookie: user.cookie,
        method: "POST",
        body: bad,
      });
      expect(response.status).toBe(400);
    }
    expect(await storedKeys(user.cookie)).toBeNull();
  });

  it("keeps each user's keys to themselves", async () => {
    const alice = await setUp("alice");
    const bob = await signedIn("bob");
    await api("/api/keys", {
      cookie: alice.user.cookie,
      method: "POST",
      body: alice.body,
    });

    expect(await storedKeys(bob.cookie)).toBeNull();
  });

  it("refuses requests from another origin, or with none", async () => {
    const { user, body } = await setUp("origin");

    for (const origin of ["https://evil.example", null]) {
      const response = await api("/api/keys", {
        cookie: user.cookie,
        method: "POST",
        body,
        origin,
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden_origin" });
    }
  });

  it("refuses an oversized body", async () => {
    const user = await signedIn("large");

    const response = await api("/api/keys", {
      cookie: user.cookie,
      method: "POST",
      body: { padding: "x".repeat(8 * 1024) },
    });

    expect(response.status).toBe(413);
  });

  it("limits key writes to 20 a minute per user", async () => {
    const user = await signedIn("limited");
    const write = () =>
      api("/api/keys", { cookie: user.cookie, method: "POST", body: {} });

    const allowed = await write();
    // Seeded rather than sent: see the rate-limit test in vault.test.ts.
    await query(
      "update api_rate_limits set count = 20 where user_id = $1 and bucket = 'keys'",
      [user.userId],
    );
    const limited = await write();
    const forget = await api("/api/keys/device", {
      cookie: user.cookie,
      method: "DELETE",
    });

    expect(allowed.status).toBe(400);
    expect(limited.status).toBe(429);
    // Lock writes too: it counts against the same budget.
    expect(forget.status).toBe(429);
  });
});

describe("replacing a slot", () => {
  it("accepts a new passphrase with a recent sign-in", async () => {
    const { user, body } = await setUp("change");
    await api("/api/keys", { cookie: user.cookie, method: "POST", body });
    const next = await changePassphrase({
      userId: user.userId,
      slot: passphraseSlotFromJson(body.passphrase),
      currentPassphrase: PASSPHRASE,
      newPassphrase: "a completely different phrase",
      kdf: FAST_KDF,
    });

    const response = await api("/api/keys/passphrase", {
      cookie: user.cookie,
      method: "PUT",
      body: passphraseSlotToJson(next),
    });

    expect(response.status).toBe(200);
    const stored = await storedKeys(user.cookie);
    await expect(
      unlockWithPassphrase({
        userId: user.userId,
        slot: passphraseSlotFromJson(stored?.passphrase),
        passphrase: "a completely different phrase",
      }),
    ).resolves.toBeTruthy();
  });

  it("needs a sign-in from the last 10 minutes", async () => {
    const { user, body } = await setUp("stale");
    await api("/api/keys", { cookie: user.cookie, method: "POST", body });
    await query(
      "update session set created_at = now() - interval '11 minutes' where user_id = $1",
      [user.userId],
    );

    for (const path of ["/api/keys/passphrase", "/api/keys/recovery"]) {
      const response = await api(path, {
        cookie: user.cookie,
        method: "PUT",
        body: path.endsWith("passphrase") ? body.passphrase : body.recovery,
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "session_not_fresh" });
    }
  });

  it("cannot replace a slot that was never set up", async () => {
    const { user, body } = await setUp("unset");

    const response = await api("/api/keys/recovery", {
      cookie: user.cookie,
      method: "PUT",
      body: body.recovery,
    });

    expect(response.status).toBe(404);
  });
});

describe("remembering a device", () => {
  async function remembered(label: string) {
    const { user, body } = await setUp(label);
    await api("/api/keys", { cookie: user.cookie, method: "POST", body });
    const { device } = await unlockWithPassphrase({
      userId: user.userId,
      slot: passphraseSlotFromJson(body.passphrase),
      passphrase: PASSPHRASE,
      remember: true,
    });
    if (!device) throw new Error("Expected a remembered device");
    const response = await api("/api/keys/device", {
      cookie: user.cookie,
      method: "POST",
      body: deviceSlotToJson(device.deviceSlot),
    });
    const deviceCookie = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("__Host-keyworth-device="));
    return { user, device, response, deviceCookie };
  }

  it("sets a session-only, httpOnly, Strict __Host- cookie", async () => {
    const { response, deviceCookie } = await remembered("cookie");

    expect(response.status).toBe(201);
    expect(deviceCookie).toBeDefined();
    expect(deviceCookie).toMatch(/; HttpOnly/i);
    expect(deviceCookie).toMatch(/; Secure/i);
    expect(deviceCookie).toMatch(/; SameSite=Strict/i);
    expect(deviceCookie).toMatch(/; Path=\//i);
    expect(deviceCookie).not.toMatch(/Max-Age|Expires/i);
  });

  it("returns the device slot only with that cookie, and it opens the data key", async () => {
    const { user, device, deviceCookie } = await remembered("unlock");
    const pair = deviceCookie?.split(";")[0] ?? "";

    const withCookie = await api("/api/keys/device", {
      cookie: `${user.cookie}; ${pair}`,
    });
    const without = await api("/api/keys/device", { cookie: user.cookie });

    expect(withCookie.status).toBe(200);
    expect(without.status).toBe(404);
    const dataKey = await unlockWithDevice({
      userId: user.userId,
      deviceKey: device.deviceKey,
      deviceSlot: deviceSlotFromJson(await withCookie.json()),
    });
    expect(dataKey.extractable).toBe(false);
  });

  it("belongs to one session: another sign-in with the same cookie gets nothing", async () => {
    const { user, deviceCookie } = await remembered("session");
    const pair = deviceCookie?.split(";")[0] ?? "";
    const other = await signInWithGoogle(user);

    const response = await api("/api/keys/device", {
      cookie: `${other.cookie}; ${pair}`,
    });

    expect(response.status).toBe(404);
  });

  it("is forgotten on Lock, and gone with the session on sign-out", async () => {
    const forgot = await remembered("forget");
    const forgotPair = forgot.deviceCookie?.split(";")[0] ?? "";
    const deleted = await api("/api/keys/device", {
      cookie: `${forgot.user.cookie}; ${forgotPair}`,
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
    expect(
      (
        await api("/api/keys/device", {
          cookie: `${forgot.user.cookie}; ${forgotPair}`,
        })
      ).status,
    ).toBe(404);

    const signedOut = await remembered("signout");
    await fetchWorker("/api/auth/sign-out", {
      method: "POST",
      headers: {
        cookie: signedOut.user.cookie,
        origin: "https://keyworth.test",
      },
    });
    expect(
      await query("select 1 from device_unlocks where user_id = $1", [
        signedOut.user.userId,
      ]),
    ).toEqual([]);
  });
});

describe("deleting the account", () => {
  it("removes the user's slots, records and remembered devices", async () => {
    const { user, body } = await setUp("cascade");
    await api("/api/keys", { cookie: user.cookie, method: "POST", body });

    const response = await api("/api/auth/delete-user", {
      cookie: user.cookie,
      method: "POST",
      body: {},
    });

    expect(response.status).toBe(200);
    for (const table of [
      "user_key_slots",
      "vault_records",
      "device_unlocks",
      "api_rate_limits",
    ]) {
      expect(
        await query(`select 1 from ${table} where user_id = $1`, [user.userId]),
      ).toEqual([]);
    }
  });
});
