import {z} from "zod";
import type {LegalChatRequest} from "./provider";
import {legalSourcePassages} from "./legal-source-passages";

/** Request-local navigation into complete evidence. Labels never establish relevance. */
export function guidanceGapEvidence(input: LegalChatRequest) {
  const sources = structuredClone(input.sources);
  const passages = legalSourcePassages(sources, input.locale);
  const catalog = new Map(passages.map(passage => [passage.id, passage]));
  const copied = z.object({quotation: z.string(), sourceId: z.string(), reason: z.string()}).strict();
  const referenced = z.object({passageIds: z.array(z.enum(passages.map(passage => passage.id)))
    .min(1).max(Math.max(1, passages.length)), reason: z.string()}).strict();
  const schema = passages.length ? z.union([referenced, copied]) : copied;
  type Witness = {sourceId: string; sourceSpanId: string; quotation: string};
  const valid = (quotation: string) => quotation.trim().length > 0 && quotation.length <= 2_000;
  return {
    schema,
    sources: sources.map(source => ({...source, spans: source.spans?.map(span => {
      const parts = passages.filter(passage => passage.sourceId === source.id && passage.sourceSpanId === span.id);
      if (!parts.length) return span;
      const {text, ...metadata} = span;
      if (parts.map(part => part.text).join("") !== text) throw new TypeError("LEGAL_PASSAGE_CONTEXT_UNAVAILABLE");
      return {...metadata, sentences: parts.map(part => ({sourcePassageId: part.id, text: part.text}))};
    })})),
    resolve(gaps: readonly z.infer<typeof schema>[]): Witness[] {
      const witnesses = gaps.flatMap((gap): Witness[] => {
        if ("quotation" in gap) {
          const source = sources.find(source => source.id === gap.sourceId);
          const span = valid(gap.quotation) && source?.sourceClass === "OFFICIAL_LEGISLATION" && source.status === "verified"
            ? source.spans?.find(span => span.quality === "high" && span.text.includes(gap.quotation)) : undefined;
          return span ? [{sourceId: source!.id, sourceSpanId: span.id, quotation: gap.quotation}] : [];
        }
        if (new Set(gap.passageIds).size !== gap.passageIds.length) return [];
        const runs: Array<Array<(typeof passages)[number]>> = [];
        for (const id of gap.passageIds) {
          const part = catalog.get(id);
          if (!part) return [];
          const last = runs.at(-1)?.at(-1);
          if (last && last.sourceId === part.sourceId && last.sourceSpanId === part.sourceSpanId && last.end === part.start) {
            runs.at(-1)!.push(part);
          } else runs.push([part]);
        }
        const resolved = runs.map(parts => ({sourceId: parts[0]!.sourceId, sourceSpanId: parts[0]!.sourceSpanId,
          quotation: parts.map(part => part.text).join("")}));
        return resolved.every(witness => valid(witness.quotation)) ? resolved : [];
      });
      const unique = [...new Map(witnesses.map(witness => [JSON.stringify(witness), witness])).values()];
      return unique.length <= 20 ? unique : [];
    },
  };
}
