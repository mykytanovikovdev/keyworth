# Tests: the chat's transit (`chat.test.ts`)

## What the suite proves

`POST /api/chat` runs in the real Worker, against the test database, with only
Workers AI replaced: `fetch` to `api.cloudflare.com` answers with events in the
format Workers AI streams (OpenAI-style chunks, a final `usage`, `[DONE]`), so
the provider's own parsing runs as in production. Each test signs in a new user.

| Test                                       | Invariant ([chat-transit.md](../../../worker/chat/docs/chat-transit.md))                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| streams an answer…                         | The answer streams back; reasoning stays on the server; the model gets the system prompt, the question, all seven tools and no email or name; the token and model are the configured ones; the answer is `no-store` |
| hands the model's tool call to the browser | A tool call is streamed as a call with its input; the server produces no result                                                                                                                                     |
| passes the browser's tool result on        | A result sent with the conversation reaches the model as a `tool` message                                                                                                                                           |
| makes the model answer without tools…      | `tool_choice` is `auto` before the last step and `none` on it                                                                                                                                                       |
| refuses what is not a conversation         | Twelve malformed bodies (a `system` message, a forged tool result in a question, an unknown tool, a tool input against its schema, hidden characters, too long, too many messages…) get 400 and no model call       |
| refuses a body over its limit              | 413 before the body is read; no model call                                                                                                                                                                          |
| needs a session and the app's own origin   | 401 without a session, 403 from another origin; no model call                                                                                                                                                       |
| counts what each answer cost…              | The day's count grows by the reported usage (13 neurons for 1,000 + 200 tokens); at the budget, 429 `budget` with next midnight UTC and no model call                                                               |
| starts a new day's count from zero         | Yesterday's row is replaced by today's cost, not added to                                                                                                                                                           |
| is limited per user per minute             | The 21st request in a minute gets 429 `rate_limited`; no model call                                                                                                                                                 |
| logs nothing of the conversation…          | A broken stream event and a failed request (whose error carries the request) print nothing of the question, the answer or the user; the browser gets the fixed failure sentence                                     |

Every guard in `worker/chat/route.ts` and `shared/schemas/chat.ts` was broken on
purpose once (`npm run mutate`, 12 breakages: the logging handlers, the
provider's messages, the last step, reasoning, the budget check and count, the
new day, the AI SDK's check, the question's rules, the first message, the cache
header); each failed at least one test.

## Deliberately not here

- **The real model.** Its answers' quality and its behavior with the prompt
  belong to the eval set (phase 9); its CPU time is measured on production.
- **The tools themselves.** They run in the browser (phase 5.2) and are tested
  there; the server only passes their definitions and results.
- **Isolation between users.** The route reads and writes no user data: the
  only row it writes, the day's count, has no user id.

## Adding a case

Sign in a new user, install `mockWorkersAi(reply)` after signing in (the
sign-in helper restores `fetch` when it is done), call `api("/api/chat", …)`
and read the stream with `chunksOf(response)`:

```ts
const user = await signedIn("chat-example");
const calls = mockWorkersAi(() => answer("Fine."));
const response = await api("/api/chat", {
  cookie: user.cookie,
  method: "POST",
  body: chatBody([question("What is my largest holding?")]),
});
const chunks = await chunksOf(response);
expect(calls[0]?.body.messages.at(-1)).toMatchObject({ role: "user" });
```

## Pitfalls

- The budget's counter is shared by everyone: every test in this file starts
  it empty, and no other file may write `model_usage`.
- The cost is counted in `waitUntil`, after the answer: wait for it with
  `vi.waitFor` rather than reading the row at once.
- Spying on `console` replaces `console.warn`; the route wraps whatever is
  there on each request, so the test sees what production would print.

Last reviewed: 2026-11-15
