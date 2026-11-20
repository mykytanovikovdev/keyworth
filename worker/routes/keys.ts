import { and, eq, gt } from "drizzle-orm";
import { TransactionRollbackError } from "drizzle-orm/errors";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import {
  decodeBase64url,
  encodeBase64url,
} from "../../shared/schemas/base64url.ts";
import {
  type DeviceJson,
  deviceSlotSchema,
  type KeysJson,
  keySetupSchema,
  passphraseReplaceSchema,
  recoveryReplaceSchema,
} from "../../shared/schemas/keys.ts";
import { deviceUnlocks, userKeyChecks, userKeySlots } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import {
  maxBody,
  rateLimit,
  readJson,
  requireFreshSession,
} from "../limits.ts";

/*
 * /api/keys: the wrapped copies of a user's data key. The server stores and
 * returns them but cannot open them: the keys that do (from the passphrase,
 * the recovery key or a remembered device) never reach it. See
 * src/crypto/README.md for the cryptography.
 */

export const keys = new Hono<AppEnv>();

// Key changes are rare; this only stops a runaway client or a stolen session.
const limitWrites = rateLimit("keys", 20);
const smallBody = maxBody(4 * 1024);

/** Validated binary fields arrive as base64url and are stored as bytea. */
const bytes = (text: string): Uint8Array => {
  const decoded = decodeBase64url(text);
  if (!decoded) throw new Error("Validated base64url did not decode.");
  return decoded;
};

const wrapped = (row: { iv: Uint8Array; wrappedKey: Uint8Array }) => ({
  iv: encodeBase64url(row.iv),
  wrappedKey: encodeBase64url(row.wrappedKey),
});

/** `{ keys: null }` before setup; otherwise both slots and the check value. */
keys.get("/", async (c) => {
  const db = c.get("db");
  const userId = c.get("user").id;
  // One query, so one connection: two queries at once would each open their
  // own, and every connection costs a handshake with the database.
  const rows = await db
    .select({ slot: userKeySlots, check: userKeyChecks })
    .from(userKeySlots)
    .leftJoin(userKeyChecks, eq(userKeyChecks.userId, userKeySlots.userId))
    .where(eq(userKeySlots.userId, userId));
  const slot = (kind: string) => rows.find((row) => row.slot.kind === kind);
  const passphrase = slot("passphrase")?.slot;
  const recovery = slot("recovery")?.slot;
  const check = rows[0]?.check;
  if (!passphrase?.kdf || !recovery || !check) {
    return c.json<KeysJson>({ keys: null });
  }
  return c.json<KeysJson>({
    keys: {
      passphrase: {
        v: 1,
        kdf: passphrase.kdf,
        salt: encodeBase64url(passphrase.salt),
        ...wrapped(passphrase),
      },
      recovery: {
        v: 1,
        salt: encodeBase64url(recovery.salt),
        ...wrapped(recovery),
      },
      check: {
        v: 1,
        iv: encodeBase64url(check.iv),
        tag: encodeBase64url(check.tag),
      },
    },
  });
});

/**
 * First setup: the check value and both slots in one transaction, so a user
 * has all three or none. 409 if they exist; a browser whose first request went
 * through but whose answer was lost sees 409 on retry and compares the stored
 * passphrase slot's IV with the one it sent.
 */
keys.post("/", limitWrites, smallBody, async (c) => {
  const body = keySetupSchema.safeParse(await readJson(c));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);
  const { passphrase, recovery, check } = body.data;
  const userId = c.get("user").id;
  try {
    await c.get("db").transaction(async (tx) => {
      const checks = await tx
        .insert(userKeyChecks)
        .values({ userId, iv: bytes(check.iv), tag: bytes(check.tag) })
        .onConflictDoNothing()
        .returning({ userId: userKeyChecks.userId });
      const slots = await tx
        .insert(userKeySlots)
        .values([
          {
            userId,
            kind: "passphrase",
            kdf: passphrase.kdf,
            salt: bytes(passphrase.salt),
            iv: bytes(passphrase.iv),
            wrappedKey: bytes(passphrase.wrappedKey),
          },
          {
            userId,
            kind: "recovery",
            salt: bytes(recovery.salt),
            iv: bytes(recovery.iv),
            wrappedKey: bytes(recovery.wrappedKey),
          },
        ])
        .onConflictDoNothing()
        .returning({ kind: userKeySlots.kind });
      // Anything less than all three means keys exist: write none of it.
      if (checks.length !== 1 || slots.length !== 2) tx.rollback();
    });
  } catch (error) {
    if (error instanceof TransactionRollbackError) {
      return c.json({ error: "already_set_up" }, 409);
    }
    throw error;
  }
  return c.json({ ok: true }, 201);
});

/**
 * Replaces one slot, only if it is still the one the browser read (the same
 * IV); otherwise 409 with the stored IV. Needs a recent sign-in.
 */
