import { isDeepStrictEqual } from "node:util";

/** Request-owned complete evidence; selecting a writer packet never erases other reads. */
export class EvidenceInventory<T extends { identity: string; text: string }> {
  private readonly provisions = new Map<string, T>();

  retain(provision: T) {
    const existing = this.provisions.get(provision.identity);
    if (existing && !isDeepStrictEqual(existing, provision)) throw new Error("EVIDENCE_IDENTITY_CONFLICT");
    if (existing) return;
    this.provisions.set(provision.identity, structuredClone(provision));
  }

  all(): T[] {
    return structuredClone([...this.provisions.values()]);
  }

  select(identities: readonly string[]): T[] {
    const selected = [...new Set(identities)].map((identity) => {
      const provision = this.provisions.get(identity);
      if (!provision) throw new Error("EVIDENCE_NOT_RETAINED");
      return structuredClone(provision);
    });
    return selected;
  }
}
