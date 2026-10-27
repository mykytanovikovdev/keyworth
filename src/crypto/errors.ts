/**
 * - `wrong-secret`: the passphrase, recovery key or device key does not open
 *   the wrapped key (AES-GCM authentication failed while unwrapping). It also
 *   covers a damaged or substituted slot: AES-GCM cannot tell them apart, so
 *   the interface should not blame the user outright.
 * - `tampered`: a record does not decrypt: changed, truncated, replayed, or
 *   moved to another user, kind, id or revision.
 * - `not-latin`: a passphrase or recovery key contains characters other than
 *   plain Latin (printable ASCII), often because another keyboard layout is on.
 * - `mistyped`: a recovery key's check group does not match: a typo.
 * - `invalid-input`: malformed input, refused before any cryptography runs.
 */
export type CryptoErrorCode =
  "wrong-secret" | "tampered" | "not-latin" | "mistyped" | "invalid-input";

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
