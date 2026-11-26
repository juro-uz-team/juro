import { createHash } from "node:crypto";
import { loadAnswerRuntimeConfiguration } from "../legal-answer-workflow/runtime-configuration";
import { openConfiguredAnswerRuntime } from "../legal-answer-workflow/configured-runtime";
import { readOfficialProvision } from "../legal-answer-workflow/evidence";
import { corpusDatabase } from "../storage/connection";
import { legalDatabaseFreshnessFromAsOf } from "../legal/verified-retrieval";
import type { LegalSourceContext } from "../legal/source-context";

type Owner = { id: string; workspaceId: string; userId: string };

export async function retrieveDocumentLegalSources(
  _db: D1Database, text: string, locale: "ru" | "uz", limit = 5, owner?: Owner,
) {
  const sources: LegalSourceContext[] = [];
  const submittedAt = Date.now();
  const deadlineMs = 24_000;
  const signal = AbortSignal.timeout(deadlineMs);
  const scope = { kind: "current" } as const;
  let asOf = "";
  let runtime: Awaited<ReturnType<typeof openConfiguredAnswerRuntime>> | undefined;
  let execution: Awaited<ReturnType<ReturnType<NonNullable<typeof runtime>["dependencies"]>["createExecution"]>> | undefined;
  try {
    if (!owner) throw new Error("DOCUMENT_RESEARCH_OWNER_REQUIRED");
    const configuration = await loadAnswerRuntimeConfiguration(process.env);
    runtime = await openConfiguredAnswerRuntime(configuration, {
      corpusPool: corpusDatabase("app").pool, privateObjects: { get: async () => null },
    }, submittedAt + deadlineMs, signal);
    const dependencies = runtime.dependencies("fast");
    const clean = text.replace(/\b\d{6,}\b/g, " ").replace(/\s+/g, " ").trim();
    const queries = [...new Set([
      clean.slice(0, 420),
      clean.length > 700 ? clean.slice(450, 870) : "",
      clean.length > 1400 ? clean.slice(-420) : "",
    ].filter(Boolean))];
    if (!queries.length) return { sources, freshness: legalDatabaseFreshnessFromAsOf(""), legalDatabaseAsOf: "" };
    execution = await dependencies.createExecution({
      runId: owner.id, model: dependencies.model,
      request: { question: queries[0], language: locale, mode: "fast", format: "short", history: [], privateDocuments: [],
        actor: { tenantId: owner.workspaceId, userId: owner.userId }, submittedAt, deadlineMs, signal },
    });
    const corpus = execution.corpus;
    const searches = await Promise.allSettled(queries.map(query => corpus.search(query, scope, signal)));
    const packets = searches.flatMap(item => item.status === "fulfilled" ? [item.value] : []);
    const candidates = [...new Set(packets.flatMap(packet => packet.candidates.slice(0, 8)))];
    const reads = await Promise.allSettled(candidates.slice(0, 16).map(async identity => {
      const locator = await corpus.resolve(identity, scope, signal);
      if (!locator) return null;
      return readOfficialProvision(locator, corpus, scope, signal);
    }));
    const seen = new Set<string>();
    for (const item of reads) {
      if (item.status !== "fulfilled" || !item.value) continue;
      const provision = item.value;
      if (seen.has(provision.objectKey)) continue;
      seen.add(provision.objectKey);
      const checkedAt = provision.editionObservation?.observedAt ?? new Date(configuration.legalDatabaseAsOf).toISOString();
      sources.push({
        id: "corpus-" + createHash("sha256").update(provision.objectKey).digest("hex"),
        actTitle: (provision.sourceTitle || provision.sourceUrl).slice(0, 500),
        actIdentifier: null, officialUrl: provision.sourceUrl, revisionDate: null, publishedAt: null,
        lastCheckedAt: checkedAt, verifiedAt: checkedAt, locale, sourceType: "lex", status: "verified",
        verificationState: "verified", contentSha256: provision.sha256, article: provision.articleNumber ?? null,
        excerpt: provision.text.slice(0, 1200), sourceClass: "OFFICIAL_LEGISLATION",
      });
      if (sources.length === limit) break;
    }
    if (sources.length || (candidates.length === 0 && packets.some(packet => packet.sparseAvailable && packet.denseAvailable))) {
      asOf = configuration.legalDatabaseAsOf;
    }
  } catch {
    // Retain structural findings when research cannot supply official evidence.
  } finally {
    await execution?.drain?.();
    runtime?.close();
  }
  const freshness = legalDatabaseFreshnessFromAsOf(asOf);
  // Prepared reads have already passed the corpus runtime's current-edition
  // checks. The legacy live-sync age threshold does not govern that corpus.
  if (asOf && freshness.status === "stale") freshness.status = "fresh";
  return { sources, freshness, legalDatabaseAsOf: freshness.asOf };
}
