import { afterEach, describe, expect, it } from "vitest";
import { VAULT_BATCH } from "../../../shared/schemas/vault.ts";
import {
  deleteTransaction,
  deleteTransactions,
  ImportStopped,
  importTransactions,
  inBatches,
  keepIfUnlocked,
  loadTransactions,
  saveTransaction,
  TransactionError,
  type TransactionList,
  type VaultAccess,
} from "../../../src/features/transactions/service.ts";
import { ApiError } from "../../../src/vault/api.ts";
import { writeRecord } from "../../../src/vault/records.ts";
import { ALICE } from "../crypto/fixtures.ts";
import { fakeBrowser, PASSPHRASE } from "../vault/fake-browser.ts";

/*
 * The transaction service against a fake server with the real API's rules,
 * through a real vault: what is stored is encrypted, and every change meets
 * the ledger's rules before anything is written.
 */

const NOW = Date.parse("2026-11-08T12:00:00Z");

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
  const access: VaultAccess = { vault: tab.vault, api: b.server.api };
  return { b, access };
}

const trade = (
  type: "buy" | "sell",
  executedAt: string,
  quantity: string,
  fields: Record<string, unknown> = {},
) => ({
  type,
  assetId: "crypto:bitcoin",
  executedAt: `${executedAt}T10:00:00Z`,
  quantity,
  price: "60000",
  priceCurrency: "USD",
  source: "manual",
  ...fields,
});

const transferOut = (executedAt: string, quantity: string) => ({
  type: "transfer_out",
  assetId: "crypto:bitcoin",
  executedAt: `${executedAt}T10:00:00Z`,
  quantity,
  source: "manual",
});

/** Saves each value in turn, as a user would one after another. */
async function saved(access: VaultAccess, ...values: unknown[]) {
  let list: TransactionList = { records: [], damaged: [] };
  for (const value of values) {
    list = await saveTransaction(access, list, { value }, NOW);
  }
  return list;
}

async function refused(change: Promise<unknown>) {
  const error = await change.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(TransactionError);
  return error as TransactionError;
}

describe("saving", () => {
  it("stores a transaction encrypted and reads it back with its revision", async () => {
    const { b, access } = await unlocked();

    const list = await saved(access, trade("buy", "2025-12-20", "0.5"));

    expect(list.records).toHaveLength(1);
    expect(list.records[0]?.revision).toBe(1);
    expect(JSON.stringify([...b.server.records.values()])).not.toMatch(
      /bitcoin|60000|manual/,
    );
    expect(await loadTransactions(access)).toEqual(list);
  });

  it("replaces a transaction under the same id, with the next revision", async () => {
    const { access } = await unlocked();
    const list = await saved(access, trade("buy", "2025-12-20", "0.5"));
    const id = list.records[0]?.id ?? "";

    const edited = await saveTransaction(
      access,
      list,
      { id, value: trade("buy", "2025-12-20", "0.7") },
      NOW,
    );

    expect(edited.records).toEqual([
      { id, revision: 2, value: trade("buy", "2025-12-20", "0.7") },
    ]);
    expect(await loadTransactions(access)).toEqual(edited);
  });

  it("refuses what is not a transaction, naming the fields", async () => {
    const { b, access } = await unlocked();

    const error = await refused(
      saved(
        access,
        trade("buy", "2025-12-20", "1e5", { priceCurrency: "usd" }),
      ),
    );

    expect(error.problems).toEqual([
      { kind: "invalid", fields: ["quantity", "priceCurrency"] },
    ]);
    expect(b.server.records.size).toBe(0);
  });

  it("refuses a transaction dated in the future, allowing a clock a few minutes ahead", async () => {
    const { access } = await unlocked();
    const at = (iso: string) =>
      trade("buy", "2026-11-08", "1", { executedAt: iso });

    await saved(access, at("2026-11-08T12:05:00Z"));
    const error = await refused(saved(access, at("2026-11-08T12:30:00Z")));

    expect(error.problems).toEqual([{ kind: "in-the-future" }]);
  });
});

