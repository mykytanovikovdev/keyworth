import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { sessionQuery } from "../features/auth/client.ts";
import type { SettingsAction } from "../features/settings/SettingsPage.tsx";
import { SettingsPage, SignInPage } from "./lazy-pages.ts";
import { AppShell } from "./AppShell.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";

/*
 * Routes are declared in code: a handful of them, fully typed, with no code
 * generator. Signed-in pages sit under the `session` layout, whose beforeLoad
 * sends anyone without a session to /sign-in; the server enforces the same rule
 * on every API call, this only decides which page to show. Inside it, the `app`
 * layout lets nobody past the key gate (src/features/unlock/VaultGate.tsx)
 * before the data key is open; /recover sits outside the gate, for a user
 * locked out of it.
 */

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "session",
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.query(sessionQuery);
    if (!session) throw redirect({ to: "/sign-in" });
  },
  component: Outlet,
});

const appRoute = createRoute({
  getParentRoute: () => sessionRoute,
  id: "app",
  component: AppShell,
});

const recoverRoute = createRoute({
  getParentRoute: () => sessionRoute,
  path: "/recover",
  component: lazyRouteComponent(
    () => import("../features/unlock/RecoverPage.tsx"),
    "RecoverPage",
  ),
});

const SETTINGS_ACTIONS: readonly string[] = [
  "delete-account",
  "change-passphrase",
  "new-recovery-key",
] satisfies SettingsAction[];

const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: lazyRouteComponent(
    () => import("../features/portfolio/PortfolioPage.tsx"),
    "PortfolioPage",
  ),
});

const transactionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/transactions",
  component: lazyRouteComponent(
    () => import("../features/transactions/TransactionsPage.tsx"),
    "TransactionsPage",
  ),
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  // Set when coming back from a fresh sign-in for one of these actions. It
  // only opens the dialog; the server decides whether the sign-in is fresh.
  validateSearch: (search): { then?: SettingsAction } =>
    typeof search.then === "string" && SETTINGS_ACTIONS.includes(search.then)
      ? { then: search.then as SettingsAction }
      : {},
  component: function Settings() {
    const { then } = settingsRoute.useSearch();
    return <SettingsPage then={then} />;
  },
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  validateSearch: (search): { error?: string } =>
    typeof search.error === "string" ? { error: search.error } : {},
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.query(sessionQuery);
    if (session) throw redirect({ to: "/" });
  },
  component: function SignIn() {
    const { error } = signInRoute.useSearch();
    return <SignInPage error={error} />;
  },
});

const privacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/privacy",
  component: lazyRouteComponent(
    () => import("../features/legal/PrivacyPage.tsx"),
    "PrivacyPage",
  ),
});

const termsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/terms",
  component: lazyRouteComponent(
    () => import("../features/legal/TermsPage.tsx"),
    "TermsPage",
  ),
});

// The design system page exists only in dev and in `vite build --mode design`.
// In a production build this condition is the constant `false`, so the route
// and everything it imports are left out of the bundle.
const designRoute =
  import.meta.env.DEV || import.meta.env.MODE === "design"
    ? createRoute({
        getParentRoute: () => rootRoute,
        path: "/design",
        component: lazyRouteComponent(
          () => import("../ui/gallery/DesignSystemPage.tsx"),
        ),
      })
    : null;

// Same condition: a developer tool that times Argon2id on this device.
const kdfBenchmarkRoute =
  import.meta.env.DEV || import.meta.env.MODE === "design"
    ? createRoute({
        getParentRoute: () => rootRoute,
        path: "/design/kdf",
        component: lazyRouteComponent(() => import("./KdfBenchmarkPage.tsx")),
      })
    : null;

// Same condition: mockups of the phase 3.3 screens, for review.
const encryptionMockupsRoute =
  import.meta.env.DEV || import.meta.env.MODE === "design"
    ? createRoute({
        getParentRoute: () => rootRoute,
        path: "/design/encryption",
        component: lazyRouteComponent(
          () => import("./EncryptionMockupsPage.tsx"),
        ),
      })
    : null;

// Same condition: mockups of the 4.3b screens (transactions), for review.
const transactionsMockupsRoute =
  import.meta.env.DEV || import.meta.env.MODE === "design"
    ? createRoute({
        getParentRoute: () => rootRoute,
        path: "/design/transactions",
        component: lazyRouteComponent(
          () => import("./TransactionsMockupsPage.tsx"),
        ),
      })
    : null;

// Same condition: mockups of the 4.4 portfolio page, for review.
const portfolioMockupsRoute =
  import.meta.env.DEV || import.meta.env.MODE === "design"
    ? createRoute({
        getParentRoute: () => rootRoute,
        path: "/design/portfolio",
        component: lazyRouteComponent(
          () => import("./PortfolioMockupsPage.tsx"),
        ),
      })
    : null;

const routeTree = rootRoute.addChildren([
  sessionRoute.addChildren([
    appRoute.addChildren([homeRoute, transactionsRoute, settingsRoute]),
    recoverRoute,
  ]),
  signInRoute,
  privacyRoute,
  termsRoute,
  ...(designRoute ? [designRoute] : []),
  ...(kdfBenchmarkRoute ? [kdfBenchmarkRoute] : []),
  ...(encryptionMockupsRoute ? [encryptionMockupsRoute] : []),
  ...(transactionsMockupsRoute ? [transactionsMockupsRoute] : []),
  ...(portfolioMockupsRoute ? [portfolioMockupsRoute] : []),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
