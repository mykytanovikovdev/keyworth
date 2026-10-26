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

/** Which record a ciphertext belongs to; all three go into the AAD. */
export interface RecordRef {
  userId: string;
  kind: RecordKind;
  /** A UUID made in the browser before encryption (crypto.randomUUID()). */
  recordId: string;
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
  const aad = recordAad(ref.userId, ref.kind, ref.recordId);
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    dataKey,
    pad(utf8(JSON.stringify(value))),
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
 * the ciphertext was changed or belongs to another user, kind or id. The
 * caller still validates the value against the kind's schema.
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
  const aad = recordAad(ref.userId, ref.kind, ref.recordId);
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
  return JSON.parse(fromUtf8(unpad(new Uint8Array(plaintext)))) as unknown;
}
