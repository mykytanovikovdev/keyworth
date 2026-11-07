import type { MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";

/**
 * Security headers for every response the Worker generates (JSON API responses,
 * 404s, errors). Static assets and the SPA shell never pass through the Worker,
 * so their headers live in public/_headers — keep both in sync with the e2e tests.
 */
const baseHeaders = secureHeaders({
  // API responses are data, never documents: nothing may load or frame them.
  contentSecurityPolicy: {
    defaultSrc: ["'none'"],
    frameAncestors: ["'none'"],
  },
  crossOriginResourcePolicy: "same-origin",
  crossOriginOpenerPolicy: "same-origin",
  referrerPolicy: "no-referrer",
  strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
  xFrameOptions: "DENY",
});

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await baseHeaders(c, next);
  // Responses may contain user data (encrypted or not): never cache them,
  // unless a route says so for data that is the same for everyone (logos).
  if (!c.res.headers.has("Cache-Control"))
    c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
};
