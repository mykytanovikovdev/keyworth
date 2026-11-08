import { describe, expect, it } from "vitest";
import {
  decodeVlq,
  groupOf,
  sizesByGroup,
  sizesBySource,
} from "../../scripts/bundle-map.ts";

describe("base64 VLQ", () => {
  it.each([
    ["A", [0]],
    ["C", [1]],
    ["D", [-1]],
    ["gB", [16]],
    ["AAgBC", [0, 0, 16, 1]],
  ])("decodes %j", (segment, values) => {
    expect(decodeVlq(segment)).toEqual(values);
  });
});

describe("sizes from a source map", () => {
  // Line 1: columns 0–4 from a.ts, 5–9 from b.ts. Line 2: glue, then a.ts.
  const code = "aaaaabbbbb\nxxccc";
  const map = { sources: ["a.ts", "b.ts"], mappings: "AAAA,KCAA;AAAA,EDAA" };

  it("gives each span to its source, up to the next span or the line's end", () => {
    // Line 2's first segment points at b.ts (index carried over), so "xx" is b.
    expect(sizesBySource(code, map)).toEqual(
      new Map([
        ["a.ts", 8],
        ["b.ts", 7],
      ]),
    );
  });

  it("counts code with no mapping as unmapped", () => {
    const sizes = sizesBySource("glue();", { sources: [], mappings: "" });

    expect(sizes).toEqual(new Map([["(unmapped)", 7]]));
  });
});

describe("grouping sources", () => {
  it.each([
    ["../../node_modules/react-aria/dist/private/x.mjs", "react-aria"],
    ["../../node_modules/@noble/hashes/esm/argon2.js", "@noble/hashes"],
    ["../../node_modules/a/node_modules/b/index.js", "b"],
    ["../../src/features/transactions/TransactionForm.tsx", "src/features"],
    ["../../shared/schemas/text.ts", "shared/schemas"],
    ["\u0000vite/preload-helper.js", "\u0000vite/preload-helper.js"],
  ])("puts %j under %j", (source, group) => {
    expect(groupOf(source)).toBe(group);
  });

  it("sums per group, largest first", () => {
    const sizes = new Map([
      ["../../src/ui/a.tsx", 2],
      ["../../node_modules/react/index.js", 5],
      ["../../src/ui/b.tsx", 4],
    ]);

    expect(sizesByGroup(sizes)).toEqual([
      ["src/ui", 6],
      ["react", 5],
    ]);
  });
});
