import { Link } from "react-aria-components";

export interface NavItem {
  href: string;
  label: string;
  current: boolean;
}

/**
 * The app's sections, in the header: inline next to the mark on wide screens,
 * a full-width row under it on phones. Links go through the router: a page
 * reload would lock the data.
 */
export function AppNav({ items }: { items: readonly NavItem[] }) {
  return (
    <nav
      aria-label="Main"
      className="order-last -mx-1 flex w-[calc(100%+0.5rem)] gap-1 pb-2 sm:order-none sm:mx-0 sm:w-auto sm:pb-0"
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          {...(item.current && { "aria-current": "page" as const })}
          className={`inline-flex h-8 flex-1 items-center justify-center rounded-md px-3 text-sm whitespace-nowrap transition-colors duration-(--kw-duration-fast) sm:flex-none ${
            item.current
              ? "bg-surface font-medium text-fg"
              : "text-fg-muted data-hovered:bg-hover data-hovered:text-fg"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
