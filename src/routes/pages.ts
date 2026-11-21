import { lazyRouteComponent } from "@tanstack/react-router";

/*
 * Pages loaded on first use, each its own chunk. lazyRouteComponent gives each
 * a `preload` that the router waits for before it leaves the current page, so
 * a switch never shows an empty frame. The signed-in sections are also fetched
 * in the background as soon as the app's frame is up (`preloadSections`): the
 * first switch to one is then instant.
 */

export const PortfolioPage = lazyRouteComponent(
  () => import("../features/portfolio/PortfolioPage.tsx"),
  "PortfolioPage",
);

export const TransactionsPage = lazyRouteComponent(
  () => import("../features/transactions/TransactionsPage.tsx"),
  "TransactionsPage",
);

// Not fetched ahead with the sections: it carries the AI SDK and the
// markdown renderer, for those who open the chat.
export const ChatPage = lazyRouteComponent(
  () => import("../features/chat/ChatPage.tsx"),
  "ChatPage",
);

export const SettingsPage = lazyRouteComponent(
  () => import("../features/settings/SettingsPage.tsx"),
  "SettingsPage",
);

export const SignInPage = lazyRouteComponent(
  () => import("../features/auth/SignInPage.tsx"),
  "SignInPage",
);

/** What lazyRouteComponent returns, as far as loading goes. */
interface LazyPage {
  preload?: () => Promise<void> | undefined;
}

/**
 * A route component that renders a lazy page with props of its own (the
 * route's search), given the page's `preload`: the router then waits for the
 * page's code as it does for any other page. Without it the router switches at
 * once and shows nothing until the code arrives.
 */
export function waitingFor<C extends object>(
  page: LazyPage,
  component: C,
): C & { preload: () => Promise<void> } {
  return Object.assign(component, {
    preload: async () => {
      // Gone once loaded: lazyRouteComponent drops it.
      await page.preload?.();
    },
  });
}

/** The sections' code, fetched in the background; each load happens once. */
export function preloadSections(): void {
  for (const page of [PortfolioPage, TransactionsPage, SettingsPage]) {
    void page.preload?.();
  }
}
