import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// WCAG 2.2 AA: 4.5:1 for text, 3:1 for UI components and focus indicators.
const TEXT = 4.5;
const UI = 3;

const THEMES = ["light", "dark"] as const;

const REQUIRED_TOKENS = [
  "canvas",
  "surface",
  "raised",
  "hover",
  "bubble",
  "fg",
  "fg-muted",
  "line",
  "line-strong",
  "accent",
  "on-accent",
  "accent-soft",
  "focus",
  "gain",
  "gain-soft",
  "loss",
  "loss-soft",
  "warning",
  "warning-soft",
];

// [foreground, backgrounds it appears on, minimum ratio]
const PAIRS: [string, string[], number][] = [
  ["fg", ["canvas", "surface", "raised", "hover", "bubble"], TEXT],
  ["fg-muted", ["canvas", "surface", "raised", "bubble"], TEXT],
  ["on-accent", ["accent"], TEXT],
  ["accent", ["canvas", "surface", "raised"], TEXT],
  ["line-strong", ["canvas", "surface", "raised"], UI],
  ["focus", ["canvas", "surface", "raised"], UI],
  ["gain", ["canvas", "surface", "raised", "gain-soft"], TEXT],
  ["loss", ["canvas", "surface", "raised", "loss-soft"], TEXT],
  ["warning", ["canvas", "surface", "raised", "warning-soft"], TEXT],
];

type Tokens = Record<string, string>;

function parseBlocks(css: string): Map<string, Tokens> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // Media blocks only adjust motion; drop them so they don't override colors.
  const withoutMedia = withoutComments.replace(
    /@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,
    "",
  );
  const blocks = new Map<string, Tokens>();
  for (const match of withoutMedia.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? "").trim();
    const tokens: Tokens = { ...blocks.get(selector) };
    for (const declaration of (match[2] ?? "").matchAll(
      /--kw-([\w-]+):\s*([^;]+);/g,
    )) {
      tokens[declaration[1] ?? ""] = (declaration[2] ?? "").trim();
    }
    blocks.set(selector, tokens);
  }
  return blocks;
}

function resolve(blocks: Map<string, Tokens>, theme: string): Tokens {
  return {
    ...blocks.get(":root"),
    ...(theme === "dark" ? blocks.get(':root[data-theme="dark"]') : {}),
  };
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`Expected #rrggbb, got ${hex}`);
  const value = parseInt(match[1], 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(
    (channel) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    },
  );
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

const blocks = parseBlocks(readFileSync("design/prototype/tokens.css", "utf8"));

describe.each(THEMES)("%s theme", (theme) => {
  const tokens = resolve(blocks, theme);

  it("defines every semantic color token", () => {
    const missing = REQUIRED_TOKENS.filter((name) => !tokens[name]);
    expect(missing).toEqual([]);
  });

  it.each(PAIRS)(
    "%s meets its contrast minimum",
    (foreground, backgrounds, minimum) => {
      const failures = backgrounds
        .map((background) => {
          const ratio = contrast(
            tokens[foreground] ?? "",
            tokens[background] ?? "",
          );
          return { background, ratio: Math.round(ratio * 100) / 100 };
        })
        .filter(({ ratio }) => ratio < minimum);
      expect(failures, `${foreground} needs ${String(minimum)}:1`).toEqual([]);
    },
  );
});
