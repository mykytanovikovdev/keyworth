/**
 * CPU and time per route on production, live. Streams the Worker's events
 * with `wrangler tail` (your wrangler login) while you use the app, and prints
 * a table per route when stopped with Ctrl+C, or after `--seconds N`.
 *
 * Usage: `npm run perf` or `npm run perf -- --seconds 120`. Nothing is written
 * to disk: the events stay in memory and only their timings are kept.
 */
import { spawn } from "node:child_process";
import {
  formatReport,
  type Sample,
  sampleOf,
  splitJsonObjects,
} from "./perf-report.ts";

const secondsArg = process.argv.indexOf("--seconds");
const seconds =
  secondsArg === -1 ? null : Number(process.argv[secondsArg + 1] ?? "");
if (seconds !== null && !(seconds > 0)) {
  console.error("Usage: npm run perf [-- --seconds N]");
  process.exit(2);
}

const samples: Sample[] = [];
let pending = "";

const tail = spawn(
  "npx",
  ["wrangler", "tail", "keyworth", "--format", "json"],
  {
    stdio: ["ignore", "pipe", "inherit"],
  },
);

tail.stdout.setEncoding("utf8");
tail.stdout.on("data", (chunk: string) => {
  const { objects, rest } = splitJsonObjects(pending + chunk);
  pending = rest;
  for (const text of objects) {
    const sample = sampleOf(JSON.parse(text));
    if (sample) {
      samples.push(sample);
      process.stderr.write(
        `\r${String(samples.length)} requests seen. Ctrl+C for the report.`,
      );
    }
  }
});

let reported = false;
const report = () => {
  if (reported) return;
  reported = true;
  tail.kill("SIGINT");
  // Exit once the report is out: to a pipe, a write finishes later, and
  // exiting at once loses it.
  process.stdout.write(`\n\n${formatReport(samples)}\n`, () => {
    process.exit(0);
  });
};

process.on("SIGINT", report);
if (seconds !== null) setTimeout(report, seconds * 1000);
tail.on("exit", report);
console.error(
  "Watching the production Worker. Use the app, then press Ctrl+C for the report.",
);
