import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
  AFTER_ARGON2,
  returningUser,
  sql,
  unlock,
  WCAG_TAGS,
} from "./signed-in.ts";
import { stubMarket } from "./market.ts";
import { collectErrors, cspViolations, watchCspViolations } from "./support.ts";

/*
 * Transactions in the production build, in Chromium, Firefox and WebKit:
 * added through the form, encrypted in the vault, listed, edited, deleted with
 * Undo, refused when they would sell more than was held. Market data is
 * answered in the browser (`market.ts`), so no test reaches CoinGecko.
 */

test.beforeEach(async ({ page }) => {
  test.slow();
  await watchCspViolations(page);
  await stubMarket(page);
});

async function openApp(
  page: Page,
  context: Parameters<typeof returningUser>[0],
  baseURL: string | undefined,
) {
  const user = await returningUser(context, baseURL);
  await page.goto("/transactions");
  await unlock(page, user.passphrase);
  await expect(
    page.getByRole("heading", { level: 1, name: "Transactions" }),
  ).toBeVisible(AFTER_ARGON2);
  return user;
}

/** A row's text as shown: each row has a phone's and a wide screen's version. */
const visible = (page: Page, text: string) =>
  page.getByText(text).filter({ visible: true }).first();

/**
 * Axe on what Keyworth draws. React Aria's live announcer adds, for seven
 * seconds, a role="img" entry pointing at a listbox option that has already
 * closed; screen readers have read it by then, and it is not the page's markup.
 */
const axe = (page: Page) =>
  new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .exclude('[aria-live] > [role="img"]');

const dialogOf = (page: Page, title: string) =>
  page.getByRole("dialog", { name: title });

/** Fills the form as a person would: the kind, a coin by typing, today, amounts. */
async function fillForm(
  page: Page,
  {
    kind = "Buy",
    coin = "bit",
    option = /Bitcoin/,
    quantity = "0.5",
    price = "60000",
    note,
  }: {
    kind?: string;
    coin?: string;
    option?: RegExp;
    quantity?: string;
    price?: string;
    note?: string;
  } = {},
) {
  const dialog = dialogOf(page, "Add transaction");
  await dialog.getByRole("radio", { name: kind }).click();
  await dialog.getByRole("combobox", { name: "Coin" }).fill(coin);
  await page.getByRole("option", { name: option }).click();
  await dialog.getByRole("button", { name: "Today" }).click();
  await dialog.getByRole("textbox", { name: "Quantity" }).fill(quantity);
  if (kind !== "Send") {
    const label = kind === "Receive" ? "Value per coin" : "Price per coin";
    await dialog.getByRole("textbox", { name: label }).fill(price);
  }
  if (note !== undefined) {
    await dialog.getByRole("button", { name: "Add note" }).click();
    await dialog.getByRole("textbox", { name: "Note" }).fill(note);
  }
  return dialog;
}

async function add(page: Page, fields: Parameters<typeof fillForm>[1] = {}) {
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  const dialog = await fillForm(page, fields);
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  return dialog;
}

const storedTransactions = (userId: string) =>
  sql<{ ciphertext: Buffer }>(
    "select ciphertext from vault_records where user_id = $1 and kind = 'transaction'",
    [userId],
  );

test("a purchase is encrypted, listed, and still there after unlocking again", async ({
  page,
  context,
  baseURL,
}) => {
  const errors = collectErrors(page);
  const { passphrase, userId } = await openApp(page, context, baseURL);
  await expect(page.getByText("No transactions yet")).toBeVisible();

  await page.getByRole("button", { name: "Add transaction" }).click();
  const dialog = await fillForm(page);
  // Today's price, offered with one press.
  await expect(dialog.getByText(/Price that day: \$75,000\.00/)).toBeVisible();
  await dialog.getByRole("button", { name: "Use this price" }).click();
  await expect(
    dialog.getByRole("textbox", { name: "Price per coin" }),
  ).toHaveValue("75000.00");
  await expect(dialog.getByText("$37,500.00")).toBeVisible();
  await dialog.getByRole("button", { name: "Add transaction" }).click();

  await expect(page.getByText("Transaction added")).toBeVisible();
  await expect(visible(page, "+0.5 BTC")).toBeVisible();
  const rows = await storedTransactions(userId);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.ciphertext.toString("latin1")).not.toMatch(
    /bitcoin|75000|manual/,
  );

  await page.reload();
  await unlock(page, passphrase);
  await expect(visible(page, "+0.5 BTC")).toBeVisible(AFTER_ARGON2);
  expect(errors).toEqual([]);
  expect(await cspViolations(page)).toEqual([]);
});

