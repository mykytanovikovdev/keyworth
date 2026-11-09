/**
 * License policy for dependencies. Keyworth is AGPL-3.0-or-later, so every
 * dependency must be compatible with it. The rationale for each entry is in
 * scripts/README.md.
 */

/** Allowed for any dependency, including code shipped to browsers and the Worker. */
export const ALLOWED_LICENSES = [
  "MIT",
  "MIT-0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Unlicense",
  "MPL-2.0",
  // Fonts: shipped as separate files, never mixed into our code.
  "OFL-1.1",
] as const;

/** Allowed only for build and test tooling that is never shipped. */
export const DEV_ONLY_LICENSES = ["LGPL-3.0-or-later", "CC-BY-4.0"] as const;

/**
 * Per-package exceptions. An exception only applies while the package keeps
 * exactly this license string, so a license change triggers a new review. A
 * package with no license field at all is `license: "none"` and must name its
 * `version`: what was read by hand holds for that version only.
 */
export interface LicenseException {
  license: string;
  /** Required with `license: "none"`. */
  version?: string;
  reason: string;
}

export const LICENSE_EXCEPTIONS: Record<string, LicenseException> = {
  "@react-aria/optimize-locales-plugin": {
    license: "none",
    version: "2.1.0",
    reason:
      "Adobe's build plugin that drops React Aria's strings for other languages. Its package.json has no license field, but the package ships an Apache-2.0 LICENSE and every source file carries the Apache-2.0 header (read 2026-11-09). Build only: never shipped.",
  },
};

export interface LockPackage {
  version?: string;
  license?: unknown;
  dev?: boolean;
  devOptional?: boolean;
  link?: boolean;
}

export interface Violation {
  name: string;
  version: string;
  license: string;
  reason: string;
}

type SpdxNode =
  | { type: "license"; id: string }
  | { type: "and" | "or"; left: SpdxNode; right: SpdxNode };

/**
 * Parses an SPDX license expression such as `(MIT OR Apache-2.0)` or
 * `Apache-2.0 AND LGPL-3.0-or-later`. Precedence: WITH > AND > OR.
 * Throws on malformed input.
 */
export function parseSpdx(expression: string): SpdxNode {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let position = 0;

  const peek = () => tokens[position];
  const isOperator = (token: string | undefined, operator: string) =>
    token?.toUpperCase() === operator;

  function parseOr(): SpdxNode {
    let node = parseAnd();
    while (isOperator(peek(), "OR")) {
      position++;
      node = { type: "or", left: node, right: parseAnd() };
    }
    return node;
  }

  function parseAnd(): SpdxNode {
    let node = parseWith();
    while (isOperator(peek(), "AND")) {
      position++;
      node = { type: "and", left: node, right: parseWith() };
    }
    return node;
  }

  function parseWith(): SpdxNode {
    const node = parsePrimary();
    if (isOperator(peek(), "WITH")) {
      position++;
      // A license exception only grants extra permissions, so the base license decides.
      if (peek() === undefined)
        throw new Error(`Missing exception after WITH in "${expression}"`);
      position++;
    }
    return node;
  }

  function parsePrimary(): SpdxNode {
    const token = peek();
    if (token === undefined)
      throw new Error(`Unexpected end of "${expression}"`);
    position++;
    if (token === "(") {
      const node = parseOr();
      if (peek() !== ")") throw new Error(`Missing ")" in "${expression}"`);
      position++;
      return node;
    }
    if (token === ")" || ["AND", "OR", "WITH"].includes(token.toUpperCase())) {
      throw new Error(`Unexpected "${token}" in "${expression}"`);
    }
    return { type: "license", id: token };
  }

  const tree = parseOr();
  if (position !== tokens.length) {
    throw new Error(`Unexpected "${String(peek())}" in "${expression}"`);
  }
  return tree;
}

/** True if the expression can be satisfied using only licenses from `allowed`. */
export function isSatisfiedBy(
  expression: string,
  allowed: readonly string[],
): boolean {
  const allowedIds = new Set(allowed.map((id) => id.toLowerCase()));

  const evaluate = (node: SpdxNode): boolean => {
    switch (node.type) {
      case "license":
        return allowedIds.has(node.id.toLowerCase());
      case "and":
        return evaluate(node.left) && evaluate(node.right);
      case "or":
        return evaluate(node.left) || evaluate(node.right);
    }
  };

  return evaluate(parseSpdx(expression));
}

/** Returns every installed package whose license breaks the policy. */
export function findLicenseViolations(
  packages: Record<string, LockPackage>,
  exceptions: Record<string, LicenseException> = LICENSE_EXCEPTIONS,
): Violation[] {
  const violations: Violation[] = [];

  for (const [path, pkg] of Object.entries(packages)) {
    // The root entry is this project itself; links point at local folders.
    if (path === "" || pkg.link === true) continue;

    const name = path.slice(
      path.lastIndexOf("node_modules/") + "node_modules/".length,
    );
    const version = pkg.version ?? "unknown";
    const isDevOnly = pkg.dev === true || pkg.devOptional === true;

    if (typeof pkg.license !== "string" || pkg.license.trim() === "") {
      const exception = exceptions[name];
      if (exception?.license === "none" && exception.version === version) {
        continue;
      }
      violations.push({
        name,
        version,
        license: "none",
        reason: "no license field",
      });
      continue;
    }
    const license = pkg.license;

    if (exceptions[name]?.license === license) continue;

    const allowed = isDevOnly
      ? [...ALLOWED_LICENSES, ...DEV_ONLY_LICENSES]
      : ALLOWED_LICENSES;
    let satisfied: boolean;
    try {
      satisfied = isSatisfiedBy(license, allowed);
    } catch {
      violations.push({
        name,
        version,
        license,
        reason: "unparseable license expression",
      });
      continue;
    }

    if (!satisfied) {
      const devOnlyWouldPass =
        !isDevOnly &&
        isSatisfiedBy(license, [...ALLOWED_LICENSES, ...DEV_ONLY_LICENSES]);
      violations.push({
        name,
        version,
        license,
        reason: devOnlyWouldPass
          ? "license is allowed for dev tooling only, but this is a runtime dependency"
          : "license is not on the allowlist",
      });
    }
  }

  return violations;
}
