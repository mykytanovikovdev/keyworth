# Input validation

How Keyworth treats everything that comes in from outside the code: what a user
types or pastes into a field, the page's address, a file to import, a request to
the API, and data from market sources. One set of rules, so every new field is
built the same way, and the attacks that go through inputs (script injection,
spoofed text, hostile files) are stopped by design rather than case by case.

## The five layers

Each layer assumes the one before it was skipped. A field's filter is a
convenience an attacker bypasses by calling the API directly; the platform's
CSP still holds if every check above it fails.

| Layer         | Where                                                           | What it does                                                                                    |
| ------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1. The field  | `src/ui` components, field filters (`typedAmount`, `typedText`) | Never lets in what can never be valid: letters in an amount, hidden characters, past the length |
| 2. The schema | `shared/schemas` (zod), the transaction service's rules         | The source of truth: what a value may be, checked before anything is encrypted or saved         |
| 3. The server | `worker/routes`, `worker/limits.ts`                             | Checks every parameter and body again with strict schemas, allowlists, size and rate limits     |
| 4. The output | React text, URL builders, CSV export                            | Data is shown as text only; addresses are built from checked ids; exported cells cannot run     |
| 5. The page   | CSP, Trusted Types, ESLint                                      | Even a string that slipped through everything cannot become markup or code                      |

**A field drops, a schema refuses.** What can never be valid (a letter in an
amount, a character nobody can see) is not typed at all, silently. What is
incomplete or out of range gets a message at the field. A schema never changes a
value to make it pass: whoever sends text cleans it first, and anything else is
refused, so the server never quietly stores something other than what was sent.

## Rules by kind of input

| Kind                          | The field                                                                                                      | The schema / the server                                                                                                                                                                                                                                                                                                                                  | Shown as                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Amount (quantity, price, fee) | Digits and one separator, `.` or `,`; at most 30 digits before it, 18 after (`typedAmount`)                    | Plain-digit string, no exponent, no sign (`shared/schemas/transaction.ts`); never a `number` until display                                                                                                                                                                                                                                               | Grouped digits, text                                       |
| Date                          | Day, month and year segments only (`DateField`), not after today; repeated in words                            | ISO 8601 in UTC; no more than 10 minutes ahead (`src/features/transactions/check.ts`)                                                                                                                                                                                                                                                                    | Words: "December 20, 2025"                                 |
| Choice (coin, currency, kind) | Picked from a list (`ComboBox`, `Select`, `SegmentedControl`); typing only searches                            | Only an option's id is kept: asset id pattern, currency lists, enums; the server checks the same                                                                                                                                                                                                                                                         | The option's label                                         |
| Free text (note, search)      | One line; hidden characters dropped as typed (`typedText`); `maxLength`                                        | `plainTextSchema(max)`: refused unless already clean; the search route answers 400 to hidden characters                                                                                                                                                                                                                                                  | Text                                                       |
| Secret (passphrase, key)      | Printable ASCII only, no autofill, autocorrect or spellcheck ([argon2.md](../../../src/crypto/docs/argon2.md)) | Never sent: only what it unlocks is                                                                                                                                                                                                                                                                                                                      | Hidden; the recovery key once, when made                   |
| The page's address            | —                                                                                                              | Each parameter checked against an allowlist (`validateSearch` or the page); anything else is ignored                                                                                                                                                                                                                                                     | Never shown: `?error=` picks a known message               |
| Data from a market source     | —                                                                                                              | Checked (zod, or by hand for long series), reduced, `cleanText` and length limits before it is kept                                                                                                                                                                                                                                                      | Text; logos as raster images only                          |
| A question to the chat        | Several lines allowed (Shift+Enter); at most 2,000 characters                                                  | `questionSchema`: not blank, no hidden characters but line breaks; the server checks the whole conversation (`shared/schemas/chat.ts`, OpenAI format): its first message a question, no `system` role, known tools only, each call's input against its tool's schema, each result answering a call; it writes the model's instructions and limits itself | Text as typed; the model's answer as markdown without HTML |
| A file (CSV import)           | See [Files](#files)                                                                                            | Every row through the transaction service, like the form                                                                                                                                                                                                                                                                                                 | Text                                                       |

### Free text

`shared/schemas/text.ts` holds the one definition, for the browser and the Worker:

- **Hidden characters** are control characters (`\p{Cc}`: line breaks, tabs,
  NUL, escape) and format characters (`\p{Cf}`: zero-width spaces and joiners,
  and the bidirectional overrides that make `txt.exe` look like `exe.txt`).
  They let text look like something it is not, in a list, a log or a CSV cell,
  so free text never keeps them.
- `typedText(value, max)`: what a field keeps of a keystroke or a paste. Line
  breaks become spaces; spaces stay as typed, so the next word can follow.
- `cleanText(value, max)`: what is kept. One composed form (NFC), single spaces,
  no spaces at the ends, cut without splitting a character. Cleaning twice
  changes nothing, which the schema relies on.
- `plainTextSchema(max)`: a schema accepts only text `cleanText` would leave
  unchanged.
- **Markup characters are kept.** `<`, `>` and `&` are ordinary text
  ("BTC < 60k") and are only ever shown as text; removing them would corrupt
  real notes and suggest the danger was there rather than in how text is shown.
- Notes are one line (owner's decision, 2026-11-08): a note fits one list row and
  one CSV cell, and no control character has a reason to be in it.

### Files

The CSV import (`src/features/transactions/csv-import.ts`, `ImportDialog.tsx`)
follows these rules:

1. **Read in the browser, as text, and nowhere else.** The file never goes to the
   server and is never executed, opened as a page or shown as markup.
2. **The extension and the type are hints, not checks.** `accept=".csv,text/csv"`
   helps the picker; both are set by whoever made the file. The content decides.
3. **Size first.** `file.size` is checked before reading (5 MB is more than a
   decade of trades); a larger file is refused unread.
4. **Text, not bytes.** Decoded as UTF-8 with `fatal: true`; a NUL byte or an
   invalid sequence means it is not a CSV file. A byte-order mark is dropped.
5. **Rows within the vault's limits.** At most as many rows as the user's quota
   can still hold; more is refused before anything is written, and a file
   longer than the room and every recorded row together before any row is
   checked. At most 100 coins outside the snapshot are looked up by id.
6. **Every row through the transaction service.** Each cell is free text, an
   amount, a date or a choice, and gets that kind's rules; nothing is written
   unless the user confirms the preview.
7. **The file name is text.** Shown as text if at all, never used as a path, a
   key or an address.
8. **Only CSV.** No spreadsheets (macros), archives (zip bombs), XML (external
   entities), HTML, SVG or PDF: none is needed, and each brings an attack surface.

How the code meets them: the picker hints `.csv`; `readText` refuses a file
over 5 MB before reading it, and bytes that are not UTF-8 or hold a NUL;
`readTable` needs the known columns; every row is rebuilt field by field
(amounts strictly, below; currencies from the form's list, the note through
`cleanText`) and then parsed by the transaction schema; the ledger's
rule runs over the whole file; the account's room is checked before anything
is written; the dialog shows what would be added, skipped and refused, and the
service writes only after the button. A cell quoted in a message is cut to 40
characters and cleaned. The file name is shown as text, cleaned and cut.

**Numbers in a file are read strictly,** stricter than a field: a field shows
what it understood as you type, a file's preview shows only counts, so a number
read a thousand times off would go in unseen. A point is always the decimal
point (the export and the template write it); a lone comma is one too ("0,5");
spaces between groups of three digits group thousands ("1 234,50"). Any other
grouping ("1.234,50", "1,234.50", "1'000") is refused with a message, and so is
a comma before exactly three digits after one to three others ("1,234" could be
either). Tested in `tests/unit/transactions/csv-import.test.ts`.

**Export** (`csv-export.ts`) writes CSV that spreadsheets open: where a formula
could start, at the start of a cell or after a `;` (a spreadsheet whose list
separator is `;` splits the line there, quotes or not), a `=`, `+`, `-`, `@`, a
tab or a carriage return gets one more `'` before it, so a note such as
`=HYPERLINK(...)` stays text instead of becoming a formula. The import takes
off exactly that `'`, so every note comes back as it was, one that starts with
`'=` included.

## What the server does with input

- **Strict schemas and allowlists.** Bodies are strict objects with exact sizes
  (`shared/schemas`); ids match a pattern; currencies, kinds and cursors come
  from fixed lists or formats. Something unknown is a 400, not a guess.
- **Limits before work.** Body size (4 KB, 96 KB, 128 KB, 48 KB), query length, ids
  per request, rate limits per user, quotas per user
  ([api-guards.md](../../../worker/routes/docs/api-guards.md)).
- **No string becomes code.** Queries are Drizzle's or parameterized `sql`
  templates; `sql.raw` takes only constants from the code.
- **Input never chooses where the server connects.** Market sources are fixed
  hosts; a request adds only a checked id to a path or a value to a query string
  (`URLSearchParams`).
- **Input never reaches a log.** Errors name the source and the kind of failure,
  never what was asked for.

## Invariants

1. Nothing a user or a source wrote is rendered as markup: no
   `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML` or
   `document.write` (ESLint), and the CSP's `trusted-types 'none'` makes every
   such sink throw at runtime.
2. No address (`href`, `src`) is built from free text. Addresses are constants or
   built from a checked id with `encodeURIComponent`; `javascript:` addresses are
   refused by ESLint and the CSP allows no inline script.
3. Kept free text has no hidden characters, one line, its length limit.
4. A lookup by a key that came from outside (an address parameter, a file's
   column name, a source's field) uses an allowlist, a `Map` or `Object.hasOwn`:
   `"constructor"` or `"__proto__"` must not find something built in.
5. An amount is digits in a string until it is shown.
6. A value from a list is kept as its id, and the id is checked again where it is
   used.

## Attacks and what stops them

| Attack                                                     | Stopped by                                                                                              | Tested in                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Script in a note or a coin's name (`<img onerror=…>`)      | React text (layer 4); no HTML sinks (ESLint); Trusted Types and the CSP (layer 5)                       | `tests/unit/transactions/rendering.test.ts`, `tests/e2e/transactions.spec.ts`, `tests/e2e/app.spec.ts` |
| Script through an address (`javascript:`, a crafted `src`) | Addresses from constants or encoded ids; `no-script-url`; CSP `default-src 'none'`, `img-src 'self'`    | `rendering.test.ts` (an id with quotes stays encoded)                                                  |
| Words or code through the page's address (`?error=`)       | Known codes only, by own keys; a parameter never becomes text on the page                               | `tests/e2e/auth.spec.ts`                                                                               |
| Spoofed text (bidi overrides, zero-width characters)       | Fields drop them, schemas refuse them, the server refuses them in a search, sources' text is cleaned    | `tests/unit/schemas.test.ts`, `tests/integration/market.test.ts`                                       |
| Built-in names as keys (`constructor`, `__proto__`)        | Allowlists, `Map`, `Object.hasOwn`; parsed data read through schemas, never merged with `Object.assign` | `tests/e2e/auth.spec.ts`                                                                               |
| Oversized input                                            | `maxLength`, schema limits, body limits, rate limits, quotas                                            | `tests/integration/vault.test.ts`, `market.test.ts`                                                    |
| SQL injection                                              | Parameterized queries only                                                                              | Every integration test goes through them                                                               |
| A request that makes the server call elsewhere             | Fixed hosts; input only as a checked path segment or an encoded query value                             | `market.test.ts` (refused ids; other hosts fail the test)                                              |
| Input in the logs                                          | Fixed error messages that name no input                                                                 | `market.test.ts` (the one log line)                                                                    |
| Slow patterns on long input (ReDoS)                        | Anchored patterns without nested repetition, run on input already cut to its limit                      | Review                                                                                                 |
| A formula in an exported cell                              | Export puts a `'` before `= + - @`, tab and CR at a cell's start and after `;`                          | `tests/unit/transactions/csv.test.ts`; `transactions.spec.ts` (the downloaded file)                    |
| A hostile file                                             | [Files](#files): size first, strict UTF-8, each row rebuilt and parsed, a preview before writing        | `tests/unit/transactions/csv-import.test.ts`; `tests/e2e/transactions.spec.ts`                         |
| Instructions hidden in data for the assistant              | Data reaches the model marked as untrusted and cut to size (project rule 12, phase 5)                   | With the chat, phase 5                                                                                 |

**Accepted limits.** Free text may mix scripts, so a note can hold letters that
look like Latin ones (Cyrillic "а"); notes are the user's own and may be in any
language. Secrets, which must be typed again exactly, are printable ASCII only.

## Decisions and alternatives

- **Drop in the field, refuse in the schema,** rather than clean everywhere: a
  server that silently rewrites what it is sent hides bugs and attacks alike.
- **Keep `<`, `>`, `&` in text** rather than strip or escape them on input:
  escaping is the output's job, done once, by React.
- **No new test libraries:** components are rendered to a string in Node
  (`react-dom/server`) to check what reaches the page; the e2e tests add the
  real browser and CSP.
- **File rules first, file code with the import:** the rules were fixed here
  before the importer existed (4.3), so it started from them (4.5).
- **Our own CSV reader, not a library:** RFC 4180 fits on a screen, every rule
  of it is tested, and a parser with options (dynamic typing, formulas,
  headers guessed) would read more into a file than this format needs.

## Adding a field: checklist

1. Pick its kind from the table. A choice keeps an id, never free text.
2. Build it from `src/ui` with its limit (`maxLength`) and its kind's filter
   (`typedAmount`, `typedText`); `inputMode` and `autoComplete` to match.
3. Give it a schema in `shared/schemas` with the kind's builder
   (`plainTextSchema`, the decimal patterns, an enum) and a named limit the field
   shares.
4. If it reaches the server: the route checks it with the same schema or an
   allowlist, under body and rate limits; it never reaches a log or `sql.raw`.
5. Show it as text. Never put it into `href`, `src` or `style`; encode an id with
   `encodeURIComponent`; look keys up with `Object.hasOwn` or a `Map`.
6. If it can reach the assistant, it goes as untrusted data (rule 12).
7. Test: accepted and refused values (hidden characters and the limit among
   them), how it is shown, and the server's 400.
8. Add it to the tables above.

Last reviewed: 2026-11-15
