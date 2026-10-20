import { X } from "lucide-react";
import type { ReactNode } from "react";
import {
  Dialog as AriaDialog,
  Heading,
  Modal,
  ModalOverlay,
  type ModalOverlayProps,
} from "react-aria-components";
import { IconButton } from "./Button.tsx";

export { DialogTrigger } from "react-aria-components";

interface DialogProps extends Pick<
  ModalOverlayProps,
  "isOpen" | "defaultOpen" | "onOpenChange"
> {
  title: string;
  /**
   * "alertdialog" for confirmations that need an answer: it cannot be dismissed
   * by clicking outside or pressing Escape, and has no close button.
   */
  role?: "dialog" | "alertdialog";
  children: ReactNode | ((close: () => void) => ReactNode);
}

/**
 * A modal dialog. Focus moves inside and stays there until it closes, the page
 * behind does not scroll, and focus returns to the trigger afterwards. Use it
 * inside a DialogTrigger next to its button, or control it with `isOpen`.
 */
export function Dialog({
  title,
  role = "dialog",
  children,
  ...overlayProps
}: DialogProps) {
  const isDismissable = role === "dialog";
  return (
    <ModalOverlay
      {...overlayProps}
      isDismissable={isDismissable}
      isKeyboardDismissDisabled={!isDismissable}
      className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-4 data-entering:animate-fade-in data-exiting:animate-fade-out sm:items-center"
    >
      <Modal className="w-full max-w-md data-entering:animate-pop-in data-exiting:animate-pop-out">
        <AriaDialog
          role={role}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl bg-raised p-5 shadow-raised sm:p-6"
        >
          {({ close }) => (
            <>
              <div className="flex items-start justify-between gap-4">
                <Heading slot="title" className="text-lg font-semibold">
                  {title}
                </Heading>
                {isDismissable && (
                  <IconButton
                    label="Close"
                    tooltip={false}
                    onPress={close}
                    className="-mt-1.5 -mr-2"
                  >
                    <X />
                  </IconButton>
                )}
              </div>
              {typeof children === "function" ? children(close) : children}
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

/** The row of buttons at the end of a dialog: stacked on phones, right-aligned on wider screens. */
export function DialogActions({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      {children}
    </div>
  );
}