describe("the ledger's rules", () => {
  it("refuses a sale of more than was held, saying how much was", async () => {
    const { b, access } = await unlocked();
    const list = await saved(access, trade("buy", "2025-12-20", "0.5"));

    const error = await refused(
      saveTransaction(
        access,
        list,
        { value: trade("sell", "2026-01-10", "0.6") },
        NOW,
      ),
    );

    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]).toMatchObject({
      kind: "oversold",
      assetId: "crypto:bitcoin",
      executedAt: "2026-01-10T10:00:00Z",
      asked: "0.6",
      held: "0.5",
    });
    expect(b.server.records.size).toBe(1);
  });

  it("counts what was held at the sale's moment, not today", async () => {
    const { access } = await unlocked();
    const list = await saved(access, trade("buy", "2026-02-01", "1"));

    const error = await refused(
      saveTransaction(
        access,
        list,
        { value: transferOut("2026-01-15", "0.1") },
        NOW,
      ),
    );

    expect(error.problems[0]).toMatchObject({ kind: "oversold", held: "0" });
  });

  it("refuses a backdated sale that would leave a later one short, and names that one", async () => {
    const { access } = await unlocked();
    const list = await saved(
      access,
      trade("buy", "2026-01-01", "1"),
      trade("sell", "2026-03-01", "1"),
    );
    const later = list.records[1]?.id;

    const error = await refused(
      saveTransaction(
        access,
        list,
        { value: trade("sell", "2026-02-01", "0.4") },
        NOW,
      ),
    );

    expect(error.problems).toEqual([
      expect.objectContaining({
        transactionId: later,
        asked: "1",
        held: "0.6",
      }),
    ]);
  });

  it("refuses to shrink or delete a purchase that a later sale needs", async () => {
    const { access } = await unlocked();
    const list = await saved(
      access,
      trade("buy", "2026-01-01", "1"),
      trade("sell", "2026-03-01", "0.8"),
    );
    const buy = list.records[0]?.id ?? "";

    const shrunk = await refused(
      saveTransaction(
        access,
        list,
        { id: buy, value: trade("buy", "2026-01-01", "0.5") },
        NOW,
      ),
    );
    const deleted = await refused(deleteTransaction(access, list, buy));

    expect(shrunk.problems[0]).toMatchObject({ kind: "oversold", held: "0.5" });
    expect(deleted.problems[0]).toMatchObject({ kind: "oversold", held: "0" });
    expect(await loadTransactions(access)).toEqual(list);
  });

  it("allows a purchase and a sale on the same day, whatever their times", async () => {
    const { access } = await unlocked();

    const list = await saved(
      access,
      trade("buy", "2026-01-01", "1", { executedAt: "2026-01-01T00:00:00Z" }),
      trade("sell", "2026-01-01", "1", { executedAt: "2026-01-01T00:00:00Z" }),
    );

    expect(list.records).toHaveLength(2);
  });

  it("keeps coins apart: one coin's purchase does not cover another's sale", async () => {
    const { access } = await unlocked();
    const list = await saved(access, trade("buy", "2026-01-01", "1"));

    const error = await refused(
      saveTransaction(
        access,
        list,
        {
          value: trade("sell", "2026-02-01", "1", {
            assetId: "crypto:ethereum",
          }),
        },
        NOW,
      ),
    );

    expect(error.problems[0]).toMatchObject({
      assetId: "crypto:ethereum",
      held: "0",
    });
  });

  it("lets a sale already short (an import, say) stay so, but not grow", async () => {
    const { access } = await unlocked();
    const id = crypto.randomUUID();
    // Written past the service, as an older import could have.
    await writeRecord(
      access.vault,
      access.api,
      "transaction",
      id,
      0,
      trade("sell", "2026-01-01", "1"),
    );
    const list = await loadTransactions(access);

    const noted = await saveTransaction(
      access,
      list,
      {
        id,
        value: trade("sell", "2026-01-01", "1", {
          note: "from the old exchange",
        }),
      },
      NOW,
    );
    const grown = await refused(
      saveTransaction(
        access,
        noted,
        { id, value: trade("sell", "2026-01-01", "2") },
        NOW,
      ),
    );

    expect(noted.records[0]?.revision).toBe(2);
    expect(grown.problems[0]).toMatchObject({ kind: "oversold", asked: "2" });
  });
});

