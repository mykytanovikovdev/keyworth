/*
 * What each refusal from src/crypto means to the person typing. Errors say
 * what is wrong and what to do; `wrong-secret` does not blame the user
 * outright, because a damaged slot fails the same way.
 */
export const PASSPHRASE_HINT =
  "At least 12 characters: Latin letters, digits, spaces and punctuation. Four or more random words work well.";

export const messages = {
  notLatin:
    "Use only Latin letters, digits, spaces and punctuation. Is the keyboard set to English?",
  tooShort: "Use at least 12 characters.",
  wrongPassphrase:
    "This passphrase doesn't unlock your data. Check it and try again.",
  recoveryTypo:
    "This recovery key has a typo. Compare it group by group with your saved copy.",
  recoveryWrong: "This recovery key doesn't belong to this account.",
  recoveryShape: "A recovery key has 36 characters in nine groups.",
} as const;
