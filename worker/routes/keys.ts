import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import {
  decodeBase64url,
  encodeBase64url,
} from "../../shared/schemas/base64url.ts";
import {
  deviceSlotSchema,
  keySetupSchema,
  passphraseSlotSchema,
  recoverySlotSchema,
} from "../../shared/schemas/keys.ts";
import { deviceUnlocks, userKeySlots } from "../db/schema.ts";
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

/** `{ keys: null }` before setup; otherwise both slots. */
keys.get("/", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(userKeySlots)
    .where(eq(userKeySlots.userId, c.get("user").id));
  const passphrase = rows.find((row) => row.kind === "passphrase");
  const recovery = rows.find((row) => row.kind === "recovery");
  if (!passphrase?.kdf || !recovery) return c.json({ keys: null });
  return c.json({
    keys: {
      passphrase: {
        kdf: passphrase.kdf,
        salt: encodeBase64url(passphrase.salt),
        ...wrapped(passphrase),
      },
      recovery: { salt: encodeBase64url(recovery.salt), ...wrapped(recovery) },
    },
  });
});

/** First setup: both slots in one statement, or 409 if they already exist. */
keys.post("/", limitWrites, smallBody, async (c) => {
  const body = keySetupSchema.safeParse(await readJson(c));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);
  const { passphrase, recovery } = body.data;
  const userId = c.get("user").id;
  const inserted = await c
    .get("db")
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
  // Both rows or neither: they are only ever created together here.
  if (inserted.length === 0) return c.json({ error: "already_set_up" }, 409);
  return c.json({ ok: true }, 201);
});

/** A new passphrase (or newer Argon2 settings); needs a recent sign-in. */
keys.put(
  "/passphrase",
  limitWrites,
  requireFreshSession,
  smallBody,
  async (c) => {
    const body = passphraseSlotSchema.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const updated = await c
      .get("db")
      .update(userKeySlots)
      .set({
        kdf: body.data.kdf,
        salt: bytes(body.data.salt),
        iv: bytes(body.data.iv),
        wrappedKey: bytes(body.data.wrappedKey),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userKeySlots.userId, c.get("user").id),
          eq(userKeySlots.kind, "passphrase"),
        ),
      )
      .returning({ kind: userKeySlots.kind });
    if (updated.length === 0) return c.json({ error: "not_set_up" }, 404);
    return c.json({ ok: true });
  },
);

/** A new recovery key; the old one stops working. Needs a recent sign-in. */
keys.put(
  "/recovery",
  limitWrites,
  requireFreshSession,
  smallBody,
  async (c) => {
    const body = recoverySlotSchema.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const updated = await c
      .get("db")
      .update(userKeySlots)
      .set({
        salt: bytes(body.data.salt),
        iv: bytes(body.data.iv),
        wrappedKey: bytes(body.data.wrappedKey),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userKeySlots.userId, c.get("user").id),
          eq(userKeySlots.kind, "recovery"),
        ),
      )
      .returning({ kind: userKeySlots.kind });
    if (updated.length === 0) return c.json({ error: "not_set_up" }, 404);
    return c.json({ ok: true });
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

keys.get("/device", async (c) => {
  const token = getCookie(c, DEVICE_COOKIE, deviceCookie(c.env).prefix);
  const tokenBytes = token ? decodeBase64url(token) : null;
  if (tokenBytes?.length !== TOKEN_BYTES) {
    return c.json({ error: "not_remembered" }, 404);
  }
  const [row] = await c
    .get("db")
    .select({ iv: deviceUnlocks.iv, wrappedKey: deviceUnlocks.wrappedKey })
    .from(deviceUnlocks)
    .where(
      and(
        eq(deviceUnlocks.sessionId, c.get("session").id),
        eq(deviceUnlocks.tokenHash, await sha256(tokenBytes)),
      ),
    )
    .limit(1);
  if (!row) return c.json({ error: "not_remembered" }, 404);
  return c.json(wrapped(row));
});

/** Lock, or "forget this device": the session itself stays signed in. */
keys.delete("/device", async (c) => {
  await c
    .get("db")
    .delete(deviceUnlocks)
    .where(eq(deviceUnlocks.sessionId, c.get("session").id));
  const cookie = deviceCookie(c.env);
  deleteCookie(c, DEVICE_COOKIE, cookie.options);
  return c.body(null, 204);
});
