/**
 * - `wrong-secret`: the passphrase, recovery key or device key does not open
 *   the wrapped key (AES-GCM authentication failed while unwrapping).
 * - `tampered`: a record does not decrypt: changed, truncated, or moved to
 *   another user, kind or id.
 * - `invalid-input`: malformed input, refused before any cryptography runs.
 */
export type CryptoErrorCode = "wrong-secret" | "tampered" | "invalid-input";

export class CryptoError extends Error {
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CryptoError";
    this.code = code;
  }
}

/**
 * WebCrypto reports a failed AES-GCM check as an OperationError; anything else
 * is a bug or an unsupported browser and is rethrown unchanged.
 */
export async function onAuthFailure<T>(
  operation: Promise<T>,
  code: CryptoErrorCode,
  message: string,
): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof DOMException && error.name === "OperationError") {
      throw new CryptoError(code, message, { cause: error });
    }
    throw error;
  }
}
