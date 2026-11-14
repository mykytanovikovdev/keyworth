# src/features/chat/

## Purpose

The chat: a question in plain words (any language), the assistant's answer
streamed in, and the steps it took to find the numbers. This folder holds the
screens: the chat list in the menu, the conversation, the question box, the
steps line and the answer's formatting, and the "Delete all chats" dialog.

**Today these are presentational components shown by the mockups**
(`/design/chat`, [src/routes/ChatMockupsPage.tsx](../../routes/ChatMockupsPage.tsx)),
approved on 2026-11-14. Wiring them to `/api/chat`, the tools that run in the
browser and the encrypted history comes in the next steps of phase 5.

Not here: the model, the system prompt and the limits (the server's
`/api/chat`), the calculations the tools return
([shared/metrics/](../../../shared/metrics/README.md)), and the frame with the
menu ([src/routes/AppFrame.tsx](../../routes/AppFrame.tsx)).

## How it works

| File                       | Role                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `chat-list.ts`             | `ChatSummary`; `groupChats`: Today, Previous 7 days, Previous 30 days, Older, newest first  |
| `ChatList.tsx`             | The chats in the menu, each with a "⋯" menu (Delete chat)                                   |
| `Composer.tsx`             | The question box: Enter sends, Shift+Enter is a new line, Stop while answering; the caption |
| `Messages.tsx`             | A question, an answer, the steps line (`ToolSteps`), a stopped or broken-off answer         |
| `ChatLayout.tsx`           | The reading column with the box kept at the bottom; `EmptyChat`, a new chat with ideas      |
| `answer-styles.ts`         | How an answer's paragraphs, lists, bold, tables and code look                               |
| `DeleteAllChatsDialog.tsx` | "Delete all chats?": asked once; Undo in the toast afterwards                               |

An answer is shown in two parts. **The steps line** says what the assistant is
doing ("Looking at your portfolio…") and afterwards sums it up in one line that
opens into the list. Each step also says what the AI received: "Shares and
changes. Amounts stayed on this device", or "Amounts included, as you asked".
**The answer's text** arrives as markdown and becomes plain React elements; one
class on the container (`answerClassName`) styles them, so no model output is
ever rendered as HTML.

## Why this way

- **The caption under the box says the answers are AI-written** ("AI answers
  can be wrong. Not investment advice."): people must be told they are talking
  to an AI (EU AI Act, art. 50(1)), and the app gives no investment advice.
- **The steps say what left the device.** Amounts go to the model only when
  the question is about them; showing it at every step makes the rule visible
  rather than a promise in the privacy policy.
- **Deleting a chat asks nothing; Undo brings it back,** as with transactions.
  Deleting all of them asks once, because it reaches every device.
- **The box stays at the bottom while the page scrolls** (`sticky`), rather than
  a scrolling box inside a fixed-height page: on iOS the page's own scroll
  behaves with the on-screen keyboard.
- **The box grows with the text by setting its height through CSSOM**, which
  the CSP allows; a style attribute in the markup would not be.

## Pitfalls & gotchas

- **Enter during an input method's composition** (Japanese, Chinese) must not
  send: `Composer` checks `isComposing`.
- **The "⋯" of a chat is hidden until hover or focus with a mouse,** and always
  shown on touch screens (`pointer-coarse`), where nothing hovers.
- **A wide table scrolls by itself, never the page:** the renderer wraps tables
  in an `overflow-x-auto` container.

## How to work with it

```sh
npm run dev   # then /design/chat: every screen, with a switcher
```

`?screen=<id>` opens one screen, `&bare` hides the switcher (for screenshots).
The mockups' answers are made up and stream on timers; nothing reaches a model.

## Related

- [src/routes/](../../routes/README.md): the app frame and the mockups
- [src/ui/](../../ui/README.md): the design system these screens are built from
- [src/features/transactions/](../transactions/README.md): the same delete and
  Undo pattern