async function replaceSlot(
  c: Context<AppEnv>,
  kind: "passphrase" | "recovery",
  expectedIv: string,
  values: Partial<typeof userKeySlots.$inferInsert>,
) {
  const db = c.get("db");
  const owned = and(
    eq(userKeySlots.userId, c.get("user").id),
    eq(userKeySlots.kind, kind),
  );
  const updated = await db
    .update(userKeySlots)
    .set({ ...values, updatedAt: new Date() })
    .where(and(owned, eq(userKeySlots.iv, bytes(expectedIv))))
    .returning({ kind: userKeySlots.kind });
  if (updated.length > 0) return c.json({ ok: true });
  const [current] = await db
    .select({ iv: userKeySlots.iv })
    .from(userKeySlots)
    .where(owned)
    .limit(1);
  if (!current) return c.json({ error: "not_set_up" }, 404);
  return c.json({ error: "conflict", iv: encodeBase64url(current.iv) }, 409);
}

/** A new passphrase (or newer Argon2 settings). */
keys.put(
  "/passphrase",
  limitWrites,
  requireFreshSession,
  smallBody,
  async (c) => {
    const body = passphraseReplaceSchema.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const { slot, expectedIv } = body.data;
    return replaceSlot(c, "passphrase", expectedIv, {
      version: slot.v,
      kdf: slot.kdf,
      salt: bytes(slot.salt),
      iv: bytes(slot.iv),
      wrappedKey: bytes(slot.wrappedKey),
    });
  },
);

/** A new recovery key. The old one stops opening the stored slot. */
keys.put(
  "/recovery",
  limitWrites,
  requireFreshSession,
  smallBody,
  async (c) => {
    const body = recoveryReplaceSchema.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const { slot, expectedIv } = body.data;
    return replaceSlot(c, "recovery", expectedIv, {
      version: slot.v,
      salt: bytes(slot.salt),
      iv: bytes(slot.iv),
      wrappedKey: bytes(slot.wrappedKey),
    });
  },
);

/*
 * "Remember this device". The browser keeps a non-extractable device key in
 * IndexedDB; the server keeps the data key wrapped by it, tied to the current
 * session, and hands it back only with a session-only cookie whose hash it
 * stores. Closing the browser drops the cookie; signing out or revoking the
 * session deletes the row.
 */

const DEVICE_COOKIE = "keyworth-device";
const TOKEN_BYTES = 32;

/**
 * A remembered device asks for the passphrase again this long after it was
 * remembered, even if the browser and the session lived on (the owner's
 * decision): browsers that restore tabs keep session cookies, and a session
 * renews itself with use, so nothing else would ever end it.
 */
export const DEVICE_MAX_AGE_DAYS = 14;

/** `__Host-` and Secure over HTTPS; plain over http://localhost in development. */
function deviceCookie(env: Env): {
  options: CookieOptions;
  prefix?: "host";
} {
  const secure = new URL(env.BETTER_AUTH_URL).protocol === "https:";
  return {
    // No Max-Age or Expires: a session cookie, gone when the browser closes.
    options: {
      path: "/",
      httpOnly: true,
      sameSite: "Strict",
      secure,
      ...(secure && { prefix: "host" as const }),
    },
    ...(secure && { prefix: "host" as const }),
  };
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

keys.post("/device", limitWrites, smallBody, async (c) => {
  const body = deviceSlotSchema.safeParse(await readJson(c));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);
  const token = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  const row = {
    sessionId: c.get("session").id,
    userId: c.get("user").id,
    tokenHash: await sha256(token),
    iv: bytes(body.data.iv),
    wrappedKey: bytes(body.data.wrappedKey),
  };
  // One remembered key per session: remembering again replaces it.
  await c
    .get("db")
    .insert(deviceUnlocks)
    .values(row)
    .onConflictDoUpdate({
      target: deviceUnlocks.sessionId,
      set: {
        tokenHash: row.tokenHash,
        iv: row.iv,
        wrappedKey: row.wrappedKey,
        createdAt: new Date(),
      },
    });
  const cookie = deviceCookie(c.env);
  setCookie(c, DEVICE_COOKIE, encodeBase64url(token), cookie.options);
  return c.json({ ok: true }, 201);
});

/**
 * The device half for this session, or `{ slot: null }`: "not remembered" is a
 * normal answer at every start, not an error (a 404 would be logged in the
 * browser's console each time).
 */
keys.get("/device", async (c) => {
  const token = getCookie(c, DEVICE_COOKIE, deviceCookie(c.env).prefix);
  const tokenBytes = token ? decodeBase64url(token) : null;
  if (tokenBytes?.length !== TOKEN_BYTES) {
    return c.json<DeviceJson>({ slot: null });
  }
  const [row] = await c
    .get("db")
    .select({ iv: deviceUnlocks.iv, wrappedKey: deviceUnlocks.wrappedKey })
    .from(deviceUnlocks)
    .where(
      and(
        eq(deviceUnlocks.sessionId, c.get("session").id),
        eq(deviceUnlocks.tokenHash, await sha256(tokenBytes)),
        // Refused at once: the daily cleanup only deletes an older row later.
        gt(
          deviceUnlocks.createdAt,
          new Date(Date.now() - DEVICE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000),
        ),
      ),
    )
    .limit(1);
  return c.json<DeviceJson>({ slot: row ? wrapped(row) : null });
});

/** Lock, or "forget this device": the session itself stays signed in. */
keys.delete("/device", limitWrites, async (c) => {
  await c
    .get("db")
    .delete(deviceUnlocks)
    .where(eq(deviceUnlocks.sessionId, c.get("session").id));
  const cookie = deviceCookie(c.env);
  deleteCookie(c, DEVICE_COOKIE, cookie.options);
  return c.body(null, 204);
});
