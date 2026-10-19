// Placeholder mark: a keyhole. The real logo is out of scope for the prototype.
export function KeyworthMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true">
      <rect width="28" height="28" rx="8" className="fill-accent" />
      <circle cx="14" cy="11.5" r="3.5" className="fill-on-accent" />
      <path d="M12.4 13.5h3.2l1 7.5h-5.2z" className="fill-on-accent" />
    </svg>
  );
}
