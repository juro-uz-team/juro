import { z } from "zod";
import { citationProseNormalizer } from "./citation-prose";

const object = z.record(z.string(), z.unknown());
const statements = z.array(z.object({
  statement: z.string().min(1).max(4000),
  sourceIds: z.array(z.string().min(1)).min(1).max(24),
}).strict()).min(1).max(24);

/** Compose each rule with its own support before grouping it for saved presentation. */
export function configureStatementCitations(schema: Record<string, unknown>) {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const parsed = object.safeParse(value);
    if (!parsed.success) return;
    const node = parsed.data;
    const properties = object.safeParse(node.properties);
    if (properties.success) {
      const fields = properties.data;
      if (fields.explanation && fields.requirementIds && fields.actions && fields.sourceIds) {
        node.properties = { ...fields, explanation: { type: "array", minItems: 1, maxItems: 24,
          description: "Compose separate legal statements with their exact supporting sources. Retain each rule's material conditions, exceptions, time limits and application. The combined statement text must fit within 4000 characters.",
          items: { type: "object", properties: { statement: fields.explanation, sourceIds: fields.sourceIds },
            required: ["statement", "sourceIds"], additionalProperties: false } } };
        delete (node.properties as Record<string, unknown>).sourceIds;
        if (Array.isArray(node.required)) node.required = node.required.filter(key => key !== "sourceIds");
        Object.assign(value as object, node);
      }
    }
    Object.values(node).forEach(visit);
  };
  visit(schema);
}

/** Canonical validation and active-handle binding still run after citation formatting and grouping. */
export function restoreStatementCitations(value: unknown, prose = citationProseNormalizer(undefined)): unknown {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    const parsed = object.safeParse(value);
    if (!parsed.success) return value;
    const node = parsed.data;
    const ids = z.array(z.string()).safeParse(node.sourceIds);
    return Object.fromEntries(Object.entries(node).map(([key, child]) => [key,
      typeof child === "string" && ids.success ? prose(child, ids.data)
        : key === "summary" && typeof child === "string" && Array.isArray(node.summarySourceIds)
          ? prose(child, z.array(z.string()).parse(node.summarySourceIds)) : normalize(child)]));
  };
  const response = object.parse(normalize(value));
  const turn = object.parse(response.turn);
  if (turn.content == null) return value;
  const content = object.parse(turn.content);
  const issues = z.array(object).parse(content.issues).map(issue => {
    if ("sourceIds" in issue) throw new Error("PROVIDER_OUTPUT_INVALID");
    const parts = statements.parse(issue.explanation);
    return { ...issue, explanation: parts.map(part => part.statement).join("\n\n"),
      sourceIds: [...new Set(parts.flatMap(part => part.sourceIds))] };
  });
  return { ...response, turn: { ...turn, content: { ...content, issues } } };
}
