/**
 * What every public Markdown file (READMEs and `docs/`) must satisfy: links
 * that lead somewhere, a current review date on each `docs/` file, and nothing
 * that belongs in a secret store or a private note. Pure functions over text,
 * so the tests run them on samples; `check-docs.ts` feeds them the repository.
 */
import { posix } from "node:path";

export interface DocProblem {
  file: string;
  line: number;
  message: string;
}

/**
 * Blanks out code (fenced blocks and inline spans) but keeps the line breaks,
 * so links are found only in prose and line numbers still match the file.
 */
export function withoutCode(markdown: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return markdown
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, blank)
    .replace(/`[^`\n]+`/g, blank);
}

const lineOf = (text: string, index: number) =>
  text.slice(0, index).split("\n").length;

/** Links to other files of the repository: `[text](path)`, not URLs or anchors. */
export function relativeLinks(
  markdown: string,
): { target: string; line: number }[] {
  const prose = withoutCode(markdown);
  const links: { target: string; line: number }[] = [];
  for (const match of prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1] ?? "";
    if (/^([a-z][a-z0-9+.-]*:|#)/i.test(target)) continue;
    links.push({ target, line: lineOf(prose, match.index) });
  }
  return links;
}

/** Each relative link must name a file or folder that exists. */
export function linkProblems(
  file: string,
  markdown: string,
  exists: (path: string) => boolean,
): DocProblem[] {
  return relativeLinks(markdown).flatMap(({ target, line }) => {
    const path = posix.join(
      posix.dirname(file),
      decodeURIComponent(target.split("#")[0] ?? ""),
    );
    return exists(path)
      ? []
      : [{ file, line, message: `broken link: ${target}` }];
  });
}

export const isDocsFile = (file: string) => /(^|\/)docs\/[^/]+\.md$/.test(file);

const isRealDay = (day: string) =>
  !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) &&
  new Date(`${day}T00:00:00Z`).toISOString().startsWith(day);

/**
 * A `docs/` file ends with `Last reviewed: YYYY-MM-DD`, a real day that has
 * come: the date it was last checked against the code.
 */
export function reviewProblems(
  file: string,
  markdown: string,
  today: string,
): DocProblem[] {
  if (!isDocsFile(file)) return [];
  const lines = markdown.trimEnd().split("\n");
  const last = lines.at(-1) ?? "";
  const day = /^Last reviewed: (\d{4}-\d{2}-\d{2})$/.exec(last)?.[1];
  const problem = (message: string) => [{ file, line: lines.length, message }];
  if (!day)
    return problem('missing "Last reviewed: YYYY-MM-DD" as the last line');
  if (!isRealDay(day)) return problem(`not a real day: ${day}`);
  if (day > today) return problem(`reviewed in the future: ${day}`);
  return [];
}

/** Addresses reserved for examples (RFC 2606, RFC 6761, RFC 5737), and loopback. */
const EXAMPLE_EMAIL =
  /@([a-z0-9-]+\.)*(example\.(com|org|net)|[a-z0-9-]+\.(test|example|invalid))$/i;
const EXAMPLE_IP =
  /^(127\.0\.0\.1|0\.0\.0\.0|192\.0\.2\.\d+|198\.51\.100\.\d+|203\.0\.113\.\d+)$/;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

interface Rule {
  pattern: RegExp;
  message: string;
  allowed?: (found: string) => boolean;
}

const RULES: Rule[] = [
  {
    pattern: /postgres(?:ql)?:\/\/[^\s`'")]+/gi,
    message: "a database connection string",
    allowed: (found) =>
      LOCAL_HOST.test(
        found.replace(/^[^/]*\/\/([^@/]*@)?/, "").split("/")[0] ?? "",
      ),
  },
  { pattern: /npg_[A-Za-z0-9]{6,}/g, message: "a Neon password" },
  {
    pattern: /[a-z0-9-]+\.[a-z0-9-.]*neon\.tech/gi,
    message: "a database host",
  },
  {
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    message: "an email address (use an example.com one)",
    allowed: (found) => EXAMPLE_EMAIL.test(found),
  },
  {
    pattern: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g,
    message: "an IP address (use a documentation range, RFC 5737)",
    allowed: (found) => EXAMPLE_IP.test(found),
  },
  {
    pattern: /co-authored-by|generated with|claude code/gi,
    message: "a mention of a development assistant",
  },
];

/** Secrets, hosts, personal addresses and tool credits have no place in public docs. */
export function forbiddenProblems(
  file: string,
  markdown: string,
): DocProblem[] {
  return RULES.flatMap(({ pattern, message, allowed }) =>
    [...markdown.matchAll(pattern)]
      .filter((match) => !allowed?.(match[0]))
      .map((match) => ({
        file,
        line: lineOf(markdown, match.index),
        // Never the text itself: it may be the very secret being reported.
        message,
      })),
  );
}
