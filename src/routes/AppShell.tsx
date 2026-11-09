import { Outlet, useRouterState } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-aria-components";
import { VaultGate } from "../features/unlock/VaultGate.tsx";
import { ButtonLink, KeyworthMark, ThemeToggle } from "../ui/index.ts";
import { AppNav } from "./AppNav.tsx";
import { preloadSections } from "./pages.ts";

/** The frame around every signed-in page, once the data key is open. */
export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // While the passphrase is typed, or the first page draws: the sections'
  // code holds no data, and the first switch to one is then instant.
  useEffect(preloadSections, []);
  return (
    <VaultGate>
      <div className="flex min-h-dvh flex-col">
        <header className="border-b border-line">
          <div className="mx-auto flex min-h-14 w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 px-4 sm:flex-nowrap sm:px-6">
            <div className="flex h-14 items-center">
              {/* Through the router: a page reload would lock the data. */}
              <Link
                href="/"
                className="flex items-center gap-2 rounded-md text-sm font-semibold"
              >
                <KeyworthMark />
                {/* The narrowest phones have room for the mark alone. */}
                <span className="max-[359px]:sr-only">Keyworth</span>
              </Link>
            </div>
            <AppNav
              items={[
                { href: "/", label: "Portfolio", current: pathname === "/" },
                {
                  href: "/transactions",
                  label: "Transactions",
                  current: pathname.startsWith("/transactions"),
                },
              ]}
            />
            <div className="flex h-14 items-center gap-2 sm:ml-auto">
              <ThemeToggle />
              <ButtonLink
                href="/settings"
                variant="ghost"
                size="sm"
                icon={<Settings aria-hidden="true" />}
              >
                Settings
              </ButtonLink>
            </div>
          </div>
        </header>
        <main className="flex flex-1 flex-col">
          <Outlet />
        </main>
      </div>
    </VaultGate>
  );
}
