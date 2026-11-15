# The chat's transit: `/api/chat`

## Purpose and scope

Keyworth's server stores only encrypted envelopes, with one exception: to answer
a question, the browser decrypts what the question needs and sends it, with the
conversation, through `POST /api/chat` to the model. This document describes
that path: what passes, what is checked, what is kept (a number) and what is
never written anywhere (everything else).

Out of scope: what the tools return and when amounts are included (the tools,
in the browser), the encrypted history (the vault), the model's answers'
quality (the eval set).

## How it works

1. **Guards** ([api-guards.md](../../routes/docs/api-guards.md)): a session,
   the app's own `Origin`, at most 128 KB of body, 20 requests per user per
   minute.
2. **The conversation is checked** (`shared/schemas/chat.ts`): 1–40 messages,
   the first a question; roles only `user` and `assistant` (a `system` message
   from the browser is refused); a question is text only, not blank, at most
   2,000 characters, with no hidden characters but line breaks; parts only
   text, steps and calls of the chat's own tools. Then the AI SDK checks each
   part's shape and each tool call's input against its schema
   (`safeValidateUIMessages`). Anything else: 400 `invalid_request`, before
   the model is asked.
3. **The day's budget** (`model_usage`): if today's count has reached 9,000
   neurons, 429 `budget` with `resetsAt` (next midnight UTC), before the model
   is asked.
4. **One step**: the system prompt, the latest 20 messages (starting at a
   question) and the tools' definitions, to Workers AI over its REST API. The
   answer streams back to the browser as the AI SDK's UI message chunks,
   without the model's reasoning.
5. **The cost** is counted after the step, from the tokens Workers AI reports,
   in the background (`waitUntil`), so the answer is not delayed.

## Invariants

- **Nothing of a conversation is stored or logged.** No request body, answer,
  tool call or error object is written to the database or to `console`. The
  only row the route writes is the day's count of neurons, which holds no user
  id.
- **The user's identity never reaches the model.** The user comes from the
  session; neither the email nor the name is in the system prompt or the
  messages.
- **The model's instructions come only from the server.** A `system` message in
  the conversation is refused (and the AI SDK refuses it again by default).
- **The model cannot run anything on the server.** Its tools have no `execute`:
  a call is handed to the browser.
- **A question is bounded.** At most `maxSteps` (6) model steps: on the last,
  the model must answer without tools (`toolChoice: "none"`). Each step has at
  most 1,500 output tokens and 60 seconds.
- **The day's spending is bounded** for all users together, below Workers AI's
  free allowance.

## Decisions and alternatives

- **REST instead of the AI binding**: see [the README](../README.md#why-this-way).
- **No per-user quota yet.** While the development model is free and only the
  budget for everyone is spent, the per-minute rate limit is the per-user
  guard. A daily quota per user comes with the paid model (PLAN, phase 5).
- **The browser sends the whole conversation each time** (as the AI SDK's chat
  does) and the server cuts it to the latest 20 messages. Keeping history on
  the server would mean storing plaintext.
- **Reasoning stays on the server**: it is not part of the answer.

## Edge cases

| Case                                  | What happens                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| The user stops the answer, or leaves  | The step is aborted; it is charged at its most (no usage was reported)                           |
| Workers AI fails or times out         | One retry; then the stream ends with "The answer stopped: …"; the log gets the error's type only |
| A broken event in Workers AI's stream | The provider's message about it (with the event) is dropped                                      |
| Budget reached during a question      | The next step is refused with 429 `budget`; the browser says when it resets                      |
| Today's row is from yesterday         | The first step of the day starts the count from its own cost                                     |

## How it is tested

`tests/integration/chat.test.ts`, through the real Worker and the test database,
with Workers AI replaced at `fetch` ([tests/integration/docs/chat.md](../../../tests/integration/docs/chat.md)).
Each invariant above is checked, and `npm run mutate` confirmed that breaking
any of the route's guards fails a test.

## How to change it safely

- A new tool: its schema in `shared/schemas/chat-tools.ts` (the server's
  definitions follow), its part type is then allowed in a conversation.
- A new model: `model.ts` and `budget.ts`, then the cost test. Check the
  provider's console messages and errors for content before relying on the
  route's `onError`.
- Never log inside the route beyond `describeError`; never add a route that
  echoes a request.

Last reviewed: 2026-11-15
