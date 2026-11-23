import { z } from "zod";
import { requireApiUser, withApiErrors } from "../../../../../lib/document-builder/auth/api";
import { classifyLegalSourceUrl } from "../../../../../lib/legal/source-fetch";
import { preparedCandidateConfigurationSchema } from "../../../../../lib/legal-corpus/prepared-candidate-configuration";
import { createCorpusTransport } from "../../../../../lib/legal-answer-workflow/corpus-transport";
import { resolveSavedSourceRoute } from "../../../../../lib/legal-answer-workflow/saved-source-routing";
import { loadPreparedCorpusRoutes } from "../../../../../lib/legal-answer-workflow/runtime-configuration";
import { requireSelectedWorkspace } from "../../../../../lib/platform/workspace";
import { corpusDatabase } from "../../../../../lib/storage/connection";

const id = z.string().regex(/^[a-f0-9]{64}$/u);
const category = z.string().regex(/^(?:(?:LBC|LS|TERM):\d{1,20})?$/u);
const page = (maximum: number) => z.string().regex(/^\d{1,7}$/u).transform(Number).pipe(z.number().int().max(maximum));
const search = z.object({ query: z.string().trim().max(120), language: z.enum(["", "ru", "uz", "uzc", "en"]),
  category });
const reader = z.object({ work: id, offset: page(1_000_000) });
const entry = z.object({ work: id, title: z.string().min(1), url: z.string().refine(value => {
  try { return classifyLegalSourceUrl(value).sourceKind === "lex"; } catch { return false; }
}), edition: z.iso.date().nullable(), language: z.string() });
const catalogue = z.object({ entries: z.array(entry).max(16), categories: z.array(z.object({ id: category, label: z.string() })),
  hasMore: z.boolean() });
const document = z.object({ entry: entry.nullable(), units: z.array(z.object({ text: z.string(), locator: z.string() })).max(24),
  nextOffset: z.number().int().positive().nullable(), extractionGaps: z.boolean().optional() });

const respond = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "cache-control": "private, no-store" },
});

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await requireApiUser(request);
  await requireSelectedWorkspace(user, request.headers.get("x-juro-workspace-id"));
  const params = new URL(request.url).searchParams;
  const work = params.get("work");
  const cursor = params.get("cursor") ?? "";
  const parsed = work === null ? search.safeParse({
    query: params.get("q") ?? "", language: params.get("language") ?? "",
    category: params.get("category") ?? "",
  }) : reader.safeParse({ work, offset: params.get("offset") ?? "0" });
  if (!parsed.success || !/^(?:[a-f0-9]{64}:\d{1,6})?$/u.test(cursor)) return respond({ code: "CORPUS_BROWSE_INVALID" }, 400);
  try {
    const corpus = await loadPreparedCorpusRoutes(process.env);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
    const partitions = [...corpus.additions.toReversed(), { ...corpus, replacements: new Set<string>() }].map(partition => ({
      artifacts: preparedCandidateConfigurationSchema.parse(partition.current.release.configuration).artifacts,
      transport: createCorpusTransport(partition.sources ?? partition.current.worker),
      replacements: partition.replacements,
    }));
    if (work !== null) {
      for (const { transport, artifacts } of partitions) {
        const source = document.parse(await transport.browseSources({ artifacts, ...parsed.data }, signal));
        if (source.entry === null) continue;
        if (source.entry.work !== work) throw new Error("CORPUS_SOURCE_IDENTITY");
        return respond(source);
      }
      const archived = (await corpusDatabase().pool.query<{ package_sha256: string; manifest: Buffer }>(
        `SELECT s.package_sha256,e.manifest FROM storage.corpus_publication_sources s
         JOIN storage.corpus_evidence_stores e USING (generation_sha256) WHERE s.work=$1`, [work])).rows[0];
      if (archived) {
        const saved = resolveSavedSourceRoute(archived.manifest, archived.package_sha256, process.env);
        const { artifacts } = preparedCandidateConfigurationSchema.parse(saved.release.configuration);
        const source = document.parse(await createCorpusTransport(saved.worker)
          .browseSources({ artifacts, ...parsed.data }, signal));
        if (source.entry?.work !== work) throw new Error("CORPUS_SOURCE_IDENTITY");
        return respond(source);
      }
      return respond({ code: "CORPUS_SOURCE_MISSING" }, 404);
    }
    const [packageSha, cursorPage] = cursor.split(":");
    const start = cursor ? partitions.findIndex(partition => partition.artifacts.packageSha256 === packageSha) : 0;
    if (start < 0) return respond({ code: "CORPUS_BROWSE_GENERATION_CHANGED" }, 409);
    const categories = new Map<string, string>();
    const options = await Promise.all(partitions.map(({ transport, artifacts }, index) =>
      transport.browseSources({ artifacts, ...parsed.data, page: start === index ? Number(cursorPage ?? 0) : 0 }, signal)
        .then(result => catalogue.parse(result))));
    for (const option of options) for (const item of option.categories) {
      if (!categories.has(item.id)) categories.set(item.id, item.label);
    }
    const filters = [...categories].map(([id, label]) => ({ id, label }));
    const replaced = new Set(partitions.slice(0, start).flatMap(partition => [...partition.replacements]));
    for (let index = start; index < partitions.length; index++) {
      const { artifacts, replacements } = partitions[index];
      const { entries, hasMore } = options[index];
      const visible = entries.filter(item => {
        const url = new URL(item.url);
        const source = /^\/docs\/(-?\d+)$/u.exec(url.pathname)?.[1];
        return !source || !replaced.has(JSON.stringify([source, url.searchParams.get("ONDATE")]));
      });
      const nextPage = hasMore ? `${artifacts.packageSha256}:${Number(index === start ? cursorPage ?? 0 : 0) + 1}`
        : index + 1 < partitions.length ? `${partitions[index + 1].artifacts.packageSha256}:0` : null;
      if (visible.length || hasMore) return respond({ entries: visible, categories: filters, nextPage });
      for (const replacement of replacements) replaced.add(replacement);
    }
    return respond({ entries: [], categories: filters, nextPage: null });
  } catch (error) {
    if (request.signal.aborted) throw error;
    return respond({ code: "CORPUS_BROWSE_UNAVAILABLE" }, 503);
  }
});
