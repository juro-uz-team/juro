import type { WritingDraft } from "../../lib/legal-answer-workflow/writing-stream";

/** Plain React text keeps unfinished output inert; the saved answer supplies interactive citations. */
export function AnswerWriting({ draft }: { draft: WritingDraft | null }) {
  if (!draft || (!draft.blocks.length && !draft.notices?.length)) return null;
  return <div className="ai-answer-writing" aria-busy="true" data-answer-writing>
    {draft.notices?.map((notice, index) => <p key={`revision-${index}`} role="status" className="ai-answer-revision">{notice}</p>)}
    {draft.blocks.map(block => /\/(?:title|name)$/u.test(block.key)
      ? <h3 key={block.key}>{block.text}</h3>
      : <p key={block.key} style={{ whiteSpace: "pre-wrap" }}>{block.text}</p>)}
  </div>;
}
