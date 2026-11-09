import { lazy } from "react";

/*
 * Pages that take their route's search as props, loaded on first use like the
 * others: lazyRouteComponent (router.tsx) cannot pass props, React.lazy can.
 * The router's Suspense boundary shows nothing while one loads.
 */

export const SettingsPage = lazy(async () => ({
  default: (await import("../features/settings/SettingsPage.tsx")).SettingsPage,
}));

export const SignInPage = lazy(async () => ({
  default: (await import("../features/auth/SignInPage.tsx")).SignInPage,
}));
