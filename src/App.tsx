import { lazy, Suspense } from "react";
import { Toaster, UIProvider } from "./ui/index.ts";

// The design system page exists only in dev and in `vite build --mode design`.
// In a production build this condition is the constant `false`, so the page and
// everything it imports are left out of the bundle.
const DesignSystemPage =
  import.meta.env.DEV || import.meta.env.MODE === "design"
    ? lazy(() => import("./ui/gallery/DesignSystemPage.tsx"))
    : null;

function isDesignSystemPath(): boolean {
  return /^\/design\/?$/.test(window.location.pathname);
}

// Placeholder until the app's screens arrive in the next phases.
function Placeholder() {
  return (
    <main className="grid min-h-dvh place-content-center gap-2 p-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Keyworth</h1>
      <p className="text-base text-fg-muted">Private AI portfolio assistant.</p>
      <p className="text-base text-fg-muted">Your net worth. Your key.</p>
    </main>
  );
}

export function App() {
  return (
    <UIProvider>
      {DesignSystemPage && isDesignSystemPath() ? (
        <Suspense fallback={null}>
          <DesignSystemPage />
        </Suspense>
      ) : (
        <Placeholder />
      )}
      <Toaster />
    </UIProvider>
  );
}
