import { z } from "zod";

const object = z.record(z.string(), z.unknown());
const reference = z.object({ sourceId: z.string(), url: z.string() }).passthrough();
const selection = z.object({ requirementId: z.string(), referenceId: z.string() }).strict();

/** A single offered handle preserves the parent that authenticates a link. */
export class ResearchReferenceBindings {
  private readonly handles = new Map<string, string>();
  private readonly targets = new Map<string, { sourceId: string; url: string }>();

  observe(input: Record<string, unknown>) {
    if (!Array.isArray(input.availableReferences)) return;
    input.availableReferences = input.availableReferences.map(value => {
      const parsed = reference.parse(value);
      const key = JSON.stringify([parsed.sourceId, parsed.url]);
      let id = this.handles.get(key);
      if (!id) {
        id = `ref${this.handles.size + 1}`;
        this.handles.set(key, id);
        this.targets.set(id, { sourceId: parsed.sourceId, url: parsed.url });
      }
      return { ...parsed, referenceId: id };
    });
  }

  restore(action: unknown): unknown {
    if (!object.safeParse(action).data?.referenceId) return action;
    const parsed = selection.safeParse(action);
    const target = parsed.success ? this.targets.get(parsed.data.referenceId) : undefined;
    return parsed.success && target ? { requirementId: parsed.data.requirementId, ...target } : action;
  }

  bind(schema: Record<string, unknown>) {
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      const node = object.safeParse(value).data;
      if (!node) return;
      if (Array.isArray(node.anyOf)) {
        (value as Record<string, unknown>).anyOf = node.anyOf.flatMap(branch => {
          const fields = object.safeParse(object.safeParse(branch).data?.properties).data;
          if (!fields?.sourceId || !fields.url) return [branch];
          if (!this.targets.size) return [];
          return [{ type: "object", additionalProperties: false, required: ["requirementId", "referenceId"],
            properties: { requirementId: fields.requirementId, referenceId: { type: "string",
              pattern: `^(?:${[...this.targets.keys()].join("|")})$` } } }];
        });
      }
      Object.values(value as Record<string, unknown>).forEach(visit);
    };
    visit(schema);
  }

  clear() { this.handles.clear(); this.targets.clear(); }
}
