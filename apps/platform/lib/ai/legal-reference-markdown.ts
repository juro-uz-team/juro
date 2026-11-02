import type { Root } from "mdast";
import { inlineReferences, type ReferenceSource } from "./legal-inline-references";

type Node = { type: string; value?: string; url?: string; children?: Node[] };
/** Link text nodes only: never rewrite code, existing links, HTML or Markdown syntax. */
export function legalReferenceMarkdown(sources: readonly ReferenceSource[]) {
  return () => (tree: Root) => {
    const visit = (node: Node) => {
      if (["link", "linkReference", "code", "inlineCode", "html"].includes(node.type) || !node.children) return;
      node.children = node.children.flatMap(child => {
        if (child.type !== "text" || !child.value) { visit(child); return [child]; }
        const text = child.value, references = inlineReferences(text, sources).filter(reference => reference.href);
        const nodes: Node[] = []; let offset = 0;
        for (const reference of references) {
          if (reference.start > offset) nodes.push({ type: "text", value: text.slice(offset, reference.start) });
          nodes.push({ type: "link", url: reference.href, children: [{ type: "text", value: reference.label }] });
          offset = reference.end;
        }
        if (offset < text.length) nodes.push({ type: "text", value: text.slice(offset) });
        return nodes;
      });
    };
    visit(tree);
  };
}
