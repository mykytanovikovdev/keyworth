# The chat's transit: `/api/chat/completions`

## Purpose and scope

Keyworth's server stores only encrypted envelopes, with one exception: to answer
a question, the browser decrypts what the question needs and sends it, with the
conversation, through `POST /api/chat/completions` to the model. This document
describes that path: what passes, what is checked, what is kept (a number) and
what is never written anywhere (everything else).

Out of scope: what the tools return and when amounts are included, and the
agent's loop in the browser
([src/features/chat/docs/tools-and-minimization.md](../../../src/features/chat/docs/tools-and-minimization.md)),
the encrypted history (the vault), the answers' quality (the eval set).

## How it works

1. **Guards** ([api-guards.md](../../routes/docs/api-guards.md)): a session,
   the app's own `Origin`, at most 128 KB of body.
2. **The conversation is checked** (`shared/schemas/chat.ts`, then
   `toolCallsValid`): only `messages` is read; 1–40 messages, the first a
   question; roles only `user`, `assistant` and `tool` (a `system` message is
   refused); a question is a string, not blank, at most 2,000 characters, with
   no hidden characters but line breaks; an assistant's tool calls name the
   chat's own tools, with input each tool's schema accepts; each tool result
   answers a call made before it. Anything else: 400 `invalid_request`, before
   the model is asked.
3. **Admission**, one SQL statement: the user's 20 requests a minute (429
   `rate_limited` with `Retry-After`) and today's spending for everyone (429
   `budget` with `resetsAt`, next midnight UTC, at 9,000 neurons).
4. **The model's request is written by the server**: the model, the system
   prompt, the latest 20 messages starting at a question, the tools'
   definitions, `tool_choice` (`none` on a question's last step), the token
   limit, streaming with usage, thinking off. Everything else the browser sent
   is dropped.
5. **The answer streams back untouched**: Workers AI's events go to the browser
   as they come. A copy of the stream is read afterwards, in the background
   (`waitUntil`), for the step's `neurons`, which are added to the day's count.

## Invariants

- **Nothing of a conversation is stored or logged.** No request body, answer,
  model error body or error object is written to the database or to `console`.
  The only row the route writes is the day's count of neurons, which holds no
  user id.
- **The user's identity never reaches the model.** The user comes from the
  session; neither the email nor the name is in the system prompt or the
  messages.
- **The model's instructions, tools and limits come only from the server.** A
  `system` message is refused; the browser's model, tools, `tool_choice`,
  token limit or other fields are ignored.
- **The model cannot run anything on the server.** Its tool calls go to the
  browser; the server only checks them when they come back.
- **A question is bounded.** At most `maxSteps` (6) model steps: on the last,
  the model must answer without tools. Each step has at most 1,500 output
  tokens and 60 seconds.
- **The day's spending is bounded** for all users together, below Workers AI's
  free allowance.
- **The chat stays on its subject.** The system prompt limits it to the user's
  portfolio, the markets and financial ideas; anything else gets a one-sentence
  refusal (checked by a set of off-topic questions with the eval set).

## Decisions and alternatives

- **A thin proxy instead of the AI SDK on the server**: see
  [the README](../README.md#why-this-way) (about 200 ms of CPU per answer
  against the Free plan's 10 ms).
- **No per-user quota yet.** While the development model costs nothing within
  the day's budget, the per-minute rate is the per-user guard. A daily quota
  per user comes with the paid model (PLAN, phase 5).
- **The browser sends the whole conversation each time**, and the server cuts
  it to the latest 20 messages. Keeping history on the server would mean
  storing plaintext.
- **No topic filter in front of the model yet**: the system prompt and the
  off-topic set come first; a small classifying model would add latency and
  cost, and is added only if the prompt does not hold.

## Edge cases

| Case                                    | What happens                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| The user stops the answer, or leaves    | The model's request is aborted with the browser's; the step is charged at its most |
| Workers AI refuses or cannot be reached | 502 `model_unavailable`; the log gets the status or the error's type only          |
| The stream breaks off                   | The browser's client sees the end; the step is charged at its most                 |
| Budget reached during a question        | The next step is refused with 429 `budget`; the browser says when it resets        |
| Today's row is from yesterday           | The first step of the day starts the count from its own cost                       |

## How it is tested

`tests/integration/chat.test.ts`, through the real Worker and the test database,
with Workers AI replaced at `fetch` by recorded streams
([tests/integration/docs/chat.md](../../../tests/integration/docs/chat.md));
`tests/unit/chat/` checks the count and that the browser's client reads the
same streams. `npm run mutate` confirmed that breaking any of the route's
guards fails a test.

## How to change it safely

- A new tool: its schema in `shared/schemas/chat-tools.ts`; the server's
  definitions and checks follow.
- A new model: `model.ts` and `budget.ts`; record its streams and check the
  browser's client reads them; check its error bodies before relying on the
  route dropping them.
- Never log inside the route beyond `describeError` and a status; never pass
  the browser's body on, only `messages`.

Last reviewed: 2026-11-21
