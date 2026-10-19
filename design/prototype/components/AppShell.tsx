import {
  Bell,
  LockOpen,
  Menu,
  MessageSquare,
  Moon,
  PanelLeft,
  Plus,
  Settings,
  Sun,
  Wallet,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { conversations } from "../data.ts";
import type { ShellScreen, Theme } from "../types.ts";
import { Button, IconButton } from "./Button.tsx";
import { KeyworthMark } from "./KeyworthMark.tsx";

interface AppShellProps {
  screen: ShellScreen;
  title: string;
  theme: Theme;
  onToggleTheme: () => void;
  onNavigate: (screen: ShellScreen) => void;
  children: ReactNode;
}

const ICON = { size: 18, strokeWidth: 1.75 } as const;

export function AppShell({
  screen,
  title,
  theme,
  onToggleTheme,
  onNavigate,
  children,
}: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const navigate = (next: ShellScreen) => {
    setDrawerOpen(false);
    onNavigate(next);
  };

  return (
    <div className="flex h-dvh bg-canvas text-fg">
      {/* Desktop sidebar */}
      <aside
        className={`hidden shrink-0 overflow-hidden border-r border-line bg-surface transition-[width] duration-200 ease-out lg:block ${collapsed ? "w-0 border-r-0" : "w-68"}`}
      >
        <div className="w-68">
          <Sidebar
            screen={screen}
            onNavigate={navigate}
            onCollapse={() => {
              setCollapsed(true);
            }}
          />
        </div>
      </aside>

      {/* Mobile drawer */}
      <div className="lg:hidden">
        <div
          aria-hidden="true"
          className={`fixed inset-0 z-30 bg-scrim transition-opacity duration-200 ${drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
          onClick={() => {
            setDrawerOpen(false);
          }}
        />
        <aside
          aria-label="Navigation"
          inert={!drawerOpen}
          className={`fixed inset-y-0 left-0 z-40 w-[min(18rem,85vw)] border-r border-line bg-surface shadow-raised transition-transform duration-250 ease-out ${drawerOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
          <Sidebar
            screen={screen}
            onNavigate={navigate}
            onClose={() => {
              setDrawerOpen(false);
            }}
          />
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 px-3 md:px-5">
          <IconButton
            label="Open navigation"
            className="lg:hidden"
            onClick={() => {
              setDrawerOpen(true);
            }}
          >
            <Menu {...ICON} />
          </IconButton>
          {collapsed && (
            <IconButton
              label="Show sidebar"
              className="hidden lg:inline-flex"
              onClick={() => {
                setCollapsed(false);
              }}
            >
              <PanelLeft {...ICON} />
            </IconButton>
          )}
          <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium">
            {title}
          </h1>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-sm text-fg-muted transition-colors duration-150 hover:bg-hover hover:text-fg"
            title="Your data is decrypted on this device. Select to lock."
            aria-label="Unlocked. Select to lock."
          >
            <LockOpen size={15} strokeWidth={1.75} />
            <span className="hidden sm:inline">Unlocked</span>
          </button>
          <IconButton
            label={
              theme === "dark"
                ? "Switch to light theme"
                : "Switch to dark theme"
            }
            onClick={onToggleTheme}
          >
            {theme === "dark" ? <Sun {...ICON} /> : <Moon {...ICON} />}
          </IconButton>
        </header>
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}

interface SidebarProps {
  screen: ShellScreen;
  onNavigate: (screen: ShellScreen) => void;
  onCollapse?: () => void;
  onClose?: () => void;
}

function Sidebar({ screen, onNavigate, onCollapse, onClose }: SidebarProps) {
  return (
    <div className="flex h-dvh flex-col px-3 pb-3">
      <div className="flex h-14 items-center gap-2.5 px-1">
        <KeyworthMark />
        <span className="flex-1 text-[15px] font-semibold tracking-tight">
          Keyworth
        </span>
        {onCollapse && (
          <IconButton label="Hide sidebar" onClick={onCollapse}>
            <PanelLeft {...ICON} />
          </IconButton>
        )}
        {onClose && (
          <IconButton label="Close navigation" onClick={onClose}>
            <X {...ICON} />
          </IconButton>
        )}
      </div>

      <Button
        className="mt-2 w-full justify-start"
        icon={<Plus {...ICON} />}
        onClick={() => {
          onNavigate("empty");
        }}
      >
        New chat
      </Button>

      <nav
        aria-label="Conversations"
        className="mt-6 min-h-0 flex-1 overflow-y-auto"
      >
        <ConversationGroup
          title="Today"
          items={conversations.today}
          active={screen === "chat" ? 0 : -1}
          onOpen={() => {
            onNavigate("chat");
          }}
        />
        <ConversationGroup
          title="Previous 7 days"
          items={conversations.earlier}
          active={-1}
          onOpen={() => {
            onNavigate("chat");
          }}
        />
      </nav>

      <nav
        aria-label="Sections"
        className="flex flex-col gap-0.5 border-t border-line pt-3"
      >
        <NavItem
          icon={<MessageSquare {...ICON} />}
          label="Chat"
          active={screen === "chat" || screen === "empty"}
          onClick={() => {
            onNavigate("chat");
          }}
        />
        <NavItem
          icon={<Wallet {...ICON} />}
          label="Portfolio"
          active={screen === "portfolio"}
          onClick={() => {
            onNavigate("portfolio");
          }}
        />
        <NavItem icon={<Bell {...ICON} />} label="Alerts" active={false} />
        <NavItem
          icon={<Settings {...ICON} />}
          label="Settings"
          active={false}
        />
      </nav>
    </div>
  );
}

interface ConversationGroupProps {
  title: string;
  items: string[];
  active: number;
  onOpen: () => void;
}

function ConversationGroup({
  title,
  items,
  active,
  onOpen,
}: ConversationGroupProps) {
  return (
    <section className="mb-5">
      <h2 className="px-2 pb-1.5 text-xs font-medium text-fg-muted">{title}</h2>
      <ul className="flex flex-col gap-0.5">
        {items.map((item, index) => (
          <li key={item}>
            <a
              href="#"
              onClick={(event) => {
                event.preventDefault();
                onOpen();
              }}
              aria-current={index === active ? "page" : undefined}
              className={`block truncate rounded-md px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-hover ${index === active ? "bg-hover font-medium text-fg" : "text-fg"}`}
            >
              {item}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface NavItemProps {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick?: () => void;
}

function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`flex h-9 items-center gap-2.5 rounded-md px-2 text-sm transition-colors duration-150 hover:bg-hover ${active ? "bg-hover font-medium text-fg" : "text-fg-muted hover:text-fg"}`}
    >
      {icon}
      {label}
    </button>
  );
}
