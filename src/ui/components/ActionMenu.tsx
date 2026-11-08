import { Ellipsis } from "lucide-react";
import type { ReactNode } from "react";
import { Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { IconButton } from "./Button.tsx";

export interface MenuAction {
  id: string;
  label: string;
  icon?: ReactNode;
}

interface ActionMenuProps {
  /** The button's accessible name: "Actions for Buy 0.5 BTC on Dec 20". */
  label: string;
  actions: readonly MenuAction[];
  onAction?: (id: string) => void;
  /** Layout only (margins, position). */
  className?: string;
}

/** A "⋯" button with a short menu of actions for one item, such as a row. */
export function ActionMenu({
  label,
  actions,
  onAction,
  className = "",
}: ActionMenuProps) {
  return (
    <MenuTrigger>
      <IconButton label={label} tooltip={false} className={className}>
        <Ellipsis />
      </IconButton>
      <Popover
        placement="bottom end"
        className="min-w-36 rounded-md border border-line bg-raised p-1 shadow-raised data-entering:animate-fade-in data-exiting:animate-fade-out"
      >
        <Menu
          aria-label={label}
          items={actions}
          onAction={(key) => {
            if (typeof key === "string") onAction?.(key);
          }}
          className="outline-none"
        >
          {(action) => (
            <MenuItem
              id={action.id}
              textValue={action.label}
              className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-fg outline-none data-focused:bg-hover [&_svg]:text-fg-muted"
            >
              {action.icon}
              {action.label}
            </MenuItem>
          )}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
