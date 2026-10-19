/**
 * Fails when an installed dependency has a license that is not compatible with
 * the project's AGPL-3.0-or-later license. Reads package-lock.json only, so it
 * needs no extra dependencies. Usage: `npm run licenses`.
 */
import { readFileSync } from "node:fs";
import { findLicenseViolations, type LockPackage } from "./license-policy.ts";

interface Lockfile {
  lockfileVersion: number;
  packages: Record<string, LockPackage>;
}

const lockfile = JSON.parse(
  readFileSync("package-lock.json", "utf8"),
) as Lockfile;

if (lockfile.lockfileVersion < 3) {
  console.error(
    `Expected lockfileVersion 3, got ${String(lockfile.lockfileVersion)}.`,
  );
  process.exit(1);
}

const violations = findLicenseViolations(lockfile.packages);
const checked = Object.keys(lockfile.packages).length - 1;

if (violations.length > 0) {
  console.error(
    `License check failed: ${String(violations.length)} of ${String(checked)} packages.`,
  );
  for (const { name, version, license, reason } of violations) {
    console.error(`  ${name}@${version}  ${license}  — ${reason}`);
  }
  console.error(
    "See scripts/README.md for the policy and how to add an exception.",
  );
  process.exit(1);
}

console.log(`License check passed: ${String(checked)} packages.`);
