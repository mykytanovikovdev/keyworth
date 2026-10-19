import { describe, expect, it } from "vitest";
import {
  findLicenseViolations,
  isSatisfiedBy,
  parseSpdx,
  type LockPackage,
} from "../../scripts/license-policy.ts";

describe("parseSpdx", () => {
  it("parses a single license", () => {
    expect(parseSpdx("MIT")).toEqual({ type: "license", id: "MIT" });
  });

  it("gives AND higher precedence than OR", () => {
    expect(parseSpdx("MIT OR Apache-2.0 AND ISC")).toEqual({
      type: "or",
      left: { type: "license", id: "MIT" },
      right: {
        type: "and",
        left: { type: "license", id: "Apache-2.0" },
        right: { type: "license", id: "ISC" },
      },
    });
  });

  it("respects parentheses", () => {
    expect(parseSpdx("(MIT OR Apache-2.0) AND ISC")).toMatchObject({
      type: "and",
    });
  });

  it("reduces WITH to the base license", () => {
    expect(parseSpdx("Apache-2.0 WITH LLVM-exception")).toEqual({
      type: "license",
      id: "Apache-2.0",
    });
  });

  it.each([
    "",
    "(MIT",
    "MIT)",
    "MIT OR",
    "AND MIT",
    "MIT Apache-2.0",
    "MIT WITH",
  ])("rejects malformed expression %j", (expression) => {
    expect(() => parseSpdx(expression)).toThrow();
  });
});

describe("isSatisfiedBy", () => {
  const allowed = ["MIT", "Apache-2.0"];

  it.each([
    ["MIT", true],
    ["mit", true],
    ["GPL-3.0-only", false],
    ["(MIT OR GPL-3.0-only)", true],
    ["MIT AND GPL-3.0-only", false],
    ["MIT AND Apache-2.0", true],
    ["Apache-2.0 WITH LLVM-exception", true],
    ["GPL-2.0+", false],
  ])("%s → %s", (expression, expected) => {
    expect(isSatisfiedBy(expression, allowed)).toBe(expected);
  });
});

describe("findLicenseViolations", () => {
  const lock = (packages: Record<string, LockPackage>) => ({
    "": { version: "0.0.0", license: "AGPL-3.0-or-later" },
    ...packages,
  });

  it("accepts allowed licenses and skips the root package", () => {
    const packages = lock({
      "node_modules/react": { version: "19.3.1", license: "MIT" },
      "node_modules/wrangler": {
        version: "4.0.0",
        license: "MIT OR Apache-2.0",
        dev: true,
      },
    });

    expect(findLicenseViolations(packages, {})).toEqual([]);
  });

  it("allows dev-only licenses for dev dependencies", () => {
    const packages = lock({
      "node_modules/@img/sharp-libvips-linux-x64": {
        version: "1.0.0",
        license: "LGPL-3.0-or-later",
        devOptional: true,
      },
      "node_modules/caniuse-lite": {
        version: "1.0.0",
        license: "CC-BY-4.0",
        dev: true,
      },
    });

    expect(findLicenseViolations(packages, {})).toEqual([]);
  });

  it("rejects dev-only licenses for runtime dependencies", () => {
    const packages = lock({
      "node_modules/some-lib": {
        version: "1.0.0",
        license: "LGPL-3.0-or-later",
      },
    });

    expect(findLicenseViolations(packages, {})).toEqual([
      {
        name: "some-lib",
        version: "1.0.0",
        license: "LGPL-3.0-or-later",
        reason:
          "license is allowed for dev tooling only, but this is a runtime dependency",
      },
    ]);
  });

  it("rejects licenses that are not on the allowlist, even for dev tooling", () => {
    const packages = lock({
      "node_modules/a/node_modules/nested": {
        version: "2.0.0",
        license: "SSPL-1.0",
        dev: true,
      },
    });

    expect(findLicenseViolations(packages, {})).toEqual([
      {
        name: "nested",
        version: "2.0.0",
        license: "SSPL-1.0",
        reason: "license is not on the allowlist",
      },
    ]);
  });

  it.each([{}, { license: "" }, { license: { type: "MIT" } }])(
    "rejects a missing or non-string license field: %j",
    (fields) => {
      const packages = lock({
        "node_modules/x": { version: "1.0.0", ...fields },
      });

      expect(findLicenseViolations(packages, {})).toMatchObject([
        { reason: "no license field" },
      ]);
    },
  );

  it("rejects unparseable expressions", () => {
    const packages = lock({
      "node_modules/x": { version: "1.0.0", license: "SEE LICENSE IN x" },
    });

    expect(findLicenseViolations(packages, {})).toMatchObject([
      { reason: "unparseable license expression" },
    ]);
  });

  it("honours an exception only while the license string is unchanged", () => {
    const exceptions = { x: { license: "Custom-1.0", reason: "reviewed" } };

    expect(
      findLicenseViolations(
        lock({ "node_modules/x": { version: "1.0.0", license: "Custom-1.0" } }),
        exceptions,
      ),
    ).toEqual([]);
    expect(
      findLicenseViolations(
        lock({ "node_modules/x": { version: "1.1.0", license: "Custom-2.0" } }),
        exceptions,
      ),
    ).toHaveLength(1);
  });

  it("ignores linked local packages", () => {
    const packages = lock({ "node_modules/local": { link: true } });

    expect(findLicenseViolations(packages, {})).toEqual([]);
  });
});
