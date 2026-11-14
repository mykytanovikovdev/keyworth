import type { ReactNode } from "react";
import { Button as AriaButton } from "react-aria-components";
import { ChatDisclaimer, Composer } from "./Composer.tsx";

/**
 * A conversation: messages in a reading column, the question box kept at the
 * bottom of the screen while the page scrolls, any notice right above it.
 */
export function ChatLayout({
  children,
  footer,
}: {
  children: ReactNode;
  /** The box, with a notice above it when there is one. */
  footer: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 pt-6 pb-8 sm:px-6">
        {children}
      </div>
      <div className="sticky bottom-0 bg-canvas pt-2 pb-3">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 sm:px-6">
          {footer}
          <ChatDisclaimer />
        </div>
      </div>
    </div>
  );
}

interface EmptyChatProps {
  onSend: (text: string) => void;
  suggestions: readonly string[];
  /** A notice above the box, such as today's limit. */
  notice?: ReactNode;
  isDisabled?: boolean;
}

/** A new chat: one question, what happens to the data, a few ideas to start. */
export function EmptyChat({
  onSend,
  suggestions,
  notice,
  isDisabled = false,
}: EmptyChatProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 pt-10 pb-[12vh] sm:px-6">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            What would you like to know?
          </h1>
          <p className="mx-auto max-w-md text-base text-fg-muted">
            Ask about your portfolio in any language. Amounts go to the AI only
            when you ask about them.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {notice}
          <Composer onSend={onSend} rows={2} isDisabled={isDisabled} />
          <ChatDisclaimer />
        </div>
        {!isDisabled && (
          <ul className="flex flex-wrap justify-center gap-2">
            {suggestions.map((suggestion) => (
              <li key={suggestion}>
                <AriaButton
                  onPress={() => {
                    onSend(suggestion);
                  }}
                  className="rounded-full border border-line px-3.5 py-1.5 text-sm text-fg-muted transition-colors duration-(--kw-duration-fast) data-hovered:bg-hover data-hovered:text-fg data-pressed:bg-hover"
                >
                  {suggestion}
                </AriaButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
