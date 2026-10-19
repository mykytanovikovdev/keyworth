import { Toaster, UIProvider } from "./ui/index.ts";

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
      <Placeholder />
      <Toaster />
    </UIProvider>
  );
}
