import { describe, expect, it } from "vitest";
import {
  forbiddenProblems,
  linkProblems,
  relativeLinks,
  reviewProblems,
} from "../../scripts/docs-policy.ts";

describe("relative links", () => {
  it("finds links to files, with their lines, and skips URLs and anchors", () => {
    const markdown = [
      "See [the model](docs/threat-model.md#keys).",
      "[Site](https://keyworth.app) [Mail](mailto:a@example.com) [Up](#top)",
      "[Parent](../README.md)",
    ].join("\n");

    expect(relativeLinks(markdown)).toEqual([
      { target: "docs/threat-model.md#keys", line: 1 },
      { target: "../README.md", line: 3 },
    ]);
  });

  it("ignores links inside code, which are examples", () => {
    const markdown = ["```md", "[x](missing.md)", "```", "`[y](gone.md)`"].join(
      "\n",
    );

    expect(relativeLinks(markdown)).toEqual([]);
  });

  it("are broken when the target does not exist, relative to the file", () => {
    const exists = (path: string) => path === "src/crypto/docs/argon2.md";
    const markdown = "[Argon2](docs/argon2.md) [Gone](docs/gone.md#part)";

    expect(linkProblems("src/crypto/README.md", markdown, exists)).toEqual([
      {
        file: "src/crypto/README.md",
        line: 1,
        message: "broken link: docs/gone.md#part",
      },
    ]);
  });
});

describe("the review date of a docs/ file", () => {
  const ending = (last: string) => `# Title\n\nText.\n\n${last}\n`;

  it("is the last line, a real day that has come", () => {
    expect(
      reviewProblems(
        "a/docs/x.md",
        ending("Last reviewed: 2026-11-08"),
        "2026-11-08",
      ),
    ).toEqual([]);
  });

  it("is required only in docs/ folders", () => {
    expect(reviewProblems("a/README.md", "# A\n", "2026-11-08")).toEqual([]);
  });

  it.each([
    ["Text.", 'missing "Last reviewed: YYYY-MM-DD" as the last line'],
    ["Last reviewed: 2026-02-30", "not a real day: 2026-02-30"],
    ["Last reviewed: 2026-11-09", "reviewed in the future: 2026-11-09"],
  ])("fails for %j", (last, message) => {
    expect(
      reviewProblems("a/docs/x.md", ending(last), "2026-11-08"),
    ).toMatchObject([{ message }]);
  });
});

describe("what public docs never hold", () => {
  it.each([
    "postgres://owner:secret@ep-name.eu-central-1.aws.neon.tech/db",
    "password npg_AbCdEf123456",
    "write to friend@gmail.com",
    "blocked 85.10.20.30",
    "Generated with some tool",
    "Co-Authored-By: someone",
  ])("flags %j", (text) => {
    expect(forbiddenProblems("README.md", `Intro\n${text}\n`)).not.toEqual([]);
  });

  it("reports the line, not the text, which may be the secret itself", () => {
    const [problem] = forbiddenProblems("README.md", "a\nnpg_AbCdEf123456\n");

    expect(problem).toEqual({
      file: "README.md",
      line: 2,
      message: "a Neon password",
    });
  });

  it.each([
    "postgres://keyworth:keyworth@localhost:5433/keyworth",
    "invite me@example.com or user@keyworth.test",
    "listens on 127.0.0.1:3123; blocks 203.0.113.7 and 198.51.100.0/24",
    "version 1.22.1 of the library, and 10.5.3.2.1",
    "Claude Haiku, the model behind the assistant",
  ])("allows %j", (text) => {
    expect(forbiddenProblems("README.md", text)).toEqual([]);
  });
});
