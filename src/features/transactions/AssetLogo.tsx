import { useState } from "react";

interface AssetLogoProps {
  assetId: string;
  symbol: string;
  /** `md` (32px) for rows, `sm` (24px) inside fields and menus. */
  size?: "sm" | "md";
  /** False shows the symbol only: mockups, and coins without a logo. */
  useImage?: boolean;
}

/**
 * A coin's logo, through Keyworth's server (the page may load images from its
 * own origin only), or its symbol in a circle when there is none. Decorative:
 * the name is always written next to it.
 */
export function AssetLogo({
  assetId,
  symbol,
  size = "md",
  useImage = true,
}: AssetLogoProps) {
  const [failed, setFailed] = useState(false);
  const box = size === "sm" ? "size-6" : "size-8";
  if (useImage && !failed) {
    return (
      <img
        src={`/api/assets/${encodeURIComponent(assetId)}/logo`}
        alt=""
        loading="lazy"
        onError={() => {
          setFailed(true);
        }}
        className={`${box} shrink-0 rounded-full`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${box} inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-surface text-2xs font-medium tracking-tight text-fg-muted`}
    >
      {symbol.slice(0, size === "sm" ? 3 : 4)}
    </span>
  );
}
