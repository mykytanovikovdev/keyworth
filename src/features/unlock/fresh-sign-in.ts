import { httpApi, vault } from "../../vault/index.ts";
import { signInWithGoogle } from "../auth/client.ts";

/*
 * Replacing a wrapped key needs a Google sign-in from the last 10 minutes
 * (the server's rule). Screens ask before anything secret is typed, so nobody
 * types a passphrase or a recovery key that the server would then refuse.
 */

/** Typing the secrets and running Argon2 takes a while: ask again with less than this left. */
const MARGIN_SECONDS = 120;

export async function hasFreshSignIn(): Promise<boolean> {
  return (await httpApi.me()).freshForSeconds >= MARGIN_SECONDS;
}

/**
 * Leaves for Google and comes back to `returnTo`. The new sign-in is a new
 * session, which the remembered device is not bound to: this browser forgets
 * it first (both halves), and every tab locks.
 */
export async function signInAgain(returnTo: string): Promise<void> {
  await vault.lock("reauthenticate");
  await signInWithGoogle(returnTo);
}
