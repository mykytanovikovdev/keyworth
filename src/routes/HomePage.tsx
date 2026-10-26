import { useSuspenseQuery } from "@tanstack/react-query";
import { sessionQuery } from "../features/auth/client.ts";
import { ButtonLink } from "../ui/index.ts";

// Placeholder until the portfolio and chat arrive in the next phases.
export function HomePage() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const firstName = session?.user.name.split(" ")[0] ?? "";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-3 px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Welcome, {firstName}
      </h1>
      <p className="max-w-prose text-base text-fg-muted">
        Your portfolio will live here once encryption is set up. For now, you
        can manage your account in Settings.
      </p>
      <div className="mt-3">
        <ButtonLink href="/settings">Open settings</ButtonLink>
      </div>
    </div>
  );
}
