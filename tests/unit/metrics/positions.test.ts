import { describe, expect, it } from "vitest";
import { computePositions } from "../../../shared/metrics/positions.ts";
import {
  buy,
  entries,
  income,
  sell,
  split,
  transferIn,
  transferOut,
  USD,
  usdWithRates,
} from "./fixtures.ts";

// Every expected number below was worked out by hand, not taken from the code.

function only(...args: Parameters<typeof computePositions>) {
  const { positions, issues } = computePositions(...args);
  const position = positions[0];
  if (!position || positions.length !== 1) throw new Error("Expected one.");
  return { position, issues, amounts: position.amounts };
}

function summary(...args: Parameters<typeof computePositions>) {
  const { position, amounts } = only(...args);
  return {
    quantity: position.quantity.toString(),
    cost: amounts?.costBasis.toString(),
    average: amounts?.averageCost?.toString() ?? null,
    realized: amounts?.realizedPnl.toString(),
    income: amounts?.income.toString(),
  };
}

describe("a position through its whole life", () => {
  const life = entries(
    buy("2025-01-01", "2", "30000", { fee: "20" }),
    sell("2025-02-01", "1", "40000", { fee: "10" }),
    buy("2025-03-01", "1", "50000"),
    transferOut("2025-04-01", "0.5"),
    income("2025-05-01", "0.1", "60000"),
    sell("2025-06-01", "1.6", "70000"),
    buy("2025-07-01", "1", "10000"),
  );

  // After each transaction in turn, as in shared/metrics/docs/calculations.md.
  it.each([
    [
      "a buy puts its fee in the cost",
      1,
      {
        quantity: "2",
        cost: "60020",
        average: "30010",
        realized: "0",
        income: "0",
      },
    ],
    [
      "a sale realizes proceeds less fee less average cost",
      2,
      {
        quantity: "1",
        cost: "30010",
        average: "30010",
        realized: "9980",
        income: "0",
      },
    ],
    [
      "another buy moves the average",
      3,
      {
        quantity: "2",
        cost: "80010",
        average: "40005",
        realized: "9980",
        income: "0",
      },
    ],
    [
      "a transfer out takes cost at the average and touches no P&L",
      4,
      {
        quantity: "1.5",
        cost: "60007.5",
        average: "40005",
        realized: "9980",
        income: "0",
      },
    ],
    [
      "income adds units at their worth, counted apart from P&L",
      5,
      {
        quantity: "1.6",
        cost: "66007.5",
        average: "41254.6875",
        realized: "9980",
        income: "6000",
      },
    ],
    [
      "selling everything leaves exactly no cost and no average",
      6,
      {
        quantity: "0",
        cost: "0",
        average: null,
        realized: "55972.5",
        income: "6000",
      },
    ],
    [
      "buying again starts a new average and keeps what was realized",
      7,
      {
        quantity: "1",
        cost: "10000",
        average: "10000",
        realized: "55972.5",
        income: "6000",
      },
    ],
  ])("%s", (_, count, expected) => {
    expect(summary(life.slice(0, count), USD)).toEqual(expected);
  });
});

describe("precision", () => {
  it("multiplies tiny quantities and long prices exactly", () => {
    const { cost } = summary(
      entries(
        buy("2025-01-01", "0.000000000000000001", "3000.123456789012345678"),
      ),
      USD,
    );
    expect(cost).toBe("0.000000000000003000123456789012345678");
  });

  it("adds tenths with no float error", () => {
    expect(
      summary(
        entries(
          buy("2025-01-01", "0.1", "1"),
          buy("2025-01-02", "0.2", "1"),
          sell("2025-01-03", "0.3", "1"),
        ),
        USD,
      ),
    ).toEqual({
      quantity: "0",
      cost: "0",
      average: null,
      realized: "0",
      income: "0",
    });
  });

  it("leaves no dust when sales split a cost that does not divide evenly", () => {
    const { cost, realized } = summary(
      entries(
        buy("2025-01-01", "3", "1", { fee: "7" }),
        sell("2025-01-02", "1", "1"),
        sell("2025-01-03", "2", "1"),
      ),
      USD,
    );
    expect(cost).toBe("0");
    // Paid 10 in all, got 3 back.
    expect(realized).toBe("-7");
  });
});

