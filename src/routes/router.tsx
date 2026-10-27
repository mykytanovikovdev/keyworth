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
import { SignInPage } from "../features/auth/SignInPage.tsx";
import { PrivacyPage } from "../features/legal/PrivacyPage.tsx";
import { TermsPage } from "../features/legal/TermsPage.tsx";
import { SettingsPage } from "../features/settings/SettingsPage.tsx";
import { AppShell } from "./AppShell.tsx";
import { HomePage } from "./HomePage.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";

/*
 * Routes are declared in code: a handful of them, fully typed, with no code
 * generator. Signed-in pages sit under the `app` layout, whose beforeLoad
 * sends anyone without a session to /sign-in. The server enforces the same rule
 * on every API call; this only decides which page to show.
 */

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.query(sessionQuery);
    if (!session) throw redirect({ to: "/sign-in" });
  },
  component: AppShell,
});

const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: HomePage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  // Set when coming back from a fresh sign-in to delete the account.
  validateSearch: (search): { reauthenticated?: true } =>
    search.reauthenticated ? { reauthenticated: true } : {},
  component: function Settings() {
    const { reauthenticated } = settingsRoute.useSearch();
    return <SettingsPage reauthenticated={reauthenticated === true} />;
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
  component: PrivacyPage,
});

const termsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/terms",
  component: TermsPage,
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

const routeTree = rootRoute.addChildren([
  appRoute.addChildren([homeRoute, settingsRoute]),
  signInRoute,
  privacyRoute,
  termsRoute,
  ...(designRoute ? [designRoute] : []),
  ...(kdfBenchmarkRoute ? [kdfBenchmarkRoute] : []),
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
