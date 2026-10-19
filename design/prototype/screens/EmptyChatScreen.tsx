import { useLayoutEffect, useRef } from "react";
import { Composer } from "../components/Composer.tsx";
import { suggestions } from "../data.ts";
import { revealInSequence } from "../motion.ts";

/** A new conversation: one question, a few starting points. */
export function EmptyChatScreen() {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const parts = Array.from(
      rootRef.current?.querySelectorAll("[data-reveal]") ?? [],
    );
    return revealInSequence(parts);
  }, []);

  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-[12vh]">
      <div ref={rootRef} className="w-full max-w-2xl">
        <h2
          data-reveal
          className="text-center text-2xl font-semibold tracking-tight md:text-[28px]"
        >
          What would you like to know?
        </h2>
        <p
          data-reveal
          className="mx-auto mt-2 max-w-md text-center text-fg-muted"
        >
          Answers use your portfolio data. Amounts stay on this device unless
          you ask about them.
        </p>
        <div data-reveal className="mt-8">
          <Composer layout="centered" />
        </div>
        <ul className="mt-4 flex flex-wrap justify-center gap-2">
          {suggestions.map((suggestion) => (
            <li key={suggestion} data-reveal>
              <button
                type="button"
                className="rounded-full border border-line px-3.5 py-1.5 text-sm text-fg-muted transition-colors duration-150 hover:bg-hover hover:text-fg"
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
