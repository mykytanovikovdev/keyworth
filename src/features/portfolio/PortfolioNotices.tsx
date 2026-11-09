import { Button, Notice } from "../../ui/index.ts";

interface PortfolioNoticesProps {
  /** Transactions that cannot be decrypted or read. */
  damaged: number;
  /** Symbols of held coins that have no price right now. */
  unpriced: readonly string[];
  /** Today's prices failed altogether. */
  pricesFailed: boolean;
  onRetry?: () => void;
  /** Some sale moved more than was held at the time. */
  oversold: boolean;
}

const list = (items: readonly string[]) =>
  items.length <= 2
    ? items.join(" and ")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;

/** What the figures leave out, said once, above them. */
export function PortfolioNotices({
  damaged,
  unpriced,
  pricesFailed,
  onRetry,
  oversold,
}: PortfolioNoticesProps) {
  return (
    <>
      {pricesFailed ? (
        <Notice tone="warning">
          <span className="flex flex-wrap items-center gap-x-2">
            Prices couldn&apos;t load, so values and gains are missing.
            <Button
              variant="ghost"
              size="sm"
              className="-my-1 h-6 px-1.5 text-warning"
              {...(onRetry && { onPress: onRetry })}
            >
              Try again
            </Button>
          </span>
        </Notice>
      ) : (
        unpriced.length > 0 && (
          <Notice tone="info">
            No price for {list(unpriced)} right now, so the total, the chart and
            the figures leave {unpriced.length === 1 ? "it" : "them"} out.
          </Notice>
        )
      )}
      {damaged > 0 && (
        <Notice tone="warning">
          {damaged === 1
            ? "1 transaction can't be read and is left out of every figure. You can delete it on the Transactions page."
            : `${String(damaged)} transactions can't be read and are left out of every figure. You can delete them on the Transactions page.`}
        </Notice>
      )}
      {oversold && (
        <Notice tone="info">
          A sale moved more than you held at the time; only what you held is
          counted. Check it on the Transactions page.
        </Notice>
      )}
    </>
  );
}
