import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useVaultState, vault } from "../../vault/index.ts";
import { sessionQuery } from "../auth/client.ts";

/** The vault for the signed-in user, started on first use, and that user's email. */
export function useStartedVault() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const state = useVaultState();
  const userId = session?.user.id;
  useEffect(() => {
    if (userId) void vault.start(userId);
  }, [userId]);
  return { state, email: session?.user.email ?? "" };
}
