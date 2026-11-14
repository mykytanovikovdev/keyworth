import { Trash2 } from "lucide-react";
import { Link } from "react-aria-components";
import { ActionMenu } from "../../ui/index.ts";
import { type ChatSummary, groupChats } from "./chat-list.ts";

interface ChatListProps {
  chats: readonly ChatSummary[];
  currentId?: string | undefined;
  hrefOf: (id: string) => string;
  onDelete: (id: string) => void;
  /** Layout only. */
  className?: string;
}

const ACTIONS = [
  { id: "delete", label: "Delete chat", icon: <Trash2 aria-hidden="true" /> },
];

/**
 * The user's chats in the menu, newest first, grouped by day. Each has a "⋯"
 * menu with Delete: shown on hover or focus with a mouse, always on touch
 * screens, where nothing hovers.
 */
export function ChatList({
  chats,
  currentId,
  hrefOf,
  onDelete,
  className = "",
}: ChatListProps) {
  const groups = groupChats(chats);
  return (
    <nav aria-label="Chats" className={className}>
      {groups.length === 0 && (
        <p className="px-2 text-sm text-fg-muted">
          Your chats will appear here.
        </p>
      )}
      {groups.map((group) => (
        <section key={group.label} className="mb-4 last:mb-0">
          <h2 className="px-2 pb-1 text-xs font-medium text-fg-muted">
            {group.label}
          </h2>
          <ul className="flex flex-col gap-0.5">
            {group.chats.map((chat) => {
              const current = chat.id === currentId;
              return (
                <li key={chat.id} className="group relative">
                  <Link
                    href={hrefOf(chat.id)}
                    {...(current && { "aria-current": "page" as const })}
                    className={`flex h-9 items-center rounded-md pr-10 pl-2 text-sm transition-colors duration-(--kw-duration-fast) ${
                      current
                        ? "bg-hover font-medium text-fg"
                        : "text-fg data-hovered:bg-hover"
                    }`}
                  >
                    <span className="truncate">{chat.title}</span>
                  </Link>
                  <div
                    className={`absolute top-0 right-0 transition-opacity duration-(--kw-duration-fast) group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100 ${
                      current ? "opacity-100" : "opacity-0"
                    }`}
                  >
                    <ActionMenu
                      label={`Actions for the chat “${chat.title}”`}
                      actions={ACTIONS}
                      onAction={() => {
                        onDelete(chat.id);
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
