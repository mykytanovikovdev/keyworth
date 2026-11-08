/**
 * Fails when a public Markdown file (a README or a file in a `docs/` folder)
 * has a broken relative link, a `docs/` file lacks a current "Last reviewed"
 * date, or a file holds a connection string, a database host, a real email or
 * IP address, or a credit to a development assistant. Usage: `npm run
 * docs:check` (part of `npm run check`). The rules: `docs-policy.ts`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  forbiddenProblems,
  linkProblems,
  reviewProblems,
} from "./docs-policy.ts";

// Tracked files and new ones git would add: never the ignored working notes.
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "*.md"],
  { encoding: "utf8" },
)
  .split("\n")
  .filter((file) => file !== "" && existsSync(file));

const today = new Date().toISOString().slice(0, 10);
const problems = files.flatMap((file) => {
  const markdown = readFileSync(file, "utf8");
  return [
    ...linkProblems(file, markdown, existsSync),
    ...reviewProblems(file, markdown, today),
    ...forbiddenProblems(file, markdown),
  ];
});

if (problems.length > 0) {
  console.error(
    `Docs check failed: ${String(problems.length)} problem(s) in ${String(files.length)} files.`,
  );
  for (const { file, line, message } of problems) {
    console.error(`  ${file}:${String(line)}  ${message}`);
  }
  console.error("See scripts/README.md for the rules.");
  process.exit(1);
}

console.log(`Docs check passed: ${String(files.length)} files.`);
