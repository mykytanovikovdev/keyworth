import { afterEach, describe, expect, it } from "vitest";
import { settingsSchema } from "../../../shared/schemas/settings.ts";
import { ApiError } from "../../../src/vault/api.ts";
import { isDeviceKey } from "../../../src/vault/device-keys.ts";
import { readRecords, writeRecord } from "../../../src/vault/records.ts";
import { isDataKey } from "../../../src/vault/tabs.ts";
import { ALICE } from "../crypto/fixtures.ts";
import { fakeBrowser, PASSPHRASE } from "./fake-browser.ts";

/*
 * Records through the vault, and the guards on keys that cross a boundary:
 * IndexedDB takes only device keys, and the tab channel only data keys.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function unlocked() {
  const b = fakeBrowser();
  cleanups.push(() => {
    b.closeAll();
  });
  const tab = b.openTab();
  await tab.vault.start(ALICE);
  await tab.vault.createKeys(PASSPHRASE);
  return { b, vault: tab.vault, api: b.server.api };
}

describe("records", () => {
  it("are written encrypted and read back with their revision", async () => {
    const { b, vault, api } = await unlocked();
    const id = crypto.randomUUID();

    const first = await writeRecord(vault, api, "settings", id, 0, {
      baseCurrency: "EUR",
    });
    const second = await writeRecord(vault, api, "settings", id, first, {
      baseCurrency: "CHF",
    });

    expect([first, second]).toEqual([1, 2]);
    expect(JSON.stringify([...b.server.records.values()])).not.toMatch(
      /"(CHF|EUR)"|baseCurrency/,
    );
    expect(await readRecords(vault, api, "settings", settingsSchema)).toEqual([
      { id, revision: 2, value: { baseCurrency: "CHF" } },
    ]);
  });

  it("refuses a stale revision, so two devices cannot overwrite each other", async () => {
    const { vault, api } = await unlocked();
    const id = crypto.randomUUID();
    await writeRecord(vault, api, "settings", id, 0, { baseCurrency: "EUR" });
    await writeRecord(vault, api, "settings", id, 1, { baseCurrency: "GBP" });

    await expect(
      writeRecord(vault, api, "settings", id, 1, { baseCurrency: "JPY" }),
    ).rejects.toMatchObject({ code: "conflict", status: 409 });
    await expect(
      writeRecord(vault, api, "settings", id, 1, {}),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("returns a damaged or unexpected record as damaged, next to good ones", async () => {
    const { b, vault, api } = await unlocked();
    const good = crypto.randomUUID();
    const replayed = crypto.randomUUID();
    const odd = crypto.randomUUID();
    await writeRecord(vault, api, "settings", good, 0, { baseCurrency: "EUR" });
    await writeRecord(vault, api, "settings", replayed, 0, {});
    await writeRecord(vault, api, "settings", odd, 0, { baseCurrency: 42 });
    // The server serves revision 1's envelope as if it were revision 2.
    const row = b.server.records.get(replayed);
    if (row) row.revision = 2;

    const read = await readRecords(vault, api, "settings", settingsSchema);

    expect(read).toEqual([
      { id: good, revision: 1, value: { baseCurrency: "EUR" } },
      { id: replayed, revision: 2, value: null },
      { id: odd, revision: 1, value: null },
    ]);
  });

  it("keep fields a newer version added when an older one saves", () => {
    const parsed = settingsSchema.parse({
      baseCurrency: "USD",
      addedLater: { theme: "dark" },
    });
    expect(parsed).toEqual({
      baseCurrency: "USD",
      addedLater: { theme: "dark" },
    });
  });
});

describe("keys that cross a boundary", () => {
  const generate = (extractable: boolean, usages: KeyUsage[]) =>
    crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      extractable,
      usages,
    );

  it("IndexedDB takes only a non-extractable wrap/unwrap key", async () => {
    const device = await generate(false, ["wrapKey", "unwrapKey"]);
    const extractable = await generate(true, ["wrapKey", "unwrapKey"]);
    const dataKey = await generate(false, ["encrypt", "decrypt"]);
    const both = await generate(false, [
      "encrypt",
      "decrypt",
      "wrapKey",
      "unwrapKey",
    ]);

    expect(isDeviceKey(device)).toBe(true);
    for (const key of [extractable, dataKey, both, "key", null]) {
      expect(isDeviceKey(key)).toBe(false);
    }
  });

  it("the tab channel takes only a non-extractable encrypt/decrypt key", async () => {
    expect(isDataKey(await generate(false, ["encrypt", "decrypt"]))).toBe(true);
    expect(isDataKey(await generate(true, ["encrypt", "decrypt"]))).toBe(false);
    expect(isDataKey(await generate(false, ["wrapKey", "unwrapKey"]))).toBe(
      false,
    );
    expect(isDataKey({ type: "secret" })).toBe(false);
  });
});
