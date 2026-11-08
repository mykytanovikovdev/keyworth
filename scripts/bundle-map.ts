/**
 * How much of a built chunk each source file and package accounts for, read
 * from the chunk's source map. Pure functions; `bundle-size.ts` builds the app
 * and prints the result. A small decoder instead of a source-map library: the
 * format's "mappings" field is base64 VLQ, and sizes need nothing else.
 */

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** The numbers in one segment of a "mappings" string (base64 VLQ). */
export function decodeVlq(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = BASE64.indexOf(char);
    if (digit === -1) throw new Error(`Not base64: ${char}`);
    value += (digit & 31) * 2 ** shift;
    if (digit & 32) {
      shift += 5;
    } else {
      values.push(value & 1 ? -Math.floor(value / 2) : Math.floor(value / 2));
      value = 0;
      shift = 0;
    }
  }
  return values;
}

export interface SourceMap {
  sources: string[];
  mappings: string;
}

/**
 * Characters of `code` per source file: each mapped span runs from its
 * segment to the next one on the line, or to the line's end. Unmapped code
 * (the bundler's own glue) counts under "(unmapped)".
 */
export function sizesBySource(
  code: string,
  map: SourceMap,
): Map<string, number> {
  const sizes = new Map<string, number>();
  const add = (source: string, length: number) => {
    if (length > 0) sizes.set(source, (sizes.get(source) ?? 0) + length);
  };
  const lines = code.split("\n");
  let sourceIndex = 0;
  map.mappings.split(";").forEach((lineMappings, lineIndex) => {
    const lineLength = lines[lineIndex]?.length ?? 0;
    let column = 0;
    let mapped = 0;
    const spans: { column: number; source: string | null }[] = [];
    for (const segment of lineMappings.split(",")) {
      if (segment === "") continue;
      const [columnDelta = 0, sourceDelta] = decodeVlq(segment);
      column += columnDelta;
      if (sourceDelta === undefined) {
        spans.push({ column, source: null });
      } else {
        sourceIndex += sourceDelta;
        spans.push({ column, source: map.sources[sourceIndex] ?? "?" });
      }
    }
    spans.forEach((span, index) => {
      const end = spans[index + 1]?.column ?? lineLength;
      const length = end - span.column;
      mapped += length;
      add(span.source ?? "(unmapped)", length);
    });
    add("(unmapped)", lineLength - mapped);
  });
  return sizes;
}

/**
 * The package a source belongs to (`react-aria`, `@noble/hashes`), or the
 * project folder (`src/features`, `shared/schemas`) for the app's own code.
 */
export function groupOf(source: string): string {
  const inModules = source.split("node_modules/").at(-1);
  if (inModules !== undefined && inModules !== source) {
    const [first = "", second = ""] = inModules.split("/");
    return first.startsWith("@") ? `${first}/${second}` : first;
  }
  const project = /(?:^|\/)((?:src|shared|worker)\/[^/]+)/.exec(source);
  return project?.[1] ?? source.replace(/^(\.\.\/)+/, "");
}

/** Sizes summed per group, largest first. */
export function sizesByGroup(
  sizes: Map<string, number>,
): [group: string, size: number][] {
  const groups = new Map<string, number>();
  for (const [source, size] of sizes) {
    const group = groupOf(source);
    groups.set(group, (groups.get(group) ?? 0) + size);
  }
  return [...groups].sort((a, b) => b[1] - a[1]);
}
