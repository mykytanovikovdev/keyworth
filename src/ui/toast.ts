import { UNSTABLE_ToastQueue as ToastQueue } from "react-aria-components";

/*
 * Toasts are queued outside React, so any code (a mutation's error handler, the
 * vault sync) can show one. React Aria still marks its Toast API as unstable, so
 * it is used only here and in Toaster.tsx: an API change touches two files.
 */

export type ToastTone = "neutral" | "success" | "error";

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastContent {
  title: string;
  description?: string;
  tone: ToastTone;
  /** One button, such as Undo; pressing it also closes the toast. */
  action?: ToastAction;
}

export const toastQueue = new ToastQueue<ToastContent>({ maxVisibleToasts: 3 });

interface ShowToastOptions {
  description?: string;
  tone?: ToastTone;
  action?: ToastAction;
}

/**
 * Shows a short notification. Errors stay until dismissed, so they can be read;
 * others close after 5 seconds, React Aria's recommended minimum. The timer
 * pauses while the pointer or keyboard focus is on a toast.
 */
export function showToast(
  title: string,
  { description, tone = "neutral", action }: ShowToastOptions = {},
): string {
  const content: ToastContent = { title, tone };
  if (description !== undefined) content.description = description;
  if (action !== undefined) content.action = action;
  return toastQueue.add(content, tone === "error" ? {} : { timeout: 5000 });
}
