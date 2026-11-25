import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { PricesJson } from "../../../shared/schemas/market.ts";
import { ASK_AGAIN_MS } from "./market.ts";

/**
 * Prices the server answered with while it loads newer ones (`refreshing`) are
 * asked for again, once for each answer: the same prices again, when the newer
 * ones did not come, start nothing.
 */
export function useNewerPrices(...answers: (PricesJson | undefined)[]) {
  const client = useQueryClient();
  const waiting = answers
    .flatMap((prices) => (prices?.refreshing ? prices.fetchedAt : []))
    .join(" ");
  useEffect(() => {
    if (waiting === "") return;
    const timer = setTimeout(() => {
      void client.refetchQueries({
        type: "active",
        predicate: ({ state: { data } }) => isRefreshing(data),
      });
    }, ASK_AGAIN_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [client, waiting]);
}

const isRefreshing = (data: unknown) =>
  typeof data === "object" &&
  data !== null &&
  "refreshing" in data &&
  data.refreshing === true;
