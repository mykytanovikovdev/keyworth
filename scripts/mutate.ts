/**
 * Checks that the tests would notice a broken line. For each mutation in a
 * plan (format: `mutation-plan.ts`), it breaks the line, runs the tests, and
 * puts the file back, whatever happens. A mutation the tests miss "survives".
 *
 * Usage: `npm run mutate -- <plan.json>`. Exits non-zero if the tests fail
 * before any change, if a mutation does not match exactly one place, or if any
 * mutation survives.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parsePlan, replaceOnce, type Mutation } from "./mutation-plan.ts";

const planPath = process.argv[2];
if (!planPath) {
  console.error("Usage: npm run mutate -- <plan.json>");
  process.exit(2);
}

const mutations = parsePlan(readFileSync(planPath, "utf8"));

const passes = (command: string[]) =>
  spawnSync(command[0] ?? "", command.slice(1), { stdio: "ignore" }).status ===
  0;

// Every mutation must match before anything is touched.
const unmatched = mutations.filter(
  ({ file, from, to }) =>
    replaceOnce(readFileSync(file, "utf8"), from, to) === null,
);
if (unmatched.length > 0) {
  for (const { label, file } of unmatched) {
    console.error(`Not exactly one match: ${label} (${file})`);
  }
  process.exit(1);
}

// A test command that already fails would "catch" every mutation.
const commands = [
  ...new Map(mutations.map((m) => [m.command.join(" "), m.command])).values(),
];
for (const command of commands) {
  if (!passes(command)) {
    console.error(`Fails before any change: ${command.join(" ")}`);
    process.exit(1);
  }
}

// The file being changed right now, restored on Ctrl+C as well.
let pending: { file: string; source: string } | null = null;
const restore = () => {
  if (pending) writeFileSync(pending.file, pending.source);
  pending = null;
};
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    restore();
    process.exit(130);
  });
}

const survivors: Mutation[] = [];
for (const mutation of mutations) {
  const source = readFileSync(mutation.file, "utf8");
  pending = { file: mutation.file, source };
  try {
    writeFileSync(
      mutation.file,
      replaceOnce(source, mutation.from, mutation.to) ?? source,
    );
    const caught = !passes(mutation.command);
    console.log(`${caught ? "caught  " : "SURVIVED"}  ${mutation.label}`);
    if (!caught) survivors.push(mutation);
  } finally {
    restore();
  }
}

console.log(
  `${String(mutations.length - survivors.length)} of ${String(mutations.length)} caught.`,
);
if (survivors.length > 0) process.exit(1);
