import { expect, test, type APIResponse } from "@playwright/test";

// Expected values are written out here on purpose rather than imported from
// public/_headers or worker/security-headers.ts: the test must catch wrong values.
const PAGE_HEADERS = {
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types 'none'",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "permissions-policy":
    "accelerometer=(), autoplay=(), bluetooth=(), browsing-topics=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), serial=(), usb=(), publickey-credentials-create=(self), publickey-credentials-get=(self)",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
  "cross-origin-resource-policy": "same-origin",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
};

const WORKER_HEADERS = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "cross-origin-resource-policy": "same-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "x-robots-tag": "noindex, nofollow",
};

// What a browser sends when the user opens a URL or follows a redirect.
const NAVIGATION = {
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  accept: "text/html",
};

function expectHeaders(
  response: APIResponse,
  expected: Record<string, string>,
) {
  const headers = response.headers();
  for (const [name, value] of Object.entries(expected)) {
    expect(headers[name], name).toBe(value);
  }
}

test.describe("SPA shell", () => {
  for (const path of ["/", "/portfolio/some/deep/link"]) {
    test(`${path} serves index.html with the page security headers`, async ({
      request,
    }) => {
      const response = await request.get(path, { headers: NAVIGATION });

      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("text/html");
      expect(await response.text()).toContain('<div id="root">');
      expectHeaders(response, PAGE_HEADERS);
    });
  }

  test("index.html has no inline scripts, styles or event handlers", async ({
    request,
  }) => {
    const html = await (await request.get("/")).text();

    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) {
      expect(tag, "every script must be external").toMatch(/\ssrc="\/[^"]+"/);
    }
    expect(html).not.toMatch(/<style\b/);
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).not.toMatch(/\son[a-z]+="/);
  });
});

test.describe("static files", () => {
  test("hashed assets are immutable and carry the security headers", async ({
    request,
  }) => {
    const html = await (await request.get("/")).text();
    const scriptPath = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(
      html,
    )?.[1];
    if (scriptPath === undefined)
      throw new Error("No hashed script in index.html");

    const response = await request.get(scriptPath);

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expectHeaders(response, {
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
    });
  });

  test("robots.txt disallows crawling until the public release", async ({
    request,
  }) => {
    const response = await request.get("/robots.txt");

    expect(response.status()).toBe(200);
    expect(await response.text()).toBe("User-agent: *\nDisallow: /\n");
  });

  test("the _headers config file is not served", async ({ request }) => {
    const response = await request.get("/_headers");

    expect(await response.text()).not.toContain("Content-Security-Policy:");
  });
});

test.describe("API", () => {
  test("GET /api/health responds with the Worker security headers", async ({
    request,
  }) => {
    const response = await request.get("/api/health");

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expectHeaders(response, WORKER_HEADERS);
  });

  test("a navigation to an unknown /api path reaches the Worker, not the SPA", async ({
    request,
  }) => {
    // OAuth callbacks are navigations: without run_worker_first they would get index.html.
    const response = await request.get("/api/does-not-exist", {
      headers: NAVIGATION,
    });

    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expectHeaders(response, WORKER_HEADERS);
  });
});
