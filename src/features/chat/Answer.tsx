import type { ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { answerClassName } from "./answer-styles.ts";

/*
 * An answer's text: the model writes markdown, which becomes plain React
 * elements. No HTML in it is ever rendered (`skipHtml`), nothing loads from
 * elsewhere (no images), and a link shows as its words only: the model cannot
 * put an address in front of someone to click (CLAUDE.md, rule 6).
 */

const strong = ({ children }: { children?: ReactNode }) => (
  <p>
    <strong>{children}</strong>
  </p>
);

const COMPONENTS: Components = {
  a: ({ children }) => <span>{children}</span>,
  // Headings read as a bold line: an answer is a short reply, not a document.
  h1: strong,
  h2: strong,
  h3: strong,
  h4: strong,
  h5: strong,
  h6: strong,
  // A wide table scrolls by itself, never the page.
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
};

export function Answer({ text }: { text: string }) {
  return (
    <div className={answerClassName}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={["img"]}
        unwrapDisallowed
        components={COMPONENTS}
      >
        {text}
      </Markdown>
    </div>
  );
}
