import { RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import type { Screen, Theme, Variant } from "../types.ts";

interface Option<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <fieldset className="flex items-center gap-2">
      <legend className="sr-only">{label}</legend>
      <span aria-hidden="true" className="w-16 text-xs text-fg-muted">
        {label}
      </span>
      <div className="flex rounded-md bg-surface p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => {
              onChange(option.value);
            }}
            className={`rounded-[5px] px-2.5 py-1 text-xs transition-colors duration-150 ${option.value === value ? "bg-raised font-medium text-fg shadow-raised" : "text-fg-muted hover:text-fg"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

interface PrototypeToolbarProps {
  variant: Variant;
  theme: Theme;
  screen: Screen;
  onVariant: (value: Variant) => void;
  onTheme: (value: Theme) => void;
  onScreen: (value: Screen) => void;
  onReplay: () => void;
}

/** Prototype-only controls. Hidden in screenshots with `?chrome=0`. */
export function PrototypeToolbar(props: PrototypeToolbarProps) {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="fixed right-4 bottom-4 z-50 inline-flex items-center gap-2 rounded-full border border-line bg-raised px-3 py-2 text-xs font-medium shadow-raised"
      >
        <SlidersHorizontal size={14} strokeWidth={1.75} />
        Prototype
      </button>
    );
  }

  return (
    <aside
      aria-label="Prototype controls"
      className="fixed right-4 bottom-4 z-50 flex flex-col gap-2 rounded-lg border border-line bg-raised p-3 shadow-raised"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Prototype</span>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="Replay animations"
            title="Replay animations"
            onClick={props.onReplay}
            className="rounded-md p-1 text-fg-muted hover:bg-hover hover:text-fg"
          >
            <RotateCcw size={14} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label="Hide prototype controls"
            title="Hide"
            onClick={() => {
              setOpen(false);
            }}
            className="rounded-md p-1 text-fg-muted hover:bg-hover hover:text-fg"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <Segmented
        label="Variant"
        value={props.variant}
        options={[
          { value: "neutral", label: "Neutral" },
          { value: "warm", label: "Warm" },
        ]}
        onChange={props.onVariant}
      />
      <Segmented
        label="Theme"
        value={props.theme}
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
        onChange={props.onTheme}
      />
      <Segmented
        label="Screen"
        value={props.screen}
        options={[
          { value: "empty", label: "New" },
          { value: "chat", label: "Chat" },
          { value: "portfolio", label: "Portfolio" },
          { value: "unlock", label: "Unlock" },
        ]}
        onChange={props.onScreen}
      />
    </aside>
  );
}
