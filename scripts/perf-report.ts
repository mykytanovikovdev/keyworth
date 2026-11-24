/**
 * How the production Worker spends its time, per route: what `npm run perf`
 * prints from the events `wrangler tail` streams. Pure parsing and arithmetic;
 * `perf.ts` runs the tail. Only each request's method, path, outcome, status,
 * CPU and wall time and where it entered Cloudflare are read: never headers, query
 * strings or bodies. Wall time is the time inside the Worker; with placement
 * (wrangler.jsonc), the hop from the entry location to the Worker comes on
 * top, and the tail does not show it (the response's `cf-placement` header
 * says where the Worker ran).
 */

export interface Sample {
  route: string;
  outcome: string;
  /** The response's HTTP status; null when the Worker gave none. */
  status: number | null;
  cpuMs: number;
  wallMs: number;
  /** The Cloudflare location the request entered at, such as TBS. */
  colo: string | null;
}

/**
 * Splits a stream of JSON objects printed one after another (wrangler prints
 * each event as indented JSON) into whole objects. Returns the objects found
 * and the unfinished rest, to prepend to the next chunk.
 */
export function splitJsonObjects(text: string): {
  objects: string[];
  rest: string;
} {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") {
      if (depth === 0) start = index;
      depth++;
    } else if (char === "}" && depth > 0) {
      depth--;
      if (depth === 0) {
        objects.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return { objects, rest: start === -1 ? "" : text.slice(start) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A request's route: its path with ids as `:id` (a coin such as
 * `crypto:bitcoin`, a record's UUID), so requests group by route rather than
 * by what they asked for.
 */
export function routeOf(method: string, url: string): string {
  const path = new URL(url).pathname
    .split("/")
    .map((segment) => {
      const decoded = decodeURIComponent(segment);
      return /^[a-z]+:/.test(decoded) || UUID.test(decoded) ? ":id" : segment;
    })
    .join("/");
  return `${method} ${path}`;
}

/** One tail event as a sample; null for anything but a request (a cron run). */
export function sampleOf(event: unknown): Sample | null {
  if (typeof event !== "object" || event === null) return null;
  const record = event as Record<string, unknown>;
  const request = (record.event as { request?: Record<string, unknown> } | null)
    ?.request;
  if (!request || typeof request.url !== "string") return null;
  const method = typeof request.method === "string" ? request.method : "GET";
  const cf = (request.cf ?? {}) as Record<string, unknown>;
  const status = (record.event as { response?: { status?: unknown } }).response
    ?.status;
  return {
    route: routeOf(method, request.url),
    outcome: typeof record.outcome === "string" ? record.outcome : "unknown",
    status: typeof status === "number" ? status : null,
    cpuMs: Number(record.cpuTime ?? 0),
    wallMs: Number(record.wallTime ?? 0),
    colo: typeof cf.colo === "string" ? cf.colo : null,
  };
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

export interface RouteSummary {
  route: string;
  count: number;
  cpuMedian: number;
  cpuMax: number;
  wallMedian: number;
  wallMax: number;
  /** Why each failed request failed (`failureOf`), one entry a request. */
  failures: string[];
}

/**
 * Why a request failed: the runtime's outcome, in its own words, when it is not
 * "ok" (an exceeded limit, an exception, a browser that left), else the 5xx our
 * own error handler answered. Null when it did not fail.
 */
function failureOf({ outcome, status }: Sample): string | null {
  if (outcome !== "ok") return outcome;
  return status !== null && status >= 500 ? String(status) : null;
}

/** Per route, slowest wall time first. */
export function summarize(samples: readonly Sample[]): RouteSummary[] {
  const byRoute = new Map<string, Sample[]>();
  for (const sample of samples) {
    byRoute.set(sample.route, [...(byRoute.get(sample.route) ?? []), sample]);
  }
  return [...byRoute]
    .map(([route, list]) => ({
      route,
      count: list.length,
      cpuMedian: median(list.map(({ cpuMs }) => cpuMs)),
      cpuMax: Math.max(...list.map(({ cpuMs }) => cpuMs)),
      wallMedian: median(list.map(({ wallMs }) => wallMs)),
      wallMax: Math.max(...list.map(({ wallMs }) => wallMs)),
      failures: list.flatMap((sample) => failureOf(sample) ?? []),
    }))
    .sort((a, b) => b.wallMedian - a.wallMedian);
}

/** How often each value occurs, most frequent first: "FRA ×12, TBS ×2". */
export function tally(values: readonly (string | null)[]): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value ?? "none";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => `${value} ×${String(count)}`)
    .join(", ");
}

/** The table `npm run perf` prints. */
export function formatReport(samples: readonly Sample[]): string {
  if (samples.length === 0) return "No requests seen.";
  const rows = summarize(samples).map((row) => [
    row.route,
    String(row.count),
    `${String(row.cpuMedian)} / ${String(row.cpuMax)}`,
    `${String(row.wallMedian)} / ${String(row.wallMax)}`,
    tally(row.failures),
  ]);
  const header = [
    "Route",
    "Requests",
    "CPU ms (median / max)",
    "Time ms (median / max)",
    "Not ok",
  ];
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ");
  return [
    line(header),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map(line),
    "",
    `Entered Cloudflare at: ${tally(samples.map(({ colo }) => colo))}`,
    "Time is inside the Worker; the hop to where it runs comes on top.",
  ].join("\n");
}
