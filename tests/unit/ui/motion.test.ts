import { describe, expect, it } from "vitest";
import { durationMs } from "../../../src/ui/motion.ts";

describe("durationMs", () => {
  it("reads milliseconds as written in the tokens", () => {
    expect(durationMs("240ms")).toBe(240);
    expect(durationMs(" 1500ms ")).toBe(1500);
  });

  it("reads seconds, as the production CSS minifier writes them", () => {
    expect(durationMs(".24s")).toBe(240);
    expect(durationMs("1.5s")).toBe(1500);
    expect(durationMs("0s")).toBe(0);
  });

  it("treats a missing token as no time", () => {
    expect(durationMs("")).toBe(0);
  });
});
