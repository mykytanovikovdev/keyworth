import type { ReactNode } from "react";
import { KeyworthMark, TextLink } from "../../ui/index.ts";

interface LegalPageProps {
  title: string;
  children: ReactNode;
}

/** Shared layout for the privacy policy and terms: readable text, nothing else. */
export function LegalPage({ title, children }: LegalPageProps) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <a
        href="/"
        aria-label="Keyworth home"
        className="inline-block rounded-md"
      >
        <KeyworthMark className="size-8" />
      </a>
      <h1 className="mt-6 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
        Draft. Keyworth is in a closed beta; the final text will be published
        before it opens to everyone.
      </p>
      <div className="mt-8 flex flex-col gap-6 text-base text-fg [&_h2]:text-lg [&_h2]:font-semibold [&_li]:mt-1 [&_p]:text-fg-muted [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-fg-muted">
        {children}
      </div>
      <p className="mt-12 border-t border-line pt-4 text-sm text-fg-muted">
        <TextLink href="/sign-in">Back to sign-in</TextLink>
      </p>
    </main>
  );
}