test("takes a date typed from the keyboard, under the CSP", async ({
  page,
  context,
  baseURL,
}) => {
  const errors = collectErrors(page);
  await openApp(page, context, baseURL);
  await page.getByRole("button", { name: "Add transaction" }).click();
  const dialog = dialogOf(page, "Add transaction");

  await dialog
    .getByRole("group", { name: "Date" })
    .getByRole("spinbutton")
    .first()
    .click();
  await page.keyboard.type("20122025");

  await expect(dialog.getByText("December 20, 2025")).toBeVisible();
  expect(errors).toEqual([]);
  expect(await cspViolations(page)).toEqual([]);
});

test("a sale offers the coins held, and All sells what was held that day", async ({
  page,
  context,
  baseURL,
}) => {
  const { userId } = await openApp(page, context, baseURL);
  await add(page, { quantity: "0.53124" });
  await expect(visible(page, "+0.53124 BTC")).toBeVisible();

  await page.getByRole("button", { name: "Add transaction" }).first().click();
  // A sale offers only the coins held, each with how much is left.
  const form = dialogOf(page, "Add transaction");
  await form.getByRole("radio", { name: "Sell" }).click();
  await form.getByRole("button", { name: "Show coin options" }).click();
  await expect(page.getByRole("option")).toHaveText([/Bitcoin.*0\.53124 BTC/]);
  await page.keyboard.press("Escape");
  const dialog = await fillForm(page, {
    kind: "Sell",
    quantity: "",
    price: "61000",
  });
  await expect(dialog.getByText(/^Held on .+: 0\.53124 BTC$/)).toBeVisible();
  await dialog.getByRole("button", { name: "All" }).click();
  await expect(dialog.getByRole("textbox", { name: "Quantity" })).toHaveValue(
    "0.53124",
  );
  await dialog.getByRole("button", { name: "Add transaction" }).click();

  await expect(visible(page, "−0.53124 BTC")).toBeVisible();
  expect(await storedTransactions(userId)).toHaveLength(2);
});

test("refuses a sale of more than was held, and stores nothing", async ({
  page,
  context,
  baseURL,
}) => {
  const { userId } = await openApp(page, context, baseURL);
  await add(page);
  await expect(visible(page, "+0.5 BTC")).toBeVisible();

  const dialog = await add(page, {
    kind: "Sell",
    quantity: "1",
    price: "61000",
  });

  await expect(dialog.getByText(/^You held 0\.5 BTC on /)).toBeVisible();
  expect(await storedTransactions(userId)).toHaveLength(1);
});

test("edits and deletes a transaction, and Undo brings it back", async ({
  page,
  context,
  baseURL,
}) => {
  const { userId } = await openApp(page, context, baseURL);
  await add(page);
  await expect(page.getByText("Transaction added")).toBeVisible();

  await page.getByRole("button", { name: /^Edit .*\+0\.5 BTC/ }).click();
  const dialog = dialogOf(page, "Edit transaction");
  await dialog.getByRole("textbox", { name: "Quantity" }).fill("0.7");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved")).toBeVisible();
  await expect(visible(page, "+0.7 BTC")).toBeVisible();

  await page
    .getByRole("button", { name: /^Actions for Buy \+0\.7 BTC/ })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByText("No transactions yet")).toBeVisible();
  expect(await storedTransactions(userId)).toHaveLength(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(visible(page, "+0.7 BTC")).toBeVisible();
  await expect
    .poll(async () => (await storedTransactions(userId)).length)
    .toBe(1);
});

test("a note with markup is shown as the text it is, and runs nothing", async ({
  page,
  context,
  baseURL,
}) => {
  // A phone's layout shows a row's note.
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, context, baseURL);
  const note = `<img src=x onerror="window.ranFromNote=1">`;

  await add(page, { note });

  await expect(page.getByText(note, { exact: false })).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as { ranFromNote?: number }).ranFromNote),
  ).toBeUndefined();
  expect(await cspViolations(page)).toEqual([]);
});

test("fits a 320px screen, and the list and the form have no axe violations", async ({
  page,
  context,
  baseURL,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openApp(page, context, baseURL);
  await add(page, {
    kind: "Buy",
    coin: "eth",
    option: /Ethereum/,
    quantity: "4.1",
  });
  await expect(visible(page, "+4.1 ETH")).toBeVisible();
  const fits = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );

  expect(await fits()).toBe(true);
  expect((await axe(page).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Add transaction" }).first().click();
  await fillForm(page, { kind: "Receive", coin: "lit", option: /Litecoin/ });
  expect(await fits()).toBe(true);
  expect(
    (await axe(page).include('[role="dialog"]').analyze()).violations,
  ).toEqual([]);
});
