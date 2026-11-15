# worker/chat/

## Purpose

`POST /api/chat`: the conversation on its way to the model and the model's
answer on its way back. It is the one place where plaintext passes through the
server, and nothing of it is stored or logged: only what each answer cost, a
number for the day's budget. The rules, invariants and tests are in
[docs/chat-transit.md](docs/chat-transit.md).

Not here: the tools' work (they run in the browser, on the decrypted data), the
chat's history (the browser keeps it encrypted in the vault) and the chat's
screens ([src/features/chat/](../../src/features/chat/README.md)).

## How it works

```
browser ── POST /api/chat { id, messages } ──► session, origin, 128 KB, 20/min
                                               │
                                     shapes and tool inputs checked
                                     (shared/schemas/chat.ts, the AI SDK)
                                               │
                                     today's budget left? ── no ─► 429 budget
                                               │
                    one model step: system prompt + latest 20 messages + tool definitions
                                               │
                         Workers AI (REST) ────┘ streamed back as UI message chunks
                                               │
                              cost counted after the step (waitUntil)
```

A question can take several requests: when the model calls a tool, the step
ends with the call; the browser runs the tool and sends the conversation again
with the result. Each request is one step.

| File        | Role                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------- |
| `route.ts`  | The route: checks, budget, one `streamText` step, the stream back, the cost after it         |
| `model.ts`  | The model and its price in neurons; quiets the provider's own console messages               |
| `budget.ts` | The day's budget for all users together (`model_usage`), checked before and counted after    |
| `prompt.ts` | The system prompt, version 0                                                                 |
| `tools.ts`  | The tools' definitions for the model, without `execute`, from `shared/schemas/chat-tools.ts` |

## Why this way

- **Workers AI through its REST API, not the AI binding.** The binding always
  reaches Cloudflare, even in tests and local development (Wrangler has no
  local model): every test run would need a Cloudflare login and spend the
  free allowance, and CI has neither. Through REST the model is an ordinary
  `fetch`, which tests replace with answers in Workers AI's own stream format.
  The cost: a token (`WORKERS_AI_TOKEN`) allowed only to run models.
- **One step per request.** The tools run where the decrypted data is, in the
  browser (CLAUDE.md, rule 9), so the server cannot continue past a tool call.
  The browser counts as a step the same way the server does (`step-start`
  parts), and past `maxSteps` the model must answer without tools.
- **The budget is checked before and counted after.** The cost of an answer is
  known only when it ends, so the last answer of a day can pass the budget by
  one answer; the budget is set below Workers AI's free 10,000 neurons for that.
- **The model's reasoning is not sent to the browser** (`sendReasoning:
false`): it is not the answer, and it would double what is streamed.

## Pitfalls & gotchas

- **Never let an error reach `console` whole.** The provider's error carries the
  request it failed on, the whole conversation; the AI SDK's default `onError`
  prints it. Both `onError` handlers are set: the log gets `describeError`, the
  browser a fixed sentence.
- **The provider prints a stream event it cannot parse** — a piece of the
  answer. `quietProvider()` drops its messages (all start with
  `[workers-ai-provider]`) and re-wraps `console.warn` if anything replaced it.
- **`createUIMessageStreamResponse` sets `cache-control: no-cache`**; the route
  sets `no-store`, the rule for every API answer.
- **A cut-off step has no usage.** When the user stops an answer or the
  connection drops, the step is charged at its most: a token per request byte
  and the longest answer.

## How to work with it

- Tests: `npx vitest run --project worker tests/integration/chat.test.ts`
  (needs `npm run db:up`); Workers AI is replaced at `fetch`.
- To chat locally with the real model, put a Workers AI token in `.dev.vars`
  (`WORKERS_AI_TOKEN`); every answer counts against the day's budget and the
  account's allowance.
- Changing the model: `model.ts` (id, price per million tokens, longest step)
  and the budget's numbers in `budget.ts`; then the cost test in
  `chat.test.ts`.

## Related

- [docs/chat-transit.md](docs/chat-transit.md): invariants, limits, what is
  logged
- [shared/schemas/](../../shared/schemas/README.md): the request and the tools
- [routes/docs/api-guards.md](../routes/docs/api-guards.md): every route's guards
- [src/crypto/docs/threat-model.md](../../src/crypto/docs/threat-model.md): what
  the chat means for privacy
