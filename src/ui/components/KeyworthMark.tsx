interface KeyworthMarkProps {
  /** Size, e.g. "size-7" (the default) or "size-10". */
  className?: string;
  /** Motion for the keyhole alone, which turns like a lock (the key screens). */
  keyholeClassName?: string;
}

/** The app's mark: a keyhole on the accent. Decorative; pair it with the name. */
export function KeyworthMark({
  className = "size-7",
  keyholeClassName = "",
}: KeyworthMarkProps) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true">
      <rect width="28" height="28" rx="8" className="fill-accent" />
      <g className={`fill-on-accent ${keyholeClassName}`}>
        <circle cx="14" cy="11.5" r="3.5" />
        <path d="M12.4 13.5h3.2l1 7.5h-5.2z" />
      </g>
    </svg>
  );
}
