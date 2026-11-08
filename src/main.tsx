import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { guardLiveAnnouncer } from "./ui/index.ts";
import "./ui/styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

// Before any field can announce: see src/ui/live-announcer.ts.
guardLiveAnnouncer();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
