import type { ReactNode } from "react";
import {
  Dialog as AriaDialog,
  Modal,
  ModalOverlay,
  type ModalOverlayProps,
} from "react-aria-components";
import { useVisualViewportTop } from "../viewport.ts";

interface DrawerProps extends Pick<
  ModalOverlayProps,
  "isOpen" | "onOpenChange"
> {
  /** The panel's accessible name, such as "Menu". */
  label: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}

/**
 * A panel that slides in from the left edge over the page: the app's menu on
 * narrow screens. A modal like `Dialog`: focus moves inside and returns to the
 * trigger, the page behind does not scroll, Escape or a tap outside closes it.
 * It covers the visible part of the page, as `Dialog` does, for iOS.
 */
export function Drawer({ label, children, ...overlayProps }: DrawerProps) {
  const top = useVisualViewportTop();
  return (
    <ModalOverlay
      {...overlayProps}
      isDismissable
      style={{ top }}
      className="fixed top-0 left-0 z-50 h-(--visual-viewport-height) w-full bg-scrim data-entering:animate-fade-in data-exiting:animate-fade-out"
    >
      <Modal className="h-full w-[min(18rem,85vw)] border-r border-line bg-surface shadow-raised data-entering:animate-slide-in data-exiting:animate-slide-out">
        <AriaDialog aria-label={label} className="h-full outline-none">
          {({ close }) =>
            typeof children === "function" ? children(close) : children
          }
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
