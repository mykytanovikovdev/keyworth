# worker/chat/

## Purpose

`POST /api/chat/completions`: the conversation on its way to the model and the
model's answer on its way back. It is the one place where plaintext passes
through the server, and nothing of it is stored or logged: only what each step
cost, a number for the day's budget. The rules, invariants and tests are in
[docs/chat-transit.md](docs/chat-transit.md).

The route is a **thin proxy**: the browser runs the AI SDK (the agent's loop,
the tools on the decrypted data, the reading of the stream); the server checks
the request, writes the model's request itself and passes the model's stream
back untouched.

Not here: the tools' work and the agent's loop (the browser), the chat's
history (kept encrypted in the vault, by the browser:
[chat-history.md](../../src/features/chat/docs/chat-history.md)) and the chat's
screens
([src/features/chat/](../../src/features/chat/README.md)).

## How it works

```
browser (AI SDK + @ai-sdk/openai-compatible, baseURL <this site>/api)
   │ POST /api/chat/completions { messages, …anything else is ignored }
   ▼
session, origin, 128 KB ──► messages checked (shared/schemas/chat.ts):
                             roles user/assistant/tool, no system, the question's
                             rules, known tools, each call's input, each result's call
   │
   ▼ one SQL statement: the user's rate (20/min) + today's spending ── 429
   │
   ▼ the request to the model, written by the server: its model, its system
     prompt, its tool definitions, tool_choice from the step count, max_tokens,
     stream with usage, thinking off, temperature 0, and last one line naming
     the language of the latest question
   │
Workers AI (/ai/v1/chat/completions) ──► stream ──tee──► browser, untouched
                                                  └────► read after, for `neurons` (waitUntil)
```

A question can take several requests: when the model calls a tool, the step
ends with the call; the browser runs the tool and sends the conversation again
with the result. Each request is one step.

| File          | Role                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `route.ts`    | The route: checks, admission, the model's request, the stream back, the cost after it                   |
| `model.ts`    | The model, its endpoint, the longest step, thinking off, temperature 0, the price for an uncounted step |
| `tools.ts`    | The tools' definitions for the model (built once), and the check of past tool calls                     |
| `budget.ts`   | The user's rate and the day's budget in one statement; adding a step's cost                             |
| `usage.ts`    | A step's neurons, from the last kilobytes of the stream                                                 |
| `prompt.ts`   | The system prompt, version 0.2: scope (portfolio and markets only), rules                               |
| `language.ts` | The latest question's language, for the request's last line                                             |

## Why this way

- **A thin proxy, not the AI SDK on the server.** Parsing the model's stream on
  the server cost about 40 µs of CPU per event: around 200 ms for one answer
  measured on production, against the Free plan's 10 ms. Passing the bytes on
  costs no JavaScript at all; reading a copy afterwards for the count takes
  well under a millisecond. The AI SDK still does its work, in the browser,
  where the tools and the decrypted data already are.
- **The server writes the model's request.** The browser's body is read for
  `messages` only: the model, the instructions, the tools, `tool_choice`, the
  token limit, the temperature and the thinking switch are the server's, so a modified browser
  can spend no more than the app does, and cannot instruct the model.
- **Workers AI's OpenAI-compatible endpoint, through REST.** Its stream is the
  standard format the browser's client reads (tested on recorded streams); the
  older `/ai/run` endpoint adds token ids and ends without `choices`. The AI
  binding always reaches Cloudflare, even in tests and local development; REST
  is an ordinary `fetch`, which tests replace.
- **Thinking off.** GLM thinks before answering by default: a short answer took
  7.4 s and 18 neurons with it, 1.1 s and 2 neurons without (measured
  2026-11-15). The tools have already done the math the answers explain.
- **Temperature 0, and a tool before any figure.** At its default temperature the
  development model made up figures without calling a tool, and now and then
  wrote nonsense. Compared on the real model (2026-11-25), counting answers a
  script found nothing wrong with, some of its flags being its own mistakes: 24
  of 34 as it was, 25 with temperature 0 alone, 28 with the rules as well; as it
  is now 46 of 51, and on questions not used to tune it 29 of 32 against 26. The
  line's present wording came after that: 13 of 14 turns in the right language.
- **The language comes last, from the server.** The model slipped into the
  conversation's earlier language, or asked which to use, whatever the rules
  said. `language.ts` recognizes the latest question's language by its script
  and a few words, and adds one line with its name: never the question's words.
  Switching from Russian to English in one conversation still fails sometimes.
- **One round trip before the model.** The rate limit and the budget are one
  SQL statement (`countUse` from `limits.ts` inside a CTE).
- **The cost from Workers AI's own count.** Its events carry a running
  `usage.neurons`; the largest in the stream's tail is the step's cost. A step
  that broke off before any count is charged at its most.

## Pitfalls & gotchas

- **Never log a request, a model error's body or an error object.** The model's
  error body can echo the request; it is cancelled unread, and only the status
  is logged. A failed `fetch`'s error can hold the request; only
  `describeError` is logged.
- **The stream's count is cumulative and can dip:** an all-zero `usage` may come
  just before the final one, so `neuronsInTail` takes the largest.
- **`tee()` keeps the model going while either copy reads.** The model's fetch
  carries the browser's abort signal, so Stop in the browser ends both copies;
  the count then falls back to the step's most.
- **The browser's client posts to `baseURL + "/chat/completions"`**, which is
  why the route is `/api/chat/completions`.

## How to work with it

- Tests: `npx vitest run --project worker tests/integration/chat.test.ts`
  (needs `npm run db:up`), with Workers AI replaced at `fetch` by streams
  recorded from it (`tests/support/workers-ai.ts`); the browser's client on the
  same streams: `tests/unit/chat/`.
- To call the real model by hand, copy a Workers AI token and use it as
  `$(pbpaste)` in `curl`; never put it in a file.
- Changing the model: `model.ts` (id, endpoint, longest step, extras such as
  thinking) and the budget's numbers in `budget.ts`; record new streams for
  `tests/support/workers-ai.ts` and check the browser's client still reads them.

## Related

- [docs/chat-transit.md](docs/chat-transit.md): invariants, limits, what is
  logged
- [shared/schemas/](../../shared/schemas/README.md): the request and the tools
- [routes/docs/api-guards.md](../routes/docs/api-guards.md): every route's guards
- [src/crypto/docs/threat-model.md](../../src/crypto/docs/threat-model.md): what
  the chat means for privacy
