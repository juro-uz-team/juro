import {z} from "zod";
import {MAX_OFFICIAL_RESEARCH_QUERY_CHARACTERS} from "./research-formulation";

/** Discovery proposals, never evidence or an assessment of legal coverage. */
export const initialResearchPlanSchema=z.object({queries:z.array(z.object({
  text:z.string().trim().min(1).max(MAX_OFFICIAL_RESEARCH_QUERY_CHARACTERS)
    .describe("A complete concise publisher search query, at most 100 characters. Use separate queries for distinct concepts or languages; never truncate a longer question."),
  topicIndices:z.array(z.number().int().min(0).max(23)).min(1).max(24),
  privateNameSpans:z.array(z.string().trim().min(1).max(300)).max(24),
  legalTitleSpans:z.array(z.string().trim().min(3).max(300)).max(12),
}).strict()).min(1).max(20)}).strict();
export type InitialResearchQueries=z.infer<typeof initialResearchPlanSchema>["queries"];

export function validateInitialResearchQueries(value:unknown,topics:readonly string[]):InitialResearchQueries {
  const {queries}=initialResearchPlanSchema.parse({queries:value});
  if(queries.some(query=>query.topicIndices.some(index=>index>=topics.length)))throw Error("RESEARCH_QUERY_TOPIC_INVALID");
  if(topics.some((_,index)=>!queries.some(query=>query.topicIndices.includes(index))))throw Error("RESEARCH_QUERY_TOPIC_MISSING");
  return queries;
}
