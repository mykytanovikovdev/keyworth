import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import type { ReactNode } from "react";
import {
  Button as AriaButton,
  Text,
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as ToastContent,
  UNSTABLE_ToastRegion as ToastRegion,
} from "react-aria-components";
import { toastQueue, type ToastTone } from "../toast.ts";

const icons: Record<ToastTone, ReactNode> = {
  neutral: <Info aria-hidden="true" className="text-fg-muted" />,
  success: <CircleCheck aria-hidden="true" className="text-gain" />,
  error: <CircleAlert aria-hidden="true" className="text-loss" />,
};

/**
 * Renders queued toasts at the top of the screen, clear of the chat composer.
 * Mount once, near the root. F6 moves focus to the toasts and back.
 */
export function Toaster() {
  return (
    <ToastRegion
      queue={toastQueue}
      className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4 outline-none"
    >
      {({ toast }) => (
        <AriaToast
          toast={toast}
          className="pointer-events-auto flex w-full max-w-sm animate-enter items-start gap-3 rounded-lg border border-line bg-raised py-3 pr-2 pl-3 shadow-raised"
        >
          <span className="mt-0.5 shrink-0">{icons[toast.content.tone]}</span>
          <ToastContent className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Text slot="title" className="text-sm font-medium text-fg">
              {toast.content.title}
            </Text>
            {toast.content.description && (
              <Text slot="description" className="text-sm text-fg-muted">
                {toast.content.description}
              </Text>
            )}
          </ToastContent>
          <AriaButton
            slot="close"
            aria-label="Dismiss"
            className="-my-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors duration-(--kw-duration-fast) data-hovered:bg-hover data-hovered:text-fg"
          >
            <X />
          </AriaButton>
        </AriaToast>
      )}
    </ToastRegion>
  );
}
