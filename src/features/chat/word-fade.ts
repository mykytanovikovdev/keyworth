/*
 * Each word of an answer being streamed fades in, as the design system's
 * `animate-word` (src/ui/README.md, Motion): the newest few are partly
 * transparent at once, a soft trailing edge. A plugin for the markdown renderer:
 * it wraps words in spans as the tree is drawn. Words already there keep their
 * place, so React leaves them alone and only new ones fade. Code is left whole.
 */

interface Node {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
}

const WHOLE = new Set(["code", "pre"]);

function faded(text: string): Node[] {
  return text.split(/(?<=\s)(?=\S)/).map((word) =>
    word.trim() === ""
      ? { type: "text", value: word }
      : {
          type: "element",
          tagName: "span",
          properties: { className: ["animate-word"] },
          children: [{ type: "text", value: word }],
        },
  );
}

function wrap(node: Node) {
  if (!node.children || WHOLE.has(node.tagName ?? "")) return;
  node.children = node.children.flatMap((child) => {
    if (child.type === "text" && child.value && child.value.trim() !== "") {
      return faded(child.value);
    }
    wrap(child);
    return [child];
  });
}

export const fadeWords = () => (tree: Node) => {
  wrap(tree);
};
