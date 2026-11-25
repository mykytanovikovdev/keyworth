import { useRouter, useRouterState } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import {
  Fragment,
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { answerClassName } from "../features/chat/answer-styles.ts";
import { STARTER_QUESTIONS, useFollow } from "../features/chat/follow.ts";
import { ChatLayout, EmptyChat } from "../features/chat/ChatLayout.tsx";
import { Composer } from "../features/chat/Composer.tsx";
import { DeleteAllChatsDialog } from "../features/chat/DeleteAllChatsDialog.tsx";
import {
  AnswerFailed,
  AssistantMessage,
  StoppedNote,
  type ToolStep,
  ToolSteps,
  UserMessage,
} from "../features/chat/Messages.tsx";
import { Section } from "../features/settings/Section.tsx";
import { Button, Notice, showToast, ThemeToggle } from "../ui/index.ts";
import { mockChats } from "./mock-chats.ts";
import { MockFrame } from "./MockFrame.tsx";

/*
 * Mockups of the phase 5 chat and the new app frame, for review before they
 * are wired up (dev and design builds only). Answers are made up and stream on
 * timers; nothing reaches a model. `?screen=<id>` opens one; `&bare` hides the
 * switcher, for screenshots.
 */

type Block =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

interface Reply {
  steps: ToolStep[];
  blocks: Block[];
}

interface Turn {
  question: string;
  reply: Reply;
}

const PORTFOLIO_STEP: ToolStep = {
  label: "Looked at your portfolio",
  running: "Looking at your portfolio",
  detail: "Shares and changes. Amounts stayed on this device.",
};

const MONTH: Turn = {
  question: "How did my portfolio do this month?",
  reply: {
    steps: [
      {
        ...PORTFOLIO_STEP,
        detail: "Shares and 30-day changes. Amounts stayed on this device.",
      },
      {
        label: "Calculated the month",
        running: "Calculating the month",
        detail: "Change, the largest drop, and how each coin moved.",
      },
    ],
    blocks: [
      {
        kind: "p",
        text: "Your portfolio is **up 4.2%** over the last 30 days. Most of the gain came from Bitcoin, your largest holding:",
      },
      {
        kind: "ul",
        items: [
          "**Bitcoin**, 58% of the portfolio: +6.8%",
          "**Ethereum**, 27%: +1.9%",
          "**Solana**, 15%: −3.4%",
        ],
      },
      {
        kind: "p",
        text: "The largest drop on the way was **−5.1%**, from October 3 to October 9, and it was made up by October 16.",
      },
    ],
  },
};

const IN_DOLLARS: Turn = {
  question: "And in dollars?",
  reply: {
    steps: [
      {
        label: "Looked at your portfolio, with amounts",
        running: "Looking at your portfolio",
        detail: "Amounts included, as you asked.",
      },
    ],
    blocks: [
      {
        kind: "p",
        text: "Your portfolio is worth **$48,210** now, **$1,946** more than 30 days ago. Bitcoin added $1,795 of that.",
      },
    ],
  },
};

const COMPARISON: Turn = {
  question: "Compare Bitcoin and Ethereum over the last 90 days",
  reply: {
    steps: [
      {
        label: "Looked up price history",
        running: "Looking up price history",
        detail:
          "Daily prices of Bitcoin and Ethereum for 90 days. Nothing about your portfolio.",
      },
      {
        label: "Compared the two",
        running: "Comparing the two",
        detail: "Change, volatility, the largest drop and correlation.",
      },
    ],
    blocks: [
      {
        kind: "p",
        text: "Over 90 days Bitcoin rose more than Ethereum and swung less:",
      },
      {
        kind: "table",
        head: ["", "Bitcoin", "Ethereum"],
        rows: [
          ["Change", "+12.4%", "+3.1%"],
          ["Volatility, annualized", "41%", "58%"],
          ["Largest drop", "−14.2%", "−22.7%"],
        ],
      },
      {
        kind: "p",
        text: "Their **correlation is 0.82**: on most days they moved in the same direction.",
      },
    ],
  },
};

const RUSSIAN: Turn = {
  question: "Как изменился портфель за неделю?",
  reply: {
    steps: [
      {
        ...PORTFOLIO_STEP,
        detail: "Shares and 7-day changes. Amounts stayed on this device.",
      },
    ],
    blocks: [
      {
        kind: "p",
        text: "За неделю портфель **вырос на 1,8%**. Больше всех прибавила Solana, а Ethereum немного снизился:",
      },
      {
        kind: "ul",
        items: [
          "**Bitcoin**: +1,1%",
          "**Ethereum**: −0,6%",
          "**Solana**: +7,2%",
        ],
      },
    ],
  },
};

const WEEK_MOVER: Turn = {
  question: "Which coin moved the most this week?",
  reply: {
    steps: [
      {
        ...PORTFOLIO_STEP,
        detail: "Shares and 7-day changes. Amounts stayed on this device.",
      },
      {
        label: "Checked today's prices",
        running: "Checking today's prices",
        detail: "Current prices of your 3 coins.",
      },
    ],
    blocks: [
      {
        kind: "p",
        text: "**Solana** moved the most: **+7.2%** this week, against +1.1% for Bitcoin and −0.6% for Ethereum.",
      },
      {
        kind: "p",
        text: "It also swung the most from day to day. Its largest move in one day was +4.9%, on Tuesday, and its largest fall −2.3%, on Thursday.",
      },
    ],
  },
};

const typedReply = (question: string): Turn => ({
  question,
  reply: {
    steps: [PORTFOLIO_STEP],
    blocks: [
      {
        kind: "p",
        text: "This is a mockup, so this answer is made up. In the app, your question goes to the AI with only the numbers it needs:",
      },
      {
        kind: "ul",
        items: [
          "the **shares and changes** of your coins,",
          "**prices** and their history,",
          "**amounts** only when you ask about them.",
        ],
      },
    ],
  },
});

const olderChat = (title: string): Turn => ({
  question: title,
  reply: {
    steps: [PORTFOLIO_STEP],
    blocks: [
      {
        kind: "p",
        text: "An older chat in the mockup: its answer would be here.",
      },
    ],
  },
});

// ---------------------------------------------------------------------------
// A made-up answer, revealed word by word as a stream would.

interface Word {
  text: string;
  bold: boolean;
}

function wordsOf(text: string): Word[] {
  const words: Word[] = [];
  for (const part of text.split(/(\*\*[^*]+\*\*)/)) {
    if (part === "") continue;
    const bold = part.startsWith("**") && part.endsWith("**");
    const inner = bold ? part.slice(2, -2) : part;
    for (const word of inner.split(/(?<=\s)/)) {
      if (word !== "") words.push({ text: word, bold });
    }
  }
  return words;
}

const sizeOf = (block: Block): number =>
  block.kind === "p"
    ? wordsOf(block.text).length
    : block.kind === "ul"
      ? block.items.reduce((sum, item) => sum + wordsOf(item).length, 0)
      : block.head.length + block.rows.flat().length;

const totalWords = (blocks: readonly Block[]) =>
  blocks.reduce((sum, block) => sum + sizeOf(block), 0);

function Words({
  text,
  shown,
  animate,
}: {
  text: string;
  shown: number;
  animate: boolean;
}) {
  return wordsOf(text)
    .slice(0, shown)
    .map((word, index) => {
      const content = animate ? (
        <span className="animate-word">{word.text}</span>
      ) : (
        word.text
      );
      return (
        // Words only append, so the index is a stable key.
        <Fragment key={index}>
          {word.bold ? <strong>{content}</strong> : content}
        </Fragment>
      );
    });
}

function Answer({
  blocks,
  shown,
  animate,
}: {
  blocks: readonly Block[];
  shown: number;
  animate: boolean;
}) {
  let left = shown;
  const out: ReactNode[] = [];
  for (const [index, block] of blocks.entries()) {
    if (left <= 0) break;
    if (block.kind === "p") {
      out.push(
        <p key={index}>
          <Words text={block.text} shown={left} animate={animate} />
        </p>,
      );
    } else if (block.kind === "ul") {
      // Words left for each item: what the items before it have not used.
      const lefts = block.items.map((_, item) =>
        block.items
          .slice(0, item)
          .reduce((rest, before) => rest - wordsOf(before).length, left),
      );
      out.push(
        <ul key={index}>
          {block.items.map((item, position) => {
            const words = lefts[position] ?? 0;
            return words <= 0 ? null : (
              <li key={item}>
                <Words text={item} shown={words} animate={animate} />
              </li>
            );
          })}
        </ul>,
      );
    } else {
      const rows = block.rows.filter(
        (_, row) => left >= block.head.length + (row + 1) * block.head.length,
      );
      out.push(
        // A wide table scrolls by itself, never the page.
        <div key={index} className="my-4 overflow-x-auto">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, column) => (
                  <th key={column} scope="col">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row[0]}
                  className={animate ? "animate-word" : undefined}
                >
                  {row.map((cell, column) => (
                    // As GFM makes a table: the first column is a plain cell.
                    <td key={column}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    }
    left -= sizeOf(block);
  }
  return <div className={answerClassName}>{out}</div>;
}

// ---------------------------------------------------------------------------
// A conversation that plays: steps on a timer, then the answer word by word.

type Ending = "done" | "stopped" | "failed";

interface Played {
  turn: Turn;
  /** Steps finished. */
  done: number;
  /** Words shown. */
  shown: number;
  ending: Ending | null;
}

const STEP_MS = 900;
const WORD_MS = 45;

const finished = (turn: Turn): Played => ({
  turn,
  done: turn.reply.steps.length,
  shown: totalWords(turn.reply.blocks),
  ending: "done",
});

function useConversation(start: Played[]) {
  const [turns, setTurns] = useState(start);
  const live = turns.at(-1);
  const playing = live?.ending === null;

  useEffect(() => {
    if (live?.ending !== null) return;
    const steps = live.turn.reply.steps.length;
    const words = totalWords(live.turn.reply.blocks);
    const timer = window.setTimeout(
      () => {
        setTurns((all) =>
          all.map((played, index) => {
            if (index !== all.length - 1) return played;
            if (played.done < steps)
              return { ...played, done: played.done + 1 };
            const shown = played.shown + 1;
            return { ...played, shown, ending: shown >= words ? "done" : null };
          }),
        );
      },
      live.done < steps ? STEP_MS : WORD_MS,
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [live]);

  const ask = (turn: Turn) => {
    setTurns((all) => [...all, { turn, done: 0, shown: 0, ending: null }]);
  };
  const end = (ending: Ending) => {
    setTurns((all) =>
      all.map((played, index) =>
        index === all.length - 1 ? { ...played, ending } : played,
      ),
    );
  };
  const retry = () => {
    setTurns((all) =>
      all.map((played, index) =>
        index === all.length - 1
          ? { ...played, done: 0, shown: 0, ending: null }
          : played,
      ),
    );
  };
  return { turns, playing, ask, end, retry };
}

/** Next midnight UTC, in the viewer's own time: when today's limit resets. */
const RESETS_AT = new Intl.DateTimeFormat("en-US", {
  timeStyle: "short",
}).format(new Date(new Date().setUTCHours(24, 0, 0, 0)));

function LimitNotice() {
  return (
    <Notice tone="info">
      The chat has reached today&apos;s limit. It&apos;s back at {RESETS_AT}.
    </Notice>
  );
}

function Conversation({
  start,
  limit = false,
}: {
  start: Played[];
  limit?: boolean;
}) {
  const { turns, playing, ask, end, retry } = useConversation(start);
  const { endRef, back } = useFollow(turns.length, playing);
  return (
    <ChatLayout
      onBack={back}
      footer={
        <>
          {limit && <LimitNotice />}
          <Composer
            answering={playing}
            isDisabled={limit}
            onSend={(question) => {
              ask(typedReply(question));
            }}
            onStop={() => {
              end("stopped");
            }}
          />
        </>
      }
    >
      {turns.map((played, index) => (
        <Fragment key={index}>
          <UserMessage>{played.turn.question}</UserMessage>
          <AssistantMessage>
            <ToolSteps steps={played.turn.reply.steps} done={played.done} />
            <Answer
              blocks={played.turn.reply.blocks}
              shown={played.shown}
              animate={played.ending === null}
            />
            {played.ending === "stopped" && <StoppedNote />}
            {played.ending === "failed" && (
              <AnswerFailed
                reason="The answer broke off: the connection was lost."
                onRetry={retry}
              />
            )}
          </AssistantMessage>
        </Fragment>
      ))}
      <div ref={endRef} />
    </ChatLayout>
  );
}

// ---------------------------------------------------------------------------
// Screens.

function NewChat({ limit = false }: { limit?: boolean }) {
  const [asked, setAsked] = useState<string | null>(null);
  if (asked !== null) {
    const turn =
      [MONTH, WEEK_MOVER, COMPARISON].find((t) => t.question === asked) ??
      typedReply(asked);
    return <Conversation start={[{ turn, done: 0, shown: 0, ending: null }]} />;
  }
  return (
    <EmptyChat
      suggestions={STARTER_QUESTIONS}
      onSend={setAsked}
      isDisabled={limit}
      {...(limit && { notice: <LimitNotice /> })}
    />
  );
}

const CHATS: Record<string, Played[]> = {
  c1: [finished(MONTH), finished(IN_DOLLARS)],
  c2: [finished(COMPARISON)],
  c3: [finished(RUSSIAN)],
};

function OpenChat({ id }: { id: string }) {
  const chats = useSyncExternalStore(mockChats.subscribe, mockChats.get);
  const chat = chats.find((entry) => entry.id === id);
  const start = CHATS[id] ?? [finished(olderChat(chat?.title ?? "A chat"))];
  return (
    <MockFrame section="chat" currentChatId={id} title={chat?.title}>
      <Conversation key={id} start={start} />
    </MockFrame>
  );
}

const cutAt = (turn: Turn, words: number, ending: Ending): Played => ({
  turn,
  done: turn.reply.steps.length,
  shown: words,
  ending,
});

function SettingsScreen({ confirm = false }: { confirm?: boolean }) {
  const chats = useSyncExternalStore(mockChats.subscribe, mockChats.get);
  const [open, setOpen] = useState(confirm);
  const count = chats.length;
  return (
    <MockFrame section="settings">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <Section title="Theme" description="Saved on this device.">
          <ThemeToggle showLabels />
        </Section>
        <Section
          title="Chats"
          description={
            count === 0
              ? "No chats yet."
              : `Encrypted on this device, like your transactions. ${count === 1 ? "1 chat" : `${String(count)} chats`}.`
          }
        >
          <Button
            icon={<Trash2 aria-hidden="true" />}
            isDisabled={count === 0}
            onPress={() => {
              setOpen(true);
            }}
          >
            Delete all chats
          </Button>
        </Section>
        <p className="text-sm text-fg-muted">
          The other settings (account, keys, currency) stay as they are.
        </p>
      </div>
      <DeleteAllChatsDialog
        isOpen={open}
        onOpenChange={setOpen}
        count={count}
        onDelete={() => {
          const before = mockChats.get();
          mockChats.set([]);
          setOpen(false);
          showToast(
            before.length === 1
              ? "Deleted 1 chat"
              : `Deleted ${String(before.length)} chats`,
            {
              action: {
                label: "Undo",
                onAction: () => {
                  mockChats.set(before);
                },
              },
            },
          );
        }}
      />
    </MockFrame>
  );
}

const SCREENS: { id: string; label: string; render: () => ReactNode }[] = [
  {
    id: "new",
    label: "1. New chat",
    render: () => (
      <MockFrame section="chat">
        <NewChat />
      </MockFrame>
    ),
  },
  { id: "c1", label: "2. An answer", render: () => <OpenChat id="c1" /> },
  { id: "c2", label: "3. A table", render: () => <OpenChat id="c2" /> },
  { id: "c3", label: "4. In Russian", render: () => <OpenChat id="c3" /> },
  {
    id: "streaming",
    label: "5. Answering (plays)",
    render: () => (
      <MockFrame section="chat" title={WEEK_MOVER.question}>
        <Conversation
          start={[{ turn: WEEK_MOVER, done: 0, shown: 0, ending: null }]}
        />
      </MockFrame>
    ),
  },
  {
    id: "stopped",
    label: "6. Stopped",
    render: () => (
      <MockFrame section="chat" title={WEEK_MOVER.question}>
        <Conversation start={[cutAt(WEEK_MOVER, 11, "stopped")]} />
      </MockFrame>
    ),
  },
  {
    id: "failed",
    label: "7. Broke off",
    render: () => (
      <MockFrame section="chat" title={WEEK_MOVER.question}>
        <Conversation start={[cutAt(WEEK_MOVER, 19, "failed")]} />
      </MockFrame>
    ),
  },
  {
    id: "limit",
    label: "8. Today's limit, new chat",
    render: () => (
      <MockFrame section="chat">
        <NewChat limit />
      </MockFrame>
    ),
  },
  {
    id: "limit-chat",
    label: "9. Today's limit, in a chat",
    render: () => (
      <MockFrame section="chat" currentChatId="c1" title={MONTH.question}>
        <Conversation start={CHATS.c1 ?? []} limit />
      </MockFrame>
    ),
  },
  {
    id: "first",
    label: "10. First visit",
    render: () => (
      <MockFrame section="chat" noChats>
        <NewChat />
      </MockFrame>
    ),
  },
  {
    id: "settings",
    label: "11. Settings",
    render: () => <SettingsScreen />,
  },
  {
    id: "settings-confirm",
    label: "12. Delete all chats?",
    render: () => <SettingsScreen confirm />,
  },
];

export default function ChatMockupsPage() {
  const router = useRouter();
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const params = new URLSearchParams(searchStr);
  const asked = params.get("screen") ?? "new";
  // A chat from the menu: ?screen=chat&id=c4.
  const chatId = asked === "chat" ? (params.get("id") ?? "c1") : null;
  const screen = SCREENS.find((entry) => entry.id === (chatId ?? asked));
  const key = `${asked}-${chatId ?? ""}`;
  return (
    <>
      <Fragment key={key}>
        {chatId !== null && !screen ? (
          <OpenChat id={chatId} />
        ) : (
          (screen ?? SCREENS[0])?.render()
        )}
      </Fragment>
      {!params.has("bare") && (
        <div className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-lg border border-line bg-raised p-2 shadow-raised max-lg:top-16 max-lg:bottom-auto">
          <label className="sr-only" htmlFor="mockup-screen">
            Screen
          </label>
          <select
            id="mockup-screen"
            value={screen?.id ?? ""}
            onChange={(event) => {
              void router.navigate({
                href: `/design/chat?screen=${event.target.value}`,
                replace: true,
              });
            }}
            className="h-8 max-w-48 rounded-md border border-line-strong bg-raised px-2 text-sm text-fg"
          >
            {screen === undefined && <option value="">A chat</option>}
            {SCREENS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
