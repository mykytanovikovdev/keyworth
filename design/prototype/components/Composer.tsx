import { ArrowUp, Square } from "lucide-react";

interface ComposerProps {
  layout: "centered" | "docked";
  streaming?: boolean;
}

export function Composer({ layout, streaming = false }: ComposerProps) {
  const tall = layout === "centered";
  return (
    <form
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <div className="flex items-end gap-2 rounded-xl border border-line bg-raised p-2 pl-4 shadow-raised transition-[border-color,box-shadow] duration-150 focus-within:border-line-strong">
        <label htmlFor={`composer-${layout}`} className="sr-only">
          Message
        </label>
        <textarea
          id={`composer-${layout}`}
          rows={tall ? 2 : 1}
          placeholder="Ask about your portfolio"
          className="max-h-48 min-h-10 flex-1 resize-none bg-transparent py-2 text-[15px] leading-6 text-fg outline-none placeholder:text-fg-muted"
        />
        {streaming ? (
          <button
            type="button"
            aria-label="Stop the answer"
            title="Stop"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line-strong text-fg transition-colors duration-150 hover:bg-hover"
          >
            <Square size={14} strokeWidth={2} className="fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Send"
            title="Send"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent transition-colors duration-150 hover:bg-accent/90"
          >
            <ArrowUp size={18} strokeWidth={2} />
          </button>
        )}
      </div>
      {layout === "docked" && (
        <p className="mt-2 text-center text-xs text-fg-muted">
          Keyworth explains your data. Not investment advice.
        </p>
      )}
    </form>
  );
}
