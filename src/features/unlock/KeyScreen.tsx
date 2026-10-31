import type { ReactNode } from "react";
import { Button, KeyworthMark } from "../../ui/index.ts";

/**
 * The frame shared by every screen that deals with keys: the same centered
 * column as the sign-in page, so signing in, creating a passphrase and
 * unlocking read as one flow.
 */
export function KeyScreen({
  step,
  title,
  description,
  email,
  onSignOut,
  signingOut = false,
  children,
}: {
  /** "Step 1 of 2" in a sequence; nothing on a single screen. */
  step?: string;
  title: string;
  description: ReactNode;
  /** The signed-in Google account, with a way out; absent when not signed in. */
  email?: string;
  onSignOut?: () => void;
  signingOut?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <KeyworthMark className="size-10" />
        {step && <p className="mt-6 text-sm text-fg-muted">{step}</p>}
        <h1
          className={`${step ? "mt-1" : "mt-6"} text-2xl font-semibold tracking-tight`}
        >
          {title}
        </h1>
        <div className="mt-2 text-base text-fg-muted">{description}</div>
        {children}
        {email && (
          <div className="mt-10 flex items-center justify-between gap-3 border-t border-line pt-3 text-xs text-fg-muted">
            <span className="min-w-0 truncate">Signed in as {email}</span>
            <Button
              variant="ghost"
              size="sm"
              isPending={signingOut}
              {...(onSignOut && { onPress: onSignOut })}
            >
              Sign out
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
