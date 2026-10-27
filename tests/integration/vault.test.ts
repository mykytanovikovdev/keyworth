import { describe, expect, it } from "vitest";
import { KDF_LIMITS } from "../../shared/schemas/keys.ts";
import {
  MAX_REVISION,
  type RecordKind,
  VAULT_LIMITS,
  type VaultRecordJson,
} from "../../shared/schemas/vault.ts";
import {
  createKeys,
  decryptRecord,
  encryptRecord,
  passphraseSlotToJson,
  recoverySlotToJson,
} from "../../src/crypto/index.ts";
import { api, fetchWorker, query, signedIn } from "./helpers.ts";

const PASSPHRASE = "purple elephant dances at noon";
const RECOVERY_SECRET_PATTERN =
  /^([0-9A-HJKMNP-TV-Z]{4}-){8}[0-9A-HJKMNP-TV-Z]{4}$/;

/** A signed-in user with keys set up, as the browser would leave them. */
async function vaultUser(label: string) {
  const user = await signedIn(label);
  const keys = await createKeys({
    userId: user.userId,
    passphrase: PASSPHRASE,
    kdf: {
      alg: "argon2id",
      version: 19,
      memoryKiB: KDF_LIMITS.minMemoryKiB,
      passes: KDF_LIMITS.minPasses,
      parallelism: 1,
    },
  });
  await api("/api/keys", {
    cookie: user.cookie,
    method: "POST",
    body: {
      passphrase: passphraseSlotToJson(keys.passphraseSlot),
      recovery: recoverySlotToJson(keys.recoverySlot),
    },
  });
  return { ...user, ...keys };
}

type VaultUser = Awaited<ReturnType<typeof vaultUser>>;

async function put(
  user: VaultUser,
  id: string,
  value: unknown,
  {
    revision = 0,
    kind = "settings",
  }: { revision?: number; kind?: RecordKind } = {},
) {
  const envelope = await encryptRecord(
    user.dataKey,
    { userId: user.userId, kind, recordId: id },
    value,
  );
  return api(`/api/vault/${id}`, {
    cookie: user.cookie,
    method: "PUT",
    body: { kind, revision, envelope },
  });
}

async function list(user: VaultUser, kind?: string) {
  const response = await api(`/api/vault${kind ? `?kind=${kind}` : ""}`, {
    cookie: user.cookie,
  });
  expect(response.status).toBe(200);
  return (await response.json<{ records: VaultRecordJson[] }>()).records;
}

