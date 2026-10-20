import { LucideProvider } from "lucide-react";
import type { ReactNode } from "react";
import { I18nProvider } from "react-aria-components";

/**
 * App-wide settings for the design system. Mount once at the root.
 *
 * - English for React Aria's built-in strings ("Close", "Dismiss") and number
 *   and date formats: the interface is English only, whatever the browser's
 *   language.
 * - Lucide icons default to 16px at a 1.75 stroke, matching 14px text.
 */
export function UIProvider({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="en-US">
      <LucideProvider size={16} strokeWidth={1.75}>
        {children}
      </LucideProvider>
    </I18nProvider>
  );
}
