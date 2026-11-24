import { useChat } from "@ai-sdk/react";
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { getToolName, isTextUIPart, isToolUIPart } from "ai";
import {
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ChatToolName } from "../../../shared/schemas/chat-tools.ts";
import { Button, Notice } from "../../ui/index.ts";
import { sessionQuery } from "../auth/client.ts";
import { Answer } from "./Answer.tsx";
import { loadChatData } from "./chat-data.ts";
import { openChat, type OpenedChat } from "./chat-saver.ts";
import { chatSession } from "./chat-session.ts";
import type { ChatEntry } from "./chats.ts";
import { ChatLayout, EmptyChat } from "./ChatLayout.tsx";
import { Composer } from "./Composer.tsx";
import {
  type ChatUIMessage,
  type Conversation as OpenConversation,
  currentConversation,
  startConversation,
} from "./conversation.ts";
import { STARTER_QUESTIONS, useFollow } from "./follow.ts";
import {
  AnswerFailed,
  AssistantMessage,
  StoppedNote,
  type ToolStep,
  ToolSteps,
  UserMessage,
} from "./Messages.tsx";
import { access, chatsQuery, putChat } from "./queries.ts";
import { type Failure, failureOf, failureWords } from "./refusals.ts";
import { stepWords } from "./step-words.ts";

/*
 * /chat, a new chat, and /chat/<id>, a kept one: one conversation at a time.
 * The questions, the steps the assistant took and its answers, streamed in; the
 * box at the bottom. Kept encrypted after each question and answer.
 */

const FINISHED = new Set(["output-available", "output-error", "output-denied"]);

/** What an answer did, as the steps line shows it. */
function stepsOf(message: ChatUIMessage): { steps: ToolStep[]; done: number } {
  const calls = message.parts.filter(isToolUIPart);
  return {
    steps: calls.map((part) =>
      stepWords(
        getToolName(part) as ChatToolName,
        part.input as Partial<Record<string, unknown>> | undefined,
      ),
    ),
    done: calls.filter((part) => FINISHED.has(part.state)).length,
  };
}

const textOf = (message: ChatUIMessage) =>
  message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join("\n\n");

