import { Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { VaultGate } from "../features/unlock/VaultGate.tsx";
import { AppFrame, type AppLinks, type AppSection } from "./AppFrame.tsx";
import { preloadSections } from "./pages.ts";

const LINKS: AppLinks = {
  portfolio: "/",
  transactions: "/transactions",
  settings: "/settings",
};

/** Which item of the menu the address belongs to. */
function sectionOf(pathname: string): AppSection {
  if (pathname.startsWith("/transactions")) return "transactions";
  if (pathname.startsWith("/settings")) return "settings";
  return "portfolio";
}

/** The frame around every signed-in page, once the data key is open. */
export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // While the passphrase is typed, or the first page draws: the sections'
  // code holds no data, and the first switch to one is then instant.
  useEffect(preloadSections, []);
  return (
    <VaultGate>
      <AppFrame section={sectionOf(pathname)} links={LINKS}>
        <Outlet />
      </AppFrame>
    </VaultGate>
  );
}
