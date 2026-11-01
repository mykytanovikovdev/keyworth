import { readFile } from "node:fs/promises";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { Pool } from "pg";
import { TEST_DATABASE_URL } from "../support/database.ts";
import { setUpKeys } from "../support/keys.ts";
import { createSignedInUser } from "../support/session.ts";
import { collectErrors, cspViolations, watchCspViolations } from "./support.ts";

/*
 * End-to-end encryption in the production build, in Chromium, Firefox and
 * WebKit: onboarding, unlocking, tabs, "Remember this device", Lock, the idle
 * lock, recovery, changing keys in Settings, and the first encrypted record.
 * Argon2 runs with the production settings, about a second per derivation.
 */

const RECOVERY_KEY = /^([0-9A-Z]{4}-){8}[0-9A-Z]{4}$/;
const RECOVERY_KEY_LABEL = /^Recovery key: ([0-9A-Z]{4}-){8}[0-9A-Z]{4}$/;

test.beforeEach(async ({ page }) => {
  await watchCspViolations(page);
});

async function sql<T extends Record<string, unknown>>(
  query: string,
  params: unknown[],
): Promise<T[]> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    return (await pool.query<T>(query, params)).rows;
  } finally {
    await pool.end();
  }
}

async function signIn(context: BrowserContext, baseURL: string | undefined) {
  const email = `e2e-keys-${crypto.randomUUID().slice(0, 8)}@example.com`;
  await context.addCookies(
    await createSignedInUser({
      databaseUrl: TEST_DATABASE_URL,
      baseURL: baseURL ?? "",
      email,
      name: "Alex Example",
    }),
  );
  return email;
}

/** A signed-in user who set up keys earlier, on another visit. */
async function returningUser(
  context: BrowserContext,
  baseURL: string | undefined,
) {
  const email = await signIn(context, baseURL);
  return {
    email,
    ...(await setUpKeys({ databaseUrl: TEST_DATABASE_URL, email })),
  };
}

const unlockHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Unlock Keyworth" });
const welcome = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Welcome, Alex" });

async function unlock(page: Page, passphrase: string, remember = false) {
  await page.getByLabel("Passphrase", { exact: true }).fill(passphrase);
  if (remember) {
    // The box is drawn over a hidden input: click the label, as people do.
    await page.getByText("Remember this device", { exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "Remember this device" }),
    ).toBeChecked();
  }
  await page.getByRole("button", { name: "Unlock" }).click();
}

async function openSettings(page: Page) {
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible();
}

test("onboarding: a passphrase, the recovery key shown once, then the app", async ({
  page,
  context,
  baseURL,
}) => {
  const errors = collectErrors(page);
  const email = await signIn(context, baseURL);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Create a passphrase" }),
  ).toBeVisible();
  const field = page.getByLabel("Passphrase", { exact: true });
  const submit = page.getByRole("button", { name: "Continue" });
  // Not "new-password": that made Chrome generate the passphrase and save it.
  await expect(field).toHaveAttribute("autocomplete", "off");

  await field.fill("фиолетовый слон танцует");
  await submit.click();
  await expect(page.getByText("Is the keyboard set to English?")).toBeVisible();
  await field.fill("too short");
  await submit.click();
  await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
  await field.fill("purple elephant dances at noon");
  await submit.click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Save your recovery key" }),
  ).toBeVisible({ timeout: 15_000 });
  const label = await page
    .getByRole("group", { name: /^Recovery key: / })
    .getAttribute("aria-label");
  const recoveryKey = label?.replace("Recovery key: ", "") ?? "";
  expect(recoveryKey).toMatch(RECOVERY_KEY);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("keyworth-recovery-key.txt");
  expect(await readFile(await download.path(), "utf8")).toContain(recoveryKey);

  await page.getByRole("button", { name: "I've saved it" }).click();
  await expect(welcome(page)).toBeVisible();
  const slots = await sql<{ kind: string }>(
    `select kind from user_key_slots
      where user_id = (select id from "user" where email = $1) order by kind`,
    [email],
  );
  expect(slots.map((slot) => slot.kind)).toEqual(["passphrase", "recovery"]);
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("prints the recovery key alone", async ({ page, context, baseURL }) => {
  await signIn(context, baseURL);
  await page.goto("/");
  await page
    .getByLabel("Passphrase", { exact: true })
    .fill("purple elephant dances at noon");
  await page.getByRole("button", { name: "Continue" }).click();
  const key = page.getByRole("group", { name: /^Recovery key: / });
  await expect(key).toBeVisible({ timeout: 15_000 });

  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-printing-key", "");
  });

  const visibility = async (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => getComputedStyle(element).visibility);
  expect(await visibility("h1")).toBe("hidden");
  expect(await visibility("button")).toBe("hidden");
  expect(await visibility("[data-print-key] [role=group]")).toBe("visible");
});

