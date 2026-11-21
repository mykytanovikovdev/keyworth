import { useChat } from "@ai-sdk/react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { getToolName, isTextUIPart, isToolUIPart } from "ai";
import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ChatToolName } from "../../../shared/schemas/chat-tools.ts";
import { Notice } from "../../ui/index.ts";
import { sessionQuery } from "../auth/client.ts";
import { loadChatData } from "./chat-data.ts";
import { chatSession } from "./chat-session.ts";
import { ChatLayout, EmptyChat } from "./ChatLayout.tsx";
import { Composer } from "./Composer.tsx";
import { type ChatUIMessage, conversation } from "./conversation.ts";
import { STARTER_QUESTIONS, useFollow } from "./follow.ts";
import {
  AnswerFailed,
  AssistantMessage,
  StoppedNote,
  type ToolStep,
  ToolSteps,
  UserMessage,
} from "./Messages.tsx";
import { Answer } from "./Answer.tsx";
import { type Failure, failureOf, failureWords } from "./refusals.ts";
import { stepWords } from "./step-words.ts";

/*
 * /chat: one conversation at a time, kept while the tab is open (New chat or
 * locking starts a new one). The questions, the steps the assistant took and
 * its answers, streamed in; the box at the bottom.
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

export function ChatPage() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const userId = session?.user.id ?? "";
  const generation = useSyncExternalStore(
    chatSession.subscribe,
    chatSession.generation,
  );
  // A new start is a new conversation, with nothing left of the last one.
  return <Conversation key={generation} userId={userId} />;
}

function Conversation({ userId }: { userId: string }) {
  const client = useQueryClient();
  const chat = useMemo(
    () => conversation(userId, () => loadChatData(client, userId)),
    [client, userId],
  );
  const { messages, sendMessage, status, stop, error, regenerate } = useChat({
    chat,
  });
  // The messages after which the person pressed Stop.
  const [stoppedAfter, setStoppedAfter] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const endRef = useFollow(messages);

  const answering = status === "submitted" || status === "streaming";
  const failure: Failure | null = error ? failureOf(error.message) : null;
  const limited = useLimited(failure);
  const limitNotice = limited && failure && (
    <Notice tone="info">{failureWords(failure)}</Notice>
  );

  const ask = (text: string) => {
    void sendMessage({ text });
  };

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
          <Composer
            answering={answering}
            isDisabled={limited}
            onSend={ask}
            onStop={() => {
              const id = messages.at(-1)?.id;
              if (id) setStoppedAfter((before) => new Set(before).add(id));
              void stop();
            }}
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
                (stoppedAfter.has(message.id) || failedWords) && (
                  <AssistantMessage>
                    {stoppedAfter.has(message.id) ? (
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
            {text && <Answer text={text} />}
            {stoppedAfter.has(message.id) && <StoppedNote />}
            {isLast && failedWords && !stoppedAfter.has(message.id) && (
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
