import { type ReactNode, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { answerClassName } from "./answer-styles.ts";
import { fadeWords } from "./word-fade.ts";

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

interface AnswerProps {
  text: string;
  /** Being written now: its words fade in as they come. */
  streaming?: boolean;
}

export function Answer({ text, streaming = false }: AnswerProps) {
  // As it began: an answer that faded in keeps its words as they are when it
  // ends, and one read back, whole, never fades.
  const [fades] = useState(streaming);
  return (
    <div className={answerClassName}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={fades ? [fadeWords] : []}
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