test("unlock: a wrong passphrase is refused, the right one opens, a reload asks again", async ({
  page,
  context,
  baseURL,
}) => {
  const errors = collectErrors(page);
  const { passphrase } = await returningUser(context, baseURL);
  await page.goto("/settings");
  await expect(unlockHeading(page)).toBeVisible();
  await expect(page.getByLabel("Passphrase", { exact: true })).toHaveAttribute(
    "autocomplete",
    "off",
  );

  await unlock(page, "not my passphrase at all");
  await expect(
    page.getByText("This passphrase doesn't unlock your data."),
  ).toBeVisible({ timeout: 15_000 });
  await unlock(page, "пароль на кириллице");
  await expect(page.getByText("Is the keyboard set to English?")).toBeVisible();
  await unlock(page, passphrase);

  // Where the user was going, not the home page.
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(unlockHeading(page)).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("one unlock per browser: a new tab gets the key, Lock locks every tab", async ({
  page,
  context,
  baseURL,
}) => {
  const { passphrase } = await returningUser(context, baseURL);
  await page.goto("/");
  await unlock(page, passphrase);
  await expect(welcome(page)).toBeVisible({ timeout: 15_000 });

  const second = await context.newPage();
  await watchCspViolations(second);
  await second.goto("/");
  await expect(welcome(second)).toBeVisible();

  await openSettings(page);
  // Lock reloads every tab; act only once each has reloaded.
  const reloaded = [page.waitForEvent("load"), second.waitForEvent("load")];
  await page.getByRole("button", { name: "Lock now" }).click();
  await Promise.all(reloaded);

  await expect(unlockHeading(page)).toBeVisible();
  await expect(unlockHeading(second)).toBeVisible();
  // Unlocking one tab unlocks the other again.
  await unlock(page, passphrase);
  await expect(welcome(second)).toBeVisible({ timeout: 15_000 });
  expect(await cspViolations(second)).toEqual([]);
});

test("Remember this device: a reload opens the app; Lock forgets the device", async ({
  page,
  context,
  baseURL,
}) => {
  const errors = collectErrors(page);
  const { passphrase, userId } = await returningUser(context, baseURL);
  await page.goto("/");
  await unlock(page, passphrase, true);
  await expect(welcome(page)).toBeVisible({ timeout: 15_000 });
  expect(
    await sql("select 1 from device_unlocks where user_id = $1", [userId]),
  ).toHaveLength(1);

  await page.reload();
  await expect(welcome(page)).toBeVisible();

  await openSettings(page);
  await expect(page.getByText("and forgets this device")).toBeVisible();
  const reloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: "Lock now" }).click();
  await reloaded;
  await expect(unlockHeading(page)).toBeVisible();
  // The screen locks at once; the server half goes right after.
  await expect
    .poll(async () =>
      sql("select 1 from device_unlocks where user_id = $1", [userId]),
    )
    .toHaveLength(0);
  await page.reload();
  await expect(unlockHeading(page)).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("locks after 15 minutes without activity, and says so", async ({
  page,
  context,
  baseURL,
}) => {
  const { passphrase } = await returningUser(context, baseURL);
  await page.goto("/");
  await unlock(page, passphrase);
  await expect(welcome(page)).toBeVisible({ timeout: 15_000 });

  // As if the last key press were 16 minutes ago and the tab came back now.
  const reloaded = page.waitForEvent("load");
  await page.evaluate(() => {
    localStorage.setItem(
      "keyworth-last-activity",
      String(Date.now() - 16 * 60 * 1000),
    );
    window.dispatchEvent(new Event("focus"));
  });
  await reloaded;

  await expect(unlockHeading(page)).toBeVisible();
  await expect(
    page.getByText("Locked after 15 minutes without activity."),
  ).toBeVisible();
});

test("recovery: the recovery key and a new passphrase open the data", async ({
  page,
  context,
  baseURL,
}) => {
  const errors = collectErrors(page);
  const { recoveryKey } = await returningUser(context, baseURL);
  await page.goto("/");
  await page.getByRole("link", { name: "Use your recovery key" }).click();
  await expect(page).toHaveURL(/\/recover$/);
  const keyField = page.getByLabel("Recovery key");
  const passphraseField = page.getByLabel("New passphrase", { exact: true });
  const submit = page.getByRole("button", { name: "Set new passphrase" });

  // One character changed: the check group catches it before any cryptography.
  const typo = `${recoveryKey.startsWith("A") ? "B" : "A"}${recoveryKey.slice(1)}`;
  await keyField.fill(typo.toLowerCase());
  await passphraseField.fill("a brand new passphrase");
  await submit.click();
  await expect(page.getByText("This recovery key has a typo.")).toBeVisible();

  await keyField.fill(recoveryKey.replaceAll("-", " "));
  await submit.click();
  await expect(welcome(page)).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await unlock(page, "a brand new passphrase");
  await expect(welcome(page)).toBeVisible({ timeout: 15_000 });
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("recovery asks for a fresh Google sign-in before anything is typed", async ({
  page,
  context,
  baseURL,
}) => {
  const { userId } = await returningUser(context, baseURL);
  await sql(
    "update session set created_at = now() - interval '11 minutes' where user_id = $1",
    [userId],
  );
  let google: URL | undefined;
  await page.route("https://accounts.google.com/**", async (route) => {
    google = new URL(route.request().url());
    await route.fulfill({ status: 200, body: "Google" });
  });

  await page.goto("/recover");
  await expect(page.getByLabel("Recovery key")).toHaveCount(0);
  await page.getByRole("button", { name: "Sign in again" }).click();

  await expect.poll(() => google).toBeDefined();
});

test("Settings: change the passphrase, create a new recovery key", async ({
  page,
  context,
  baseURL,
}) => {
  const errors = collectErrors(page);
  const { passphrase, userId } = await returningUser(context, baseURL);
  const recoveryIv = async () =>
    (
      await sql<{ iv: Buffer }>(
        "select iv from user_key_slots where user_id = $1 and kind = 'recovery'",
        [userId],
      )
    )[0]?.iv.toString("hex");
  const before = await recoveryIv();
  await page.goto("/settings");
  await unlock(page, passphrase);

  await page.getByRole("button", { name: "Change passphrase" }).click();
  const change = page.getByRole("dialog", { name: "Change passphrase" });
  for (const label of ["Current passphrase", "New passphrase"]) {
    await expect(change.getByLabel(label, { exact: true })).toHaveAttribute(
      "autocomplete",
      "off",
    );
  }
  await change
    .getByLabel("Current passphrase", { exact: true })
    .fill("wrong one here");
  await change
    .getByLabel("New passphrase", { exact: true })
    .fill("the new passphrase");
  await change.getByRole("button", { name: "Change passphrase" }).click();
  await expect(
    change.getByText("This passphrase doesn't unlock your data."),
  ).toBeVisible({ timeout: 15_000 });
  await change
    .getByLabel("Current passphrase", { exact: true })
    .fill(passphrase);
  await change.getByRole("button", { name: "Change passphrase" }).click();
  await expect(page.getByText("Passphrase changed")).toBeVisible({
    timeout: 15_000,
  });
  await expect(change).toHaveCount(0);

  await page.getByRole("button", { name: "Create new key" }).click();
  const create = page.getByRole("dialog", {
    name: "Create a new recovery key",
  });
  await create
    .getByLabel("Passphrase", { exact: true })
    .fill("the new passphrase");
  await create.getByRole("button", { name: "Create key" }).click();
  const save = page.getByRole("alertdialog", {
    name: "Save your new recovery key",
  });
  await expect(
    save.getByRole("group", { name: RECOVERY_KEY_LABEL }),
  ).toBeVisible({ timeout: 15_000 });
  await save.getByRole("button", { name: "I've saved it" }).click();
  await expect(save).toHaveCount(0);
  expect(await recoveryIv()).not.toBe(before);

  await page.reload();
  await unlock(page, "the new passphrase");
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible({ timeout: 15_000 });
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("Settings asks for a fresh sign-in before a new passphrase is typed", async ({
  page,
  context,
  baseURL,
}) => {
  const { passphrase, userId } = await returningUser(context, baseURL);
  await page.goto("/settings");
  await unlock(page, passphrase);
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible({ timeout: 15_000 });
  await sql(
    "update session set created_at = now() - interval '11 minutes' where user_id = $1",
    [userId],
  );

  await page.getByRole("button", { name: "Change passphrase" }).click();

  const dialog = page.getByRole("dialog", { name: "Change passphrase" });
  await expect(
    dialog.getByRole("button", { name: "Sign in again" }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Current passphrase")).toHaveCount(0);
});

test("the base currency is the first encrypted record", async ({
  page,
  context,
  baseURL,
}) => {
  const { passphrase, userId } = await returningUser(context, baseURL);
  await page.goto("/settings");
  await unlock(page, passphrase);

  const currency = page.getByRole("button", { name: /^Base currency/ });
  await expect(currency).toHaveAccessibleName(/US dollar/, { timeout: 15_000 });
  await currency.click();
  await page.getByRole("menuitemradio", { name: "Euro (EUR)" }).click();
  await expect(currency).toHaveAccessibleName(/Euro/);
  await expect(currency).toBeEnabled();

  const rows = await sql<{ kind: string; ciphertext: Buffer }>(
    "select kind, ciphertext from vault_records where user_id = $1",
    [userId],
  );
  expect(rows.map((row) => row.kind)).toEqual(["settings"]);
  const stored = rows[0]?.ciphertext.toString("latin1") ?? "";
  expect(stored).not.toMatch(/EUR|baseCurrency/);

  await page.reload();
  await unlock(page, passphrase);
  await expect(currency).toHaveAccessibleName(/Euro/, { timeout: 15_000 });
});

test("Sign out everywhere signs out every tab", async ({
  page,
  context,
  baseURL,
}) => {
  const { passphrase } = await returningUser(context, baseURL);
  await page.goto("/");
  await unlock(page, passphrase);
  await expect(welcome(page)).toBeVisible({ timeout: 15_000 });
  const second = await context.newPage();
  await second.goto("/settings");
  await expect(
    second.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible();

  await second.getByRole("button", { name: "Sign out everywhere" }).click();

  await expect(second).toHaveURL(/\/sign-in$/);
  await expect(page).toHaveURL(/\/sign-in$/);
});
