import { describe, expect, it } from "vitest";
import { fadeWords } from "../../../src/features/chat/word-fade.ts";

/* Each word of an answer in its own span, so that only new ones fade in. */

const text = (value: string) => ({ type: "text", value });
const element = (tagName: string, ...children: unknown[]) => ({
  type: "element",
  tagName,
  children,
});

interface Drawn {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: string[] };
  children?: Drawn[];
}

const drawn = (node: unknown): string => {
  const { tagName, value, children = [], properties } = node as Drawn;
  if (value !== undefined) return value;
  const inner = children.map(drawn).join("");
  return properties?.className?.includes("animate-word")
    ? `[${inner}]`
    : tagName
      ? `<${tagName}>${inner}</${tagName}>`
      : inner;
};

const fade = (...children: unknown[]) => {
  const tree = { type: "root", children };
  fadeWords()(tree as Parameters<ReturnType<typeof fadeWords>>[0]);
  return drawn(tree);
};

describe("fadeWords", () => {
  it("puts every word in a span, spaces kept", () => {
    expect(fade(element("p", text("Up 4.2% this month.")))).toBe(
      "<p>[Up ][4.2% ][this ][month.]</p>",
    );
  });

  it("goes into nested elements and leaves the space between blocks alone", () => {
    expect(
      fade(
        element("p", text("Up "), element("strong", text("a lot")), text("!")),
        text("\n"),
        element("ul", element("li", text("one"))),
      ),
    ).toBe(
      "<p>[Up ]<strong>[a ][lot]</strong>[!]</p>\n<ul><li>[one]</li></ul>",
    );
  });

  it("leaves code whole", () => {
    expect(
      fade(
        element("p", element("code", text("a b"))),
        element("pre", element("code", text("x y"))),
      ),
    ).toBe("<p><code>a b</code></p><pre><code>x y</code></pre>");
  });

  it("keeps the words it has as they are when the answer grows", () => {
    const before = fade(element("p", text("Up 4.2%")));
    const after = fade(element("p", text("Up 4.2% this month")));
    expect(after.startsWith(before.slice(0, 6))).toBe(true);
  });
});
