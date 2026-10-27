import { argon2id, argon2idAsync } from "@noble/hashes/argon2.js";
import { useState } from "react";
import { CURRENT_KDF_PARAMS } from "../crypto/index.ts";
import { Button, Card } from "../ui/index.ts";

/*
 * A developer tool, only in dev and design builds: how long Argon2id with the
 * production settings takes on this device. It times the Argon2 computation
 * alone (no WebCrypto), so it also runs on a phone opening the dev server over
 * the local network, which is not a secure context.
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
    </main>
  );
}
