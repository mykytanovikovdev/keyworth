/** One chat in the menu: what the list needs, nothing of its messages. */
export interface ChatSummary {
  id: string;
  title: string;
  /** ISO, UTC: when its last message was written. */
  updatedAt: string;
}

export interface ChatGroup {
  label: string;
  chats: ChatSummary[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Newest first, in groups by the viewer's own calendar: today, the 7 days
 * before, the 30 before those, then everything older. Empty groups are left out.
 */
export function groupChats(
  chats: readonly ChatSummary[],
  now: Date = new Date(),
): ChatGroup[] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  const bounds = [
    { label: "Today", from: today },
    { label: "Previous 7 days", from: today - 7 * DAY_MS },
    { label: "Previous 30 days", from: today - 30 * DAY_MS },
    { label: "Older", from: -Infinity },
  ];
  const groups = bounds.map(({ label }) => ({
    label,
    chats: [] as ChatSummary[],
  }));
  const newestFirst = [...chats].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
  for (const chat of newestFirst) {
    const at = Date.parse(chat.updatedAt);
    const index = bounds.findIndex(({ from }) => at >= from);
    groups[index]?.chats.push(chat);
  }
  return groups.filter(({ chats: list }) => list.length > 0);
}