describe("other devices", () => {
  it("refuses an edit of a transaction changed elsewhere, and hands back the list as it is", async () => {
    const { access } = await unlocked();
    const list = await saved(access, trade("buy", "2026-01-01", "1"));
    const record = list.records[0];
    if (!record) throw new Error("Expected a record");
    // Another device edits it first.
    await writeRecord(
      access.vault,
      access.api,
      "transaction",
      record.id,
      1,
      trade("buy", "2026-01-01", "2"),
    );

    const error = await refused(
      saveTransaction(
        access,
        list,
        { id: record.id, value: trade("buy", "2026-01-01", "3") },
        NOW,
      ),
    );

    expect(error.problems).toEqual([{ kind: "changed-elsewhere" }]);
    expect(error.latest?.records[0]?.value.quantity).toBe("2");
  });

  it("refuses an edit of a transaction deleted elsewhere", async () => {
    const { access } = await unlocked();
    const list = await saved(access, trade("buy", "2026-01-01", "1"));
    const id = list.records[0]?.id ?? "";
    await access.api.deleteRecord(id);

    const error = await refused(
      saveTransaction(
        access,
        list,
        { id, value: trade("buy", "2026-01-01", "2") },
        NOW,
      ),
    );

    expect(error.problems).toEqual([{ kind: "changed-elsewhere" }]);
    expect(error.latest?.records).toEqual([]);
  });

  it("counts a transaction deleted elsewhere as deleted", async () => {
    const { access } = await unlocked();
    const list = await saved(access, trade("buy", "2026-01-01", "1"));
    const id = list.records[0]?.id ?? "";
    await access.api.deleteRecord(id);

    expect(await deleteTransaction(access, list, id)).toEqual({
      records: [],
      damaged: [],
    });
  });
});

describe("deleting several", () => {
  it("deletes the chosen ones and unreadable ones among them, in one go", async () => {
    const { b, access } = await unlocked();
    const list = await saved(
      access,
      trade("buy", "2025-01-01", "1"),
      trade("buy", "2025-01-02", "2"),
      trade("buy", "2025-01-03", "3"),
    );
    const [first, second, third] = list.records;
    if (!first || !second || !third) throw new Error("Expected three");
    const withDamaged = { ...list, damaged: ["damaged-one"] };

    const after = await deleteTransactions(access, withDamaged, [
      first.id,
      third.id,
      "damaged-one",
    ]);

    expect(after.records.map(({ id }) => id)).toEqual([second.id]);
    expect(after.damaged).toEqual([]);
    expect(
      b.server.state.calls.filter((c) => c === "deleteRecords"),
    ).toHaveLength(1);
    expect(
      (await loadTransactions(access)).records.map(({ id }) => id),
    ).toEqual([second.id]);
  });

  it("refuses to take a purchase a remaining sale needs, and deletes nothing", async () => {
    const { access } = await unlocked();
    const list = await saved(
      access,
      trade("buy", "2025-01-01", "1"),
      trade("sell", "2025-01-02", "1"),
    );
    const [buy] = list.records;
    if (!buy) throw new Error("Expected a purchase");

    await refused(deleteTransactions(access, list, [buy.id]));
    expect((await loadTransactions(access)).records).toHaveLength(2);
  });

  it("deletes everything, a sale and its purchase together", async () => {
    const { access } = await unlocked();
    const list = await saved(
      access,
      trade("buy", "2025-01-01", "1"),
      trade("sell", "2025-01-02", "1"),
    );

    const after = await deleteTransactions(
      access,
      list,
      list.records.map(({ id }) => id),
    );

    expect(after.records).toEqual([]);
    expect((await loadTransactions(access)).records).toEqual([]);
  });
});

describe("the page's copy of the list", () => {
  it("is kept only while the data key is open, never after a lock", async () => {
    const { access } = await unlocked();
    const list = await saved(access, trade("buy", "2025-01-01", "1"));
    const kept: TransactionList[] = [];

    expect(keepIfUnlocked(access, list, (l) => kept.push(l))).toBe(true);
    await access.vault.lock("lock");
    expect(keepIfUnlocked(access, list, (l) => kept.push(l))).toBe(false);

    expect(kept).toEqual([list]);
  });
});

describe("damaged records", () => {
  it("are left out of the list but named, and can be deleted", async () => {
    const { access } = await unlocked();
    await saved(access, trade("buy", "2026-01-01", "1"));
    const bad = crypto.randomUUID();
    await writeRecord(access.vault, access.api, "transaction", bad, 0, {
      type: "gift",
    });

    const list = await loadTransactions(access);
    const after = await deleteTransaction(access, list, bad);

    expect(list.records).toHaveLength(1);
    expect(list.damaged).toEqual([bad]);
    expect(after.damaged).toEqual([]);
    expect(await loadTransactions(access)).toEqual(after);
  });
});

