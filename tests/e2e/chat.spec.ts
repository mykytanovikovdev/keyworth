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

/**
 * The model answering piece by piece: the test sends each piece itself. The
 * page's own fetch is wrapped, since a routed answer arrives all at once.
 */
async function streamModel(page: Page) {
  await page.addInitScript(() => {
    const real = window.fetch.bind(window);
    const open: ReadableStreamDefaultController<Uint8Array>[] = [];
    const encoder = new TextEncoder();
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes("/api/chat/completions")) return real(input, init);
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start: (controller) => {
              open.push(controller);
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
      );
    };
    Object.assign(window, {
      sendPiece: (text: string) => {
        open.at(-1)?.enqueue(encoder.encode(text));
      },
      endAnswer: () => {
        open.at(-1)?.close();
      },
      answersOpen: () => open.length,
    });
  });
  const run = (name: string, ...args: string[]) =>
    page.evaluate(
      ([fn, ...rest]) =>
        (window as unknown as Record<string, (...a: string[]) => unknown>)[
          fn ?? ""
        ]?.(...rest),
      [name, ...args],
    );
  return {
    /** Waits until the page has asked for the nth answer. */
    asked: (n: number) =>
      expect.poll(() => run("answersOpen")).toBeGreaterThanOrEqual(n),
    /** Adds text to the answer being written. */
    write: async (text: string) => {
      const stream = answerStream(text);
      // The words only: the finish and the usage belong to the end.
      await run(
        "sendPiece",
        stream
          .slice(0, stream.indexOf('"finish_reason":"stop"'))
          .replace(/data: [^\n]*$/, ""),
      );
    },
    end: async () => {
      const stream = answerStream("");
      await run(
        "sendPiece",
        stream.slice(stream.lastIndexOf("data: {", stream.indexOf("stop"))),
      );
      await run("endAnswer");
    },
  };
}

const PARAGRAPH =
  "The portfolio moved a little this week, as the markets did. ";

/** How far the page is from its end, in pixels. */
const fromBottom = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollHeight -
      window.innerHeight -
      window.scrollY,
  );

/** Where the page is once a scroll (a smooth one in some engines) is over. */
async function settled(page: Page): Promise<number> {
  let last = -1;
  await expect
    .poll(async () => {
      const y = await page.evaluate(() => window.scrollY);
      const still = y === last;
      last = y;
      return still;
    })
    .toBe(true);
  return last;
}

/** To the end at once, as dragging the scroll bar does. */
const dragToEnd = (page: Page) =>
  page.evaluate(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight });
  });

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
  // Gone from the page; it stays in the menu, as a chat to come back to.
  await expect(
    page.getByRole("main").getByText("Which coin fell the most?"),
  ).toHaveCount(0);
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

/** The chats in the menu, newest first. */
const chatLinks = (page: Page) =>
  page.getByRole("navigation", { name: "Chats" }).getByRole("link");

/** Locks, waits for the reload and unlocks again. */
async function lockAndUnlock(page: Page, passphrase: string) {
  await page.getByRole("link", { name: "Settings" }).click();
  // Lock reloads the tab: unlock once it has.
  const reloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: "Lock now" }).click();
  await reloaded;
  await unlock(page, passphrase);
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible(AFTER_ARGON2);
}

test("keeps the chat through a lock, and goes on without the old figures @chromium-only", async ({
  page,
  context,
  baseURL,
}) => {
  const { passphrase } = await openApp(page, context, baseURL);
  const sent = await stubModel(page, [
    { stream: WORKERS_AI_TOOL_CALL },
    { stream: answerStream("Up 4.2% this month.") },
    { stream: answerStream("Still up.") },
  ]);
  await openChat(page);
  await ask(page, "How did my portfolio do this month?");
  await expect(page.getByText("Up 4.2% this month.")).toBeVisible();
  await expect(chatLinks(page)).toHaveText([
    "How did my portfolio do this month?",
  ]);
  // Its own address, without a reload.
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);

  await lockAndUnlock(page, passphrase);
  await expect(
    page.getByRole("main").getByText("Up 4.2% this month."),
  ).toHaveCount(0);
  await chatLinks(page).first().click();

  await expect(page.getByText("Up 4.2% this month.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Looked at your portfolio$/ }),
  ).toBeVisible();
  // Read back whole: nothing fades in.
  await expect(page.locator("main .animate-word")).toHaveCount(0);
  const before = sent.length;
  await ask(page, "And now?");
  await expect(page.getByText("Still up.")).toBeVisible();
  const followUp = JSON.stringify(sent.slice(before));
  expect(followUp).toContain("Call the tool again");
  expect(followUp).not.toContain('\\"share\\":1');
  await expect(chatLinks(page)).toHaveCount(1);
});

