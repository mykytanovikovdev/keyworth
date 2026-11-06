import type { ReactNode } from "react";
import { Link } from "react-aria-components";
import { KeyworthMark, TextLink } from "../../ui/index.ts";

interface LegalPageProps {
  title: string;
  /** When the text last changed, as an ISO date (`shared/legal.ts`). */
  updated: string;
  children: ReactNode;
}

const updatedOn = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeZone: "UTC",
});

/**
 * Shared layout for the privacy policy and terms: readable text, nothing else.
 * Its links stay inside the app: Settings links here, and a page reload would
 * lock the data.
 */
export function LegalPage({ title, updated, children }: LegalPageProps) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <Link
        href="/"
        aria-label="Keyworth home"
        className="inline-block rounded-md"
      >
        <KeyworthMark className="size-8" />
      </Link>
      <h1 className="mt-6 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Last updated {updatedOn.format(new Date(updated))}
      </p>
      <div className="mt-8 flex flex-col gap-6 text-base [overflow-wrap:anywhere] text-fg [&_h2]:text-lg [&_h2]:font-semibold [&_li]:mt-1 [&_p]:text-fg-muted [&_strong]:font-medium [&_strong]:text-fg [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-fg-muted">
        {children}
      </div>
      <p className="mt-12 border-t border-line pt-4 text-sm text-fg-muted">
        <TextLink href="/">Back to Keyworth</TextLink>
      </p>
    </main>
  );
}
