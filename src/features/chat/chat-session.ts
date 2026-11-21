/*
 * When the conversation starts over: New chat, or the vault locking (the
 * conversation holds decrypted numbers, so it goes with the data key). Kept
 * apart from the conversation itself, which loads the AI SDK: the frame and
 * the lock can ask for a new start without loading the chat's code.
 */

let generation = 0;
const listeners = new Set<() => void>();

export const chatSession = {
  /** Changes at every new start. */
  generation: (): number => generation,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Drops the conversation: the next question starts a new one. */
  startOver: (): void => {
    generation += 1;
    for (const listener of listeners) listener();
  },
};
