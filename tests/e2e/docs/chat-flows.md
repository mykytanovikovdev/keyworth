# Chat flows (e2e)

What `tests/e2e/chat.spec.ts` proves about the chat in the production build:
the agent's loop and the tools run for real in the browser, on a purchase
stored encrypted through the form; only the model is answered in the browser
(Playwright `route` on `/api/chat/completions`).

## What it proves

- **A question runs the whole loop** (Chromium, Firefox, WebKit): the first
  step answers with a stream recorded from Workers AI that calls
  `get_portfolio`; the browser runs the tool and sends its result with the
  second step, whose made-up answer is markdown. The steps line says "Looked
  at your portfolio" and, opened, "Shares and changes. Amounts stayed on this
  device." The answer shows bold text and a table as elements; the model's
  link shows as its words, and its HTML and image are not rendered.
- **On the wire, the model gets no amount:** the tool's result as sent holds
  the coin's share and none of the quantity, the price paid or the value; no
  request carries a `system` message or the user's email. No console error and
  no CSP violation.
- **Stop and New chat:** an answer still streaming stops with "You stopped
  this answer."; New chat on the chat's own page starts over with nothing of
  the last conversation.
- **Refusals:** a 502 says the AI isn't answering, and Try again asks again
  and shows the answer; a 429 `budget` says the chat is back at the reset time
  and disables the box.
- **Locking forgets the conversation:** after Lock (which reloads the tab) and
  unlocking, the chat is empty.
- **Narrow screens and accessibility**, in both themes: at 320 px the page
  does not scroll sideways, and axe finds no WCAG 2.2 A/AA violation before
  and after an answer.

Everything but the full loop is Chromium only: text and routing, which no
engine renders differently enough to matter
([csp-and-engines.md](csp-and-engines.md)).

## What it does not

- **The model's answers.** Whether the real model stays on its subject and
  answers well is the eval set's job (phase 9); the server's route is tested
  on recorded streams in `tests/integration/chat.test.ts`.
- **Every tool's result.** The unit tests cover each tool, with and without
  amounts (`tests/unit/chat/tools.test.ts`); the e2e suite proves the loop and
  the wire.
- **Screenshots.** Answers depend on today's date; `/design/chat` shows every
  state for review instead.

## Adding a case

`openApp(page, context, baseURL)` signs in with a purchase of 0.5 BTC at
$60,000; `stubModel(page, replies)` answers each model step in turn (a stream,
an error status with JSON, or never) and returns the request bodies;
`answerStream(text)` makes a stream in Workers AI's format. Ask with
`ask(page, question)` after `openChat(page)`. Do not ask a starter question in
a test that checks the question is gone: the empty chat shows it as a
suggestion.

Last reviewed: 2026-11-21
