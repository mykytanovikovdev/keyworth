import { describe, expect, it } from "vitest";
import { decimal } from "../../../shared/money/decimal.ts";
import { heldAt, heldNow } from "../../../src/features/transactions/check.ts";
import { heldCoins } from "../../../src/features/transactions/coin-search.ts";
import {
  buy,
  entries,
  income,
  sell,
  transferOut,
} from "../metrics/fixtures.ts";

/*
 * "All" in the form: what a sale or a transfer out on a day would find, the
 * same count the ledger's rules use to refuse selling more. And the coins a
 * sale's list offers: those held now.
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

const asPlain = (held: ReadonlyMap<string, { toString(): string }>) =>
  Object.fromEntries([...held].map(([id, units]) => [id, units.toString()]));

describe("the coins held now", () => {
  const list = entries(
    buy("2025-01-01", "0.5", "100", BTC),
    income("2025-01-05", "0.03124", "110", BTC),
    sell("2025-01-10", "0.2", "120", BTC),
    buy("2025-01-02", "3", "10", ETH),
    sell("2025-01-20", "3", "12", ETH),
  );

  it("are each coin with more than zero left, and how much", () => {
    expect(asPlain(heldNow(list))).toEqual({ "crypto:bitcoin": "0.33124" });
  });

  it("leave out the transaction being edited, like All", () => {
    // t5 sold every ether: editing it, the ether is there to sell again.
    expect(asPlain(heldNow(list, "t5"))).toEqual({
      "crypto:bitcoin": "0.33124",
      "crypto:ethereum": "3",
    });
    expect(asPlain(heldNow(list, "t3"))).toEqual({
      "crypto:bitcoin": "0.53124",
    });
  });

  it("are none before anything is bought", () => {
    expect(heldNow([]).size).toBe(0);
  });
});

describe("the list a sale offers", () => {
  const names: Record<string, string> = {
    "crypto:bitcoin": "Bitcoin",
    "crypto:ethereum": "Ethereum",
    "crypto:cardano": "Cardano",
    "crypto:dogecoin": "Dogecoin",
  };
  const assetOf = (id: string) => ({
    id,
    symbol: id.slice(7, 10).toUpperCase(),
    name: names[id] ?? id,
  });
  const prices: Record<string, string> = {
    "crypto:bitcoin": "60000",
    "crypto:ethereum": "2300",
  };

  it("puts the largest value first, then coins with no price by name", () => {
    const held = new Map([
      ["crypto:dogecoin", decimal("1000")],
      ["crypto:bitcoin", decimal("0.1")],
      ["crypto:cardano", decimal("10")],
      ["crypto:ethereum", decimal("3")],
    ]);
    const list = heldCoins(held, assetOf, (id) => prices[id]);
    // Ether: 3 × 2,300 = 6,900; bitcoin: 0.1 × 60,000 = 6,000.
    expect(list.map((coin) => coin.name)).toEqual([
      "Ethereum",
      "Bitcoin",
      "Cardano",
      "Dogecoin",
    ]);
    expect(list[1]).toEqual({
      id: "crypto:bitcoin",
      symbol: "BIT",
      name: "Bitcoin",
      quantity: "0.1",
    });
  });
});
