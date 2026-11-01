import { citationProseNormalizer } from "./citation-prose";

/** Public prose only. Structured source IDs, research notes and provider reasoning are excluded. */
export type WritingBlock = { key: string; text: string };
export type WritingDraft = { blocks: WritingBlock[]; revision?: number; notices?: string[];
  issueUpdate?: import("./issue-writing").IssueWritingUpdate };

type Frame = { path: string[]; kind: "object" | "array"; key: string; index: number; expectingKey: boolean };

/** Read string values from an unfinished JSON prefix without inventing closing quotes or escaped text. */
export function stringValues(input: string) {
  const values = new Map<string, string>(), stack: Frame[] = [];
  const completed = new Set<string>();
  const path = () => {
    const parent = stack.at(-1);
    return parent ? [...parent.path, parent.kind === "array" ? String(parent.index) : parent.key] : [];
  };
  for (let i = 0; i < input.length; i++) {
    const char = input[i], parent = stack.at(-1);
    if (char === "{" || char === "[") {
      stack.push({ path: path(), kind: char === "{" ? "object" : "array", key: "", index: 0, expectingKey: char === "{" });
    } else if (char === "}" || char === "]") {
      if (parent) completed.add(parent.path.join("/"));
      stack.pop();
    }
    else if (char === "," && parent) {
      if (parent.kind === "array") parent.index++; else parent.expectingKey = true;
    } else if (char === ":" && parent) parent.expectingKey = false;
    else if (char === '"') {
      let value = "", complete = false;
      for (i++; i < input.length; i++) {
        if (input[i] === '"') { complete = true; break; }
        if (input[i] !== "\\") { value += input[i]; continue; }
        const escape = input[++i];
        if (escape === undefined) break;
        if (escape === "u") {
          const hex = input.slice(i + 1, i + 5);
          if (!/^[0-9a-f]{4}$/iu.test(hex)) break;
          value += String.fromCharCode(Number.parseInt(hex, 16)); i += 4;
        } else {
          const escapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
          if (!(escape in escapes)) break;
          value += escapes[escape];
        }
      }
      // Do not render a split Unicode surrogate pair.
      value = value.replace(/[\uD800-\uDBFF]$/u, "");
      if (parent?.kind === "object" && parent.expectingKey) { if (complete) parent.key = value; }
      else if (parent) {
        const key = path().join("/");
        values.set(key, value);
        if (complete) completed.add(key);
      }
    }
  }
  return { values, completed };
}

const publicProse = /^turn\/content\/(?:summary|issues\/\d+\/(?:title|explanation(?:\/\d+\/statement)?|actions\/\d+\/(?:title|description))|conditionalBranches\/\d+\/(?:condition|outcome)|assumptions\/\d+\/(?:statement|impact)|risks\/\d+\/(?:title|explanation)|deadlines\/\d+\/(?:title|calculationMethod)|requiredDocuments\/\d+\/(?:name|reason)|referenceNotes\/\d+\/(?:title|note)|clarificationQuestions\/\d+)$/u;

export function createWritingProjection(onDraft: (draft: WritingDraft) => void,
  normalize = citationProseNormalizer(undefined)) {
  let text = "", previous = "";
  return (delta: string) => {
    text += delta;
    if (text.length > 2 * 1024 * 1024) throw new Error("PROVIDER_BODY_LIMIT");
    const { values, completed } = stringValues(text);
    if (values.get("turn/decision") !== "answer") return;
    const blocks = [...values].filter(([key, value]) => publicProse.test(key) && value.length > 0)
      .map(([key, value]) => {
        const parent = key.slice(0, key.lastIndexOf("/"));
        const sources = `${parent}/${key.endsWith("/summary") ? "summarySourceIds" : "sourceIds"}`;
        if (completed.has(key) && (completed.has(sources) || completed.has(parent))) {
          const ids = [...values].filter(([path]) => path.startsWith(`${sources}/`)).map(([, id]) => id);
          return { key, text: normalize(value, ids) };
        }
        // An annotation may be split across deltas and its support follows the prose.
        // Keep the uncertain suffix private until the same saved-prose rules apply.
        const suffix = /(?<=[.!?…)])[ \t]*(?=\[|【|\(|$)/mu.exec(value);
        return { key, text: suffix ? value.slice(0, suffix.index) : value };
      }).filter(block => block.text.length > 0);
    if (!blocks.length) return;
    const snapshot = JSON.stringify(blocks);
    if (snapshot !== previous) { previous = snapshot; onDraft({ blocks }); }
  };
}
