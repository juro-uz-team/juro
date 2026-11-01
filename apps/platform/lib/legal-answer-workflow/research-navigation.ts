import type { EvidenceScope } from "./evidence";

const pageSize = 50;
type ResultDescription = { kind: "search" | "literal"; query: string; scope: EvidenceScope };
type ResultSet = ResultDescription & { id: string; candidateIds: string[] };

/** Request-local navigation over retained results; listing performs no corpus work. */
export class ResearchNavigation {
  private readonly results = new Map<string, ResultSet>();
  private readonly keys = new Map<string, string>();
  private readonly pages = new Map<string, Set<number>>();
  private readonly requestedPages = new Map<string, Set<number>>();
  private readonly listed = new Set<string>();
  private listingChanges = 0;
  private replaceOnNext = false;

  get listings() { return this.listingChanges; }

  beginBatch() { this.replaceOnNext = true; this.requestedPages.clear(); }

  retain(key: string, description: ResultDescription, candidateIds: readonly string[]): string {
    const existing = this.keys.get(key);
    if (existing) return existing;
    const id = `results${this.results.size + 1}`;
    const result = { ...structuredClone(description), id, candidateIds: [...new Set(candidateIds)] };
    this.keys.set(key, id); this.results.set(id, result);
    // Empty results still replace an old view, but never expose a nonexistent page.
    this.show(id, result.candidateIds.length ? 0 : undefined);
    return id;
  }

  list(id: string, page: number): boolean {
    const result = this.results.get(id);
    if (!result) throw new Error("RESEARCH_RESULT_SET_INVALID");
    if (!Number.isInteger(page) || page < 0 || page * pageSize >= result.candidateIds.length)
      throw new Error("RESEARCH_RESULT_PAGE_INVALID");
    const key = JSON.stringify([id, page]);
    const requested = this.requestedPages.get(id) ?? new Set<number>();
    requested.add(page); this.requestedPages.set(id, requested);
    if (this.pages.get(id)?.has(page)) return false;
    this.listed.add(key); this.show(id, page); this.listingChanges++;
    return true;
  }

  private show(id: string, page: number | undefined) {
    if (this.replaceOnNext) {
      this.pages.clear(); this.replaceOnNext = false;
      for (const [requestedId, pages] of this.requestedPages) this.pages.set(requestedId, new Set(pages));
    }
    if (page === undefined) return;
    const pages = this.pages.get(id) ?? new Set<number>();
    pages.add(page); this.pages.set(id, pages);
  }

  visibleIds(): Set<string> {
    return new Set([...this.pages].flatMap(([id, pages]) => [...pages].flatMap(page =>
      this.results.get(id)!.candidateIds.slice(page * pageSize, (page + 1) * pageSize))));
  }

  catalog(attemptedIds: ReadonlySet<string>) {
    return [...this.results.values()].map(({ candidateIds, ...description }) => ({ ...description,
      retainedCount: candidateIds.length, attemptedReadCount: candidateIds.filter(id => attemptedIds.has(id)).length,
      pageSize, pageCount: Math.ceil(candidateIds.length / pageSize),
      displayedPages: [...(this.pages.get(description.id) ?? [])],
      listedPages: Array.from({ length: Math.ceil(candidateIds.length / pageSize) }, (_, page) => page)
        .filter(page => this.listed.has(JSON.stringify([description.id, page]))),
    }));
  }
}
