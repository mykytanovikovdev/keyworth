import { describe, expect, it } from "vitest";
import { encodeBase64url } from "../../shared/schemas/base64url.ts";
import { KDF_LIMITS } from "../../shared/schemas/keys.ts";
import {
  MAX_REVISION,
  type RecordKind,
  VAULT_BATCH,
  VAULT_LIMITS,
  VAULT_PAGE,
  type VaultPageJson,
  type VaultRecordJson,
} from "../../shared/schemas/vault.ts";
import {
  createKeys,
  decryptRecord,
  encryptRecord,
  keyCheckToJson,
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
      check: keyCheckToJson(keys.keyCheck),
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
    // Stored with the revision after the one sent.
    { userId: user.userId, kind, recordId: id, revision: revision + 1 },
    value,
  );
  return api(`/api/vault/${id}`, {
    cookie: user.cookie,
    method: "PUT",
    body: { kind, revision, envelope },
  });
}

/** New transaction records, encrypted as the browser stores them (revision 1). */
async function transactions(user: VaultUser, values: unknown[]) {
  return Promise.all(
    values.map(async (value) => {
      const id = crypto.randomUUID();
      const envelope = await encryptRecord(
        user.dataKey,
        { userId: user.userId, kind: "transaction", recordId: id, revision: 1 },
        value,
      );
      return { id, kind: "transaction", envelope };
    }),
  );
}

function batch(user: { cookie: string }, records: unknown[], origin?: string) {
  return api("/api/vault/batch", {
    cookie: user.cookie,
    method: "POST",
    body: { records },
    ...(origin !== undefined && { origin }),
  });
}

const storedCount = async (userId: string) => {
  const [row] = await query<{ count: string }>(
    "select count(*) from vault_records where user_id = $1",
    [userId],
  );
  return Number(row?.count);
};

async function list(user: VaultUser, kind?: string) {
  const response = await api(`/api/vault${kind ? `?kind=${kind}` : ""}`, {
    cookie: user.cookie,
  });
  expect(response.status).toBe(200);
  return (await response.json<{ records: VaultRecordJson[] }>()).records;
}

/** Every page, following `next` as the browser does. */
async function pages(
  user: { cookie: string },
  { kind, after }: { kind?: string; after?: string } = {},
) {
  const all: VaultPageJson[] = [];
  let cursor = after ?? null;
  do {
    const params = new URLSearchParams();
    if (kind) params.set("kind", kind);
    if (cursor) params.set("after", cursor);
    const response = await api(`/api/vault?${params.toString()}`, {
      cookie: user.cookie,
    });
    expect(response.status).toBe(200);
    const page = await response.json<VaultPageJson>();
    all.push(page);
    cursor = page.next;
  } while (cursor && all.length < 100);
  return all;
}

/** Records stored straight in the database: no keys needed to page through them. */
async function insertRecords(
  userId: string,
  count: number,
  { kind = "transaction", bytes = 272, age = "0 seconds" } = {},
) {
  await query(
    `insert into vault_records
       (user_id, id, kind, revision, envelope_version, iv, ciphertext, created_at)
     select $1, gen_random_uuid(), $3, 1, 1, decode(repeat('00', 12), 'hex'),
            decode(repeat('00', $4::int), 'hex'), now() - $5::interval
       from generate_series(1, $2::int)`,
    [userId, count, kind, bytes, age],
  );
}

