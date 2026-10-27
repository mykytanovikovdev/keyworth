import {
  type Envelope,
  ENVELOPE_VERSION,
  envelopeSchema,
  IV_BYTES,
} from "../../shared/schemas/envelope.ts";
import type { RecordKind } from "../../shared/schemas/vault.ts";
import {
  fromBase64url,
  fromUtf8,
  randomBytes,
  toBase64url,
  utf8,
} from "./encoding.ts";
import { CryptoError, onAuthFailure } from "./errors.ts";
import { recordAad } from "./keys.ts";
import { pad, unpad } from "./padding.ts";

/** Which record a ciphertext belongs to; all four go into the AAD. */
export interface RecordRef {
  userId: string;
  kind: RecordKind;
  /** A UUID made in the browser before encryption (crypto.randomUUID()). */
  recordId: string;
  /**
   * The revision the record has once this ciphertext is stored: when writing,
   * the revision sent to `PUT /api/vault/:id` plus one (1 for a new record);
   * when reading, the revision the server returned with it.
   */
  revision: number;
}

/**
 * Encrypts a JSON value into an envelope. Every call draws a new random 96-bit
 * IV; with random IVs one key stays safe for far more records than a portfolio
 * will ever hold (NIST SP 800-38D: up to 2^32 encryptions).
 */
export async function encryptRecord(
  dataKey: CryptoKey,
  ref: RecordRef,
  value: unknown,
): Promise<Envelope> {
  const aad = recordAad(ref.userId, ref.kind, ref.recordId, ref.revision);
  // undefined, a function or a symbol has no JSON form: storing "nothing"
  // would replace a good record with one that never decrypts.
  const json = JSON.stringify(value) as string | undefined;
  if (json === undefined) {
    throw new CryptoError("invalid-input", "This value cannot be stored.");
  }
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    dataKey,
    pad(utf8(json)),
  );
  return {
    v: ENVELOPE_VERSION,
    alg: "A256GCM",
    iv: toBase64url(iv),
    ct: toBase64url(new Uint8Array(ciphertext)),
  };
}

/**
 * Decrypts an envelope and parses the JSON inside. Fails with `tampered` when
 * the ciphertext was changed, belongs to another user, kind, id or revision,
 * or does not hold JSON. The caller still validates the value against the
 * kind's schema.
 */
export async function decryptRecord(
  dataKey: CryptoKey,
  ref: RecordRef,
  envelope: unknown,
): Promise<unknown> {
  const parsed = envelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    throw new CryptoError("invalid-input", "Not a supported envelope.");
  }
  const aad = recordAad(ref.userId, ref.kind, ref.recordId, ref.revision);
  const plaintext = await onAuthFailure(
    crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64url(parsed.data.iv),
        additionalData: aad,
      },
      dataKey,
      fromBase64url(parsed.data.ct),
    ),
    "tampered",
    "This record does not decrypt.",
  );
  const json = unpad(new Uint8Array(plaintext));
  try {
    return JSON.parse(fromUtf8(json)) as unknown;
  } catch (error) {
    // Authenticated, so written with this key: by a bug, not by an attacker.
    throw new CryptoError("tampered", "This record does not hold JSON.", {
      cause: error,
    });
  }
}
