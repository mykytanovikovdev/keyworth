import { LucideProvider } from "lucide-react";
import type { ReactNode } from "react";
import { I18nProvider, RouterProvider } from "react-aria-components";

interface UIProviderProps {
  children: ReactNode;
  /**
   * Client-side navigation for React Aria links (ButtonLink, TextLink). The
   * app passes its router's navigate; without it, links do full page loads.
   */
  navigate?: (href: string) => void;
}

/**
 * App-wide settings for the design system. Mount once at the root.
 *
 * - English for React Aria's built-in strings ("Close", "Dismiss") and number
 *   and date formats: the interface is English only, whatever the browser's
 *   language.
 * - Lucide icons default to 16px at a 1.75 stroke, matching 14px text.
 * - React Aria links navigate through the app's router.
 */
export function UIProvider({ children, navigate }: UIProviderProps) {
  const content = (
    <I18nProvider locale="en-US">
      <LucideProvider size={16} strokeWidth={1.75}>
        {children}
      </LucideProvider>
    </I18nProvider>
  );
  return navigate ? (
    <RouterProvider navigate={navigate}>{content}</RouterProvider>
  ) : (
    content
  );
}
