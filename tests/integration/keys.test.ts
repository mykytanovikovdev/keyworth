import { describe, expect, it } from "vitest";
import {
  type DeviceJson,
  KDF_LIMITS,
  type KeysJson,
} from "../../shared/schemas/keys.ts";
import {
  changePassphrase,
  createKeys,
  deviceSlotFromJson,
  deviceSlotToJson,
  type KdfParams,
  keyCheckFromJson,
  keyCheckToJson,
  passphraseSlotFromJson,
  passphraseSlotToJson,
  recoverySlotToJson,
  unlockWithDevice,
  unlockWithPassphrase,
  verifyKeyCheck,
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
    check: keyCheckToJson(keys.keyCheck),
  };
  return { user, keys, body };
}

async function storedKeys(cookie: string) {
  const response = await api("/api/keys", { cookie });
  expect(response.status).toBe(200);
  return (await response.json<KeysJson>()).keys;
}

describe("/api/keys", () => {
  it("needs a session", async () => {
    expect((await fetchWorker("/api/keys")).status).toBe(401);
  });

  it("has no keys before setup", async () => {
    const user = await signedIn("fresh");

    expect(await storedKeys(user.cookie)).toBeNull();
  });

  it("stores both slots and the check value once, and they still open the data key", async () => {
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
    await verifyKeyCheck(dataKey, user.userId, keyCheckFromJson(stored?.check));
  });

  it("shows no keys when the check value is missing, even with both slots", async () => {
    const { user, body } = await setUp("no-check");
    await api("/api/keys", { cookie: user.cookie, method: "POST", body });
    await query("delete from user_key_checks where user_id = $1", [
      user.userId,
    ]);

    expect(await storedKeys(user.cookie)).toBeNull();
  });

  it("sets up all three or nothing: over a leftover slot it writes nothing", async () => {
    const { user, body } = await setUp("partial");
    await query(
      `insert into user_key_slots (user_id, kind, kdf, salt, iv, wrapped_key)
       values ($1, 'passphrase', $2, decode(repeat('01', 16), 'hex'),
               decode(repeat('01', 12), 'hex'), decode(repeat('01', 48), 'hex'))`,
      [user.userId, JSON.stringify(FAST_KDF)],
    );

    const response = await api("/api/keys", {
      cookie: user.cookie,
      method: "POST",
      body,
    });

    expect(response.status).toBe(409);
    expect(
      await query("select kind from user_key_slots where user_id = $1", [
        user.userId,
      ]),
    ).toEqual([{ kind: "passphrase" }]);
    expect(
      await query("select 1 from user_key_checks where user_id = $1", [
        user.userId,
      ]),
    ).toEqual([]);
  });

  it("lets exactly one of several setups at once win, all of it", async () => {
    const user = await signedIn("setup-race");
    const bodies = await Promise.all(
      [1, 2, 3].map(async () => {
        const keys = await createKeys({
          userId: user.userId,
          passphrase: PASSPHRASE,
          kdf: FAST_KDF,
        });
        return {
          passphrase: passphraseSlotToJson(keys.passphraseSlot),
          recovery: recoverySlotToJson(keys.recoverySlot),
          check: keyCheckToJson(keys.keyCheck),
        };
      }),
    );

    const responses = await Promise.all(
      bodies.map((body) =>
        api("/api/keys", { cookie: user.cookie, method: "POST", body }),
      ),
    );

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409, 409]);
    // Whichever won, its slots and its check value were stored together.
    expect(bodies).toContainEqual(await storedKeys(user.cookie));
  });

  it("refuses malformed slots and Argon2 settings below OWASP's minimum", async () => {
    const { user, body } = await setUp("malformed");

    for (const bad of [
      { ...body, recovery: undefined },
      { ...body, check: undefined },
      { ...body, recovery: { ...body.recovery, v: 2 } },
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
      body: {
        expectedIv: body.passphrase.iv,
        slot: passphraseSlotToJson(next),
      },
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
        body: path.endsWith("passphrase")
          ? { expectedIv: body.passphrase.iv, slot: body.passphrase }
          : { expectedIv: body.recovery.iv, slot: body.recovery },
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
      body: { expectedIv: body.recovery.iv, slot: body.recovery },
    });

    expect(response.status).toBe(404);
  });

  it("replaces only the slot the browser read; a second writer gets 409", async () => {
    const { user, body } = await setUp("replace-race");
    await api("/api/keys", { cookie: user.cookie, method: "POST", body });
    const change = (newPassphrase: string) =>
      changePassphrase({
        userId: user.userId,
        slot: passphraseSlotFromJson(body.passphrase),
        currentPassphrase: PASSPHRASE,
        newPassphrase,
        kdf: FAST_KDF,
      }).then(passphraseSlotToJson);
    const first = await change("the first new passphrase");
    const second = await change("the second new passphrase");
    const put = (slot: typeof first) =>
      api("/api/keys/passphrase", {
        cookie: user.cookie,
        method: "PUT",
        body: { expectedIv: body.passphrase.iv, slot },
      });

    const won = await put(first);
    const lost = await put(second);
    // The same request again, as after a lost answer: 409 naming its own IV.
    const retried = await put(first);

    expect(won.status).toBe(200);
    expect(lost.status).toBe(409);
    expect(await lost.json()).toEqual({ error: "conflict", iv: first.iv });
    expect(retried.status).toBe(409);
    expect(await retried.json()).toEqual({ error: "conflict", iv: first.iv });
    expect((await storedKeys(user.cookie))?.passphrase).toEqual(first);
  });

  it("never replaces another user's slot, even given its IV", async () => {
    const alice = await setUp("replace-alice");
    const bob = await setUp("replace-bob");
    await api("/api/keys", {
      cookie: alice.user.cookie,
      method: "POST",
      body: alice.body,
    });

    const response = await api("/api/keys/recovery", {
      cookie: bob.user.cookie,
      method: "PUT",
      body: { expectedIv: alice.body.recovery.iv, slot: bob.body.recovery },
    });

    expect(response.status).toBe(404);
    expect((await storedKeys(alice.user.cookie))?.recovery).toEqual(
      alice.body.recovery,
    );
  });
});

