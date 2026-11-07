import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { Pool } from "pg";
import { TEST_DATABASE_URL } from "../support/database.ts";
import { setUpKeys } from "../support/keys.ts";
import { createSignedInUser } from "../support/session.ts";
import { collectErrors, cspViolations, watchCspViolations } from "./support.ts";

/*
 * End-to-end encryption in the production build, in Chromium, Firefox and
 * WebKit: how it works, onboarding, unlocking, tabs, "Remember this device", Lock, the idle
 * lock, recovery, changing keys in Settings, and the first encrypted record.
 * Argon2 runs with the production settings, about a second per derivation.
 */

const RECOVERY_KEY = /^([0-9A-Z]{4}-){8}[0-9A-Z]{4}$/;
const RECOVERY_KEY_LABEL = /^Recovery key: ([0-9A-Z]{4}-){8}[0-9A-Z]{4}$/;

/**
 * Argon2 with the production settings takes about a second per derivation on
 * a laptop and several in CI, slowest in WebKit on Linux; a test here runs up
 * to six. So every test gets three times the usual time, and every wait that
 * follows a derivation gets this much.
 */
const AFTER_ARGON2 = { timeout: 30_000 };

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.beforeEach(async ({ page }) => {
  test.slow();
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

/**
 * Records, from now on, each status the keyhole mark shows: "working" while
 * Argon2 runs (the ring), "opened" while the lock turns before the next
 * screen, "refused" after a refusal. The finale lasts a quarter of a second,
 * too short to catch by polling, so a MutationObserver writes the history.
 */
async function watchKeyMark(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as { keyMarkSeen?: string[] }).keyMarkSeen = seen;
    const record = () => {
      const status = document
        .querySelector("[data-key-mark]")
        ?.getAttribute("data-key-mark");
      if (status && seen.at(-1) !== status) seen.push(status);
    };
    new MutationObserver(record).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-key-mark"],
    });
    record();
  });
}

const keyMarkSeen = (page: Page) =>
  page.evaluate(() => (window as { keyMarkSeen?: string[] }).keyMarkSeen);

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
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Create a passphrase" }),
  ).toBeVisible();
  await watchKeyMark(page);
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
  ).toBeVisible(AFTER_ARGON2);
  // The ring ran only for the derivation, and the lock turned before this
  // screen, whose own mark is at rest.
  expect(await keyMarkSeen(page)).toEqual([
    "idle",
    "working",
    "opened",
    "idle",
  ]);
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

