import { describe, expect, it } from "vitest";
import { parsePlan, replaceOnce } from "../../scripts/mutation-plan.ts";

describe("a mutation plan", () => {
  it("gives each mutation the plan's command unless it names its own", () => {
    const plan = JSON.stringify({
      command: ["npx", "vitest", "run"],
      mutations: [
        { label: "a", file: "x.ts", from: "1", to: "2" },
        { label: "b", file: "y.ts", from: "3", to: "", command: ["npm", "t"] },
      ],
    });

    expect(parsePlan(plan).map((m) => m.command)).toEqual([
      ["npx", "vitest", "run"],
      ["npm", "t"],
    ]);
  });

  it.each([
    [{}, /"mutations" list/],
    [{ mutations: [{ file: "x", from: "a", to: "b" }] }, /no "label"/],
    [{ mutations: [{ label: "l", from: "a", to: "b" }] }, /no "file"/],
    [{ mutations: [{ label: "l", file: "x", from: "", to: "b" }] }, /"from"/],
    [
      {
        command: ["t"],
        mutations: [{ label: "l", file: "x", from: "a", to: "a" }],
      },
      /changes nothing/,
    ],
    [
      { mutations: [{ label: "l", file: "x", from: "a", to: "b" }] },
      /no "command"/,
    ],
  ])("is refused when malformed: %j", (plan, message) => {
    expect(() => parsePlan(JSON.stringify(plan))).toThrow(message);
  });
});

describe("replacing a line", () => {
  it("replaces the one match", () => {
    expect(replaceOnce("a + b", "+", "-")).toBe("a - b");
  });

  it("refuses no match or several, so it never breaks the wrong line", () => {
    expect(replaceOnce("a + b", "*", "-")).toBeNull();
    expect(replaceOnce("a + b + c", "+", "-")).toBeNull();
  });
});
