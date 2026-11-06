import { Outlet } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { Link } from "react-aria-components";
import { VaultGate } from "../features/unlock/VaultGate.tsx";
import { ButtonLink, KeyworthMark, ThemeToggle } from "../ui/index.ts";

/** The frame around every signed-in page, once the data key is open. */
export function AppShell() {
  return (
    <VaultGate>
      <div className="flex min-h-dvh flex-col">
        <header className="border-b border-line">
          <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
            {/* Through the router: a page reload would lock the data. */}
            <Link
              href="/"
              className="flex items-center gap-2 rounded-md text-sm font-semibold"
            >
              <KeyworthMark />
              {/* The narrowest phones have room for the mark alone. */}
              <span className="max-[359px]:sr-only">Keyworth</span>
            </Link>
            <div className="flex items-center gap-2">
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
