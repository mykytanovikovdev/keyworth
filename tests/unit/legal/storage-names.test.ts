import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The privacy policy names every cookie and storage entry the app keeps in a
 * browser (src/features/legal/README.md). Each "keyworth-…" name in the
 * browser's code is such an entry, so a new one fails here until the policy
 * lists it.
 */

/** Names in the code that are not storage: the tabs' BroadcastChannel. */
const NOT_STORAGE = new Set(["keyworth-vault"]);

function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx|js)$/.test(entry.name) ? [path] : [];
  });
}

describe("the privacy policy's list of what is stored in the browser", () => {
  it("names every keyworth-… entry the app's code uses", () => {
    const names = new Set(
      [...sources("src"), "public/theme-init.js"].flatMap((path) =>
        [...readFileSync(path, "utf8").matchAll(/["'](keyworth-[a-z-]+)["']/g)]
          .map((match) => match[1] ?? "")
          .filter((name) => !NOT_STORAGE.has(name)),
      ),
    );
    const policy = readFileSync("src/features/legal/PrivacyPage.tsx", "utf8");

    expect(names.size).toBeGreaterThan(5);
    expect(
      [...names].filter((name) => !policy.includes(`<strong>${name}</strong>`)),
    ).toEqual([]);
  });
});