/** Today's limit was reached, until it resets at midnight UTC. */
function useLimited(failure: Failure | null): boolean {
  const resetsAt =
    failure?.kind === "budget" ? failure.resetsAt.getTime() : null;
  const [reopened, setReopened] = useState<number | null>(null);
  useEffect(() => {
    if (resetsAt === null) return;
    const timer = setTimeout(
      () => {
        setReopened(resetsAt);
      },
      Math.max(0, resetsAt - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [resetsAt]);
  return resetsAt !== null && reopened !== resetsAt;
}

interface ChatPageProps {
  /** The kept chat the address names. */
  chatId?: string | undefined;
}

export function ChatPage({ chatId }: ChatPageProps) {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const userId = session?.user.id ?? "";
  const generation = useSyncExternalStore(
    chatSession.subscribe,
    chatSession.generation,
  );
  // A new start is a new conversation, with nothing left of the last one.
  return <Chat key={generation} userId={userId} chatId={chatId} />;
}

function Chat({
  userId,
  chatId,
}: {
  userId: string;
  chatId?: string | undefined;
}) {
  const client = useQueryClient();
  const conversation = useMemo(() => {
    const open = currentConversation(userId, chatId);
    if (open || chatId !== undefined) return open;
    return startConversation({
      userId,
      access,
      load: () => loadChatData(client, userId),
      onSaved: (chat) => {
        putChat(client, userId, chat);
      },
    });
  }, [client, userId, chatId]);

  if (conversation) {
    return <Conversation key={conversation.key} conversation={conversation} />;
  }
  return chatId === undefined ? null : (
    <KeptChat key={chatId} userId={userId} chatId={chatId} />
  );
}

/** A centered line of text in an empty chat's place. */
function Message({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 pb-[12vh] text-center">
      {children}
    </div>
  );
}

/** Reads a kept chat's messages, then opens it. */
function KeptChat({ userId, chatId }: { userId: string; chatId: string }) {
  const list = useQuery(chatsQuery(userId));
  const entry = list.data?.chats.find(({ id }) => id === chatId);
  const body = useQuery({
    queryKey: ["vault", userId, "chat", chatId],
    queryFn: () => (entry ? openChat(access, entry) : null),
    enabled: entry !== undefined,
    // Read again whenever it is opened: another device may have gone on with it.
    staleTime: 0,
    gcTime: 0,
  });

  if (entry && body.data) {
    return <LoadedChat userId={userId} entry={entry} opened={body.data} />;
  }
  if (list.isError || body.isError) {
    return (
      <Message>
        <p>Couldn't open this chat. Check your connection.</p>
        <Button
          onPress={() => {
            void list.refetch();
            void body.refetch();
          }}
        >
          Try again
        </Button>
      </Message>
    );
  }
  if (list.isPending || (entry && body.isPending)) {
    return (
      <Message>
        <p role="status" className="text-fg-muted">
          Opening your chat…
        </p>
      </Message>
    );
  }
  return (
    <Message>
      <p>
        {list.data.damaged.includes(chatId) || entry
          ? "This chat can't be opened: its data is damaged. You can delete it from the menu."
          : "This chat isn't here: it was deleted, or belongs to another account."}
      </p>
    </Message>
  );
}

/** A kept chat, opened once: from here on it keeps its own messages. */
function LoadedChat({
  userId,
  entry,
  opened,
}: {
  userId: string;
  entry: ChatEntry;
  opened: OpenedChat;
}) {
  const client = useQueryClient();
  const [conversation] = useState(
    () =>
      currentConversation(userId, entry.id) ??
      startConversation({
        userId,
        access,
        load: () => loadChatData(client, userId),
        onSaved: (chat) => {
          putChat(client, userId, chat);
        },
        opened: {
          entry,
          bodyRevision: opened.revision,
          messages: opened.messages,
        },
      }),
  );
  return <Conversation key={conversation.key} conversation={conversation} />;
}

const TROUBLE = {
  failed:
    "This chat isn't saved yet. It will be saved with your next question.",
  full: "This chat is full. Start a new chat to ask more.",
  gone: "This chat was deleted on another device. Start a new chat to ask more.",
} as const;

function Conversation({ conversation }: { conversation: OpenConversation }) {
  const { chat, stopped } = conversation;
  const { messages, status, error, regenerate } = useChat({ chat });
  const { chatId, trouble } = useSyncExternalStore(
    conversation.subscribe,
    conversation.saveView,
  );
  const navigate = useNavigate();
  const endRef = useFollow(messages);

  // A new chat gets its own address once it is kept; the question stays where
  // it is.
  useEffect(() => {
    if (chatId === null || conversation.isPlaced()) return;
    conversation.place();
    void navigate({
      to: "/chat/{-$chatId}",
      params: { chatId },
      replace: true,
    });
  }, [chatId, conversation, navigate]);

  const answering = status === "submitted" || status === "streaming";
  const failure: Failure | null = error ? failureOf(error.message) : null;
  const limited = useLimited(failure);
  const limitNotice = limited && failure && (
    <Notice tone="info">{failureWords(failure)}</Notice>
  );
  const troubleNotice = trouble && (
    <Notice tone={trouble === "failed" ? "warning" : "info"}>
      {TROUBLE[trouble]}
    </Notice>
  );
  const isOver = trouble === "full" || trouble === "gone";
  const ask = conversation.ask;

  if (messages.length === 0) {
    return (
      <EmptyChat
        suggestions={STARTER_QUESTIONS}
        onSend={ask}
        isDisabled={limited}
        {...(limitNotice && { notice: limitNotice })}
      />
    );
  }

  const last = messages.at(-1);
  // A question left without any answer: stopped or refused before one began.
  const unanswered = last?.role === "user" ? last : null;
  const failedWords =
    failure && !limited && failure.kind !== "budget"
      ? failureWords(failure)
      : null;

  return (
    <ChatLayout
      footer={
        <>
          {limitNotice}
          {troubleNotice}
          <Composer
            answering={answering}
            isDisabled={limited || isOver}
            onSend={ask}
            onStop={conversation.stop}
          />
        </>
      }
    >
      <h1 className="sr-only">Chat</h1>
      {messages.map((message, index) => {
        const isLast = index === messages.length - 1;
        if (message.role === "user") {
          return (
            <Fragment key={message.id}>
              <UserMessage>{textOf(message)}</UserMessage>
              {message === unanswered &&
                !answering &&
                (stopped.has(message.id) || failedWords) && (
                  <AssistantMessage>
                    {stopped.has(message.id) ? (
                      <StoppedNote />
                    ) : (
                      failedWords && (
                        <AnswerFailed
                          reason={failedWords}
                          onRetry={() => void regenerate()}
                        />
                      )
                    )}
                  </AssistantMessage>
                )}
            </Fragment>
          );
        }
        const { steps, done } = stepsOf(message);
        const text = textOf(message);
        return (
          <AssistantMessage key={message.id}>
            {steps.length > 0 && <ToolSteps steps={steps} done={done} />}
            {text && <Answer text={text} streaming={isLast && answering} />}
            {stopped.has(message.id) && !(isLast && answering) && (
              <StoppedNote />
            )}
            {isLast && failedWords && !stopped.has(message.id) && (
              <AnswerFailed
                reason={failedWords}
                onRetry={() => void regenerate()}
              />
            )}
          </AssistantMessage>
        );
      })}
      <div ref={endRef} />
    </ChatLayout>
  );
}
