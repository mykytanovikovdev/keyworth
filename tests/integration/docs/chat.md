# Tests: the chat's transit (`chat.test.ts`)

## What the suite proves

`POST /api/chat/completions` runs in the real Worker, against the test
database, with only Workers AI replaced: `fetch` to `api.cloudflare.com`
answers with streams recorded from Workers AI's OpenAI-compatible endpoint
(`tests/support/workers-ai.ts`). Each test signs in a new user.

| Test                                      | Invariant ([chat-transit.md](../../../worker/chat/docs/chat-transit.md))                                                                                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| passes the model's stream unchanged       | The browser gets Workers AI's bytes as they are, as `text/event-stream`, `no-store`, with the Worker's headers                                                                                                                                                                                         |
| writes the model's request itself         | Model, token limit, `tool_choice`, streaming with usage and thinking off are the server's; the browser's model, token limit, temperature and tools are ignored; the system prompt (with its scope) comes first; the seven tools are the server's, without `$schema` or date patterns; no email or name |
| passes a step's tool calls and results on | A call and its result reach the model as sent                                                                                                                                                                                                                                                          |
| makes the model answer without tools…     | `tool_choice` is `auto` before a question's last step and `none` on it                                                                                                                                                                                                                                 |
| refuses what is not a conversation        | Fourteen malformed bodies (a `system` message, an assistant first, hidden characters, a question as parts, an unknown tool, input that is not JSON or fails its schema, a result without its call, too many messages…) get 400 and no model call                                                       |
| refuses a body over its limit             | 413 before the body is read; no model call                                                                                                                                                                                                                                                             |
| needs a session and the app's own origin  | 401 without a session, 403 from another origin; no model call                                                                                                                                                                                                                                          |
| counts what each step cost…               | The day's count grows by the stream's own `neurons` (2.0692 → 3); at the budget, 429 `budget` with next midnight UTC and no model call                                                                                                                                                                 |
| starts a new day's count from zero        | Yesterday's row is replaced by today's cost, not added to                                                                                                                                                                                                                                              |
| charges a step it could not count…        | A stream that breaks off before any count is charged at the step's most                                                                                                                                                                                                                                |
| is limited per user per minute            | The 21st request in a minute gets 429 `rate_limited` with `Retry-After`; no model call                                                                                                                                                                                                                 |
| logs nothing of the conversation…         | A refusal whose body echoes the request, and an unreachable model whose error holds it, print nothing of the question or the user; the browser gets 502 `model_unavailable`                                                                                                                            |

Every guard was broken on purpose once (`npm run mutate`, 15 breakages: the
tool-call checks, a forged result, the browser's body passed on, thinking, the
last step, the budget, the rate, the count and its fallback, two kinds of
logging, the cache header, a `system` role, the first message); each failed
at least one test.

`tests/unit/chat/` adds the count from a stream's tail (cumulative, with an
all-zero event before the last, a line cut by the tail) and the browser's
client (`@ai-sdk/openai-compatible`) reading the same recorded streams: the
answer, its usage, and a tool call with input its schema accepts.

## Deliberately not here

- **The real model.** Its answers' quality, its keeping to the subject and its
  behavior with the prompt belong to the eval set (phase 9); its CPU time is
  measured on production (`npm run perf`).
- **The tools and the agent's loop.** They run in the browser and are tested
  there: `tests/unit/chat/` and `tests/e2e/chat.spec.ts`
  ([src/features/chat/docs/tools-and-minimization.md](../../../src/features/chat/docs/tools-and-minimization.md)).
- **Isolation between users.** The route reads and writes no user data: the
  only row it writes, the day's count, has no user id.

## Adding a case

Sign in a new user, install `mockWorkersAi(reply)` after signing in (the
sign-in helper restores `fetch` when it is done), and call `ask(cookie, body)`:

```ts
const user = await signedIn("chat-example");
const calls = mockWorkersAi(() => stream(WORKERS_AI_TEXT));
const response = await ask(user.cookie, {
  messages: [question("What is my largest holding?")],
});
expect(await response.text()).toBe(WORKERS_AI_TEXT);
expect(calls[0]?.body.messages.at(-1)).toMatchObject({ role: "user" });
```

## Pitfalls

- The budget's counter is shared by everyone: every test in this file starts
  it empty, and no other file may write `model_usage`.
- The cost is counted in `waitUntil`, after the answer: wait for it with
  `vi.waitFor` rather than reading the row at once.
- A recorded stream reports `neurons` in every event, cumulatively: a stream
  cut early still carries a partial count. A step without any count is one
  whose stream breaks with an error.

Last reviewed: 2026-11-21
