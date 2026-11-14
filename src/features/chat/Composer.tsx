import { ArrowUp, Square } from "lucide-react";
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { Label, TextArea, TextField } from "react-aria-components";
import { IconButton } from "../../ui/index.ts";

/** A question's limit: long enough for a pasted list of trades. */
const MAX_QUESTION_LENGTH = 2000;

interface ComposerProps {
  onSend: (text: string) => void;
  /** While an answer streams: Send becomes Stop. */
  onStop?: () => void;
  answering?: boolean;
  /** Nothing can be asked now, such as when today's limit is reached. */
  isDisabled?: boolean;
  /** Two lines in an empty chat, one under a conversation. */
  rows?: 1 | 2;
  /** Layout only. */
  className?: string;
}

/**
 * Where a question is typed. Enter sends, Shift+Enter starts a new line, and
 * the box grows with the text up to a limit, then scrolls. While an answer
 * streams, the button stops it instead.
 */
export function Composer({
  onSend,
  onStop,
  answering = false,
  isDisabled = false,
  rows = 1,
  className = "",
}: ComposerProps) {
  const [text, setText] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const question = text.trim();
  const canSend = !answering && !isDisabled && question !== "";

  // Grow with the text: CSSOM, which the CSP allows (no style attribute).
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${String(area.scrollHeight)}px`;
  }, [text]);

  const send = () => {
    if (!canSend) return;
    onSend(question);
    setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Not while an input method composes a word (Japanese, Chinese).
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    send();
  };

  return (
    <div
      className={`flex items-end gap-2 rounded-xl border border-line-strong bg-raised p-2 pl-4 shadow-raised transition-colors duration-(--kw-duration-fast) has-[textarea:focus-visible]:border-focus has-[textarea:focus-visible]:ring-1 has-[textarea:focus-visible]:ring-focus ${
        isDisabled ? "opacity-60" : ""
      } ${className}`}
    >
      <TextField
        value={text}
        onChange={setText}
        maxLength={MAX_QUESTION_LENGTH}
        isDisabled={isDisabled}
        className="min-w-0 flex-1"
      >
        <Label className="sr-only">Question</Label>
        <TextArea
          ref={areaRef}
          rows={rows}
          placeholder="Ask about your portfolio"
          onKeyDown={onKeyDown}
          className="block max-h-48 w-full resize-none bg-transparent py-1.5 text-md text-fg outline-none placeholder:text-fg-muted data-disabled:cursor-not-allowed"
        />
      </TextField>
      {answering ? (
        <IconButton label="Stop answering" {...(onStop && { onPress: onStop })}>
          <Square className="fill-current" />
        </IconButton>
      ) : (
        <IconButton
          label="Send"
          variant="primary"
          isDisabled={!canSend}
          onPress={send}
        >
          <ArrowUp />
        </IconButton>
      )}
    </div>
  );
}

/** Under the box: who answers (EU AI Act, art. 50(1)) and what it is not. */
export function ChatDisclaimer() {
  return (
    <p className="text-center text-xs text-fg-muted">
      AI answers can be wrong. Not investment advice.
    </p>
  );
}
