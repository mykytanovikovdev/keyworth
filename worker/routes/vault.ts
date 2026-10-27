import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  decodeBase64url,
  encodeBase64url,
} from "../../shared/schemas/base64url.ts";
import {
  recordIdSchema,
  recordKindSchema,
  VAULT_LIMITS,
  type VaultRecordJson,
  vaultWriteSchema,
} from "../../shared/schemas/vault.ts";
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

/** Every record of this user, optionally of one kind. */
vault.get("/", async (c) => {
  const kindParam = c.req.query("kind");
  const kind =
    kindParam === undefined ? null : recordKindSchema.safeParse(kindParam);
  if (kind && !kind.success) return c.json({ error: "invalid_kind" }, 400);
  const userId = c.get("user").id;
  const rows = await c
    .get("db")
    .select()
    .from(vaultRecords)
    .where(
      kind
        ? and(eq(vaultRecords.userId, userId), eq(vaultRecords.kind, kind.data))
        : eq(vaultRecords.userId, userId),
    )
    .orderBy(asc(vaultRecords.createdAt));
  const records: VaultRecordJson[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    revision: row.revision,
    envelope: {
      v: 1,
      alg: "A256GCM",
      iv: encodeBase64url(row.iv),
      ct: encodeBase64url(row.ciphertext),
    },
    updatedAt: row.updatedAt.toISOString(),
  }));
  return c.json({ records });
});

/**
 * Creates (revision 0) or replaces (the current revision) a record. Each
 * change is one statement whose WHERE clause also enforces the user's limits,
 * so concurrent writes cannot slip past them. When nothing is written, a
 * second query explains why.
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

  const written =
    revision === 0
      ? await db.execute<{ revision: number }>(sql`
          insert into vault_records
            (user_id, id, kind, revision, envelope_version, iv, ciphertext)
          select ${userId}, ${id.data}, ${kind}, 1, ${envelope.v}, ${iv}, ${ciphertext}
          where (select count(*) from vault_records where user_id = ${userId})
                  < ${VAULT_LIMITS.maxRecords}
            and ${used} + ${ciphertext.length} <= ${VAULT_LIMITS.maxBytes}
          on conflict do nothing
          returning revision`)
      : await db.execute<{ revision: number }>(sql`
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

  const saved = written.rows[0];
  if (saved)
    return c.json({ revision: saved.revision }, revision === 0 ? 201 : 200);

  const [current] = await db
    .select({ kind: vaultRecords.kind, revision: vaultRecords.revision })
    .from(vaultRecords)
    .where(and(eq(vaultRecords.userId, userId), eq(vaultRecords.id, id.data)))
    .limit(1);
  if (!current && revision !== 0) return c.json({ error: "not_found" }, 404);
  if (current && (current.kind !== kind || current.revision !== revision)) {
    // Someone else (another device) wrote first: reload and retry.
    return c.json({ error: "conflict", revision: current.revision }, 409);
  }
  return c.json({ error: "quota_exceeded" }, 413);
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
