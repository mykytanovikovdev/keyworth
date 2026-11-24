/*
 * Chats on their way out: hidden from the list at once, deleted on the server
 * when their Undo is over (the toast closes), when the page leaves or the vault
 * locks, and before a new chat is created (it must not go with "all"). Undo just
 * shows them again: nothing was deleted yet. A tab that crashes before then has
 * deleted nothing, and they show again. Light: no AI SDK, so the app's start and
 * signing out can use it.
 */

export interface Deletion {
  /** The chats' ids in the list, or all of them. */
  chats: readonly string[] | "all";
  /** Deletes on the server; with `leaving`, the request outlives the page. */
  run: (options: { leaving: boolean }) => Promise<unknown>;
  onFail: () => void;
}

interface Hidden {
  all: boolean;
  ids: ReadonlySet<string>;
}

interface Pending {
  deletion: Deletion;
  running: Promise<void> | null;
}

const SHOWN: Hidden = Object.freeze({ all: false, ids: new Set<string>() });

let pending: Pending[] = [];
let hidden: Hidden = SHOWN;
const listeners = new Set<() => void>();

function changed() {
  const ids = pending.flatMap(({ deletion }) =>
    deletion.chats === "all" ? [] : deletion.chats,
  );
  hidden = pending.length
    ? {
        all: pending.some(({ deletion }) => deletion.chats === "all"),
        ids: new Set(ids),
      }
    : SHOWN;
  for (const listener of listeners) listener();
}

const drop = (entry: Pending) => {
  pending = pending.filter((other) => other !== entry);
  changed();
};

function commit(entry: Pending, leaving: boolean): Promise<void> {
  entry.running ??= entry.deletion
    .run({ leaving })
    .catch(() => {
      entry.deletion.onFail();
    })
    .then(() => {
      drop(entry);
    });
  return entry.running;
}

export const chatDeletes = {
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** What the list leaves out. */
  hidden: (): Hidden => hidden,
  start(deletion: Deletion): { undo: () => void; commit: () => Promise<void> } {
    const entry: Pending = { deletion, running: null };
    pending.push(entry);
    changed();
    return {
      undo: () => {
        if (!entry.running) drop(entry);
      },
      commit: () =>
        pending.includes(entry) ? commit(entry, false) : Promise.resolve(),
    };
  },
  /** Deletes now everything still waiting. */
  flush: ({ leaving = false } = {}): Promise<void> =>
    Promise.all(pending.map((entry) => commit(entry, leaving))).then(
      () => undefined,
    ),
};
