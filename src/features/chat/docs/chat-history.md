# The chat's history

## Purpose and scope

Chats are kept so they can be opened again on any device: the questions, the
answers' text and which tools were called, encrypted in the browser like the
transactions. This document covers what is kept and what never is, how the two
records of a chat are written, merged and deleted, and what the server learns.

Out of scope: the encryption itself
([src/crypto/docs/envelopes.md](../../../crypto/docs/envelopes.md)), what goes to
the model while a question is answered
([tools-and-minimization.md](tools-and-minimization.md)), and the API's limits
([worker/routes/docs/api-guards.md](../../../../worker/routes/docs/api-guards.md)).

## How it works

A chat is two records, each its own envelope:

| Record         | Holds                                                                  | Read                               |
| -------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| `conversation` | title, when created, when last written, the id of the `message` record | with the menu's list, at unlock    |
| `message`      | every message of the chat (`shared/schemas/chat-history.ts`)           | when the chat is opened, by its id |

1. **A question** is saved before it is answered, the answer when it ends, also
   when stopped or failed (`conversation.ts`, `chat-saver.ts`). Saves of one
   chat run one after another; a newer one replaces those still waiting.
2. **A new chat** is created with both records in one `POST /api/vault/batch`,
   all or none, with ids chosen once: if the answer is lost, the second try
   finds them taken and goes on instead of creating a second chat. The title is
   the first question, cut to 60 characters (`kept.ts`); no model writes it.
   Then the address becomes `/chat/<id>`, without a reload.
3. **A chat that goes on** is written with `PUT /api/vault/:id`, first the
   messages, then its place in the list (the date). Rewriting the whole
   `message` record each time is why it is one record: 60 KiB at most.
4. **Opening a chat** reads its one `message` record (`GET /api/vault/:id`).
5. **Deleting** hides the chat at once and deletes both records when the Undo
   toast closes (`deleting.ts`), by `POST /api/vault/delete` with `of: "chats"`.
   "Delete all chats" is the same with `all`.

## Invariants

1. **No result of a tool is kept.** `toSaved` keeps a call's name and input (as
   carried out: `includeAmounts` is off when the amounts were held back), and
   nothing it returned. Read back, each call has a note in its place, and the
   model calls the tool again when it needs the numbers.
2. **Only whole things are kept:** a call without a result, or an answer with
   nothing in it, is left out, so a kept chat is always one the AI SDK takes.
3. **Every record is encrypted before it leaves the browser**, as the kind it
   is: a `conversation` envelope does not decrypt as a `message`.
4. **A chat is never written after it is deleted** (404 on its record ends the
   saver), and nothing that is not saved is claimed to be: the page says "This
   chat isn't saved yet", "This chat is full" or "deleted on another device".
5. **Deleting chats takes only `conversation` and `message` records**, on the
   server too (`DELETE_GROUPS`): no list of ids can take a transaction or the
   settings.
6. **The titles and messages are under `["vault", …]`** in the query cache, so
   they go when the vault locks.

## Decisions and alternatives

- **Two records, messages as one.** Rejected: one record a message (each is a
  row with a time, so the server would learn how many messages a chat has and
  when each was written; opening one chat would mean reading all the messages;
  and they share the user's 20,000 records) and an open column with the chat's
  id (the link between records would stand in a dump of the database).
- **What the server still learns:** how many chats, the size bucket of each, and
  about when and how often each was saved (its revision), and which record is
  read when one is opened
  ([threat model](../../../crypto/docs/threat-model.md)).
- **Tool results are not kept** (owner's decision, 2026-11-24): they are numbers
  of one day, some of them amounts, and would be stale in a week.
- **Conflict: merge, once.** Two devices with the same chat open: on 409 the
  other's messages are read and joined by message id (theirs first, ours added;
  ours wins for a message both have, since it may have grown), and written once
  more. Messages in the middle keep their place.
- **Undo is a delayed delete, not a re-creation.** Nothing is deleted until the
  toast closes, so Undo has nothing to restore. It is deleted sooner when the
  vault locks, the page leaves (a `keepalive` request) or a new chat is created,
  so that "all" never takes a chat begun meanwhile. Rejected: deleting at once
  and writing the chats back, which would have to read every chat first.
- **Full at 60 KiB:** an envelope holds 64 KiB with padding. The chat stops
  taking questions and says so; nothing old is dropped in silence.

## Edge cases and failures

| Case                                           | What happens                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Offline, rate limited or locked during a save  | "This chat isn't saved yet"; the next save tries again with the whole chat                                          |
| The answer to the first save is lost           | The second finds the ids taken and goes on: one chat, not two                                                       |
| The tab closes while an answer is written      | The question is kept, the answer is not                                                                             |
| The chat was deleted on another device         | "This chat was deleted on another device"; the box is disabled                                                      |
| A record does not decrypt or fit the schema    | The list shows "Can't be opened", so it can be deleted; its messages record is not known and goes with "Delete all" |
| The address names no chat of the user's        | "This chat isn't here…"                                                                                             |
| A tool's input changed since the chat was kept | That call is left out when read: the AI SDK refuses a whole chat over one                                           |
| The tab crashes before the Undo time is over   | Nothing was deleted; the chat shows again                                                                           |
| The device's clock is wrong                    | Its chats sort by that clock                                                                                        |

## How it is tested

- `tests/unit/chat/saved.test.ts`, `chats.test.ts`, `deleting.test.ts`: the kept
  form (no results, only finished parts), what the model gets back, size in
  bytes, titles; creation once though the answer is lost, order, merging, gone
  and full; delayed deletes, Undo and flush. Mutation-checked (15 breakages).
- `tests/integration/vault.test.ts`: the owner alone reads a record, both
  records of a chat in one batch or none, chat deletion by id and all, never
  settings or transactions (6 breakages).
- `tests/e2e/chat.spec.ts`: kept through a Lock, continued without the old
  figures on the wire, deleted with Undo and for good, "Delete all" apart from
  a chat begun meanwhile.

## How to change it safely

The schemas are strict, unlike the transactions': a chat with a field or a part
the code does not know reads as "can't be opened", and saving writes only what
this version knows. So a new field is a change of shape: it needs a new version
(`v`) alongside the old one, tabs opened before the deploy show such chats as
unreadable until they reload, and a test checks that it holds nothing a tool
returned. A new tool needs nothing here: its
calls are kept by name and input, and dropped when read if the input no longer
fits. Never change a shape in place: an older chat must still open.

Last reviewed: 2026-11-25
