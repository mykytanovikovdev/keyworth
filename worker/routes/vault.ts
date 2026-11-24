import { and, eq, inArray, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { decodeBase64url } from "../../shared/schemas/base64url.ts";
import {
  type RecordKind,
  recordIdSchema,
  recordKindSchema,
  DELETE_GROUPS,
  VAULT_BATCH,
  VAULT_CURSOR,
  VAULT_DELETE,
  VAULT_LIMITS,
  VAULT_PAGE,
  type VaultPageJson,
  type VaultRecordJson,
  vaultBatchSchema,
  vaultDeleteSchema,
  vaultWriteSchema,
} from "../../shared/schemas/vault.ts";
import type { Database } from "../db/client.ts";
import { vaultRecords } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { maxBody, rateLimit, readJson } from "../limits.ts";

/*
 * /api/vault: encrypted records. The server checks that each envelope has a
 * shape src/crypto/envelope.ts could have produced, enforces per-user limits
 * and revisions, and stores the bytes. It never sees a key or the content.
 */

export const vault = new Hono<AppEnv>();

const limitWrites = rateLimit("vault", 120);
// The largest envelope is about 87 KB of base64url, plus JSON around it.
const envelopeBody = maxBody(96 * 1024);

const bytes = (text: string): Uint8Array => {
  const decoded = decodeBase64url(text);
  if (!decoded) throw new Error("Validated base64url did not decode.");
  return decoded;
};

interface RecordRow extends Record<string, unknown> {
  id: string;
  kind: RecordKind;
  revision: number;
  /** Unpadded base64url, encoded by Postgres (base64url() below). */
  iv: string;
  ciphertext: string;
  /** ISO 8601 in UTC: Drizzle has pg leave timestamps as text in raw queries. */
  updated_at: string;
}

interface PageRow extends RecordRow {
  position: string;
  has_more: boolean;
}

const recordJson = (row: RecordRow): VaultRecordJson => ({
  id: row.id,
  kind: row.kind,
  revision: row.revision,
  envelope: { v: 1, alg: "A256GCM", iv: row.iv, ct: row.ciphertext },
  updatedAt: row.updated_at,
});

/**
 * The user's records, optionally of one kind, oldest first, a page at a time
 * (VAULT_PAGE). One statement: a window over the user's records counts the
 * ciphertext before each one and whether any comes after, so the Worker never
 * holds more than a page. Records keep their creation time, so a page does not
 * shift when one is edited; one created meanwhile comes on a later page, or,
 * when its write began before a page was read and finished after, with the
 * next reading (created_at is when its transaction began).
 *
 * Postgres encodes the bytes, in C: encoding them here, a byte at a time, cost
 * more CPU than a Worker on the free plan has for a page of small records.
 */
const base64url = (column: string) =>
  sql.raw(`rtrim(translate(encode(${column}, 'base64'), E'+/\\n', '-_'), '=')`);

vault.get("/", async (c) => {
  const kindParam = c.req.query("kind");
  const kind =
    kindParam === undefined ? null : recordKindSchema.safeParse(kindParam);
  if (kind && !kind.success) return c.json({ error: "invalid_kind" }, 400);
  const afterParam = c.req.query("after");
  const after = afterParam === undefined ? null : VAULT_CURSOR.exec(afterParam);
  if (afterParam !== undefined && !after) {
    return c.json({ error: "invalid_cursor" }, 400);
  }
  const userId = c.get("user").id;
  // created_at to the microsecond, as the cursor holds it.
  const position = sql`(extract(epoch from created_at) * 1000000)::bigint`;
  const result = await c.get("db").execute<PageRow>(sql`
    select id, kind, revision,
           ${base64url("iv")} as iv, ${base64url("ciphertext")} as ciphertext,
           to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
             as updated_at,
           position::text, has_more
    from (
      select id, kind, revision, iv, ciphertext, updated_at, created_at,
             ${position} as position,
             sum(octet_length(ciphertext)) over w - octet_length(ciphertext)
               as bytes_before,
             row_number() over w as row_number,
             lead(id) over w is not null as has_more
        from vault_records
       where user_id = ${userId}
         ${kind ? sql`and kind = ${kind.data}` : sql``}
         ${after ? sql`and (${position}, id) > (${after[1]}::bigint, ${after[2]}::uuid)` : sql``}
      window w as (order by created_at, id)
    ) page
    where bytes_before < ${VAULT_PAGE.maxBytes}
      and row_number <= ${VAULT_PAGE.maxRecords}
    order by created_at, id`);
  const rows = result.rows;
  const last = rows.at(-1);
  const records: VaultRecordJson[] = rows.map(recordJson);
  return c.json<VaultPageJson>({
    records,
    next: last?.has_more ? `${last.position}_${last.id}` : null,
  });
});

/**
 * One of the user's records, whatever its kind: a chat's messages are read only
 * when that chat is opened.
 */
vault.get("/:id", async (c) => {
  const id = recordIdSchema.safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "invalid_id" }, 400);
  const result = await c.get("db").execute<RecordRow>(sql`
    select id, kind, revision,
           ${base64url("iv")} as iv, ${base64url("ciphertext")} as ciphertext,
           to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
             as updated_at
      from vault_records
     where user_id = ${c.get("user").id} and id = ${id.data}`);
  const row = result.rows[0];
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json<VaultRecordJson>(recordJson(row));
});

