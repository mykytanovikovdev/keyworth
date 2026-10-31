import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { showToast } from "../../ui/index.ts";
import { vault } from "../../vault/index.ts";
import { authClient, sessionQuery } from "./client.ts";

/**
 * Signing out of this browser, or of every browser ("Sign out everywhere":
 * every session ends, and every remembered device with its session). Then
 * every tab here locks and forgets the device key; they reload into the
 * sign-in page.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);

  async function signOut({ everywhere = false } = {}) {
    setPending(true);
    const { error } = everywhere
      ? await authClient.revokeSessions()
      : await authClient.signOut();
    if (error) {
      setPending(false);
      showToast(
        everywhere ? "Couldn't sign out everywhere" : "Couldn't sign out",
        { tone: "error", description: "Try again in a moment." },
      );
      return;
    }
    queryClient.setQueryData(sessionQuery.queryKey, null);
    queryClient.removeQueries({ queryKey: ["vault"] });
    await navigate({ to: "/sign-in" });
    // After leaving the app's pages, so they never flash the unlock screen.
    await vault.lock("sign-out");
  }

  return { signOut, pending };
}
