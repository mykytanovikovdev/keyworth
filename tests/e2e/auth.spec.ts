import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Pool } from "pg";
import { TEST_DATABASE_URL } from "../support/database.ts";
import { setUpKeys } from "../support/keys.ts";
import { createSignedInUser } from "../support/session.ts";
import { collectErrors, cspViolations, watchCspViolations } from "./support.ts";

// Sign-in pages and signed-in flows in the production build, served against
// the local test database. Google is never contacted: the redirect to it is
// intercepted, and signed-in sessions are created directly in the database.

test.beforeEach(async ({ page }) => {
  await watchCspViolations(page);
});

async function signIn(context: BrowserContext, baseURL: string) {
  const id = crypto.randomUUID().slice(0, 8);
  const email = `e2e-${id}@example.com`;
  await context.addCookies(
    await createSignedInUser({
      databaseUrl: TEST_DATABASE_URL,
      baseURL,
      email,
      name: "Alex Example",
    }),
  );
  return email;
}

/** Signed in, with keys set up earlier, and unlocked on `path` (Argon2: slow in CI). */
async function signInUnlocked(
  page: Page,
  context: BrowserContext,
  baseURL: string,
  path: string,
) {
  const email = await signIn(context, baseURL);
  const { passphrase } = await setUpKeys({
    databaseUrl: TEST_DATABASE_URL,
    email,
  });
  await page.goto(path);
  await page.getByLabel("Passphrase", { exact: true }).fill(passphrase);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
    "Unlock Keyworth",
    { timeout: 30_000 },
  );
  return email;
}

async function sql(query: string, params: unknown[]) {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    return (await pool.query<Record<string, unknown>>(query, params)).rows;
  } finally {
    await pool.end();
  }
}

test.describe("signed out", () => {
  test("sign-in starts Google's flow with this app's client and callback", async ({
    page,
    baseURL,
  }) => {
    const errors = collectErrors(page);
    let googleUrl: URL | undefined;
    await page.route("https://accounts.google.com/**", async (route) => {
      googleUrl = new URL(route.request().url());
      await route.fulfill({ status: 200, body: "Google" });
    });

    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect.poll(() => googleUrl).toBeDefined();

    expect(googleUrl?.searchParams.get("client_id")).toBe(
      "test-client-id.apps.googleusercontent.com",
    );
    expect(googleUrl?.searchParams.get("redirect_uri")).toBe(
      `${baseURL ?? ""}/api/auth/callback/google`,
    );
    expect(googleUrl?.searchParams.get("state")).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test("an uninvited account sees why, in the app's own words", async ({
    page,
  }) => {
    await page.goto("/sign-in?error=NOT_INVITED&error_description=Injected");

    await expect(page.getByRole("alert")).toHaveText(
      /isn't on the invite list/,
    );
    await expect(page.getByText("Injected")).toHaveCount(0);
    expect(await cspViolations(page)).toEqual([]);
  });

  test("an unknown error code gets a generic message", async ({ page }) => {
    await page.goto("/sign-in?error=access_denied");

    await expect(page.getByRole("alert")).toHaveText(
      "Sign-in didn't finish. Try again.",
    );
  });

  test("the privacy policy and terms are public", async ({ page }) => {
    await page.goto("/privacy");
    await expect(
      page.getByRole("heading", { level: 1, name: "Privacy policy" }),
    ).toBeVisible();
    await page.goto("/terms");
    await expect(
      page.getByRole("heading", { level: 1, name: "Terms" }),
    ).toBeVisible();
  });

  test("says right under the button what continuing accepts, with links to both texts", async ({
    page,
  }) => {
    await page.goto("/sign-in");

    const consent = page
      .getByRole("button", { name: "Continue with Google" })
      .locator("+ p");
    await expect(consent).toHaveText(
      "By continuing with Google, you agree to the Terms and confirm you've read the Privacy policy.",
    );

    await consent.getByRole("link", { name: "Privacy policy" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await page.goBack();
    await consent.getByRole("link", { name: "Terms" }).click();
    await expect(page).toHaveURL(/\/terms$/);
  });
});

test.describe("signed in", () => {
  test("lands on the app (first, how its encryption works), and sign-in sends them back to it", async ({
    page,
    context,
    baseURL,
  }) => {
    const errors = collectErrors(page);
    await signIn(context, baseURL ?? "");

    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Only you can read your portfolio",
      }),
    ).toBeVisible();
    await page.goto("/sign-in");
    await expect(page).toHaveURL(/\/$/);

    expect(await cspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("signs out from settings", async ({ page, context, baseURL }) => {
    await signInUnlocked(page, context, baseURL ?? "", "/");

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();

    await expect(page).toHaveURL(/\/sign-in$/);
    expect((await page.request.get("/api/me")).status()).toBe(401);
  });

  test("reaches the privacy policy and terms from settings, and comes back without locking", async ({
    page,
    context,
    baseURL,
  }) => {
    await signInUnlocked(page, context, baseURL ?? "", "/settings");
    // Only the unlocked app has this link: a reload would ask for the passphrase.
    const settings = page.getByRole("link", { name: "Settings", exact: true });

    await page.getByRole("link", { name: "Privacy policy" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Privacy policy" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Back to Keyworth" }).click();
    await expect(settings).toBeVisible();

    await settings.click();
    await page.getByRole("link", { name: "Terms", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Terms" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Keyworth home" }).click();
    await expect(settings).toBeVisible();
  });

  test("deletes the account after confirmation", async ({
    page,
    context,
    baseURL,
  }) => {
    const email = await signInUnlocked(
      page,
      context,
      baseURL ?? "",
      "/settings",
    );

    await page.getByRole("button", { name: "Delete account" }).click();
    const dialog = page.getByRole("alertdialog", {
      name: "Delete your account?",
    });
    await dialog.getByRole("button", { name: "Delete account" }).click();

    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(
      page.getByRole("alertdialog", { name: "Account deleted" }),
    ).toBeVisible();
    expect(await sql('select 1 from "user" where email = $1', [email])).toEqual(
      [],
    );
  });

  test("asks for a fresh sign-in when the session is older than 10 minutes", async ({
    page,
    context,
    baseURL,
  }) => {
    const email = await signInUnlocked(
      page,
      context,
      baseURL ?? "",
      "/settings",
    );
    await sql(
      `update session set created_at = now() - interval '11 minutes'
        where user_id = (select id from "user" where email = $1)`,
      [email],
    );

    await page.getByRole("button", { name: "Delete account" }).click();
    const dialog = page.getByRole("alertdialog", {
      name: "Delete your account?",
    });
    await dialog.getByRole("button", { name: "Delete account" }).click();

    await expect(
      dialog.getByRole("button", { name: "Sign in again" }),
    ).toBeVisible();
    expect(
      await sql('select 1 from "user" where email = $1', [email]),
    ).toHaveLength(1);
  });
});
