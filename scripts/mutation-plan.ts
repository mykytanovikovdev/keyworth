/**
 * A mutation plan: deliberate one-line breakages of the code, each of which a
 * test should catch. Pure parsing and text replacement; `mutate.ts` applies the
 * plan to the files and runs the tests.
 *
 * The plan is a JSON file, written for one branch and not kept in the
 * repository:
 *
 *   {
 *     "command": ["npx", "vitest", "run", "--project", "unit", "tests/unit/x"],
 *     "mutations": [
 *       { "label": "no NFC", "file": "shared/schemas/text.ts",
 *         "from": ".normalize(\"NFC\")", "to": "" }
 *     ]
 *   }
 *
 * A mutation may name its own `command` instead of the plan's.
 */

export interface Mutation {
  label: string;
  file: string;
  from: string;
  to: string;
  command: string[];
}

const isCommand = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((part) => typeof part === "string" && part !== "");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The plan's mutations, each with its command; throws on a malformed plan. */
export function parsePlan(json: string): Mutation[] {
  const plan: unknown = JSON.parse(json);
  if (!isRecord(plan) || !Array.isArray(plan.mutations)) {
    throw new Error('A plan is an object with a "mutations" list.');
  }
  const fallback = plan.command;
  return plan.mutations.map((entry: unknown, index) => {
    const where = `mutation ${String(index + 1)}`;
    if (!isRecord(entry)) throw new Error(`${where} is not an object.`);
    const { label, file, from, to } = entry;
    const command = entry.command ?? fallback;
    if (typeof label !== "string" || label === "") {
      throw new Error(`${where} has no "label".`);
    }
    if (typeof file !== "string" || file === "") {
      throw new Error(`${where} (${label}) has no "file".`);
    }
    if (typeof from !== "string" || from === "" || typeof to !== "string") {
      throw new Error(`${where} (${label}) needs "from" (not empty) and "to".`);
    }
    if (from === to) {
      throw new Error(`${where} (${label}) changes nothing.`);
    }
    if (!isCommand(command)) {
      throw new Error(
        `${where} (${label}) has no "command", nor has the plan.`,
      );
    }
    return { label, file, from, to, command };
  });
}

/**
 * The source with `from` replaced by `to`, or null unless `from` occurs
 * exactly once: an ambiguous or stale mutation must not break the wrong line.
 */
export function replaceOnce(
  source: string,
  from: string,
  to: string,
): string | null {
  const first = source.indexOf(from);
  if (first === -1 || source.includes(from, first + 1)) return null;
  return source.slice(0, first) + to + source.slice(first + from.length);
}
