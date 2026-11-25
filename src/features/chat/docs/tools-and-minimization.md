# The chat's tools and what reaches the model

## Purpose and scope

The chat's model answers from numbers the browser hands it: the agent's loop
runs in the browser, and so do its tools, on the decrypted transactions. This
document covers what each tool sends to the model, what never leaves the
device, and the limits the browser keeps to. Every tool is read-only (phase 5):
none can add, change or delete anything.

Out of scope: the server's side of the transit (checks, the model's
instructions, the budget, nothing logged), in
[worker/chat/docs/chat-transit.md](../../../../worker/chat/docs/chat-transit.md);
how the figures are computed, in
[shared/metrics/docs/calculations.md](../../../../shared/metrics/docs/calculations.md).

## How it works

1. A question goes into the tab's conversation (`conversation.ts`): an AI SDK
   `ToolLoopAgent` whose model is `@ai-sdk/openai-compatible` pointed at
   `/api/chat/completions`. Each model step is one request.
2. When the model calls a tool, `tools.ts` runs it here. The data comes from
   `chat-data.ts`: the same queries as the portfolio and transactions pages
   (decrypted transactions, settings, prices, histories, rates), so their cache
   is shared.
3. The tool's result goes back with the next step, as JSON, to the model. The
   steps line shows each call and what the AI received from it
   (`step-words.ts`).

| Tool                     | Sends by default                                                                   | Adds with `includeAmounts`                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `search_asset`           | Coins found by name or ticker: id, ticker, name                                    | —                                                                                                  |
| `get_portfolio`          | The period's dates and change; each coin held: share, price change over the period | Quantities, values, average cost, unrealized profit; the total, the period's gain, all-time profit |
| `list_transactions`      | Newest first: day, kind, coin, price per coin and its currency; how many match     | Quantities; fees and their currency                                                                |
| `get_prices`             | Today's price of each coin asked, in the base currency                             | —                                                                                                  |
| `get_price_history`      | A coin's change, high and low over a period, and up to 30 of its daily prices      | —                                                                                                  |
| `calc_portfolio_metrics` | The period's change, largest drop and volatility; each coin's share and change     | —                                                                                                  |
| `compare_assets`         | 2–5 coins: change, volatility, largest drop, and their correlations                | —                                                                                                  |

Ratios are rounded to four places (a percentage to one decimal), money to two,
prices to six significant digits. Prices and histories are converted to the
base currency at each day's rate; a day without a rate is left out.

## Invariants

1. **Amounts only when the question asks for them.** Without `includeAmounts`, no
   result holds a quantity, value, total, gain, cost, profit or fee. The model is
   told to set it only then (`shared/schemas/chat-tools.ts`), and **the browser
   decides**: `asksForAmounts` (`amounts.ts`) reads the latest question, and a
   follow-up ("And Bitcoin?") the one before it. Otherwise the amounts stay here,
   whatever the model asked for; it is told so in the result, and the steps line
   says what was really sent.
2. **Notes never go.** A transaction's note is the person's own words; no tool
   sends it, with or without `includeAmounts`.
3. **Nothing says who is asking.** No tool sends the name, email or user id,
   and the server adds none.
4. **The model computes nothing.** Every figure comes from `summarize` or
   `shared/metrics` (CLAUDE.md, rule 7); a tool only selects and rounds.
5. **The tools only read.** None writes to the vault or calls a route that
   changes anything.
6. **At most six model steps a question** (`CHAT_LIMITS.maxSteps`), the same
   limit the server enforces, and no step is retried on its own.
7. **The model gets at most the latest 40 messages**, cut only before a
   question (`history.ts`): the server refuses more, and a cut after a question
   could leave a tool's result without its call.
8. **What a tool returned is never kept.** The chat is kept encrypted
   ([chat-history.md](chat-history.md)) without it, and the open conversation
   leaves memory on New chat, when another chat is opened and when the vault
   locks (with the decrypted queries, `src/App.tsx`). Nothing of it is written
   to the browser's own storage.

## Decisions and alternatives

- **Tools in the browser, not on the server** (CLAUDE.md, rule 9): the server
  never has the decrypted data, so it could not run them.
- **`DirectChatTransport`** runs the agent in process for `useChat`. Rejected:
  `useChat`'s default HTTP transport, which would need a route of ours to run
  the loop on the server.
- **Each coin's price change, not its "part in the change"**: a contribution
  per coin needs a calculation `shared/metrics` does not have yet. The tool's
  description says what it returns, so the model does not claim more.
- **Prices in the base currency**, at each day's rate, so the model never
  mixes currencies in one answer.
- **Words, not the model, decide about amounts.** The development model asked for
  them on "How did my portfolio do this month?" (2026-11-25) although told not to.
  `amounts.ts` holds words and signs that can hardly mean anything else, in the
  languages people here write in, with currency signs and codes for the rest. It
  errs on the side of keeping back: a question it misses is asked again with
  "in dollars". Rejected: asking the person to confirm each time (a click for
  every question about money) and trusting the model.
- **At most 30 points of a price history**: enough to describe its shape at a
  fraction of the tokens; the change, high and low come from every day.

## Edge cases and failures

| Case                                  | What the model gets                                                        |
| ------------------------------------- | -------------------------------------------------------------------------- |
| No transactions yet                   | `{ holdings: [], note: "The user has no transactions yet." }`              |
| A coin without a price today          | Its price is `null`; the portfolio notes that shares leave it out          |
| A coin without history                | `get_price_history`: `error: "No prices for this coin."`                   |
| A market request fails inside a tool  | The tool fails; the model is told the call failed and says so              |
| The server refuses a step (429, 502…) | No retry; the page says why (`refusals.ts`), with Try again where it helps |
| Today's limit is reached              | The box is disabled until the reset time the server gave, then reopens     |

## How it is tested

- `tests/unit/chat/tools.test.ts`: each tool on made-up transactions and
  markets; without `includeAmounts` no amount key and no note anywhere in the
  results, with it the amounts are there; prices in a base currency other than
  the dollar; history sampling; correlations; amounts asked for by the model
  and not by the question kept back. Mutation-checked: making any amount
  unconditional, sending a note or skipping the conversion fails it.
- `tests/unit/chat/amounts.test.ts`: which questions ask for amounts, in six
  languages, the starter questions among those that do not; follow-ups.
- `tests/unit/chat/history.test.ts`: the latest messages within the limit, cut
  only before a question, each tool result counted.
- `tests/e2e/chat.spec.ts`: the whole loop in the production build with the
  model answered in the browser; the tool's result as sent on the wire holds a
  share and no quantity, price paid or value, and no request carries a
  `system` message or the user's email
  ([tests/e2e/docs/chat-flows.md](../../../../tests/e2e/docs/chat-flows.md)).

## How to change it safely

A new field in a tool's result: decide whether it is an amount; if so, put it
behind `includeAmounts` and add its key to the test's list. A new tool: its
definition in `shared/schemas/chat-tools.ts`, its `execute` in `tools.ts`, its
words in `step-words.ts` (saying what the AI receives), and a test of what it
keeps back. Never send free text the person wrote other than the question.

Last reviewed: 2026-11-25
