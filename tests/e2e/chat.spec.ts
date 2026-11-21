import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { WORKERS_AI_TOOL_CALL } from "../support/workers-ai.ts";
import { stubMarket } from "./market.ts";
import { AFTER_ARGON2, returningUser, unlock, WCAG_TAGS } from "./signed-in.ts";
import {
  chooseTheme,
  collectErrors,
  cspViolations,
  watchCspViolations,
} from "./support.ts";

/*
 * The chat in the production build. The model is answered in the browser
 * (page.route on /api/chat/completions): the first step with a stream recorded
 * from Workers AI that calls get_portfolio, the next with a made-up answer in
 * markdown. Everything else is real: the agent's loop and the tools run here,
 * on a purchase stored encrypted, and what they send is checked at the wire.
 */

/** An answer as Workers AI streams it: OpenAI chunks, then the usage. */
function answerStream(text: string): string {
  const chunk = (delta: object, finish: string | null = null) =>
    `data: ${JSON.stringify({
      id: "e2e",
      object: "chat.completion.chunk",
      created: 0,
      model: "e2e",
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  const words = text.split(/(?<= )/);
  return [
    chunk({ role: "assistant", content: "" }),
    ...words.map((word) => chunk({ content: word })),
    chunk({}, "stop"),
    `data: ${JSON.stringify({
      id: "e2e",
      object: "chat.completion.chunk",
      created: 0,
      model: "e2e",
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
}

const ANSWER = [
  "Your portfolio is **up 4.2%** this month.",
  "",
  "| Coin | Share |",
  "| --- | --- |",
  "| Bitcoin | 100% |",
  "",
  "See [the details](https://evil.example/track) <b>now</b> ![x](https://evil.example/x.png)",
].join("\n");

type Reply =
  { stream: string } | { status: number; json: object } | { hold: true };

/** Answers each model step in turn; records what the browser sent. */
async function stubModel(page: Page, replies: Reply[]) {
  const sent: unknown[] = [];
  await page.route("/api/chat/completions", async (route) => {
    sent.push(route.request().postDataJSON());
    const reply = replies.shift();
    if (!reply || "hold" in reply) return; // Never answered: still streaming.
    await ("stream" in reply
      ? route.fulfill({
          body: reply.stream,
          contentType: "text/event-stream",
        })
      : route.fulfill({ status: reply.status, json: reply.json }));
  });
  return sent;
}

test.beforeEach(async ({ page }) => {
  test.slow();
  await watchCspViolations(page);
  await stubMarket(page);
});

/** Signed in and unlocked, with one purchase of 0.5 BTC at 60,000. */
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
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  const form = page.getByRole("dialog", { name: "Add transaction" });
  await form.getByRole("combobox", { name: "Coin" }).fill("bit");
  await page.getByRole("option", { name: /Bitcoin/ }).click();
  await form.getByRole("button", { name: "Today" }).click();
  await form.getByRole("textbox", { name: "Quantity" }).fill("0.5");
  await form.getByRole("textbox", { name: "Price per coin" }).fill("60000");
  await form.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Transaction added")).toBeVisible();
  return user;
}

async function openChat(page: Page) {
  await page.getByRole("link", { name: "New chat" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "What would you like to know?",
    }),
  ).toBeVisible();
}

async function ask(page: Page, question: string) {
  await page.getByRole("textbox", { name: "Question" }).fill(question);
  await page.keyboard.press("Enter");
}

/** What the tools returned, as the model got it: their JSON, one per line. */
const toolResults = (sent: unknown[]) =>
  sent
    .flatMap((body) =>
      (body as { messages: { role: string; content: string }[] }).messages
        .filter(({ role }) => role === "tool")
        .map(({ content }) => content),
    )
    .join("\n");

test("answers with the steps it took, and the model never gets an amount", async ({
  page,
  context,
  baseURL,
}) => {
  const errors = collectErrors(page);
  const { email } = await openApp(page, context, baseURL);
  const sent = await stubModel(page, [
    { stream: WORKERS_AI_TOOL_CALL },
    { stream: answerStream(ANSWER) },
  ]);
  await openChat(page);

  await ask(page, "How did my portfolio do this month?");

  const steps = page.getByRole("button", {
    name: /^Looked at your portfolio$/,
  });
  await expect(steps).toBeVisible();
  await steps.click();
  await expect(
    page.getByText("Shares and changes. Amounts stayed on this device."),
  ).toBeVisible();
  // The answer's markdown, as elements; no link, image or HTML of the model's.
  await expect(page.locator("strong", { hasText: "up 4.2%" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Bitcoin" })).toBeVisible();
  await expect(page.getByText("See the details now")).toBeVisible();
  await expect(
    page.locator("main a[href*='evil'], main img, main b"),
  ).toHaveCount(0);

  // Two model steps; the tool's result went with the second, without amounts.
  expect(sent).toHaveLength(2);
  const results = toolResults(sent);
  expect(results).toMatch(/"share":1/);
  expect(results).not.toMatch(/0\.5|30000|60000|quantity|total|value/);
  // No instructions from the browser, and nothing about who is asking.
  const all = JSON.stringify(sent);
  expect(all).not.toContain('"system"');
  expect(all).not.toContain(email);

  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("stops an answer, and starts over with New chat @chromium-only", async ({
  page,
  context,
  baseURL,
}) => {
  await openApp(page, context, baseURL);
  await stubModel(page, [{ hold: true }]);
  await openChat(page);

  await ask(page, "Which coin fell the most?");
  await page.getByRole("button", { name: "Stop answering" }).click();

  await expect(page.getByText("You stopped this answer.")).toBeVisible();
  await page.getByRole("link", { name: "New chat" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "What would you like to know?",
    }),
  ).toBeVisible();
  await expect(page.getByText("Which coin fell the most?")).toHaveCount(0);
});

test("says when today's limit is reached, and when the AI is not answering @chromium-only", async ({
  page,
  context,
  baseURL,
}) => {
  await openApp(page, context, baseURL);
  const resetsAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  await stubModel(page, [
    { status: 502, json: { error: "model_unavailable" } },
    { stream: answerStream("Here it is.") },
    { status: 429, json: { error: "budget", resetsAt } },
  ]);
  await openChat(page);

  await ask(page, "What's my biggest holding?");
  await expect(
    page.getByText("The AI isn't answering right now. Try again in a moment."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Here it is.")).toBeVisible();

  await ask(page, "And in dollars?");
  await expect(
    page.getByText(/^The chat has reached today's limit\. It's back at /),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Question" })).toBeDisabled();
});

test("forgets the conversation when the data locks @chromium-only", async ({
  page,
  context,
  baseURL,
}) => {
  const { passphrase } = await openApp(page, context, baseURL);
  await stubModel(page, [{ stream: answerStream("Here it is.") }]);
  await openChat(page);
  await ask(page, "Which coin is my largest?");
  await expect(page.getByText("Here it is.")).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  // Lock reloads the tab: unlock once it has.
  const reloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: "Lock now" }).click();
  await reloaded;
  await unlock(page, passphrase);
  await page
    .getByRole("link", { name: "New chat" })
    .click({ timeout: AFTER_ARGON2.timeout });

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "What would you like to know?",
    }),
  ).toBeVisible();
  await expect(page.getByText("Which coin is my largest?")).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`fits 320px and has no axe violations, ${theme} @chromium-only`, async ({
    page,
    context,
    baseURL,
  }) => {
    await chooseTheme(page, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page, context, baseURL);
    await stubModel(page, [
      { stream: WORKERS_AI_TOOL_CALL },
      { stream: answerStream(ANSWER) },
    ]);
    await openChat(page);
    await page.setViewportSize({ width: 320, height: 800 });
    const empty = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .exclude('[aria-live] > [role="img"]')
      .analyze();
    expect(empty.violations).toEqual([]);

    await ask(page, "How did my portfolio do this month?");
    await expect(page.getByRole("cell", { name: "Bitcoin" })).toBeVisible();

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const scan = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .exclude('[aria-live] > [role="img"]')
      .analyze();
    expect(scan.violations).toEqual([]);
  });
}