describe("transfers", () => {
  it("a transfer in costs its stated price, with no P&L", () => {
    expect(summary(entries(transferIn("2025-01-01", "2", "100")), USD)).toEqual(
      {
        quantity: "2",
        cost: "200",
        average: "100",
        realized: "0",
        income: "0",
      },
    );
  });

  it("a transfer in at price 0 is an airdrop: all of a later sale is gain", () => {
    expect(
      summary(
        entries(
          transferIn("2025-01-01", "2", "0"),
          sell("2025-01-02", "2", "5"),
        ),
        USD,
      ).realized,
    ).toBe("10");
  });
});

describe("splits", () => {
  it("multiply the units and divide the average, the cost unchanged", () => {
    expect(
      summary(
        entries(buy("2025-01-01", "10", "100"), split("2025-01-02", "4")),
        USD,
      ),
    ).toEqual({
      quantity: "40",
      cost: "1000",
      average: "25",
      realized: "0",
      income: "0",
    });
  });

  it("work in reverse, and a later sale sees the new units", () => {
    expect(
      summary(
        entries(
          buy("2025-01-01", "10", "100"),
          split("2025-01-02", "0.5"),
          sell("2025-01-03", "5", "300"),
        ),
        USD,
      ),
    ).toEqual({
      quantity: "0",
      cost: "0",
      average: null,
      // 5 × 300 for what cost 1000.
      realized: "500",
      income: "0",
    });
  });
});

describe("currencies", () => {
  it("costs a purchase at the rates of its day, its fee at its own", () => {
    const money = usdWithRates({
      "EUR 2025-01-01": "1.1",
      "GBP 2025-01-01": "1.3",
    });
    const { cost } = summary(
      entries(
        buy("2025-01-01", "10", "100", {
          priceCurrency: "EUR",
          fee: "5",
          feeCurrency: "GBP",
        }),
      ),
      money,
    );
    // 1000 EUR × 1.1 + 5 GBP × 1.3
    expect(cost).toBe("1106.5");
  });

  it("charges the fee in the price currency when it names none", () => {
    const { cost } = summary(
      entries(
        buy("2025-01-01", "1", "100", { priceCurrency: "EUR", fee: "10" }),
      ),
      usdWithRates({ "EUR 2025-01-01": "2" }),
    );
    expect(cost).toBe("220");
  });

  it("realizes the move in the rate too", () => {
    const money = usdWithRates({
      "EUR 2025-01-01": "1.1",
      "EUR 2025-02-01": "1.2",
    });
    const { realized } = summary(
      entries(
        buy("2025-01-01", "1", "100", { priceCurrency: "EUR" }),
        sell("2025-02-01", "1", "100", { priceCurrency: "EUR" }),
      ),
      money,
    );
    // The same 100 EUR in and out, but 110 USD paid and 120 USD received.
    expect(realized).toBe("10");
  });

  it("takes the rate of the UTC date, however late in the day", () => {
    const asked: string[] = [];
    computePositions(
      entries(
        buy("2025-03-01", "1", "100", {
          priceCurrency: "EUR",
          executedAt: "2025-03-01T23:59:59Z",
        }),
      ),
      {
        baseCurrency: "USD",
        rate: (_from, _to, date) => {
          asked.push(date);
          return null;
        },
      },
    );
    expect(asked).toEqual(["2025-03-01"]);
  });

  it("hides the amounts when a rate is missing, and says which", () => {
    const { position, issues, amounts } = only(
      entries(
        buy("2025-01-01", "2", "100"),
        buy("2025-01-02", "1", "100", { priceCurrency: "EUR" }),
      ),
      USD,
    );
    expect(amounts).toBeNull();
    // The units are known without any rate.
    expect(position.quantity.toString()).toBe("3");
    expect(issues).toEqual([
      {
        kind: "missing-rate",
        transactionId: "t2",
        assetId: "crypto:bitcoin",
        currency: "EUR",
        date: "2025-01-02",
      },
    ]);
  });

  it("names the fee's currency when that is the missing rate", () => {
    const { issues } = only(
      entries(buy("2025-01-01", "1", "100", { fee: "1", feeCurrency: "JPY" })),
      USD,
    );
    expect(issues).toMatchObject([{ kind: "missing-rate", currency: "JPY" }]);
  });
});

