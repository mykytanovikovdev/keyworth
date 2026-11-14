import type { ChatSummary } from "../features/chat/chat-list.ts";
import type { AppLinks } from "./AppFrame.tsx";

/*
 * Made-up chats for the mockups (dev and design builds only), shared by every
 * mockup page so a chat deleted on one is gone on the others too.
 */

const HOUR_MS = 60 * 60 * 1000;
const ago = (hours: number) =>
  new Date(Date.now() - hours * HOUR_MS).toISOString();

const START: readonly ChatSummary[] = [
  {
    id: "c1",
    title: "How did my portfolio do this month?",
    updatedAt: ago(0.2),
  },
  { id: "c2", title: "Bitcoin vs Ethereum over 90 days", updatedAt: ago(1.5) },
  { id: "c3", title: "Как изменился портфель за неделю?", updatedAt: ago(3) },
  { id: "c4", title: "My biggest holding", updatedAt: ago(2 * 24) },
  { id: "c5", title: "Litecoin buys in 2025", updatedAt: ago(5 * 24) },
  { id: "c6", title: "Staking income in September", updatedAt: ago(12 * 24) },
  { id: "c7", title: "How volatile is Solana?", updatedAt: ago(20 * 24) },
  { id: "c8", title: "What is a drawdown?", updatedAt: ago(45 * 24) },
];

let chats: readonly ChatSummary[] = START;
const listeners = new Set<() => void>();

export const mockChats = {
  get: () => chats,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set: (next: readonly ChatSummary[]) => {
    chats = next;
    for (const listener of listeners) listener();
  },
};

export const MOCK_LINKS: AppLinks = {
  portfolio: "/design/portfolio",
  transactions: "/design/transactions",
  settings: "/design/chat?screen=settings",
  newChat: "/design/chat?screen=new",
  chat: (id) => `/design/chat?screen=chat&id=${id}`,
};
