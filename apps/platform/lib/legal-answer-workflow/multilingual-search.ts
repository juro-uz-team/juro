import { z } from "zod";
import { transliterateUzbekQueries } from "../legal/uzbek-query-transliterator";

/** Search all language/script variants represented by the prepared corpus.
 * Output language never narrows these formulations or source eligibility. */
export const corpusSearchLanguages = ["en", "ru", "uz-Latn", "uz-Cyrl"] as const;
const formulation = z.string().trim().min(1).max(2000);
export const multilingualQuerySchema = z.object({
  en: formulation.nullable().describe("English formulation, or null when another corpus language is more useful"),
  ru: formulation.nullable().describe("Russian formulation, or null when not needed for this search"),
  "uz-Latn": formulation.nullable().describe("Uzbek Latin formulation, or null when not needed for this search"),
}).strict().describe("Choose the most useful corpus language; set unused languages to null. At least one must contain a formulation. Add another language only for a material discovery need. Uzbek Latin also searches its deterministic Cyrillic transliteration. Preserve actors, conditions, negation and dates.");

const initialFormulation = z.union([formulation, z.array(formulation).min(1).max(2)]).nullable();
const initialQuerySchema = z.object({ en: initialFormulation, ru: initialFormulation, "uz-Latn": initialFormulation })
  .strict().describe("Use one concise formulation for an isolated rule. If distinct material rules interact, distribute complementary formulations across Russian and Uzbek Latin to discover different language editions. Each formulation targets its distinct rule, rather than translating every query. Unused languages are null. Uzbek Latin also searches its deterministic Cyrillic transliteration.");

export function expandedQueryCount(value: unknown): number {
  const query = multilingualQuerySchema.parse(value);
  return Number(query.en !== null) + Number(query.ru !== null) + (query["uz-Latn"] !== null ? 2 : 0);
}

/** Keep the application search port language-independent; only the native
 * protocol carries the mandatory bundle. No separate translation call. */
export function configureMultilingualSearch(schema: Record<string, unknown>) {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    const fields = node.properties as Record<string, unknown> | undefined;
    if (fields) for (const key of ["queries", "query"]) {
      if (fields[key]) fields[key] = z.toJSONSchema(key === "queries" ? initialQuerySchema : multilingualQuerySchema);
    }
    Object.values(node).forEach(visit);
  };
  visit(schema);
}

export async function restoreMultilingualSearch(value: unknown, signal?: AbortSignal, allowEmptyInitialQueries = false): Promise<Record<string, unknown>> {
  const record = z.record(z.string(), z.unknown()).parse(value);
  if (record.queries !== undefined) {
    const initial = initialQuerySchema.parse(record.queries);
    const list = (value: string | string[] | null) => value === null ? [] : Array.isArray(value) ? value : [value];
    const uzbek = list(initial["uz-Latn"]);
    const cyrillic = uzbek.length ? await transliterateUzbekQueries(uzbek, signal) : [];
    const queries = [...list(initial.en), ...list(initial.ru), ...uzbek, ...cyrillic];
    if (!queries.length && !allowEmptyInitialQueries) throw new Error("RESEARCH_QUERY_EMPTY");
    const remaining = { ...record };
    delete remaining.queries;
    return { ...await restoreMultilingualSearch(remaining, signal), queries };
  }
  const actions = record.actions === undefined ? undefined : z.array(z.record(z.string(), z.unknown())).parse(record.actions);
  const bundles = [...(record.queries === undefined ? [] : [record.queries]),
    ...(actions ?? []).filter(action => action.query !== undefined).map(action => action.query)]
    .map(bundle => multilingualQuerySchema.parse(bundle));
  if (bundles.some(bundle => expandedQueryCount(bundle) === 0)) throw new Error("RESEARCH_QUERY_EMPTY");
  const uzbek = bundles.flatMap(bundle => bundle["uz-Latn"] === null ? [] : [bundle["uz-Latn"]]);
  const cyrillic = uzbek.length ? await transliterateUzbekQueries(uzbek, signal) : [];
  let index = 0, uzbekIndex = 0;
  const expand = () => {
    const parsed = bundles[index++];
    const expanded = { ...parsed, "uz-Cyrl": parsed["uz-Latn"] === null ? null : cyrillic[uzbekIndex++] };
    return corpusSearchLanguages.flatMap(language => expanded[language] === null ? [] : [expanded[language]]);
  };
  return {
    ...record,
    ...(record.queries === undefined ? {} : { queries: expand() }),
    ...(record.actions === undefined ? {} : { actions: actions!
      .flatMap(action => action.query === undefined ? [action] : expand().map(query => ({ ...action, query }))) }),
  };
}