describe("selling more than is held", () => {
  it("counts the part that was held and its share of the fee", () => {
    const { position, issues, amounts } = only(
      entries(
        buy("2025-01-01", "1", "50"),
        sell("2025-01-02", "3", "100", { fee: "30" }),
      ),
      USD,
    );
    expect(position.quantity.toString()).toBe("0");
    // 1 × 100, less a third of the fee, less the cost of 50.
    expect(amounts?.realizedPnl.toString()).toBe("40");
    expect(issues).toMatchObject([
      { kind: "oversold", transactionId: "t2", assetId: "crypto:bitcoin" },
    ]);
    expect(issues[0]?.kind === "oversold" && issues[0].missing.toString()).toBe(
      "2",
    );
  });

  it("does the same for a transfer out", () => {
    const { position, issues, amounts } = only(
      entries(buy("2025-01-01", "1", "50"), transferOut("2025-01-02", "3")),
      USD,
    );
    expect(position.quantity.toString()).toBe("0");
    expect(amounts?.costBasis.toString()).toBe("0");
    expect(issues).toMatchObject([{ kind: "oversold", transactionId: "t2" }]);
  });

  it("changes nothing when nothing was held, and asks for no rate", () => {
    const { amounts, issues } = only(
      entries(
        sell("2025-01-01", "1", "100", { priceCurrency: "EUR", fee: "1" }),
      ),
      USD,
    );
    expect(amounts?.realizedPnl.toString()).toBe("0");
    expect(issues.map(({ kind }) => kind)).toEqual(["oversold"]);
  });
});

describe("order", () => {
  it("goes by time, whatever order the records arrive in", () => {
    const later = sell("2025-01-02", "1", "200");
    const earlier = buy("2025-01-01", "1", "100");
    const { issues, amounts } = only(entries(later, earlier), USD);
    expect(issues).toEqual([]);
    expect(amounts?.realizedPnl.toString()).toBe("100");
  });

  it("counts a purchase before a sale at the same moment", () => {
    const { issues } = only(
      entries(sell("2025-01-01", "1", "200"), buy("2025-01-01", "1", "100")),
      USD,
    );
    expect(issues).toEqual([]);
  });

  it("compares times as times: .5 seconds comes after none", () => {
    const { issues } = only(
      entries(
        sell("2025-01-01", "1", "200", {
          executedAt: "2025-01-01T00:00:00.500Z",
        }),
        buy("2025-01-01", "1", "100", { executedAt: "2025-01-01T00:00:00Z" }),
      ),
      USD,
    );
    expect(issues).toEqual([]);
  });

  it("gives each asset its own position", () => {
    const { positions } = computePositions(
      entries(
        buy("2025-01-01", "1", "100"),
        buy("2025-01-01", "2", "10", { assetId: "crypto:ethereum" }),
      ),
      USD,
    );
    expect(
      positions.map(({ assetId, amounts }) => [
        assetId,
        amounts?.costBasis.toString(),
      ]),
    ).toEqual([
      ["crypto:bitcoin", "100"],
      ["crypto:ethereum", "20"],
    ]);
  });
});
