import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { Button, KeyworthMark, showToast, TextLink } from "../../ui/index.ts";
import { signInWithGoogle } from "./client.ts";

/*
 * Errors arrive as `?error=CODE` after Google redirects back. Only known codes
 * get specific text; the message is never taken from the URL, so a crafted link
 * cannot put words on this page.
 */
const errorMessages: Record<string, string> = {
  NOT_INVITED:
    "This Google account isn't on the invite list. Keyworth is in a closed beta for now.",
};
const genericError = "Sign-in didn't finish. Try again.";

export function SignInPage({ error }: { error?: string | undefined }) {
  const [pending, setPending] = useState(false);
  const message = error ? (errorMessages[error] ?? genericError) : undefined;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <KeyworthMark className="size-10" />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          Sign in to Keyworth
        </h1>
        <p className="mt-2 text-base text-fg-muted">
          A private assistant for your investment portfolio.
        </p>

        {message && (
          <p
            role="alert"
            className="mt-6 flex items-start gap-2 rounded-md bg-loss-soft px-3 py-2.5 text-sm text-loss"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 shrink-0" />
            {message}
          </p>
        )}

        <Button
          className="mt-8 w-full"
          isPending={pending}
          icon={<img src="/google-g.svg" alt="" className="size-4" />}
          onPress={() => {
            setPending(true);
            signInWithGoogle().catch(() => {
              setPending(false);
              showToast("Couldn't reach Google", {
                tone: "error",
                description: "Check your connection and try again.",
              });
            });
          }}
        >
          Continue with Google
        </Button>
        {/* Right under the button and readable: this line is what makes
            continuing an acceptance of the terms (worker/auth.ts records it). */}
        <p className="mt-3 text-sm text-fg-muted">
          By continuing with Google, you agree to the{" "}
          <TextLink href="/terms">Terms</TextLink> and confirm you've read the{" "}
          <TextLink href="/privacy">Privacy policy</TextLink>.
        </p>

        <p className="mt-10 border-t border-line pt-4 text-xs text-fg-muted">
          Invite only during the beta.
        </p>
      </div>
    </main>
  );
}
