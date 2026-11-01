import { describe, expect, it } from "vitest";
import { encodeBase64url } from "../../shared/schemas/base64url.ts";
import { VAULT_LIMITS } from "../../shared/schemas/vault.ts";
import {
  api,
  BASE_URL,
  fetchWorker,
  query,
  signedIn,
  signInWithGoogle,
} from "./helpers.ts";

/*
 * The server's own guards, tested with well-formed but meaningless bytes: the
 * server cannot tell real ciphertext from random bytes, so these tests need no
 * cryptography. Each one would fail if a guard lost its user scope, its token
 * check, its Origin check, a limit or a boundary.
 */

/** `length` random bytes, or `length` copies of `fill`, as base64url. */
const b64 = (length: number, fill?: number) =>
  encodeBase64url(
    fill === undefined
      ? crypto.getRandomValues(new Uint8Array(length))
      : new Uint8Array(length).fill(fill),
  );

const envelope = (paddedBytes = 256) => ({
  v: 1,
  alg: "A256GCM",
  iv: b64(12),
  ct: b64(paddedBytes + 16),
});

function slots(fill: number) {
  return {
    passphrase: {
      v: 1,
      kdf: {
        alg: "argon2id",
        version: 19,
        memoryKiB: 19 * 1024,
        passes: 2,
        parallelism: 1,
      },
      salt: b64(16, fill),
      iv: b64(12, fill),
      wrappedKey: b64(48, fill),
    },
    recovery: {
      v: 1,
      salt: b64(16, fill),
      iv: b64(12, fill),
      wrappedKey: b64(48, fill),
    },
    check: { v: 1, iv: b64(12, fill), tag: b64(16, fill) },
  };
}

function putRecord(
  cookie: string,
  id: string,
  { revision = 0, kind = "settings", body = envelope() } = {},
) {
  return api(`/api/vault/${id}`, {
    cookie,
    method: "PUT",
    body: { kind, revision, envelope: body },
  });
}

async function storedKeys(cookie: string) {
  const response = await api("/api/keys", { cookie });
  return (await response.json<{ keys: unknown }>()).keys;
}

/** Remembers a (fake) device for this session; returns its cookie pair. */
async function remember(cookie: string) {
  const response = await api("/api/keys/device", {
    cookie,
    method: "POST",
    body: { iv: b64(12), wrappedKey: b64(48) },
  });
  expect(response.status).toBe(201);
  return (
    response.headers
      .getSetCookie()
      .find((pair) => pair.startsWith("__Host-keyworth-device="))
      ?.split(";")[0] ?? ""
  );
}

/** The device half this request gets: the slot, or null ("not remembered"). */
async function deviceHalf(cookie: string): Promise<unknown> {
  const response = await api("/api/keys/device", { cookie });
  expect(response.status).toBe(200);
  return (await response.json<{ slot: unknown }>()).slot;
}

const deviceRows = (userId: string) =>
  query("select 1 from device_unlocks where user_id = $1", [userId]);

describe("records stay with their owner", () => {
  it("Bob cannot update or delete Alice's record by its id", async () => {
    const alice = await signedIn("iso-alice");
    const bob = await signedIn("iso-bob");
    const id = crypto.randomUUID();
    await putRecord(alice.cookie, id);

    const update = await putRecord(bob.cookie, id, { revision: 1 });
    const otherKind = await putRecord(bob.cookie, id, {
      revision: 1,
      kind: "transaction",
    });
    const remove = await api(`/api/vault/${id}`, {
      cookie: bob.cookie,
      method: "DELETE",
    });

    expect([update.status, otherKind.status, remove.status]).toEqual([
      404, 404, 404,
    ]);
    expect(await update.json()).toEqual({ error: "not_found" });
    expect(
      await query("select user_id, revision from vault_records where id = $1", [
        id,
      ]),
    ).toEqual([{ user_id: alice.userId, revision: 1 }]);
  });

  it("under the same id, an update touches only the writer's own row", async () => {
    const alice = await signedIn("same-alice");
    const bob = await signedIn("same-bob");
    const id = crypto.randomUUID();
    await putRecord(alice.cookie, id);
    await putRecord(bob.cookie, id);

    const update = await putRecord(bob.cookie, id, { revision: 1 });

    expect(update.status).toBe(200);
    expect(
      await query(
        "select user_id, revision from vault_records where id = $1 order by revision",
        [id],
      ),
    ).toEqual([
      { user_id: alice.userId, revision: 1 },
      { user_id: bob.userId, revision: 2 },
    ]);
  });
});

describe("key slots stay with their owner", () => {
  it("replacing one's own slots leaves another user's alone", async () => {
    const alice = await signedIn("slots-alice");
    const bob = await signedIn("slots-bob");
    const aliceKeys = slots(1);
    const bobKeys = slots(2);
    await api("/api/keys", {
      cookie: alice.cookie,
      method: "POST",
      body: aliceKeys,
    });
    await api("/api/keys", {
      cookie: bob.cookie,
      method: "POST",
      body: bobKeys,
    });

    for (const kind of ["passphrase", "recovery"] as const) {
      const response = await api(`/api/keys/${kind}`, {
        cookie: bob.cookie,
        method: "PUT",
        body: { expectedIv: bobKeys[kind].iv, slot: slots(3)[kind] },
      });
      expect(response.status).toBe(200);
    }

    expect(await storedKeys(alice.cookie)).toEqual(aliceKeys);
  });
});