describe("/api/vault", () => {
  it("needs a session", async () => {
    expect((await fetchWorker("/api/vault")).status).toBe(401);
  });

  it("stores an envelope and returns it unchanged, so it still decrypts", async () => {
    const user = await vaultUser("roundtrip");
    const id = crypto.randomUUID();

    const created = await put(user, id, { baseCurrency: "EUR" });
    const [record] = await list(user);

    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ revision: 1 });
    expect(record).toMatchObject({ id, kind: "settings", revision: 1 });
    const ref = {
      userId: user.userId,
      kind: "settings",
      recordId: id,
    } as const;
    expect(await decryptRecord(user.dataKey, ref, record?.envelope)).toEqual({
      baseCurrency: "EUR",
    });
  });

  it("keeps no plaintext anywhere in the database", async () => {
    const user = await vaultUser("plaintext");
    const secrets = ["Very secret note about 12.3456 BTC", "litecoin-at-60.03"];
    await put(user, crypto.randomUUID(), {
      note: secrets[0],
      asset: secrets[1],
    });

    // Every column of every row the user owns, as text and as hex.
    const dump = JSON.stringify(
      await query(
        `select to_jsonb(v)::text as row, encode(v.ciphertext, 'escape') as raw
           from vault_records v where user_id = $1
         union all
         select to_jsonb(k)::text, encode(k.wrapped_key, 'escape')
           from user_key_slots k where user_id = $1`,
        [user.userId],
      ),
    );

    for (const secret of [...secrets, PASSPHRASE, user.recoveryKey]) {
      expect(dump).not.toContain(secret);
    }
    expect(user.recoveryKey).toMatch(RECOVERY_SECRET_PATTERN);
  });

  it("updates only from the current revision", async () => {
    const user = await vaultUser("revision");
    const id = crypto.randomUUID();
    await put(user, id, { baseCurrency: "EUR" });

    const updated = await put(
      user,
      id,
      { baseCurrency: "USD" },
      { revision: 1 },
    );
    const stale = await put(user, id, { baseCurrency: "GBP" }, { revision: 1 });
    const recreated = await put(user, id, { baseCurrency: "JPY" });

    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({ revision: 2 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "conflict", revision: 2 });
    expect(recreated.status).toBe(409);
    const [record] = await list(user);
    const ref = {
      userId: user.userId,
      kind: "settings",
      recordId: id,
    } as const;
    expect(await decryptRecord(user.dataKey, ref, record?.envelope)).toEqual({
      baseCurrency: "USD",
    });
  });

  it("does not let a record change its kind", async () => {
    const user = await vaultUser("kind");
    const id = crypto.randomUUID();
    await put(user, id, { baseCurrency: "EUR" });

    const response = await put(
      user,
      id,
      { amount: "1" },
      { revision: 1, kind: "transaction" },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "kind_mismatch" });
  });

  it("refuses revisions beyond what the database can store", async () => {
    const user = await vaultUser("revision-range");
    const id = crypto.randomUUID();
    await put(user, id, { baseCurrency: "EUR" });

    const [stored] = await list(user);
    const write = (revision: number) =>
      api(`/api/vault/${id}`, {
        cookie: user.cookie,
        method: "PUT",
        body: { kind: "settings", revision, envelope: stored?.envelope },
      });

    const highest = await write(MAX_REVISION - 1);
    const beyond = await write(MAX_REVISION);
    const unsafe = await write(Number.MAX_SAFE_INTEGER);

    expect(highest.status).toBe(409);
    expect([beyond.status, unsafe.status]).toEqual([400, 400]);
  });

  it("cannot update a record that does not exist", async () => {
    const user = await vaultUser("missing");

    const response = await put(
      user,
      crypto.randomUUID(),
      { a: 1 },
      { revision: 3 },
    );

    expect(response.status).toBe(404);
  });

  it("lists by kind", async () => {
    const user = await vaultUser("filter");
    await put(user, crypto.randomUUID(), { baseCurrency: "EUR" });
    await put(
      user,
      crypto.randomUUID(),
      { amount: "1" },
      { kind: "transaction" },
    );

    expect((await list(user, "transaction")).map((r) => r.kind)).toEqual([
      "transaction",
    ]);
    expect(await list(user)).toHaveLength(2);
    expect(
      (await api("/api/vault?kind=passwords", { cookie: user.cookie })).status,
    ).toBe(400);
  });

  it("deletes a record once", async () => {
    const user = await vaultUser("delete");
    const id = crypto.randomUUID();
    await put(user, id, { baseCurrency: "EUR" });

    const first = await api(`/api/vault/${id}`, {
      cookie: user.cookie,
      method: "DELETE",
    });
    const second = await api(`/api/vault/${id}`, {
      cookie: user.cookie,
      method: "DELETE",
    });

    expect(first.status).toBe(204);
    expect(second.status).toBe(404);
    expect(await list(user)).toEqual([]);
  });

  it("refuses malformed ids and envelopes", async () => {
    const user = await vaultUser("malformed");
    const id = crypto.randomUUID();
    const envelope = await encryptRecord(
      user.dataKey,
      { userId: user.userId, kind: "settings", recordId: id },
      {},
    );

    const badId = await api("/api/vault/not-a-uuid", {
      cookie: user.cookie,
      method: "PUT",
      body: { kind: "settings", revision: 0, envelope },
    });
    const badEnvelope = await api(`/api/vault/${id}`, {
      cookie: user.cookie,
      method: "PUT",
      body: {
        kind: "settings",
        revision: 0,
        envelope: { ...envelope, ct: envelope.ct.slice(1) },
      },
    });
    const plaintext = await api(`/api/vault/${id}`, {
      cookie: user.cookie,
      method: "PUT",
      body: { kind: "settings", revision: 0, envelope, note: "plaintext" },
    });

    expect([badId.status, badEnvelope.status, plaintext.status]).toEqual([
      400, 400, 400,
    ]);
  });

  it("refuses writes from another origin", async () => {
    const user = await vaultUser("origin");
    const id = crypto.randomUUID();
    const envelope = await encryptRecord(
      user.dataKey,
      { userId: user.userId, kind: "settings", recordId: id },
      {},
    );

    const response = await api(`/api/vault/${id}`, {
      cookie: user.cookie,
      method: "PUT",
      body: { kind: "settings", revision: 0, envelope },
      origin: "https://evil.example",
    });

    expect(response.status).toBe(403);
  });
});

describe("isolation", () => {
  it("keeps every record to its owner, even under the same id", async () => {
    const alice = await vaultUser("alice");
    const bob = await vaultUser("bob");
    const id = crypto.randomUUID();
    await put(alice, id, { owner: "alice" });

    const bobCreates = await put(bob, id, { owner: "bob" });
    const bobUpdatesAlices = await put(
      bob,
      crypto.randomUUID(),
      {},
      { revision: 1 },
    );
    const bobDeletes = await api(`/api/vault/${id}`, {
      cookie: bob.cookie,
      method: "DELETE",
    });
    const bobDeletesAgain = await api(`/api/vault/${id}`, {
      cookie: bob.cookie,
      method: "DELETE",
    });

    // Bob's write under the same id is his own record, not Alice's.
    expect(bobCreates.status).toBe(201);
    expect(bobUpdatesAlices.status).toBe(404);
    expect(bobDeletes.status).toBe(204);
    expect(bobDeletesAgain.status).toBe(404);
    const [aliceRecord] = await list(alice);
    const ref = {
      userId: alice.userId,
      kind: "settings",
      recordId: id,
    } as const;
    expect(
      await decryptRecord(alice.dataKey, ref, aliceRecord?.envelope),
    ).toEqual({ owner: "alice" });
    expect(await list(bob)).toEqual([]);
  });

  it("an envelope copied into another user's vault does not decrypt there", async () => {
    const alice = await vaultUser("copy-a");
    const bob = await vaultUser("copy-b");
    const id = crypto.randomUUID();
    await put(alice, id, { secret: "alice's" });
    const [stolen] = await list(alice);

    await api(`/api/vault/${id}`, {
      cookie: bob.cookie,
      method: "PUT",
      body: { kind: "settings", revision: 0, envelope: stolen?.envelope },
    });
    const [copied] = await list(bob);

    const ref = { userId: bob.userId, kind: "settings", recordId: id } as const;
    await expect(
      decryptRecord(bob.dataKey, ref, copied?.envelope),
    ).rejects.toMatchObject({
      code: "tampered",
    });
  });
});

