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

/** Where the menu's links go: the app's routes, or the mockups' pages. */
export interface AppLinks {
  portfolio: string;
  transactions: string;
  settings: string;
  newChat: string;
  chat: (id: string) => string;
}

interface AppFrameProps {
  section: AppSection;
  chats: readonly ChatSummary[];
  currentChatId?: string | undefined;
  onDeleteChat: (id: string) => void;
  links: AppLinks;
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
  chats,
  currentChatId,
  onDeleteChat,
  links,
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
    <AppMenu
      section={section}
      chats={chats}
      currentChatId={currentChatId}
      onDeleteChat={onDeleteChat}
      links={links}
      onClose={close}
    />
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
          {section === "chat" && <NewChatIcon href={links.newChat} />}
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
  chats: readonly ChatSummary[];
  currentChatId: string | undefined;
  onDeleteChat: (id: string) => void;
  links: AppLinks;
  /** In the phone panel: its close button. */
  onClose?: (() => void) | undefined;
}

function AppMenu({
  section,
  chats,
  currentChatId,
  onDeleteChat,
  links,
  onClose,
}: AppMenuProps) {
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
      <ButtonLink
        href={links.newChat}
        icon={<SquarePen aria-hidden="true" />}
        className="w-full"
      >
        New chat
      </ButtonLink>
      <ChatList
        chats={chats}
        currentId={currentChatId}
        hrefOf={links.chat}
        onDelete={onDeleteChat}
        className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pt-2"
      />
      <nav
        aria-label="Main"
        className="flex shrink-0 flex-col gap-0.5 border-t border-line pt-3"
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
function NewChatIcon({ href }: { href: string }) {
  return (
    <Tooltip content="New chat">
      <Link
        href={href}
        aria-label="New chat"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors duration-(--kw-duration-fast) data-hovered:bg-hover data-hovered:text-fg data-pressed:bg-hover"
      >
        <SquarePen />
      </Link>
    </Tooltip>
  );
}
