import { useRouterState } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  Menu,
  Settings,
  SquarePen,
  Wallet,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-aria-components";
import type { ChatSummary } from "../features/chat/chat-list.ts";
import { ChatList } from "../features/chat/ChatList.tsx";
import {
  ButtonLink,
  Drawer,
  IconButton,
  KeyworthMark,
  Tooltip,
} from "../ui/index.ts";

export type AppSection = "chat" | "portfolio" | "transactions" | "settings";

/** Where the menu's sections go: the app's routes, or the mockups' pages. */
export interface AppLinks {
  portfolio: string;
  transactions: string;
  settings: string;
}

/** The menu's chat part: New chat and the list of kept chats. */
export interface FrameChats {
  newChat: string;
  /** Runs as New chat is followed: the conversation starts over. */
  onNewChat?: (() => void) | undefined;
  /** Absent while it loads. */
  list?:
    | {
        chats: readonly ChatSummary[];
        currentId?: string | undefined;
        onDelete: (id: string) => void;
        hrefOf: (id: string) => string;
      }
    | undefined;
}

interface AppFrameProps {
  section: AppSection;
  links: AppLinks;
  /** Absent until the app has a chat: the menu then holds the sections only. */
  chat?: FrameChats | undefined;
  /** The phone bar's title: the open chat's; the app's name when absent. */
  title?: string | undefined;
  children: ReactNode;
}

/**
 * The frame around every signed-in page: the menu in a column on the left on
 * wide screens, behind a button in a one-line bar on narrower ones. The menu
 * holds New chat, the chats and the app's sections; the theme is in Settings.
 */
export function AppFrame({
  section,
  links,
  chat,
  title,
  children,
}: AppFrameProps) {
  const href = useRouterState({ select: (s) => s.location.href });
  // Open on the page it was opened on: any navigation, from the menu or not,
  // closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const menuOpen = openOn === href;
  const setMenuOpen = (open: boolean) => {
    setOpenOn(open ? href : null);
  };

  const menu = (close?: () => void) => (
    <AppMenu section={section} links={links} chat={chat} onClose={close} />
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-68 shrink-0 border-r border-line bg-surface lg:block">
        {menu()}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-line bg-canvas px-2 lg:hidden">
          <IconButton
            label="Open menu"
            tooltip={false}
            onPress={() => {
              setMenuOpen(true);
            }}
          >
            <Menu />
          </IconButton>
          <p className="flex min-w-0 flex-1 items-center gap-2 px-1 text-sm font-medium">
            {title === undefined ? (
              <>
                <KeyworthMark />
                <span>Keyworth</span>
              </>
            ) : (
              <span className="truncate">{title}</span>
            )}
          </p>
          {section === "chat" && chat && (
            <NewChatIcon href={chat.newChat} onPress={chat.onNewChat} />
          )}
        </header>
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
      <Drawer label="Menu" isOpen={menuOpen} onOpenChange={setMenuOpen}>
        {(close) => menu(close)}
      </Drawer>
    </div>
  );
}

interface AppMenuProps {
  section: AppSection;
  links: AppLinks;
  chat: FrameChats | undefined;
  /** In the phone panel: its close button. */
  onClose?: (() => void) | undefined;
}

function AppMenu({ section, links, chat, onClose }: AppMenuProps) {
  const sections = [
    {
      href: links.portfolio,
      label: "Portfolio",
      icon: <Wallet aria-hidden="true" />,
      current: section === "portfolio",
    },
    {
      href: links.transactions,
      label: "Transactions",
      icon: <ArrowLeftRight aria-hidden="true" />,
      current: section === "transactions",
    },
    {
      href: links.settings,
      label: "Settings",
      icon: <Settings aria-hidden="true" />,
      current: section === "settings",
    },
  ];
  return (
    <div className="flex h-full flex-col gap-3 px-3 pb-3">
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 pl-1">
        {/* Through the router: a page reload would lock the data. */}
        <Link
          href={links.portfolio}
          className="flex items-center gap-2 rounded-md text-sm font-semibold"
        >
          <KeyworthMark />
          Keyworth
        </Link>
        {onClose && (
          <IconButton label="Close menu" tooltip={false} onPress={onClose}>
            <X />
          </IconButton>
        )}
      </div>
      {chat && (
        <>
          <ButtonLink
            href={chat.newChat}
            icon={<SquarePen aria-hidden="true" />}
            className="w-full"
            {...(chat.onNewChat && { onPress: chat.onNewChat })}
          >
            New chat
          </ButtonLink>
          {chat.list ? (
            <ChatList
              chats={chat.list.chats}
              currentId={chat.list.currentId}
              hrefOf={chat.list.hrefOf}
              onDelete={chat.list.onDelete}
              className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pt-2"
            />
          ) : (
            // The sections stay at the bottom, where the list would end.
            <div className="flex-1" />
          )}
        </>
      )}
      {/* Under the chats, set apart; with no chats, right under the name. */}
      <nav
        aria-label="Main"
        className={`flex shrink-0 flex-col gap-0.5 ${chat ? "border-t border-line pt-3" : ""}`}
      >
        {sections.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            {...(item.current && { "aria-current": "page" as const })}
            className={`flex h-9 items-center gap-2.5 rounded-md px-2 text-sm transition-colors duration-(--kw-duration-fast) ${
              item.current
                ? "bg-hover font-medium text-fg"
                : "text-fg-muted data-hovered:bg-hover data-hovered:text-fg"
            }`}
          >
            {item.icon}
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** "New chat" as an icon in the phone bar, while a chat is open. */
function NewChatIcon({
  href,
  onPress,
}: {
  href: string;
  onPress?: (() => void) | undefined;
}) {
  return (
    <Tooltip content="New chat">
      <Link
        href={href}
        {...(onPress && { onPress })}
        aria-label="New chat"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors duration-(--kw-duration-fast) data-hovered:bg-hover data-hovered:text-fg data-pressed:bg-hover"
      >
        <SquarePen />
      </Link>
    </Tooltip>
  );
}
