import { argon2id, argon2idAsync } from "@noble/hashes/argon2.js";
import { useState } from "react";
import { CURRENT_KDF_PARAMS } from "../crypto/index.ts";
import { Button, Card } from "../ui/index.ts";

/*
 * A developer tool, only in dev and design builds: how long Argon2id with the
 * production settings takes on this device. It times the Argon2 computation
 * alone (no WebCrypto), so it also runs on a phone opening the dev server over
 * the local network. Measure over HTTPS, though: WebKit runs JavaScript many
 * times slower on a page that is not a secure context (plain http to an IP).
 */

const RFC_9106_TAG =
  "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659";

function matchesRfc9106(): boolean {
  const filled = (length: number, byte: number) =>
    new Uint8Array(length).fill(byte);
  const tag = argon2id(filled(32, 1), filled(16, 2), {
    t: 3,
    m: 32,
    p: 4,
    dkLen: 32,
    key: filled(8, 3),
    personalization: filled(12, 4),
  });
  return (
    Array.from(tag, (b) => b.toString(16).padStart(2, "0")).join("") ===
    RFC_9106_TAG
  );
}

const median = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/*
 * When a derivation is slow on some device, these tell the computation from the
 * pauses between its slices: compute-bound and tens of times slower than on a
 * laptop means the engine is not optimizing (WebKit on a page that is not a
 * secure context, or Lockdown Mode); fast compute with slow pauses points at
 * the scheduling instead.
 */
type Probe = "compute" | "js-loop" | "yield" | "timeout" | "few-yields";

const LOOP_ITERATIONS = 20_000_000;

function jsLoop(n: number): number {
  let x = 0;
  for (let i = 0; i < n; i++) x = ((x + i) ^ (x >>> 3)) | 0;
  return x;
}

const PROBES: { id: Probe; label: string }[] = [
  { id: "compute", label: "Compute only (8 MiB, 1 pass, no yields)" },
  { id: "js-loop", label: "A plain JavaScript loop" },
  { id: "yield", label: "One scheduler.yield(), average of 30" },
  { id: "timeout", label: "One setTimeout(0), average of 30" },
  { id: "few-yields", label: "Production Argon2, yielding once a second" },
];

async function averageWait(next: () => Promise<unknown>): Promise<string> {
  const started = performance.now();
  for (let i = 0; i < 30; i++) await next();
  return `${((performance.now() - started) / 30).toFixed(1)} ms`;
}

/** Where the time goes: the computation itself, or the pauses between its slices. */
async function probe(id: Probe): Promise<string> {
  const host = globalThis as { scheduler?: { yield?: () => Promise<void> } };
  switch (id) {
    case "compute": {
      const started = performance.now();
      argon2id(new Uint8Array(24), new Uint8Array(16), {
        t: 1,
        m: 8 * 1024,
        p: 1,
        dkLen: 32,
      });
      return `${String(Math.round(performance.now() - started))} ms`;
    }
    case "js-loop": {
      const started = performance.now();
      jsLoop(LOOP_ITERATIONS);
      return `${String(Math.round(performance.now() - started))} ms`;
    }
    case "yield": {
      const schedulerYield = host.scheduler?.yield?.bind(host.scheduler);
      return schedulerYield ? averageWait(schedulerYield) : "not supported";
    }
    case "timeout":
      return averageWait(
        () => new Promise((resolve) => setTimeout(resolve, 0)),
      );
    case "few-yields": {
      const { memoryKiB, passes, parallelism } = CURRENT_KDF_PARAMS;
      const started = performance.now();
      await argon2idAsync(new Uint8Array(24), new Uint8Array(16), {
        t: passes,
        m: memoryKiB,
        p: parallelism,
        dkLen: 32,
        asyncTick: 1000,
      });
      return `${String(Math.round(performance.now() - started))} ms`;
    }
  }
}

function Diagnostics() {
  const [results, setResults] = useState<Partial<Record<Probe, string>>>({});
  const [running, setRunning] = useState<Probe | null>(null);
  const host = globalThis as { scheduler?: { yield?: unknown } };

  async function run(id: Probe) {
    setRunning(id);
    const result = await probe(id);
    setResults((previous) => ({ ...previous, [id]: result }));
    setRunning(null);
  }

  return (
    <Card className="flex flex-col gap-3 p-5">
      <p className="text-fg-muted">Where the time goes.</p>
      <p className="text-sm">
        Secure context:{" "}
        {isSecureContext ? "yes" : "no (WebKit runs JavaScript far slower)"}.
        scheduler.yield:{" "}
        {typeof host.scheduler?.yield === "function" ? "yes" : "no"}.
      </p>
      <ul className="flex flex-col gap-2">
        {PROBES.map(({ id, label }) => (
          <li key={id} className="flex items-center justify-between gap-3">
            <Button
              size="sm"
              isDisabled={running !== null}
              onPress={() => void run(id)}
            >
              {label}
            </Button>
            <span className="text-sm tabular-nums">
              {running === id ? "Running…" : (results[id] ?? "")}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function KdfBenchmarkPage() {
  const [selfCheck] = useState(matchesRfc9106);
  const [runs, setRuns] = useState<number[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const { memoryKiB, passes, parallelism } = CURRENT_KDF_PARAMS;

  async function run(times: number) {
    setRuns([]);
    setProgress(0);
    for (let i = 0; i < times; i++) {
      const password = crypto.getRandomValues(new Uint8Array(24));
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const started = performance.now();
      await argon2idAsync(password, salt, {
        t: passes,
        m: memoryKiB,
        p: parallelism,
        dkLen: 32,
        onProgress: setProgress,
      });
      const elapsed = Math.round(performance.now() - started);
      setRuns((previous) => [...previous, elapsed]);
    }
    setProgress(null);
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight">
        Argon2id benchmark
      </h1>
      <Card className="flex flex-col gap-3 p-5">
        <p className="text-fg-muted">
          Production settings: {String(memoryKiB / 1024)} MiB, {String(passes)}{" "}
          passes, {String(parallelism)} lane, with @noble/hashes.
        </p>
        <p>RFC 9106 test vector: {selfCheck ? "passed" : "FAILED"}</p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="primary"
            isDisabled={progress !== null}
            onPress={() => void run(1)}
          >
            Run once
          </Button>
          <Button isDisabled={progress !== null} onPress={() => void run(5)}>
            Run 5 times
          </Button>
        </div>
        <p role="status" className="tabular-nums">
          {progress !== null
            ? `Running… ${String(Math.round(progress * 100))}%`
            : runs.length > 0
              ? `Runs: ${runs.map((ms) => `${String(ms)} ms`).join(", ")}. Median: ${String(median(runs))} ms`
              : "Not run yet."}
        </p>
        <p className="text-sm break-words text-fg-muted">
          {navigator.userAgent}
        </p>
      </Card>
      <Diagnostics />
    </main>
  );
}