// Namespace for this route's advisory locks (pg_advisory_xact_lock's first key).
const QUOTA_LOCK = 1;

/**
 * Takes the user's write lock, waiting at most 2 seconds for it, and bounds
 * every statement of the transaction to 5 seconds. A burst of writes from one
 * session (a stolen one, say) queues for the lock while holding database
 * connections every user shares; past the wait, a write is refused as busy
 * instead. The limits are set in the lock's own statement (its FROM runs
 * first), so they cost no extra round trip.
 */
const lockUser = (tx: Pick<Database, "execute">, userId: string) =>
  tx.execute(sql`
    select pg_advisory_xact_lock(${QUOTA_LOCK}, hashtext(${userId}))
      from (select set_config('lock_timeout', '2s', true),
                   set_config('statement_timeout', '5s', true)) as limits`);

/** Postgres gave up waiting for the user's lock: lock_not_available. */
function waitedTooLong(error: unknown): boolean {
  const code = (value: unknown) =>
    value && typeof value === "object" && "code" in value
      ? value.code
      : undefined;
  return (
    code(error) === "55P03" ||
    (error instanceof Error && code(error.cause) === "55P03")
  );
}

const busy = (c: Context<AppEnv>) => {
  c.header("Retry-After", "2");
  return c.json({ error: "busy" }, 429);
};

/**
 * Creates (revision 0) or replaces (the current revision) a record. Each
 * change is one statement whose WHERE clause also enforces the user's limits.
 * Under Postgres's default isolation, two such statements running at once
 * would not see each other's rows and could both pass the limits, so a
 * per-user advisory lock lets one write at a time count and write. When
 * nothing is written, a second query explains why.
 */
vault.put("/:id", limitWrites, envelopeBody, async (c) => {
  const id = recordIdSchema.safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "invalid_id" }, 400);
  const body = vaultWriteSchema.safeParse(await readJson(c));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);
  const { kind, revision, envelope } = body.data;
  const userId = c.get("user").id;
  const db = c.get("db");
  const iv = bytes(envelope.iv);
  const ciphertext = bytes(envelope.ct);
  const used = sql`(select coalesce(sum(octet_length(ciphertext)), 0)
                      from vault_records where user_id = ${userId})`;

  const write = db.transaction(async (tx) => {
    // Held until the transaction ends; other users are never blocked.
    await lockUser(tx, userId);
    return revision === 0
      ? tx.execute<{ revision: number }>(sql`
            insert into vault_records
              (user_id, id, kind, revision, envelope_version, iv, ciphertext)
            select ${userId}, ${id.data}, ${kind}, 1, ${envelope.v}, ${iv}, ${ciphertext}
            where (select count(*) from vault_records where user_id = ${userId})
                    < ${VAULT_LIMITS.maxRecords}
              and ${used} + ${ciphertext.length} <= ${VAULT_LIMITS.maxBytes}
            on conflict do nothing
            returning revision`)
      : tx.execute<{ revision: number }>(sql`
            update vault_records set
              revision = revision + 1,
              envelope_version = ${envelope.v},
              iv = ${iv},
              ciphertext = ${ciphertext},
              updated_at = now()
            where user_id = ${userId} and id = ${id.data}
              and kind = ${kind} and revision = ${revision}
              and ${used} - octet_length(ciphertext) + ${ciphertext.length}
                    <= ${VAULT_LIMITS.maxBytes}
            returning revision`);
  });
  let written: Awaited<typeof write>;
  try {
    written = await write;
  } catch (error) {
    if (waitedTooLong(error)) return busy(c);
    throw error;
  }

  const saved = written.rows[0];
  if (saved)
    return c.json({ revision: saved.revision }, revision === 0 ? 201 : 200);

  const [current] = await db
    .select({ kind: vaultRecords.kind, revision: vaultRecords.revision })
    .from(vaultRecords)
    .where(and(eq(vaultRecords.userId, userId), eq(vaultRecords.id, id.data)))
    .limit(1);
  if (!current && revision !== 0) return c.json({ error: "not_found" }, 404);
  // A kind never changes: retrying would not help, so it is not a "conflict".
  if (current && current.kind !== kind) {
    return c.json({ error: "kind_mismatch" }, 409);
  }
  if (current && current.revision !== revision) {
    // Someone else (another device) wrote first: reload and retry.
    return c.json({ error: "conflict", revision: current.revision }, 409);
  }
  return c.json({ error: "quota_exceeded" }, 413);
});

