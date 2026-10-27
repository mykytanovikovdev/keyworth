// The public surface of src/crypto. Everything else in this folder is an
// implementation detail; see README.md for how the pieces fit together.
export { decryptRecord, encryptRecord, type RecordRef } from "./envelope.ts";
export { CryptoError, type CryptoErrorCode } from "./errors.ts";
export { fromBase64url, toBase64url } from "./encoding.ts";
export type { OnProgress } from "./kdf.ts";
export {
  changePassphrase,
  createKeys,
  type DeviceSlot,
  type PassphraseSlot,
  type RecoverySlot,
  type RememberedDevice,
  replaceRecoveryKey,
  resetPassphrase,
  unlockWithDevice,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
} from "./key-slots.ts";
export { CURRENT_KDF_PARAMS, isCurrentKdf, type KdfParams } from "./params.ts";
export {
  deviceSlotFromJson,
  deviceSlotToJson,
  passphraseSlotFromJson,
  passphraseSlotToJson,
  recoverySlotFromJson,
  recoverySlotToJson,
} from "./serialize.ts";
export {
  checkPassphrase,
  PASSPHRASE_MAX_LENGTH,
  PASSPHRASE_MIN_LENGTH,
  type PassphraseProblem,
} from "./passphrase.ts";