/** The device half this request gets: the slot, or null ("not remembered"). */
async function deviceHalf(cookie: string): Promise<unknown> {
  const response = await api("/api/keys/device", { cookie });
  expect(response.status).toBe(200);
  return (await response.json<DeviceJson>()).slot;
}

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

    const withCookie = await deviceHalf(`${user.cookie}; ${pair}`);
    const without = await deviceHalf(user.cookie);

    expect(without).toBeNull();
    const dataKey = await unlockWithDevice({
      userId: user.userId,
      deviceKey: device.deviceKey,
      deviceSlot: deviceSlotFromJson(withCookie),
    });
    expect(dataKey.extractable).toBe(false);
  });

  it("belongs to one session: another sign-in with the same cookie gets nothing", async () => {
    const { user, deviceCookie } = await remembered("session");
    const pair = deviceCookie?.split(";")[0] ?? "";
    const other = await signInWithGoogle(user);

    expect(await deviceHalf(`${other.cookie}; ${pair}`)).toBeNull();
  });

  it("asks for the passphrase again 14 days after the device was remembered", async () => {
    const { user, deviceCookie } = await remembered("expiry");
    const pair = deviceCookie?.split(";")[0] ?? "";
    const rememberedAgo = async (age: string) => {
      await query(
        "update device_unlocks set created_at = now() - $2::interval where user_id = $1",
        [user.userId, age],
      );
      return deviceHalf(`${user.cookie}; ${pair}`);
    };

    expect(await rememberedAgo("13 days 23 hours")).not.toBeNull();
    expect(await rememberedAgo("14 days 1 minute")).toBeNull();
  });

  it("is forgotten on Lock, and gone with the session on sign-out", async () => {
    const forgot = await remembered("forget");
    const forgotPair = forgot.deviceCookie?.split(";")[0] ?? "";
    const deleted = await api("/api/keys/device", {
      cookie: `${forgot.user.cookie}; ${forgotPair}`,
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
    expect(await deviceHalf(`${forgot.user.cookie}; ${forgotPair}`)).toBeNull();

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
  it("removes the user's slots, check value, records and remembered devices", async () => {
    const { user, body, keys } = await setUp("cascade");
    await api("/api/keys", { cookie: user.cookie, method: "POST", body });
    const { device } = await unlockWithPassphrase({
      userId: user.userId,
      slot: keys.passphraseSlot,
      passphrase: PASSPHRASE,
      remember: true,
    });
    if (!device) throw new Error("Expected a remembered device");
    await api("/api/keys/device", {
      cookie: user.cookie,
      method: "POST",
      body: deviceSlotToJson(device.deviceSlot),
    });
    await query(
      `insert into vault_records (user_id, id, kind, revision, envelope_version, iv, ciphertext)
       values ($1, gen_random_uuid(), 'settings', 1, 1, decode(repeat('00', 12), 'hex'),
               decode(repeat('00', 272), 'hex'))`,
      [user.userId],
    );
    const tables = [
      "user_key_slots",
      "user_key_checks",
      "vault_records",
      "device_unlocks",
      "api_rate_limits",
    ];
    for (const table of tables) {
      // Every table really held something before the account was deleted.
      expect(
        await query(`select 1 from ${table} where user_id = $1`, [user.userId]),
        table,
      ).not.toEqual([]);
    }

    const response = await api("/api/auth/delete-user", {
      cookie: user.cookie,
      method: "POST",
      body: {},
    });

    expect(response.status).toBe(200);
    for (const table of tables) {
      expect(
        await query(`select 1 from ${table} where user_id = $1`, [user.userId]),
      ).toEqual([]);
    }
  });
});