describe("importing", () => {
  const purchases = (count: number) =>
    Array.from({ length: count }, (_, n) =>
      trade("buy", "2026-01-01", `0.${String(n + 1).padStart(4, "0")}`, {
        source: "csv",
      }),
    );

  it("writes many in batches, encrypted, and says how many are in", async () => {
    const { b, access } = await unlocked();
    const before = await saved(access, trade("buy", "2025-12-01", "1"));
    const heard: number[] = [];

    const after = await importTransactions(access, before, purchases(250), {
      now: NOW,
      progress: (written) => heard.push(written),
    });

    expect(heard).toEqual([100, 200, 250]);
    expect(
      b.server.state.calls.filter((call) => call === "createRecords"),
    ).toHaveLength(3);
    expect(after.records).toHaveLength(251);
    const loaded = await loadTransactions(access);
    expect(loaded.records).toHaveLength(251);
    expect(loaded.records.every(({ revision }) => revision === 1)).toBe(true);
    expect(JSON.stringify([...b.server.records.values()])).not.toContain(
      "bitcoin",
    );
  });

  it("refuses the lot, writing nothing, when the ledger's rule fails", async () => {
    const { b, access } = await unlocked();
    const empty: TransactionList = { records: [], damaged: [] };

    const error = await refused(
      importTransactions(
        access,
        empty,
        [trade("buy", "2026-01-01", "1"), trade("sell", "2026-01-02", "2")],
        { now: NOW },
      ),
    );

    expect(error.problems).toEqual([
      expect.objectContaining({ kind: "oversold", held: "1", asked: "2" }),
    ]);
    expect(b.server.records.size).toBe(0);
  });

  it("refuses a value that is not a transaction", async () => {
    const { b, access } = await unlocked();

    const error = await refused(
      importTransactions(
        access,
        { records: [], damaged: [] },
        [{ type: "gift" }],
        { now: NOW },
      ),
    );

    expect(error.problems[0]?.kind).toBe("invalid");
    expect(b.server.records.size).toBe(0);
  });

  it("waits as told when the server says too many, then goes on", async () => {
    const { access } = await unlocked();
    const createRecords = access.api.createRecords.bind(access.api);
    let calls = 0;
    access.api.createRecords = async (batch) => {
      calls += 1;
      if (calls === 2) {
        throw new ApiError(429, { error: "rate_limited" }, 42);
      }
      await createRecords(batch);
    };
    const waited: number[] = [];

    const after = await importTransactions(
      access,
      { records: [], damaged: [] },
      purchases(150),
      {
        now: NOW,
        wait: (ms) => {
          waited.push(ms);
          return Promise.resolve();
        },
      },
    );

    expect(waited).toEqual([42_000]);
    expect(after.records).toHaveLength(150);
    expect((await loadTransactions(access)).records).toHaveLength(150);
  });

  it("stops part of the way with what is in, and nothing half written", async () => {
    const { access } = await unlocked();
    const createRecords = access.api.createRecords.bind(access.api);
    let calls = 0;
    access.api.createRecords = async (batch) => {
      calls += 1;
      if (calls === 2) throw new TypeError("Failed to fetch");
      await createRecords(batch);
    };

    const error = await importTransactions(
      access,
      { records: [], damaged: [] },
      purchases(250),
      { now: NOW },
    ).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ImportStopped);
    const stopped = error as ImportStopped;
    expect(stopped.written).toBe(100);
    expect(stopped.list.records).toHaveLength(100);
    expect(stopped.cause).toBeInstanceOf(TypeError);
    expect(await loadTransactions(access)).toEqual(stopped.list);
  });

  it("splits by the body's size as well as by count", () => {
    const record = (ct: string) => ({
      id: crypto.randomUUID(),
      kind: "transaction" as const,
      envelope: {
        v: 1 as const,
        alg: "A256GCM" as const,
        iv: "A".repeat(16),
        ct,
      },
    });
    const big = Array.from({ length: 3 }, () =>
      record("A".repeat(VAULT_BATCH.maxBytes / 2 - 200)),
    );
    const small = Array.from({ length: VAULT_BATCH.maxRecords + 1 }, () =>
      record("AAAA"),
    );

    expect(inBatches(big).map((batch) => batch.length)).toEqual([1, 1, 1]);
    expect(inBatches(small).map((batch) => batch.length)).toEqual([
      VAULT_BATCH.maxRecords,
      1,
    ]);
  });
});
