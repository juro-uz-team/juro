import { Minus, Plus } from "lucide-react";
import { useMemo } from "react";
import { wordDiff } from "../../lib/document-comparison/diff";
import type { WordDiffPart } from "../../lib/document-comparison/types";
import "./document-report.css";

export function DocumentTextDiff({ before, after, beforeLabel, afterLabel, parts }: {
  before: string | null; after: string | null; beforeLabel: string; afterLabel: string; parts?: WordDiffPart[];
}) {
  const diff = useMemo(() => {
    if (parts?.length
      && parts.filter(part => part.kind !== "added").map(part => part.value).join("") === (before ?? "")
      && parts.filter(part => part.kind !== "removed").map(part => part.value).join("") === (after ?? "")) return parts;
    if ((before?.length ?? 0) + (after?.length ?? 0) <= 6_000) return wordDiff(before, after);
    // Large proposals still retain both complete versions and the explicit replacement marks.
    return [...wordDiff(before, null), ...wordDiff(null, after)];
  }, [before, after, parts]);
  return <div className="document-text-diff">
    <section data-version="before">
      <strong><Minus aria-hidden="true" />{beforeLabel}</strong>
      <p>{before ? diff.map((part, index) => part.kind === "removed"
        ? <del key={index}>{part.value}</del> : part.kind === "same" ? part.value : null) : "—"}</p>
    </section>
    <section data-version="after">
      <strong><Plus aria-hidden="true" />{afterLabel}</strong>
      <p>{after ? diff.map((part, index) => part.kind === "added"
        ? <ins key={index}>{part.value}</ins> : part.kind === "same" ? part.value : null) : "—"}</p>
    </section>
  </div>;
}
