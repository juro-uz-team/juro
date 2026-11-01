import type { WritingDraft } from "../../lib/legal-answer-workflow/writing-stream";
import type { PlatformLocale } from "../../lib/platform/routing";

/** Plain React text keeps unfinished output inert; the saved answer supplies interactive citations. */
export function AnswerWriting({ draft, locale = "en" }: { draft: WritingDraft | null; locale?: PlatformLocale }) {
  if (!draft || (!draft.blocks.length && !draft.notices?.length)) return null;
  const main = { en: "Key point", ru: "Главное", uz: "Asosiysi" }[locale];
  const groups = new Map<string, typeof draft.blocks>();
  for (const block of draft.blocks) {
    const key = block.key.replace(/^turn\/content\//u, "").split("/").slice(0, 2).join("/");
    const blocks = groups.get(key) ?? [];
    blocks.push(block);
    groups.set(key, blocks);
  }
  return <div className="legal-answer ai-answer-writing" aria-busy="true" data-answer-writing>
    {draft.notices?.map((notice, index) => <p key={`revision-${index}`} role="status" className="ai-answer-revision">{notice}</p>)}
    {[...groups].map(([key, blocks], index) => <section key={key} className={`legal-answer__section${index === 0 ? " legal-answer__section--main" : ""}`}>
      {key === "summary" && <h2>{main}</h2>}
      {blocks.map(block => /\/(?:title|name)$/u.test(block.key)
        ? <h2 key={block.key}>{block.text}</h2>
        : <p key={block.key} style={{ whiteSpace: "pre-wrap" }}>{block.text}</p>)}
    </section>)}
  </div>;
}
