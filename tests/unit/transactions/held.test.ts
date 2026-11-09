import { describe, expect, it } from "vitest";
import { heldAt } from "../../../src/features/transactions/check.ts";
import {
  buy,
  entries,
  income,
  sell,
  transferOut,
} from "../metrics/fixtures.ts";

/*
 * "All" in the form: what a sale or a transfer out on a day would find, the
 * same count the ledger's rules use to refuse selling more.
 */

const BTC = { assetId: "crypto:bitcoin" };
const ETH = { assetId: "crypto:ethereum" };
const noonOf = (day: string) => `${day}T12:00:00Z`;

describe("what is held at a moment", () => {
  const list = entries(
    buy("2025-01-01", "0.5", "100", BTC),
    income("2025-01-05", "0.03124", "110", BTC),
    sell("2025-01-10", "0.2", "120", BTC),
    buy("2025-01-02", "3", "10", ETH),
    transferOut("2025-01-20", "0.1", BTC),
  );

  it("counts every transaction of the coin up to then, and no other coin", () => {
    expect(heldAt(list, BTC.assetId, noonOf("2025-01-12")).toString()).toBe(
      "0.33124",
    );
  });

  it("is what was held on that day, not today", () => {
    expect(heldAt(list, BTC.assetId, noonOf("2025-01-06")).toString()).toBe(
      "0.53124",
    );
    expect(heldAt(list, BTC.assetId, noonOf("2025-01-25")).toString()).toBe(
      "0.23124",
    );
  });

  it("leaves out the sale being edited: its own quantity is being chosen", () => {
    // t3 is the sale of 0.2 on the 10th.
    expect(
      heldAt(list, BTC.assetId, noonOf("2025-01-10"), "t3").toString(),
    ).toBe("0.53124");
  });

  it("is zero before the first purchase, or for a coin never held", () => {
    expect(heldAt(list, BTC.assetId, noonOf("2024-12-31")).toString()).toBe(
      "0",
    );
    expect(heldAt(list, "crypto:solana", noonOf("2025-01-12")).toString()).toBe(
      "0",
    );
  });

  it("compares moments as times, not as text", () => {
    // 12:00:00.5 is after noon, though ".5Z" sorts before "Z" as text.
    const later = entries(
      buy("2025-01-01", "1", "100", {
        ...BTC,
        executedAt: "2025-01-01T12:00:00.500Z",
      }),
    );
    expect(heldAt(later, BTC.assetId, "2025-01-01T12:00:00Z").toString()).toBe(
      "0",
    );
  });
});
