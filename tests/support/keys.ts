import { Pool } from "pg";
import { createKeys } from "../../src/crypto/index.ts";

/*
 * Keys for a signed-in test user, made in Node exactly as onboarding makes them
 * in the browser (src/crypto, production Argon2 settings) and stored as
 * POST /api/keys would store them. Browser tests then start at the unlock
 * screen instead of going through onboarding every time.
 */

export const TEST_PASSPHRASE = "correct horse battery staple";

export async function setUpKeys(options: {
  databaseUrl: string;
  email: string;
  passphrase?: string;
}): Promise<{ userId: string; passphrase: string; recoveryKey: string }> {
  const passphrase = options.passphrase ?? TEST_PASSPHRASE;
  const pool = new Pool({ connectionString: options.databaseUrl });
  try {
    const { rows } = await pool.query<{ id: string }>(
      'select id from "user" where email = $1',
      [options.email.toLowerCase()],
    );
    const userId = rows[0]?.id;
    if (!userId)
      throw new Error(`No user ${options.email} to set up keys for.`);
    const keys = await createKeys({ userId, passphrase });
    const bytes = (value: Uint8Array) => Buffer.from(value);
    await pool.query(
      "insert into user_key_checks (user_id, iv, tag) values ($1, $2, $3)",
      [userId, bytes(keys.keyCheck.iv), bytes(keys.keyCheck.tag)],
    );
    await pool.query(
      `insert into user_key_slots (user_id, kind, kdf, salt, iv, wrapped_key)
       values ($1, 'passphrase', $2, $3, $4, $5),
              ($1, 'recovery', null, $6, $7, $8)`,
      [
        userId,
        JSON.stringify(keys.passphraseSlot.kdf),
        bytes(keys.passphraseSlot.salt),
        bytes(keys.passphraseSlot.iv),
        bytes(keys.passphraseSlot.wrappedKey),
        bytes(keys.recoverySlot.salt),
        bytes(keys.recoverySlot.iv),
        bytes(keys.recoverySlot.wrappedKey),
      ],
    );
    return { userId, passphrase, recoveryKey: keys.recoveryKey };
  } finally {
    await pool.end();
  }
}