describe("remembered devices stay with their session", () => {
  it("a well-formed but wrong token gets nothing", async () => {
    const user = await signedIn("device-token");
    await remember(user.cookie);

    expect(
      await deviceHalf(`${user.cookie}; __Host-keyworth-device=${b64(32)}`),
    ).toBeNull();
  });

  it("Bob with Alice's device cookie gets nothing, and his Lock keeps her row", async () => {
    const alice = await signedIn("device-alice");
    const bob = await signedIn("device-bob");
    const aliceDevice = await remember(alice.cookie);

    const read = await deviceHalf(`${bob.cookie}; ${aliceDevice}`);
    const lock = await api("/api/keys/device", {
      cookie: `${bob.cookie}; ${aliceDevice}`,
      method: "DELETE",
    });

    expect(read).toBeNull();
    expect(lock.status).toBe(204);
    expect(await deviceRows(alice.userId)).toHaveLength(1);
    expect(await deviceHalf(`${alice.cookie}; ${aliceDevice}`)).not.toBeNull();
  });

  it("Lock in one session forgets only that session's device", async () => {
    const user = await signedIn("device-two");
    const second = await signInWithGoogle(user);
    const firstDevice = await remember(user.cookie);
    const secondDevice = await remember(second.cookie);

    await api("/api/keys/device", { cookie: second.cookie, method: "DELETE" });

    expect(await deviceHalf(`${user.cookie}; ${firstDevice}`)).not.toBeNull();
    expect(await deviceHalf(`${second.cookie}; ${secondDevice}`)).toBeNull();
  });

  it("remembering again replaces the row, and the old cookie stops working", async () => {
    const user = await signedIn("device-again");
    const before = await remember(user.cookie);
    const after = await remember(user.cookie);

    expect(await deviceRows(user.userId)).toHaveLength(1);
    expect(await deviceHalf(`${user.cookie}; ${before}`)).toBeNull();
    expect(await deviceHalf(`${user.cookie}; ${after}`)).not.toBeNull();
  });
});

describe("guards on every write", () => {
  it("refuse every Origin that is not exactly the app's, on PUT and DELETE alike", async () => {
    const user = await signedIn("origin-variants");
    const id = crypto.randomUUID();
    await putRecord(user.cookie, id);
    const origins = [
      `${BASE_URL}/`,
      "HTTPS://KEYWORTH.TEST",
      "https://keyworth.test:443",
      "http://keyworth.test",
      "https://keyworth.test.evil.example",
      "null",
      "",
    ];

    for (const origin of origins) {
      for (const [path, method] of [
        [`/api/vault/${id}`, "DELETE"],
        ["/api/keys/device", "DELETE"],
      ] as const) {
        const response = await api(path, {
          cookie: user.cookie,
          method,
          origin,
        });
        expect(response.status, `${method} ${path} from ${origin}`).toBe(403);
      }
    }
    // A Referer alone is not an Origin.
    const refererOnly = await fetchWorker(`/api/vault/${id}`, {
      method: "DELETE",
      headers: { cookie: user.cookie, referer: `${BASE_URL}/app` },
    });
    expect(refererOnly.status).toBe(403);
    expect(
      await query("select 1 from vault_records where id = $1", [id]),
    ).toHaveLength(1);
  });

  it("refuse a record body over 96 KB", async () => {
    const user = await signedIn("vault-body");

    const response = await api(`/api/vault/${crypto.randomUUID()}`, {
      cookie: user.cookie,
      method: "PUT",
      body: {
        kind: "settings",
        revision: 0,
        envelope: envelope(),
        padding: "x".repeat(100 * 1024),
      },
    });

    expect(response.status).toBe(413);
  });

  it("rate-limit record writes, remembering a device and replacing a slot", async () => {
    const user = await signedIn("rate-every-write");
    await query(
      `insert into api_rate_limits (user_id, bucket, window_start, count)
       values ($1, 'vault', now(), 120), ($1, 'keys', now(), 20)`,
      [user.userId],
    );

    const write = await putRecord(user.cookie, crypto.randomUUID());
    const device = await api("/api/keys/device", {
      cookie: user.cookie,
      method: "POST",
      body: { iv: b64(12), wrappedKey: b64(48) },
    });
    const replace = await api("/api/keys/passphrase", {
      cookie: user.cookie,
      method: "PUT",
      body: { expectedIv: b64(12), slot: slots(4).passphrase },
    });

    expect([write.status, device.status, replace.status]).toEqual([
      429, 429, 429,
    ]);
  });

  it("let exactly the rest of the budget through when writes arrive at once", async () => {
    const user = await signedIn("rate-race");
    await query(
      `insert into api_rate_limits (user_id, bucket, window_start, count)
       values ($1, 'vault', now(), 117)`,
      [user.userId],
    );

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        putRecord(user.cookie, crypto.randomUUID()),
      ),
    );

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 201, 201, 429, 429, 429]);
  });

  it("count a replaced record's old size once against the storage limit", async () => {
    const user = await signedIn("quota-update");
    const id = crypto.randomUUID();
    await putRecord(user.cookie, id, { body: envelope(4096) });
    // Fill the vault to 100 bytes below the limit, counting the 4,112-byte record.
    await query(
      `insert into vault_records (user_id, id, kind, revision, envelope_version, iv, ciphertext)
       values ($1, gen_random_uuid(), 'message', 1, 1, decode(repeat('00', 12), 'hex'),
               decode(repeat('00', $2::int), 'hex'))`,
      [user.userId, VAULT_LIMITS.maxBytes - 4112 - 100],
    );

    const same = await putRecord(user.cookie, id, {
      revision: 1,
      body: envelope(4096),
    });
    const bigger = await putRecord(user.cookie, id, {
      revision: 2,
      body: envelope(8192),
    });
    const smaller = await putRecord(user.cookie, id, {
      revision: 2,
      body: envelope(256),
    });

    expect([same.status, bigger.status, smaller.status]).toEqual([
      200, 413, 200,
    ]);
  });
});
