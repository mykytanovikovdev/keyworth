import type { ReactNode } from "react";
import { tokenize, useStreamedTokens } from "../hooks.ts";

export function UserMessage({ children }: { children: string }) {
  return (
    <div className="kw-enter flex justify-end">
      <p className="max-w-[85%] rounded-xl rounded-br-sm bg-bubble px-4 py-2.5 text-[15px] leading-6">
        {children}
      </p>
    </div>
  );
}

export function AssistantMessage({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>;
}

interface StreamedTextProps {
  text: string;
  /** Starts revealing when true. */
  active: boolean;
}

/** A streamed answer: words appear one by one and fade in. */
export function StreamedText({ text, active }: StreamedTextProps) {
  const tokens = tokenize(text);
  const visible = useStreamedTokens(tokens.length, active);
  return (
    <p className="text-[15px] leading-7" aria-busy={visible < tokens.length}>
      {tokens.slice(0, visible).map((token, index) => (
        // Tokens only ever append, never reorder, so the index is a stable key.
        <span key={index} className="kw-word">
          {token}
        </span>
      ))}
    </p>
  );
}