const limitBatches = rateLimit("vault-batch", 60);
const batchBody = maxBody(VAULT_BATCH.maxBytes);

/** An id in a batch is taken already: the whole batch is rolled back. */
class IdTaken extends Error {}

/**
 * Creates several records at once, all or none: an import. The same limits as
 * one write, under the same per-user lock: count and bytes first, then one
 * insert. An id that is taken (a batch sent twice after a lost answer) refuses
 * the whole batch, so nothing is half written.
 */
vault.post("/batch", limitBatches, batchBody, async (c) => {
  const body = vaultBatchSchema.safeParse(await readJson(c));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);
  const userId = c.get("user").id;
  const rows = body.data.records.map(({ id, kind, envelope }) => ({
    userId,
    id,
    kind,
    revision: 1,
    envelopeVersion: envelope.v,
    iv: bytes(envelope.iv),
    ciphertext: bytes(envelope.ct),
  }));
  const adding = rows.reduce((sum, row) => sum + row.ciphertext.length, 0);

  let written: boolean;
  try {
    written = await c.get("db").transaction(async (tx) => {
      await lockUser(tx, userId);
      const usage = await tx.execute<{ count: string; bytes: string }>(sql`
        select count(*) as count,
               coalesce(sum(octet_length(ciphertext)), 0) as bytes
          from vault_records where user_id = ${userId}`);
      const used = usage.rows[0];
      if (
        Number(used?.count) + rows.length > VAULT_LIMITS.maxRecords ||
        Number(used?.bytes) + adding > VAULT_LIMITS.maxBytes
      ) {
        return false;
      }
      const inserted = await tx
        .insert(vaultRecords)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: vaultRecords.id });
      if (inserted.length < rows.length) throw new IdTaken();
      return true;
    });
  } catch (error) {
    if (error instanceof IdTaken) return c.json({ error: "conflict" }, 409);
    if (waitedTooLong(error)) return busy(c);
    throw error;
  }
  if (!written) return c.json({ error: "quota_exceeded" }, 413);
  return c.json({ written: rows.length }, 201);
});

const limitDeletes = rateLimit("vault-delete", 30);
const deleteBody = maxBody(VAULT_DELETE.maxBytes);

/**
 * Deletes several of the user's records at once: transactions selected or all,
 * chats selected or all. Only the group's kinds (DELETE_GROUPS), so a list of
 * ids cannot take the settings with it; an id that is not there (deleted on
 * another device meanwhile) is no error. Answers how many went.
 */
vault.post("/delete", limitDeletes, deleteBody, async (c) => {
  const body = vaultDeleteSchema.safeParse(await readJson(c));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);
  const deleted = await c
    .get("db")
    .delete(vaultRecords)
    .where(
      and(
        eq(vaultRecords.userId, c.get("user").id),
        inArray(vaultRecords.kind, [...DELETE_GROUPS[body.data.of]]),
        "ids" in body.data
          ? inArray(vaultRecords.id, body.data.ids)
          : undefined,
      ),
    )
    .returning({ id: vaultRecords.id });
  return c.json({ deleted: deleted.length });
});

vault.delete("/:id", limitWrites, async (c) => {
  const id = recordIdSchema.safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "invalid_id" }, 400);
  const deleted = await c
    .get("db")
    .delete(vaultRecords)
    .where(
      and(
        eq(vaultRecords.userId, c.get("user").id),
        eq(vaultRecords.id, id.data),
      ),
    )
    .returning({ id: vaultRecords.id });
  if (deleted.length === 0) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});
