import { ButtonLink, KeyworthMark } from "../ui/index.ts";

export function NotFoundPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <KeyworthMark className="size-10" />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          Page not found
        </h1>
        <p className="mt-2 text-base text-fg-muted">
          The address may be mistyped, or the page has moved.
        </p>
        <ButtonLink href="/" className="mt-8">
          Go to Keyworth
        </ButtonLink>
      </div>
    </main>
  );
}
