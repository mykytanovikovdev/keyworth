import { queryOptions } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/client";

/**
 * Better Auth's browser client. The API is on the same origin, so requests
 * carry the httpOnly session cookie and need no base URL or token handling.
 */
export const authClient = createAuthClient();

/**
 * The current session, or null when signed out. Shared through TanStack Query
 * so routes, the header and settings read one cached value; sign-in, sign-out
 * and account deletion update it.
 */
export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: async () => {
    const { data, error } = await authClient.getSession();
    if (error) throw new Error(error.message ?? "Could not load the session.");
    return data;
  },
  staleTime: 5 * 60 * 1000,
});

/** Starts Google sign-in; the browser leaves for Google on success. */
export async function signInWithGoogle(callbackURL = "/") {
  const { error } = await authClient.signIn.social({
    provider: "google",
    callbackURL,
    errorCallbackURL: "/sign-in",
  });
  if (error) throw new Error(error.message ?? "Could not start sign-in.");
}
