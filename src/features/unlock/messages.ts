import { ApiError, VaultError } from "../../vault/index.ts";

/*
 * What each refusal from src/crypto and src/vault means to the person typing.
 * Errors say what is wrong and what to do; `wrong-secret` does not blame the
 * user outright, because a damaged slot fails the same way.
 */
export const PASSPHRASE_HINT =
  "At least 12 characters: Latin letters, digits, spaces and punctuation. Four or more random words work well.";

export const messages = {
  notLatin:
    "Use only Latin letters, digits, spaces and punctuation. Is the keyboard set to English?",
  tooShort: "Use at least 12 characters.",
  tooLong: "Use at most 1,024 characters.",
  wrongPassphrase:
    "This passphrase doesn't unlock your data. Check it and try again.",
  recoveryTypo:
    "This recovery key has a typo. Compare it group by group with your saved copy.",
  recoveryWrong: "This recovery key doesn't belong to this account.",
  recoveryShape: "A recovery key has 36 characters in nine groups.",
} as const;

export type PassphraseProblem = "not-latin" | "too-short" | "too-long";

export function passphraseMessage(problem: PassphraseProblem): string {
  if (problem === "not-latin") return messages.notLatin;
  return problem === "too-short" ? messages.tooShort : messages.tooLong;
}

/**
 * A toast for anything a form cannot show next to a field: the network, the
 * server's limits, another device acting first.
 */
export function failureMessage(error: unknown): {
  title: string;
  description: string;
} {
  if (error instanceof VaultError && error.code === "changed-elsewhere") {
    return {
      title: "Changed on another device",
      description:
        "This key was just changed in another tab or device. Nothing was changed here; try again.",
    };
  }
  if (error instanceof ApiError && error.code === "rate_limited") {
    return {
      title: "Too many attempts",
      description: `Wait ${String(error.retryAfter ?? 60)} seconds, then try again.`,
    };
  }
  if (error instanceof ApiError) {
    return {
      title: "Something went wrong",
      description: "The server couldn't save this. Try again in a moment.",
    };
  }
  return {
    title: "Couldn't reach Keyworth",
    description: "Check your connection and try again.",
  };
}
