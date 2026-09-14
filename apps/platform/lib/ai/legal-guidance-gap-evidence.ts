import {z} from "zod";
import type {LegalChatRequest} from "./provider";
import {legalSourcePassages, legalSourceSentenceView, legalSourcePassageWitnesses} from "./legal-source-passages";

/** Request-local navigation into complete evidence. Labels never establish relevance. */
export function guidanceGapEvidence(input: LegalChatRequest) {
  const sources = structuredClone(input.sources);
  const passages = legalSourcePassages(sources, input.locale);
  const copied = z.object({quotation: z.string(), sourceId: z.string(), reason: z.string()}).strict();
  const referenced = z.object({passageIds: z.array(z.enum(passages.map(passage => passage.id)))
    .min(1).max(Math.max(1, passages.length)), reason: z.string()}).strict();
  const schema = passages.length ? z.union([referenced, copied]) : copied;
  type Witness = {sourceId: string; sourceSpanId: string; quotation: string};
  const valid = (quotation: string) => quotation.trim().length > 0 && quotation.length <= 2_000;
  return {
    schema,
    sources: legalSourceSentenceView(sources, passages),
    resolve(gaps: readonly z.infer<typeof schema>[]): Witness[] {
      const witnesses = gaps.flatMap((gap): Witness[] => {
        if ("quotation" in gap) {
          const source = sources.find(source => source.id === gap.sourceId);
          const span = valid(gap.quotation) && source?.sourceClass === "OFFICIAL_LEGISLATION" && source.status === "verified"
            ? source.spans?.find(span => span.quality === "high" && span.text.includes(gap.quotation)) : undefined;
          return span ? [{sourceId: source!.id, sourceSpanId: span.id, quotation: gap.quotation}] : [];
        }
        const resolved = legalSourcePassageWitnesses(passages, gap.passageIds);
        return resolved?.every(witness => valid(witness.quotation)) ? resolved : [];
      });
      const unique = [...new Map(witnesses.map(witness => [JSON.stringify(witness), witness])).values()];
      return unique.length <= 20 ? unique : [];
    },
  };
}
