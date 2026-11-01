import { z } from "zod";

const object = z.record(z.string(), z.unknown());
const fields = (value: unknown) => object.safeParse(value).data ?? {};
const list = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(fields) : [];
const exact = (values: string[]) => ({ type: "string", pattern: `^(?:${values.map(value => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})$` });

/** Candidate handles carry source, edition, language and scope. Never cross their section menus. */
export class ResearchSectionBindings {
  private readonly positions = new Map<string, Set<string>>();

  observe(input: Record<string, unknown>) {
    const add = (id: unknown, position: unknown) => {
      if (typeof id !== "string" || typeof position !== "string") return;
      const positions = this.positions.get(id) ?? new Set<string>();
      positions.add(position); this.positions.set(id, positions);
    };
    for (const section of list(input.availableSections)) add(section.candidateId, section.sectionPosition);
    for (const candidate of list(input.unreadCandidates)) {
      const range = fields(candidate.readRange);
      const source = fields(fields(input.candidateSources)[String(candidate.sourceRef)]);
      const sections = [...list(range.sections), ...list(range.sourceSections),
        ...list(fields(input.candidateSourceSections)[String(range.sourceSectionsRef)]),
        ...list(source.publisherContents), ...list(candidate.publisherContents)];
      for (const id of [candidate.id, ...list(candidate.matches).map(match => match.id)]) {
        for (const section of sections) add(id, section.sectionPosition ?? section.position);
      }
    }
  }

  allows(candidate: string, position: string) { return this.positions.get(candidate)?.has(position) === true; }
  clear() { this.positions.clear(); }

  bind(schema: Record<string, unknown>) {
    // Group identical menus to avoid multiplying the provider schema by search hits.
    const groups = new Map<string, string[]>();
    for (const [id, positions] of this.positions) {
      const key = JSON.stringify([...positions].sort());
      groups.set(key, [...(groups.get(key) ?? []), id]);
    }
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, unknown>;
      if (Array.isArray(node.anyOf)) node.anyOf = node.anyOf.flatMap(branch => {
        const properties = fields(fields(branch).properties);
        return properties.sectionPosition ? [...groups].map(([positions, ids]) => ({ ...fields(branch),
          properties: { ...properties, candidateId: exact(ids), sectionPosition: exact(JSON.parse(positions)) } })) : [branch];
      });
      Object.values(node).forEach(visit);
    };
    visit(schema);
  }
}

/** Only the native adapter can authorize an error-only correction turn. Not serializable by a model. */
export const recoveredResearchTurn = Symbol("recoveredResearchTurn");
export const researchToolErrorSchema = z.object({ field: z.enum(["actions", "coverageUpdates"]),
  index: z.number().int().min(0).max(39), code: z.enum(["REQUIREMENT_NOT_OFFERED", "CANDIDATE_NOT_OFFERED",
    "SECTION_NOT_OFFERED", "SOURCE_NOT_ACQUIRED", "INVALID_ARGUMENT"]) }).strict();