/** The user's record ids in the order the pages must follow. */
async function idsInOrder(userId: string, kind?: string) {
  const rows = await query<{ id: string }>(
    `select id from vault_records where user_id = $1 ${kind ? "and kind = $2" : ""}
      order by created_at, id`,
    kind ? [userId, kind] : [userId],
  );
  return rows.map(({ id }) => id);
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
      revision: record?.revision ?? 0,
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
      revision: record?.revision ?? 0,
    } as const;
    expect(await decryptRecord(user.dataKey, ref, record?.envelope)).toEqual({
      baseCurrency: "USD",
    });
  });

  it("an old version written back over a newer one does not decrypt", async () => {
    const user = await vaultUser("replay");
    const id = crypto.randomUUID();
    await put(user, id, { baseCurrency: "EUR" });
    const [first] = await list(user);
    await put(user, id, { baseCurrency: "USD" }, { revision: 1 });

    // A stolen session cannot read records, but could save and resend them.
    const replayed = await api(`/api/vault/${id}`, {
      cookie: user.cookie,
      method: "PUT",
      body: { kind: "settings", revision: 2, envelope: first?.envelope },
    });
    const [record] = await list(user);

    expect(replayed.status).toBe(200);
    expect(record?.revision).toBe(3);
    await expect(
      decryptRecord(
        user.dataKey,
        { userId: user.userId, kind: "settings", recordId: id, revision: 3 },
        record?.envelope,
      ),
    ).rejects.toMatchObject({ code: "tampered" });
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
      { userId: user.userId, kind: "settings", recordId: id, revision: 1 },
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
      { userId: user.userId, kind: "settings", recordId: id, revision: 1 },
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

describe("pages", () => {
  it("returns the stored bytes as the browser encodes them, whatever their length", async () => {
    const user = await signedIn("pages-encoding");
    // Lengths around base64's padding and Postgres's line breaks (every 57 bytes).
    const stored = [1, 2, 3, 56, 57, 58, 272, 70_000].map((length) => {
      const bytes = new Uint8Array(length);
      for (let start = 0; start < length; start += 65_536) {
        crypto.getRandomValues(bytes.subarray(start, start + 65_536));
      }
      const iv = crypto.getRandomValues(new Uint8Array(12));
      return { id: crypto.randomUUID(), iv, bytes };
    });
    const hex = (bytes: Uint8Array) =>
      Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    await query(
      `insert into vault_records
         (user_id, id, kind, revision, envelope_version, iv, ciphertext)
       select $1, id, 'transaction', 1, 1, decode(iv, 'hex'), decode(bytes, 'hex')
         from unnest($2::uuid[], $3::text[], $4::text[]) as stored(id, iv, bytes)`,
      [
        user.userId,
        stored.map(({ id }) => id),
        stored.map(({ iv }) => hex(iv)),
        stored.map(({ bytes }) => hex(bytes)),
      ],
    );

    const [page] = await pages(user);

    for (const { id, iv, bytes } of stored) {
      const record = page?.records.find((r) => r.id === id);
      expect(record?.envelope).toEqual({
        v: 1,
        alg: "A256GCM",
        iv: encodeBase64url(iv),
        ct: encodeBase64url(bytes),
      });
    }
  });

  it("returns every record once, oldest first, a page at a time", async () => {
    const user = await signedIn("pages-count");
    await insertRecords(user.userId, 2, { age: "1 hour" });
    await insertRecords(user.userId, VAULT_PAGE.maxRecords + 1);
    await insertRecords(user.userId, 3, { kind: "settings" });

    const transactions = await pages(user, { kind: "transaction" });
    const everything = await pages(user);

    expect(transactions.map(({ records }) => records.length)).toEqual([
      VAULT_PAGE.maxRecords,
      3,
    ]);
    expect(transactions.at(-1)?.next).toBeNull();
    expect(
      transactions.flatMap(({ records }) => records.map((r) => r.id)),
    ).toEqual(await idsInOrder(user.userId, "transaction"));
    expect(
      everything.flatMap(({ records }) => records.map((r) => r.id)),
    ).toEqual(await idsInOrder(user.userId));
  });

  it("ends a page after the record that crosses 1 MiB of ciphertext", async () => {
    const user = await signedIn("pages-bytes");
    await insertRecords(user.userId, 50, { bytes: 100_000 });

    const all = await pages(user);

    // Records 1 to 11 start below 1 MiB; the 11th ends past it.
    expect(all.map(({ records }) => records.length)).toEqual([
      11, 11, 11, 11, 6,
    ]);
    expect(all.flatMap(({ records }) => records.map((r) => r.id))).toEqual(
      await idsInOrder(user.userId),
    );
  });

  it("brings a record created meanwhile on a later page, and does not repeat an edited one", async () => {
    const user = await vaultUser("pages-moving");
    await insertRecords(user.userId, VAULT_PAGE.maxRecords + 1, {
      age: "1 minute",
    });
    const [first] = await pages(user);
    const edited = first?.records[0];
    if (!edited || !first.next) throw new Error("Expected two pages");

    const created = crypto.randomUUID();
    await put(user, created, { new: "one" }, { kind: "transaction" });
    expect(
      (
        await put(
          user,
          edited.id,
          { changed: "yes" },
          {
            revision: 1,
            kind: "transaction",
          },
        )
      ).status,
    ).toBe(200);
    const rest = await pages(user, { after: first.next });

    const restIds = rest.flatMap(({ records }) => records.map((r) => r.id));
    expect(restIds).toHaveLength(2);
    expect(restIds.at(-1)).toBe(created);
    expect(restIds).not.toContain(edited.id);
  });

  it.each([
    ["a made-up cursor", "page-2"],
    ["a cursor without an id", "1762600000000000"],
    [
      "a cursor with an upper-case id",
      `1_${crypto.randomUUID().toUpperCase()}`,
    ],
  ])("refuses %s", async (_, after) => {
    const user = await signedIn("pages-bad");
    const response = await api(
      `/api/vault?after=${encodeURIComponent(after)}`,
      {
        cookie: user.cookie,
      },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_cursor" });
  });
});

describe("isolation", () => {
  it("keeps every record to its owner, even under the same id", async () => {
    const alice = await vaultUser("alice");
    const bob = await vaultUser("bob");
    const id = crypto.randomUUID();
    await put(alice, id, { owner: "alice" });

    // Before Bob has a record of his own under this id, so only Alice's exists.
    const bobUpdatesAlices = await put(bob, id, {}, { revision: 1 });
    const bobCreates = await put(bob, id, { owner: "bob" });
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
      revision: aliceRecord?.revision ?? 0,
    } as const;
    expect(
      await decryptRecord(alice.dataKey, ref, aliceRecord?.envelope),
    ).toEqual({ owner: "alice" });
    expect(await list(bob)).toEqual([]);
  });

  it("a cursor from another user's pages shows only the user's own records", async () => {
    const alice = await signedIn("pages-alice");
    const bob = await signedIn("pages-bob");
    await insertRecords(alice.userId, VAULT_PAGE.maxRecords + 1, {
      age: "1 hour",
    });
    await insertRecords(bob.userId, 2);
    const [aliceFirst] = await pages(alice);
    if (!aliceFirst?.next) throw new Error("Expected two pages");

    const bobs = await pages(bob, { after: aliceFirst.next });

    expect(bobs.flatMap(({ records }) => records.map((r) => r.id))).toEqual(
      await idsInOrder(bob.userId),
    );
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

    const ref = {
      userId: bob.userId,
      kind: "settings",
      recordId: id,
      revision: 1,
    } as const;
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

describe("batch", () => {
  it("needs a session", async () => {
    const response = await fetchWorker("/api/vault/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ records: [] }),
    });
    expect(response.status).toBe(401);
  });

  it("stores every record at revision 1, and each still decrypts", async () => {
    const user = await vaultUser("batch");
    const values = [{ n: 1 }, { n: 2 }, { n: 3 }];
    const records = await transactions(user, values);

    const response = await batch(user, records);
    const stored = await list(user, "transaction");

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ written: 3 });
    expect(stored.map(({ id }) => id).sort()).toEqual(
      records.map(({ id }) => id).sort(),
    );
    const decrypted = await Promise.all(
      stored.map((record) =>
        decryptRecord(
          user.dataKey,
          {
            userId: user.userId,
            kind: "transaction",
            recordId: record.id,
            revision: record.revision,
          },
          record.envelope,
        ),
      ),
    );
    expect(stored.every(({ revision }) => revision === 1)).toBe(true);
    expect(decrypted).toEqual(expect.arrayContaining(values));
  });

  it("writes nothing when one id is taken: all or none", async () => {
    const user = await vaultUser("batch-taken");
    const [first, ...rest] = await transactions(user, [{ a: 1 }, { b: 2 }]);
    if (!first) throw new Error("no record");
    expect((await batch(user, [first])).status).toBe(201);

    // Sent again after a lost answer: the first one is in already.
    const again = await batch(user, [...rest, first]);

    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "conflict" });
    expect(await storedCount(user.userId)).toBe(1);
  });

  it("refuses a malformed batch whole", async () => {
    const user = await vaultUser("batch-malformed");
    const [good, other] = await transactions(user, [{ a: 1 }, { b: 2 }]);
    if (!good || !other) throw new Error("no records");
    const tooMany = await transactions(
      user,
      Array.from({ length: VAULT_BATCH.maxRecords + 1 }, (_, n) => ({ n })),
    );

    const bodies = [
      [good, { ...other, envelope: { ...other.envelope, ct: "!" } }],
      [good, { ...other, id: good.id }],
      [good, { ...other, kind: "settings" }],
      [good, { ...other, userId: "someone-else" }],
      [],
      tooMany,
    ];
    const statuses = [];
    for (const records of bodies) {
      statuses.push((await batch(user, records)).status);
    }

    expect(statuses).toEqual([400, 400, 400, 400, 400, 400]);
    expect(await storedCount(user.userId)).toBe(0);
  });

  it("refuses a body over 128 KB before reading it", async () => {
    const user = await vaultUser("batch-body");
    const [record] = await transactions(user, [{ a: 1 }]);

    const response = await api("/api/vault/batch", {
      cookie: user.cookie,
      method: "POST",
      body: { records: [record], padding: "x".repeat(130 * 1024) },
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "body_too_large" });
  });

  it("refuses writes from another origin", async () => {
    const user = await vaultUser("batch-origin");
    const records = await transactions(user, [{ a: 1 }]);

    const response = await batch(user, records, "https://evil.example");

    expect(response.status).toBe(403);
    expect(await storedCount(user.userId)).toBe(0);
  });

  it("writes nothing when the records would pass the user's count", async () => {
    const user = await vaultUser("batch-count");
    await insertRecords(user.userId, VAULT_LIMITS.maxRecords - 2);

    const response = await batch(
      user,
      await transactions(user, [{ a: 1 }, { b: 2 }, { c: 3 }]),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "quota_exceeded" });
    expect(await storedCount(user.userId)).toBe(VAULT_LIMITS.maxRecords - 2);
  });

  it("writes nothing when the records would pass the user's storage", async () => {
    const user = await vaultUser("batch-bytes");
    await insertRecords(user.userId, 1, {
      kind: "message",
      bytes: VAULT_LIMITS.maxBytes - 400,
    });

    const response = await batch(
      user,
      await transactions(user, [{ a: 1 }, { b: 2 }]),
    );

    expect(response.status).toBe(413);
    expect(await storedCount(user.userId)).toBe(1);
  });

  it("holds the record limit when batches and single writes arrive at once", async () => {
    const user = await vaultUser("batch-race");
    await insertRecords(user.userId, VAULT_LIMITS.maxRecords - 2);

    const responses = await Promise.all([
      batch(user, await transactions(user, [{ a: 1 }, { b: 2 }])),
      batch(user, await transactions(user, [{ c: 3 }, { d: 4 }])),
      put(user, crypto.randomUUID(), { e: 5 }),
    ]);

    // Room for two: whichever takes the lock first fits, the rest do not.
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 413)).toHaveLength(2);
    expect(await storedCount(user.userId)).toBeLessThanOrEqual(
      VAULT_LIMITS.maxRecords,
    );
  });

  it("limits batches to 60 a minute per user, apart from single writes", async () => {
    const user = await vaultUser("batch-rate");
    await query(
      `insert into api_rate_limits (user_id, bucket, window_start, count)
       values ($1, 'vault-batch', now(), 60)`,
      [user.userId],
    );

    const limited = await batch(user, await transactions(user, [{ a: 1 }]));
    const single = await put(user, crypto.randomUUID(), { b: 2 });

    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(single.status).toBe(201);
  });

  it("writes only to the sender's vault: another user sees none of it", async () => {
    const owner = await vaultUser("batch-owner");
    const other = await vaultUser("batch-other");
    const records = await transactions(owner, [{ a: 1 }]);

    expect((await batch(owner, records)).status).toBe(201);
    // The same ids are free in another vault: ids are per user.
    expect((await batch(other, records)).status).toBe(201);

    expect(await list(other, "transaction")).toHaveLength(1);
    const [copied] = await list(other, "transaction");
    // Encrypted for the owner, it does not decrypt as the other user's.
    await expect(
      decryptRecord(
        other.dataKey,
        {
          userId: other.userId,
          kind: "transaction",
          recordId: copied?.id ?? "",
          revision: 1,
        },
        copied?.envelope,
      ),
    ).rejects.toThrow();
    expect(await storedCount(owner.userId)).toBe(1);
  });
});
