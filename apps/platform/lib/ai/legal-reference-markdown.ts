import type { Root } from "mdast";
import { inlineReferences, officialReferenceUrl, type ReferenceSource } from "./legal-inline-references";

type Node = { type: string; value?: string; url?: string; children?: Node[] };
/** Link text nodes and prefer a retained original PDF for links to that citation. */
export function legalReferenceMarkdown(sources: readonly ReferenceSource[], supportingLinks: readonly {label: string; href: string}[] = []) {
  const pdfTargets = new Map<string, Set<string>>();
  for (const source of sources) {
    const url = officialReferenceUrl(source.originalUrl), pdf = officialReferenceUrl(source.officialPdfUrl ?? "");
    if (!url || !pdf) continue;
    const document = new URL(url); document.hash = "";
    for (const key of [url, document.href]) {
      const targets = pdfTargets.get(key) ?? new Set<string>();
      targets.add(pdf); pdfTargets.set(key, targets);
    }
  }
  return () => (tree: Root) => {
    const visit = (node: Node) => {
      if (node.type === "link" && node.url) {
        const targets = pdfTargets.get(officialReferenceUrl(node.url) ?? "");
        if (targets?.size === 1) node.url = [...targets][0];
        return;
      }
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
    if (supportingLinks.length) {
      const links: Node[] = [{type:"text",value:" ("}];
      supportingLinks.forEach((link,index)=>{
        if(index) links.push({type:"text",value:"; "});
        links.push({type:"link",url:link.href,children:[{type:"text",value:link.label}]});
      });
      links.push({type:"text",value:")"});
      const root=tree as Node, last=root.children?.at(-1);
      if(last?.type==="paragraph") last.children!.push(...links);
      else root.children!.push({type:"paragraph",children:links});
    }
  };
}
