# src/features/chat/

## Purpose

The chat: a question in plain words (any language), the assistant's answer
streamed in, and the steps it took to find the numbers. This folder holds the
page at `/chat`, the agent's loop and its tools, which run in the browser on
the decrypted data, and the screens: the conversation, the question box, the
steps line, the answer's formatting and the "Delete all chats" dialog.

Not here: the model, the system prompt and the limits (the server's
[`/api/chat/completions`](../../../worker/chat/README.md)), the calculations the
tools return ([shared/metrics/](../../../shared/metrics/README.md)), and the
frame with the menu ([src/routes/AppFrame.tsx](../../routes/AppFrame.tsx)).
Chats are not kept yet: one conversation lives in the tab until the encrypted
history arrives (phase 5.3).

## How it works

```
question ─► Chat (@ai-sdk/react) ─► DirectChatTransport ─► ToolLoopAgent
                                                  │  each model step: POST /api/chat/completions
                                                  │  (the server adds the model, the prompt, the limits)
                                                  ▼
                                  tool calls ─► tools.ts on the decrypted data
                                  (results go back with the next step)
```

| File                       | Role                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `ChatPage.tsx`             | `/chat`: the empty chat or the conversation, Stop, refusals, today's limit                       |
| `conversation.ts`          | The agent (`ToolLoopAgent`, ≤ 6 steps, no retries) and the tab's one conversation (`Chat`)       |
| `chat-session.ts`          | When the conversation starts over (New chat, locking), without loading the AI SDK                |
| `tools.ts`                 | The seven read-only tools, on the data `chat-data.ts` loads; amounts only with `includeAmounts`  |
| `chat-data.ts`             | The transactions, settings and market data through the pages' own queries and cache              |
| `history.ts`               | The latest messages within the server's limit, cut only before a question                        |
| `refusals.ts`              | The server's refusals (`budget`, `rate_limited`…) as a code through the transport, then as words |
| `step-words.ts`            | What each tool call says in the steps line, and what the AI received from it                     |
| `Answer.tsx`               | The answer's markdown as plain elements: no HTML, no images, links as their words                |
| `follow.ts`                | The starter questions, and keeping a growing answer in view                                      |
| `Composer.tsx`             | The question box: Enter sends, Shift+Enter is a new line, Stop while answering; the caption      |
| `Messages.tsx`             | A question, an answer, the steps line (`ToolSteps`), a stopped or broken-off answer              |
| `ChatLayout.tsx`           | The reading column with the box kept at the bottom; `EmptyChat`, a new chat with ideas           |
| `answer-styles.ts`         | How an answer's paragraphs, lists, bold, tables and code look                                    |
| `ChatList.tsx`             | The chats in the menu, each with a "⋯" menu (Delete chat); in the mockups until chats are kept   |
| `chat-list.ts`             | `ChatSummary`; `groupChats`: Today, Previous 7 days, Previous 30 days, Older, newest first       |
| `DeleteAllChatsDialog.tsx` | "Delete all chats?": asked once; Undo in the toast afterwards (mockups until chats are kept)     |

What the tools return, what never leaves the device and how that is tested:
[docs/tools-and-minimization.md](docs/tools-and-minimization.md).

An answer is shown in two parts. **The steps line** says what the assistant is
doing ("Looking at your portfolio…") and afterwards sums it up in one line that
opens into the list. Each step also says what the AI received: "Shares and
changes. Amounts stayed on this device", or "Amounts included, as you asked".
**The answer's text** arrives as markdown and becomes plain React elements
(`react-markdown` with GFM tables); one class on the container
(`answerClassName`) styles them, so no model output is ever rendered as HTML.

## Why this way

- **The agent's loop runs in the browser**, where the decrypted data is. The
  server is a thin proxy that writes the model's request itself and passes the
  stream back untouched (decided on 2026-11-15, after the AI SDK on the server
  cost ~200 ms of CPU an answer against the free plan's 10 ms). `useChat`
  takes a `DirectChatTransport`: the AI SDK's agent, in process, instead of an
  HTTP route of our own.
- **The model client is `@ai-sdk/openai-compatible`**, pointed at
  `/api/chat/completions`: Workers AI's OpenAI-compatible stream reads as it is
  (tested on recorded streams in `tests/unit/chat/`).
- **No retries** (`maxRetries: 0`): a refused or failed step is not asked
  again on its own, since every try spends the day's budget and the minute's
  limit. The person presses Try again.
- **The steps say what left the device.** Amounts go to the model only when
  the question is about them; showing it at every step makes the rule visible
  rather than a promise in the privacy policy.
- **The caption under the box says the answers are AI-written** ("AI answers
  can be wrong. Not investment advice."): people must be told they are talking
  to an AI (EU AI Act, art. 50(1)), and the app gives no investment advice.
- **One conversation, in memory** (owner's decision, 2026-11-21) until chats
  are kept encrypted: no list in the menu that would promise what is not
  there. It survives moving between sections; New chat, Lock and closing the
  tab end it.
- **The chat's code is its own chunk, not fetched ahead** with the sections:
  it carries the AI SDK and the markdown parser (about 155 kB gzip), for those
  who open the chat. The first load stays as it was.
- **The box stays at the bottom while the page scrolls** (`sticky`), rather than
  a scrolling box inside a fixed-height page: on iOS the page's own scroll
  behaves with the on-screen keyboard.
- **The box grows with the text by setting its height through CSSOM**, which
  the CSP allows; a style attribute in the markup would not be.

## Pitfalls & gotchas

- **The model client needs an absolute address**: it builds URLs with
  `new URL`, which takes no relative path. `conversation.ts` gives it this
  site's origin.
- **Errors reach the page as text only**: `DirectChatTransport` passes the
  string `onError` returns, so the HTTP status is turned into a code there
  (`failureCode`) and back into a refusal on the page (`failureOf`).
- **Do not import `conversation.ts` (or anything with the AI SDK) from the
  frame or the app's start**: it would pull the chat's chunk into the first
  load. `chat-session.ts` is the light way in.
- **A question that is also a starter question** shows twice on an empty
  chat's page; tests that check a question is gone use their own words.
- **Enter during an input method's composition** (Japanese, Chinese) must not
  send: `Composer` checks `isComposing`.
- **A wide table scrolls by itself, never the page:** the renderer wraps tables
  in an `overflow-x-auto` container.

## How to work with it

```sh
npm run dev   # /chat needs WORKERS_AI_TOKEN in .dev.vars; /design/chat needs nothing
npm run test:e2e -- tests/e2e/chat.spec.ts   # the model answered in the browser
```

On `/design/chat`, `?screen=<id>` opens one screen and `&bare` hides the
switcher. The mockups' answers are made up and stream on timers; nothing
reaches a model.

A new tool: its definition in `shared/schemas/chat-tools.ts` (the server sends
it to the model), its `execute` in `tools.ts`, its words in `step-words.ts`,
and a test that nothing beyond what it promises reaches the model.

## Related

- [docs/tools-and-minimization.md](docs/tools-and-minimization.md): what the
  tools send, and what never leaves the device
- [worker/chat/](../../../worker/chat/README.md): the server's side, the model and its limits
- [src/routes/](../../routes/README.md): the app frame and the mockups
- [src/ui/](../../ui/README.md): the design system these screens are built from
- [src/features/portfolio/](../portfolio/README.md): `summarize`, which the
  portfolio tools reuse
