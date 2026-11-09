import { describe, expect, it } from "vitest";
import { decimal } from "../../../shared/money/decimal.ts";
import {
  axisDate,
  compactMoney,
  money,
  periodWords,
  signedMoney,
  signedPercent,
} from "../../../src/features/portfolio/format.ts";

describe("how the portfolio's figures read", () => {
  it("shows money with cents and a sign on every change", () => {
    expect(money(decimal("48210.5"), "USD")).toBe("$48,210.50");
    expect(signedMoney(decimal("1943.1"), "USD")).toBe("+$1,943.10");
    expect(signedMoney(decimal("-412.8"), "EUR")).toBe("−€412.80");
    expect(signedMoney(decimal("0"), "USD")).toBe("$0.00");
  });

  it("shows percentages with one decimal, and no sign on what rounds to zero", () => {
    expect(signedPercent(0.0421)).toBe("+4.2%");
    expect(signedPercent(-0.031)).toBe("−3.1%");
    expect(signedPercent(0.0004)).toBe("0.0%");
  });

  it("shortens axis money, and dates by the period's length", () => {
    expect(compactMoney(48210, "USD")).toBe("$48.2K");
    expect(axisDate("2025-10-01", "1M")).toBe("Oct 1");
    expect(axisDate("2025-10-01", "1Y")).toBe("Oct 2025");
  });

  it("names the period, or when a younger portfolio started", () => {
    const at = { from: "2025-10-10", shortened: false, today: "2025-11-09" };
    expect(periodWords("1M", at)).toBe("past month");
    expect(periodWords("All", at)).toBe("since Oct 2025");
    expect(periodWords("1Y", { ...at, shortened: true })).toBe(
      "since Oct 10, 2025",
    );
    expect(periodWords("1W", { ...at, from: "2025-11-09" })).toBe("today");
  });
});