test("deletes a chat with Undo, and all of them in Settings @chromium-only", async ({
  page,
  context,
  baseURL,
}) => {
  const { passphrase } = await openApp(page, context, baseURL);
  await stubModel(page, [
    { stream: answerStream("One.") },
    { stream: answerStream("Two.") },
    { stream: answerStream("Three.") },
  ]);
  for (const [question, answer] of [
    ["First question", "One."],
    ["Second question", "Two."],
  ] as const) {
    await page.getByRole("link", { name: "New chat" }).click();
    await ask(page, question);
    await expect(page.getByText(answer)).toBeVisible();
  }
  await expect(chatLinks(page)).toHaveText([
    "Second question",
    "First question",
  ]);

  const remove = async (title: string) => {
    await page
      .getByRole("button", { name: `Actions for the chat “${title}”` })
      .click();
    await page.getByRole("menuitem", { name: "Delete chat" }).click();
  };
  // Undo: back as it was.
  await remove("First question");
  await expect(chatLinks(page)).toHaveText(["Second question"]);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(chatLinks(page)).toHaveCount(2);
  // Deleted for good: not back after a reload and an unlock. A Lock does not
  // leave the delete waiting.
  await remove("First question");
  await expect(chatLinks(page)).toHaveText(["Second question"]);
  await lockAndUnlock(page, passphrase);
  await expect(chatLinks(page)).toHaveText(["Second question"]);

  await page.getByRole("button", { name: "Delete all chats" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete all chats" })
    .click();
  await expect(page.getByText("Deleted 1 chat")).toBeVisible();
  await expect(chatLinks(page)).toHaveCount(0);
  // A chat begun while Undo is still open is not among those deleted.
  await page.getByRole("link", { name: "New chat" }).click();
  await ask(page, "Third question");
  await expect(page.getByText("Three.")).toBeVisible();
  await lockAndUnlock(page, passphrase);
  await expect(chatLinks(page)).toHaveText(["Third question"]);
});

test("shows that it is working, and follows the answer down", async ({
  page,
  context,
  baseURL,
}) => {
  const model = await streamModel(page);
  await openApp(page, context, baseURL);
  await openChat(page);
  await page.setViewportSize({ width: 1280, height: 600 });

  await ask(page, "How is the week going?");
  await model.asked(1);
  // Nothing has come yet: the page says it is working.
  const working = page.getByRole("status").filter({ hasText: "Thinking" });
  await expect(working).toBeVisible();
  for (let index = 0; index < 8; index++) {
    await model.write(`${PARAGRAPH.repeat(4)}\n\n`);
    await expect.poll(() => fromBottom(page)).toBeLessThan(4);
  }
  await expect(working).toHaveCount(0);
  await model.end();

  // The second question, with the page already long: its own line and the
  // working line are in view at once, and the answer stays so.
  await ask(page, "And what about the month?");
  await model.asked(2);
  await expect(page.getByText("And what about the month?")).toBeInViewport();
  await expect(working).toBeInViewport();
  for (let index = 0; index < 8; index++) {
    await model.write(`${PARAGRAPH.repeat(4)}\n\n`);
    await expect.poll(() => fromBottom(page)).toBeLessThan(4);
  }
});

test("leaves the reader where they are, and follows again at the end", async ({
  page,
  context,
  baseURL,
}) => {
  const model = await streamModel(page);
  await openApp(page, context, baseURL);
  await openChat(page);
  await page.setViewportSize({ width: 1280, height: 600 });
  await ask(page, "How is the week going?");
  await model.asked(1);
  for (let index = 0; index < 16; index++) {
    await model.write(`${PARAGRAPH.repeat(4)}\n\n`);
  }
  await expect.poll(() => fromBottom(page)).toBeLessThan(4);

  // Scrolled up to read: the answer grows below, the page does not move.
  await page.mouse.move(640, 300);
  await page.mouse.wheel(0, -400);
  await expect.poll(() => fromBottom(page)).toBeGreaterThan(200);
  const reading = await settled(page);
  for (let index = 0; index < 4; index++) {
    await model.write(`${PARAGRAPH.repeat(4)}\n\n`);
  }
  // Not drawn to the end; a smooth scroll's last pixels up are the engine's.
  await expect.poll(() => fromBottom(page)).toBeGreaterThan(400);
  expect(await settled(page)).toBeLessThanOrEqual(reading);

  // Back at the end: it follows, and never pulls the page up again.
  await dragToEnd(page);
  await expect.poll(() => fromBottom(page)).toBeLessThan(4);
  const positions = [await page.evaluate(() => window.scrollY)];
  for (let index = 0; index < 8; index++) {
    await model.write(`${PARAGRAPH.repeat(4)}\n\n`);
    await dragToEnd(page);
    await page.waitForTimeout(60);
    positions.push(await page.evaluate(() => window.scrollY));
  }
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  await expect.poll(() => fromBottom(page)).toBeLessThan(4);
});

test("says why a chat's address cannot be opened @chromium-only", async ({
  page,
  context,
  baseURL,
}) => {
  const { passphrase } = await openApp(page, context, baseURL);
  await page.goto("/chat/0b8f6c1e-7d2a-4c3b-9e5f-1a2b3c4d5e6f");
  await unlock(page, passphrase);

  await expect(page.getByText(/^This chat isn't here/)).toBeVisible(
    AFTER_ARGON2,
  );
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