test("onboarding opens on how the encryption works: steps both ways, Continue at once", async ({
  page,
  context,
  baseURL,
}) => {
  const errors = collectErrors(page);
  await signIn(context, baseURL);
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Only you can read your portfolio",
    }),
  ).toBeVisible();
  const caption = page.locator("figcaption");
  const back = page.getByRole("button", { name: "Previous step" });
  const next = page.getByRole("button", { name: "Next step" });

  await expect(caption).toContainText("Your passphrase turns into a key");
  await expect(back).toBeDisabled();
  await next.click();
  await expect(caption).toContainText("That key opens your data key");
  await expect(
    page.getByRole("button", { name: "Step 2 of 6" }),
  ).toHaveAttribute("aria-current", "step");
  await back.click();
  await expect(caption).toContainText("Your passphrase turns into a key");
  await page.getByRole("button", { name: "Step 6 of 6" }).click();
  await expect(caption).toContainText(
    "Lose both your passphrase and your recovery key",
  );
  await expect(next).toBeDisabled();

  // Nobody has to step through: Continue works from the first step.
  await page.getByRole("button", { name: "Step 1 of 6" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Create a passphrase" }),
  ).toBeVisible();
  await expect(page.getByText("Step 2 of 3")).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("how the encryption works has no axe violations at its first and last step", async ({
  page,
  context,
  baseURL,
}) => {
  // Final pictures only: half-faded text would fail the contrast check.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(context, baseURL);
  await page.goto("/");
  await expect(page.locator("figcaption")).toContainText(
    "Your passphrase turns into a key",
  );
  expect(
    (await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()).violations,
  ).toEqual([]);
  await page.getByRole("button", { name: "Step 6 of 6" }).click();
  await expect(page.locator("figcaption")).toContainText("Lose both");
  expect(
    (await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()).violations,
  ).toEqual([]);
});

test("prints the recovery key alone", async ({ page, context, baseURL }) => {
  await signIn(context, baseURL);
  await page.goto("/");
  await page.getByRole("button", { name: "Continue" }).click();
  await page
    .getByLabel("Passphrase", { exact: true })
    .fill("purple elephant dances at noon");
  await page.getByRole("button", { name: "Continue" }).click();
  const key = page.getByRole("group", { name: /^Recovery key: / });
  await expect(key).toBeVisible(AFTER_ARGON2);

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
  const field = page.getByLabel("Passphrase", { exact: true });
  await expect(field).toHaveAttribute("autocomplete", "off");
  await watchKeyMark(page);

  await unlock(page, "not my passphrase at all");
  await expect(
    page.getByText("This passphrase doesn't unlock your data."),
  ).toBeVisible(AFTER_ARGON2);
  expect(await keyMarkSeen(page)).toEqual(["idle", "working", "refused"]);
  // With a mouse, straight back to typing (the button had the focus).
  await expect(field).toBeFocused();
  await unlock(page, "пароль на кириллице");
  await expect(page.getByText("Is the keyboard set to English?")).toBeVisible();
  await unlock(page, passphrase);

  // Where the user was going, not the home page.
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible(AFTER_ARGON2);
  expect((await keyMarkSeen(page))?.slice(-2)).toEqual(["working", "opened"]);
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
  await expect(welcome(page)).toBeVisible(AFTER_ARGON2);

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
  await expect(welcome(second)).toBeVisible(AFTER_ARGON2);
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
  await expect(welcome(page)).toBeVisible(AFTER_ARGON2);
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
  await expect(welcome(page)).toBeVisible(AFTER_ARGON2);

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
  await expect(keyField).toBeVisible();
  await watchKeyMark(page);

  // One character changed: the check group catches it before any cryptography.
  const typo = `${recoveryKey.startsWith("A") ? "B" : "A"}${recoveryKey.slice(1)}`;
  await keyField.fill(typo.toLowerCase());
  await passphraseField.fill("a brand new passphrase");
  await submit.click();
  await expect(page.getByText("This recovery key has a typo.")).toBeVisible();

  await keyField.fill(recoveryKey.replaceAll("-", " "));
  await submit.click();
  await expect(welcome(page)).toBeVisible(AFTER_ARGON2);
  expect((await keyMarkSeen(page))?.slice(-2)).toEqual(["working", "opened"]);

  await page.reload();
  await unlock(page, "a brand new passphrase");
  await expect(welcome(page)).toBeVisible(AFTER_ARGON2);
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("someone who lost the recovery key too can delete the account from the recovery screen @chromium-only", async ({
  page,
  context,
  baseURL,
}) => {
  const errors = collectErrors(page);
  const { email } = await returningUser(context, baseURL);
  await page.goto("/recover");

  await page.getByRole("button", { name: "Delete account" }).click();
  const dialog = page.getByRole("alertdialog", {
    name: "Delete your account?",
  });
  await dialog.getByRole("button", { name: "Delete account" }).click();

  await expect(page).toHaveURL(/\/sign-in$/);
  expect(await sql('select 1 from "user" where email = $1', [email])).toEqual(
    [],
  );
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("recovery asks for a fresh Google sign-in before anything is typed @chromium-only", async ({
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
  // Deleting needs the same fresh sign-in: offered only after it.
  await expect(
    page.getByRole("button", { name: "Delete account" }),
  ).toHaveCount(0);
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
  ).toBeVisible(AFTER_ARGON2);
  await change
    .getByLabel("Current passphrase", { exact: true })
    .fill(passphrase);
  await change.getByRole("button", { name: "Change passphrase" }).click();
  await expect(page.getByText("Passphrase changed")).toBeVisible(AFTER_ARGON2);
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
  ).toBeVisible(AFTER_ARGON2);
  await save.getByRole("button", { name: "I've saved it" }).click();
  await expect(save).toHaveCount(0);
  expect(await recoveryIv()).not.toBe(before);

  await page.reload();
  await unlock(page, "the new passphrase");
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible(AFTER_ARGON2);
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("Settings asks for a fresh sign-in before a new passphrase is typed @chromium-only", async ({
  page,
  context,
  baseURL,
}) => {
  const { passphrase, userId } = await returningUser(context, baseURL);
  await page.goto("/settings");
  await unlock(page, passphrase);
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible(AFTER_ARGON2);
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
  // The narrowest screen supported, where long currency names are hardest.
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/settings");
  await unlock(page, passphrase);

  const currency = page.getByRole("button", { name: /^Base currency/ });
  await expect(currency).toHaveAccessibleName(
    /United States Dollar/,
    AFTER_ARGON2,
  );
  await currency.click();
  // Its longest names wrap: on a phone the open menu stays within the screen.
  await expect(page.getByRole("menu")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  // Far down a list of 161: it has to scroll there.
  await page
    .getByRole("menuitemradio", { name: "Georgian Lari (GEL)" })
    .click();
  await expect(currency).toHaveAccessibleName(/Georgian Lari/);
  await expect(currency).toBeEnabled();

  const rows = await sql<{ kind: string; ciphertext: Buffer }>(
    "select kind, ciphertext from vault_records where user_id = $1",
    [userId],
  );
  expect(rows.map((row) => row.kind)).toEqual(["settings"]);
  const stored = rows[0]?.ciphertext.toString("latin1") ?? "";
  expect(stored).not.toMatch(/GEL|baseCurrency/);

  await page.reload();
  await unlock(page, passphrase);
  await expect(currency).toHaveAccessibleName(/Georgian Lari/, AFTER_ARGON2);
});

test("the header fits a 320px screen, and its logo goes home without locking", async ({
  page,
  context,
  baseURL,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const { passphrase } = await returningUser(context, baseURL);
  await page.goto("/settings");
  await unlock(page, passphrase);
  const settings = page.getByRole("link", { name: "Settings", exact: true });
  await expect(settings).toBeVisible(AFTER_ARGON2);

  const overflow = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
  expect(await overflow()).toBeLessThanOrEqual(0);

  // Named for screen readers even where only the mark shows.
  await page.getByRole("link", { name: "Keyworth", exact: true }).click();
  await expect(welcome(page)).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expect(unlockHeading(page)).toHaveCount(0);
});

test("Sign out everywhere signs out every tab", async ({
  page,
  context,
  baseURL,
}) => {
  const { passphrase } = await returningUser(context, baseURL);
  await page.goto("/");
  await unlock(page, passphrase);
  await expect(welcome(page)).toBeVisible(AFTER_ARGON2);
  const second = await context.newPage();
  await second.goto("/settings");
  await expect(
    second.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible();

  await second.getByRole("button", { name: "Sign out everywhere" }).click();

  await expect(second).toHaveURL(/\/sign-in$/);
  await expect(page).toHaveURL(/\/sign-in$/);
});
