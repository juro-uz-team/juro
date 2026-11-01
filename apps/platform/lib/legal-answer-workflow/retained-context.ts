/** Lossless references into earlier, verbatim retained tool results. No summaries or selection. */
export class RetainedContext {
  private readonly originals = new Map<string, { callId: string; path: string }>();

  prepare(input: Record<string, unknown>, callId: string) {
    const additions = new Map<string, { callId: string; path: string }>();
    const references: { path: string; callId: string; originalPath: string }[] = [];
    const visit = (value: unknown, path: string): unknown => {
      // Reuse only byte-identical values already retained in this conversation.
      // Complete law stays verbatim at its original location; changed law is
      // retained in full. References remove duplicate copies, never sources.
      const serialized = JSON.stringify(value);
      if (serialized === undefined) return value;
      if (path && serialized.length >= 512) {
        const original = this.originals.get(serialized);
        if (original) {
          references.push({ path, callId: original.callId, originalPath: original.path });
          return null;
        }
      }
      const offset = references.length;
      const result = Array.isArray(value) ? value.map((item, index) => visit(item, `${path}/${index}`))
        : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) =>
          [key, visit(item, `${path}/${key.replace(/~/gu, "~0").replace(/\//gu, "~1")}`)])) : value;
      // Refer only to literal earlier values, never to a chain of references.
      if (path && serialized.length >= 512 && offset === references.length)
        additions.set(serialized, { callId, path: `/packet${path}` });
      return result;
    };
    const packet = visit(input, "");
    return { value: { packet, retainedContextReferences: references }, commit: () => {
      for (const [key, value] of additions) if (!this.originals.has(key)) this.originals.set(key, value);
    } };
  }

  clear() { this.originals.clear(); }
}
