import { queryOptions } from "@tanstack/react-query";
import { httpApi, vault } from "../../vault/index.ts";
import { loadTransactions, type VaultAccess } from "./service.ts";

/** The page's vault and API: the service takes them as arguments. */
export const access: VaultAccess = { vault, api: httpApi };

/** Decrypted transactions: under ["vault", …], cleared when the vault locks. */
export const transactionsQuery = (userId: string) =>
  queryOptions({
    queryKey: ["vault", userId, "transactions"],
    queryFn: () => loadTransactions(access),
    // Another device may have added some: read again on coming back.
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });
