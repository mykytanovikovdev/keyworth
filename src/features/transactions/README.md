# src/features/transactions/

## Purpose

Transactions are the source of truth: positions, P&L and every figure are
computed from them in the browser ([shared/metrics/](../../../shared/metrics/README.md)),
and none of those results is stored. This folder is the one way to add, change
or delete a transaction, whether it comes from the form, the chat (phase 7) or
a CSV file (4.5): each change meets the same rules before anything is
encrypted. It also holds the screens that add, edit and list transactions.
Not here: the schema itself
([shared/schemas/transaction.ts](../../../shared/schemas/transaction.ts)) and the
calculations.

## How it works

| File                   | Role                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `check.ts`             | The rules, pure: the schema, no date in the future, no sale beyond what was held              |
| `service.ts`           | Load, save (add or replace) and delete through the vault; `TransactionError`                  |
| `form-values.ts`       | The form's fields: four tabs to five kinds, amounts as typed (`typedAmount`), errors in words |
| `coin-search.ts`       | Finding a coin: the snapshot's 250, then the server's search; on a sale, the coins held       |
| `format.ts`            | Dates in words, amounts with every digit they have                                            |
| `AssetLogo.tsx`        | A coin's logo through the server, or its symbol in a circle                                   |
| `TransactionForm.tsx`  | The "Add transaction" / "Edit transaction" dialog                                             |
| `TransactionList.tsx`  | Columns on a wide screen, two lines a row on a phone; the empty state; unreadable records     |
| `editor.tsx`           | Adding, editing, deleting with Undo, for any page: the form, refusals in words, coin names    |
| `TransactionsPage.tsx` | `/transactions`: the list, and the editor for each row                                        |
| `queries.ts`           | The decrypted list as a query under `["vault", …]`, read again when the tab comes back        |
| `market.ts`            | The snapshot, coins outside it, the server's search, "Price that day" from history and rates  |
| `csv.ts`               | CSV as RFC 4180 has it: reading, writing, and cells kept from turning into formulas           |
| `csv-import.ts`        | A file checked before anything is written: size, UTF-8, columns, each row, duplicates, ledger |
| `csv-export.ts`        | The transactions as a file in the same format, oldest first; the template                     |
| `ImportDialog.tsx`     | "Import transactions": choose a file, see what it adds, skips and refuses, then import        |
| `import-export.tsx`    | The page's import and export: coins looked up, the service called, the file downloaded        |
| `download.ts`          | Text saved as a file: a Blob behind a temporary link, nothing over the network                |

**The form** (owner's decisions, 2026-11-08): tabs Buy, Sell, Receive and Send
(Receive with an Income box for staking and interest); the date typed as day /
month / year and repeated in words; a price currency from the 161 fiat
currencies, USDT and USDC; "Price that day" from `/api/market/history` and
`/api/market/rates`. A picked day is kept as noon UTC, which stays that day from
UTC−11 to UTC+11, or as now when noon is still ahead. Amounts take digits and one
separator only, a point or a comma. Deleting is at once, with Undo in the toast.
On Sell and Send (owner's decision, 2026-11-09), "Held on <day>: <quantity>"
under the quantity says what was held at that moment, and **All** fills it in to
the last digit: `heldAt` in `check.ts`, the same count the ledger's rule uses,
leaving out the transaction being edited. The coin list on Sell and Send offers
only the coins held today (`heldNow` in `check.ts`, again leaving out the one
being edited), each with its quantity, the largest value first as on the
portfolio; typing filters them in the browser, with no server search. Nothing
is lost: with none of a coin left today, taking some out on any earlier day
leaves a later sale short, which the ledger refuses anyway. A coin picked on Buy
stays picked when the kind changes, and "Held on …: 0" says there is nothing to
sell. Every screen and state is on `/design/transactions` (dev and design
builds).

**Wiring.** `useTransactionEditor()` (`editor.tsx`) is the one way a page changes a
transaction: the transactions page and the portfolio page both render its
`dialog` and call `openAdd`. It reads the list once and keeps it as a query; every change
goes through the service, which returns the new list, and the query takes it as
it is (no reload). A refusal comes back next to its field; `changed-elsewhere`
shows the other device's version in the form (a new `key`) or, when it was
deleted, closes the form. Undo puts the deleted transaction back under a new id.
Market data: the shared snapshot names most coins and offers them first in the
search; names of coins outside it, and "Price that day", are asked for by id
and kept under `["vault", …]`, which the app clears when the vault locks (they
say what the user holds). Coins outside the snapshot are asked for only once
the snapshot is in (`outsideSnapshot`): before it, every coin would look
outside. "Price that day" is the day's close from the coin's history, or for
today the price the page already has (asking by id only for a coin it lacks),
converted at the day's rate (or the last one before it) when the price
currency is not the dollar.

**Import and export** (owner's decisions, 2026-11-09): the "⋯" next to "Add
transaction" holds Import from CSV and Export to CSV; an empty list offers
"Import from a file". The format is Keyworth's own (an export, or the template
filled in by hand): `Date,Type,Coin,Symbol,Quantity,Price,Currency,Fee,Fee
currency,Note`, a day or a moment in UTC, Buy, Sell, Receive, Send or Income, a
coin by its id or by a symbol among the 250 largest. A file is read and checked
on the device (`csv-import.ts`, rules in
[input-validation.md](../../../shared/schemas/docs/input-validation.md#files)):
each row by the form's rules, rows recorded already skipped (same type, coin,
moment, quantity and price; each recorded transaction matches one row, so equal
fills in one file both count), the ledger's rule over the whole file, the room
left in the account. The dialog shows what it would add, skip and refuse, row by
row; `importTransactions` writes the rows in batches of 100
(`POST /api/vault/batch`, each whole or not at all), waits when told to slow
down, and on a failure part of the way stores what is in: importing the file
again adds the rest. Export writes every readable transaction, oldest first,
each cell safe to open in a spreadsheet; splits (which nothing creates yet) and
unreadable records are left out and counted in the message.

Each transaction is its own encrypted record of kind `transaction` with a random
id. `loadTransactions` reads every page of them and splits them into
`records` (with the revision each was read with) and `damaged` (ids of records
that do not decrypt or do not fit the schema).

`saveTransaction(access, list, { id?, value })` and
`deleteTransaction(access, list, id)` take the list as last read and return it
with the change applied; nothing is written when a rule fails. They throw a
`TransactionError` whose `problems` say why:

| Problem             | When                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `invalid`           | The value does not fit the schema; `fields` names them                                                                         |
| `in-the-future`     | Dated more than 10 minutes ahead of this device's clock                                                                        |
| `oversold`          | A sale or transfer out, this one or a later one, would move more than was held at its moment: `asked`, `held`, the transaction |
| `changed-elsewhere` | The record was edited or deleted on another device since it was read; `latest` holds the list as it is now                     |

## Why this way

- **One service for every way in.** The form, the chat's confirmation card and
  the CSV import differ only in how they collect a value; the rules, the record
  ids and the encryption are the same, so a trade cannot pass one way and fail
  another.
- **The whole ledger decides a sale.** A sale dated in the past changes what is
  held for every later one, so a change is checked by replaying the ledger
  before and after it (`computePositions`, the same code the figures use). A
  backdated sale that would leave a later one short is refused and names that
  one; so is shrinking or deleting a purchase a later sale needs.
- **Short already is allowed to stay short.** A sale imported short (or written
  by an older version) may be edited without being fixed first, as long as it
  is not made shorter: refusing every change until then would block the fix.
  The figures still count only what was held.
- **The other device wins.** A change to a record that changed elsewhere is
  refused rather than written over it; the user sees the current version and
  decides again. A record deleted elsewhere counts as deleted.
- **The vault and the API are arguments**, so the unit tests run the service
  against a fake server with a real vault; the app passes its own.
- **Rows with a problem are skipped, not the file** (owner's decision): the
  preview names each one and why, and importing a fixed file again adds only
  what is missing, because recorded rows count as duplicates. A file that does
  not fit the account is refused whole, before anything is written.
- **A batch endpoint for the import**, not a loop of single writes: these are
  limited to 120 a minute, so a thousand rows would take nine. A batch keeps
  the same quotas under the same lock and is written whole or not at all.
- **Our own format first**, exchanges' formats later (owner's decision): each
  has its own columns, kinds and fees, and the format a user can always produce
  is an export.

## Pitfalls & gotchas

- The form starts from `initial` once: to show a newer version (after
  `changed-elsewhere`), give it a new `key`.
- `shared/money` decimals are strict: compare and compute with `decimal("1")`,
  never a plain number (`gte(1)` throws "Invalid value").
- A query that names coins goes under `["vault", userId, …]`; only the snapshot,
  the same for everyone, may stay outside it.
- The list goes into the cache through `keepIfUnlocked`: a save or an import
  that finishes after the vault locked keeps nothing (a Lock also reloads the
  page, but the rule should not depend on that).
- A new field follows [input-validation.md](../../../shared/schemas/docs/input-validation.md):
  its limit, its kind's filter, a schema, and text-only output.

- Pass the list as last read, not one assembled by hand: its revisions are what
  a change sends back.
- Two devices adding transactions at the same moment each check against their
  own list; the server does not see inside records, so it cannot stop a sale
  that only the two together make short. The figures then count what was held
  and show the shortfall.
- `damaged` records count in no figure; they can be deleted like any other.
- **"Choose a file" is a `<label>` around the file input, not React Aria's
  `FileTrigger`.** FileTrigger calls the hidden input's `click()` from its
  press handler; Chrome on iOS stopped opening the picker that way after
  "Download the template". A tap on the label opens the picker natively in
  every browser. It is styled with `buttonClassName`, its hover and press as
  `hover:` and `active:` (a label has no React Aria state), and the focus ring
  shows on the label while the hidden input has focus.
- **Chrome on iOS ignores a tap that comes less than about a second after its
  picker was closed:** the picker is still closing until the input's `cancel`
  event arrives, and a second one does not open meanwhile. Nothing in the page
  can shorten that; a tap after it works. Found on an iPhone with an event log;
  moving the input out of the dialog (it is `position: fixed`) changed nothing.
- **Duplicates are matched by content, not by id:** a file has no record ids.
  A trade typed in by hand with another price or minute is not a duplicate of
  the same trade in a file.
- **A day without a time imports as the form keeps it:** noon UTC, or now if
  noon is still ahead. A day still ahead everywhere keeps its noon and is
  refused as the future.
- **Numbers in a file are read more strictly than in a field** (`fileAmount`):
  the preview shows only counts, so a grouped number guessed wrong ("1.234,50"
  as 1.2345, "1,234" as 1.234) would go in unseen. A point or a lone comma is
  the decimal separator, spaces may group thousands, any other grouping and the
  ambiguous "1,234" are refused with a message
  ([input-validation.md](../../../shared/schemas/docs/input-validation.md#files)).
- **Write invisible characters as escapes** (`"\uFEFF"`) in source: a literal
  byte-order mark looks like nothing, and ESLint skips it inside strings.

## How to work with it

- Run the tests: `npx vitest run --project unit tests/unit/transactions`
  (the CSV in `csv.test.ts` and `csv-import.test.ts`, the import's batches in
  `service.test.ts`); the batch endpoint in `tests/integration/vault.test.ts`.
- Look at the screens: `npm run dev` → `/design/transactions`.
- A new rule: add it to `check.ts` as a problem kind, test it there through the
  service, and give it words where the problems are shown.

## Related

- [src/vault/](../../vault/README.md): records, revisions and encryption
- [shared/metrics/docs/calculations.md](../../../shared/metrics/docs/calculations.md): how the figures treat a shortfall
- [worker/routes/README.md](../../../worker/routes/README.md): `GET /api/vault` in pages
