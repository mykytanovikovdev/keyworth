interface SkeletonProps {
  /** Size and shape, e.g. "h-4 w-32" or "size-8 rounded-full". */
  className?: string;
}

/**
 * A placeholder for content that is loading. Hidden from screen readers: mark
 * the loading region itself with aria-busy and a text status instead.
 */
export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-md bg-hover motion-safe:animate-pulse ${className}`}
    />
  );
}
