import {z} from "zod";

/** Discovery proposals, never evidence or an assessment of legal coverage. */
export const initialResearchPlanSchema=z.object({queries:z.array(z.object({
  text:z.string().trim().min(1).max(900)
    .describe("A complete concise indexed search query. Use separate queries for distinct concepts or languages; preserve material qualifications without truncation. Public-site discovery is separate."),
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
