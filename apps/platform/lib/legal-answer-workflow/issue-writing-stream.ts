import { issueWritingHeaderSchema } from "./issue-writing";
import { citationProseNormalizer } from "./citation-prose";
import { stringValues, type WritingDraft } from "./writing-stream";

/** Only the dedicated issue tool exposes prose; source bindings must precede it. */
export function createIssueWritingProjection(onDraft: (draft: WritingDraft) => void, sources: ReadonlySet<string>,
  normalize = citationProseNormalizer(undefined)) {
  let text = "";
  const previous = new Map<number, string>();
  return (delta: string) => {
    text += delta;
    if (text.length > 2 * 1024 * 1024) throw new Error("PROVIDER_BODY_LIMIT");
    const { values, completed } = stringValues(text);
    for (let index = 0; index < 4; index++) {
      const path = `updates/${index}`;
      const fields = ["id", "baseVersion", "change", "reason"];
      if (!fields.every(field => completed.has(`${path}/${field}`)) || !completed.has(`${path}/sourceIds`)) continue;
      const sourceIds = [...values].filter(([key]) => key.startsWith(`${path}/sourceIds/`)).map(([, value]) => value);
      const update = issueWritingHeaderSchema.parse({ ...Object.fromEntries(fields.map(field => [field, values.get(`${path}/${field}`)])), sourceIds });
      if (sourceIds.some(id => !sources.has(id))) throw new Error("ISSUE_SUPPORT_INVALID");
      const blocks = [...values].filter(([key]) => new RegExp(`^${path}/content/(?:title|explanation|actions/\\d+/(?:title|description))$`).test(key))
        .map(([key, value]) => {
          // The header admits only acquired law. Annotation removal additionally
          // requires the citations attached to this exact issue or action.
          const parent = key.slice(0, key.lastIndexOf("/")), support = `${parent}/sourceIds`;
          const issueProse = parent === `${path}/content`;
          const bound = issueProse || completed.has(support) || completed.has(parent);
          const ids = issueProse ? sourceIds : [...values].filter(([path]) => path.startsWith(`${support}/`)).map(([, id]) => id);
          if (bound && ids.some(id => !sourceIds.includes(id))) throw new Error("ISSUE_SUPPORT_INVALID");
          const suffix = /(?<=[.!?…)])[ \t]*(?=\[|【|\(|$)/mu.exec(value);
          return { key: key.replace(`${path}/content`, `issue/${update.id}`),
            text: completed.has(key) && bound ? normalize(value, ids) : suffix ? value.slice(0, suffix.index) : value };
        }).filter(block => block.text.length > 0);
      if (!blocks.length && update.change !== "retract") continue;
      const snapshot = JSON.stringify({ blocks, issueUpdate: update });
      if (snapshot !== previous.get(index)) { previous.set(index, snapshot); onDraft({ blocks, issueUpdate: update }); }
    }
  };
}