describe("limits", () => {
  it("refuses a new record once the user has the maximum number", async () => {
    const user = await vaultUser("count");
    await query(
      `insert into vault_records (user_id, id, kind, revision, envelope_version, iv, ciphertext)
       select $1, gen_random_uuid(), 'transaction', 1, 1, decode(repeat('00', 12), 'hex'),
              decode(repeat('00', 272), 'hex')
         from generate_series(1, $2::int)`,
      [user.userId, VAULT_LIMITS.maxRecords],
    );

    const response = await put(user, crypto.randomUUID(), { one: "more" });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "quota_exceeded" });
  });

  it("refuses a record that would exceed the user's storage", async () => {
    const user = await vaultUser("bytes");
    await query(
      `insert into vault_records (user_id, id, kind, revision, envelope_version, iv, ciphertext)
       values ($1, gen_random_uuid(), 'message', 1, 1, decode(repeat('00', 12), 'hex'),
               decode(repeat('00', $2::int), 'hex'))`,
      [user.userId, VAULT_LIMITS.maxBytes - 100],
    );

    const response = await put(user, crypto.randomUUID(), { one: "more" });

    expect(response.status).toBe(413);
  });

  it("holds the record limit when creates arrive at once", async () => {
    const user = await vaultUser("count-race");
    await query(
      `insert into vault_records (user_id, id, kind, revision, envelope_version, iv, ciphertext)
       select $1, gen_random_uuid(), 'transaction', 1, 1, decode(repeat('00', 12), 'hex'),
              decode(repeat('00', 272), 'hex')
         from generate_series(1, $2::int)`,
      [user.userId, VAULT_LIMITS.maxRecords - 1],
    );

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        put(user, crypto.randomUUID(), { at: "once" }),
      ),
    );

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 413, 413, 413, 413, 413]);
    const [stored] = await query<{ count: string }>(
      "select count(*) from vault_records where user_id = $1",
      [user.userId],
    );
    expect(Number(stored?.count)).toBe(VAULT_LIMITS.maxRecords);
  });

  it("holds the storage limit when creates arrive at once", async () => {
    const user = await vaultUser("bytes-race");
    // Room for exactly one record of the smallest size (272 bytes).
    await query(
      `insert into vault_records (user_id, id, kind, revision, envelope_version, iv, ciphertext)
       values ($1, gen_random_uuid(), 'message', 1, 1, decode(repeat('00', 12), 'hex'),
               decode(repeat('00', $2::int), 'hex'))`,
      [user.userId, VAULT_LIMITS.maxBytes - 300],
    );

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        put(user, crypto.randomUUID(), { at: "once" }),
      ),
    );

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 413, 413, 413, 413, 413]);
    const [stored] = await query<{ bytes: string }>(
      "select sum(octet_length(ciphertext)) as bytes from vault_records where user_id = $1",
      [user.userId],
    );
    expect(Number(stored?.bytes)).toBeLessThanOrEqual(VAULT_LIMITS.maxBytes);
  });

  it("limits writes to 120 a minute per user, and the window resets", async () => {
    const user = await vaultUser("rate");
    // Seeding the counter instead of sending 120 requests: in this runner every
    // request keeps its database connection until the file ends.
    await query(
      `insert into api_rate_limits (user_id, bucket, window_start, count)
       values ($1, 'vault', now(), 120)`,
      [user.userId],
    );
    const remove = () =>
      api(`/api/vault/${crypto.randomUUID()}`, {
        cookie: user.cookie,
        method: "DELETE",
      });

    const limited = await remove();
    await query(
      "update api_rate_limits set window_start = now() - interval '61 seconds' where user_id = $1",
      [user.userId],
    );
    const afterWindow = await remove();

    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(afterWindow.status).toBe(404);
  });

  it("tells a limited client how long is left in the window", async () => {
    const user = await vaultUser("retry-after");
    await query(
      `insert into api_rate_limits (user_id, bucket, window_start, count)
       values ($1, 'vault', now() - interval '50 seconds', 120)`,
      [user.userId],
    );

    const limited = await api(`/api/vault/${crypto.randomUUID()}`, {
      cookie: user.cookie,
      method: "DELETE",
    });

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(
      9,
    );
    expect(Number(limited.headers.get("retry-after"))).toBeLessThanOrEqual(10);
  });
});
