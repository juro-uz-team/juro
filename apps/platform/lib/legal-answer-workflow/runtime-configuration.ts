import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { researchConcurrencySchema } from "./contracts";
import { parsePinnedCandidateRelease } from "../legal-corpus/legal-candidate-index";
import { preparedCandidateConfigurationSchema } from "../legal-corpus/prepared-candidate-configuration";
import { createPreparedTransportPair } from "./prepared-transport";

const amount = z.number().int().nonnegative().max(1_000_000_000_000);
const rateFields = { input: amount.positive(), cachedInput: amount, output: amount.positive() };
const tier = z.object(rateFields).strict().refine(value => value.cachedInput <= value.input);
const rates = z.object({ ...rateFields, longContext: tier.optional() }).strict()
  .refine(value => value.cachedInput <= value.input);
const path = z.string().min(1).refine(isAbsolute);
const spendingCaps = z.object({ generation: amount.positive(), embedding: amount.positive() }).strict();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const workerSettings = z.object({ url: z.string(), workerSha256: sha256 }).strict();
const additionSettings = z.object({
  current: workerSettings.extend({ release: z.unknown() }),
  history: workerSettings.extend({ release: z.unknown() }),
  sources: workerSettings,
  replacements: z.array(z.tuple([z.string().regex(/^-?\d+$/u), z.string().nullable()])).max(100_000),
}).strict();
const common = {
  format: z.literal("legal-answer-runtime-v1"), legalDatabaseAsOf: z.iso.date(),
  generationSha256: z.string().regex(/^[a-f0-9]{64}$/u), currentRelease: z.unknown(), historyRelease: z.unknown(),
  corpusAdditions: z.array(additionSettings).max(16).optional(),
  generationRates: z.record(z.string().regex(/^gpt-[A-Za-z0-9._-]+$/u), rates), embeddingInputRate: amount.positive(),
  fastGenerationRates: z.partialRecord(z.enum(["gpt-6-luna", "gpt-6.1-terra"]), rates).optional(),
  serviceTier: z.partialRecord(z.enum(["gpt-6-luna", "gpt-6.1-terra"]), z.literal("default")).optional(),
  continuationServiceTier: z.partialRecord(z.enum(["gpt-6-luna", "gpt-6.1-terra"]), z.literal("default")).optional(),
  ledgerPath: path, receiptPath: path,
  maximumRequestGenerationMicrousd: amount.positive().optional(),
  automaticReadLimit: z.number().int().min(0).max(6).optional(),
  automaticReadScope: z.literal("provision").optional(),
  questionFirstResearch: z.boolean().optional(),
  candidateReadScope: z.literal("provision").optional(),
  researchConcurrency: researchConcurrencySchema.optional(),
  entryNavigation: z.boolean().optional(),
  prefetchInitialSearch: z.boolean().optional(),
  inputTokenCounting: z.partialRecord(z.enum(["gpt-6-luna", "gpt-6.1-terra"]), z.boolean()).optional(),
  countInputAfterWriting: z.partialRecord(z.enum(["gpt-6-luna", "gpt-6.1-terra"]), z.boolean()).optional(),
  issueWriting: z.boolean().optional(),
  continuationReasoningEffort: z.partialRecord(z.enum(["gpt-6-luna", "gpt-6.1-terra"]), z.enum(["none", "low", "medium", "high"])).optional(),
  reasoningEffort: z.partialRecord(z.enum(["gpt-6-luna", "gpt-6.1-terra"]),
    z.partialRecord(z.enum(["interpret", "select", "assess", "write"]), z.enum(["none", "low", "medium", "high"]))).optional(),
};
const schema = z.discriminatedUnion("purpose", [
  z.object({ ...common, purpose: z.literal("qualification"), phase: z.enum(["diagnostic", "final"]),
    spendingCaps: spendingCaps.optional() }).strict(),
  z.object({ ...common, purpose: z.literal("production"), phase: z.literal("operating"),
    spendingCaps: spendingCaps.optional() }).strict(),
]);

type RuntimeEnv = Readonly<Record<string, string | undefined>>;
function runtimeDocument(value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("ANSWER_RUNTIME_CONFIGURATION_INVALID");
  return result.data;
}
function requireSetting(env: RuntimeEnv, name: string) {
  const value = env[name];
  if (!value?.trim()) throw new Error("ANSWER_RUNTIME_SETTING_MISSING");
  return value;
}
function parseCorpusRoutes(config: ReturnType<typeof runtimeDocument>, env: RuntimeEnv) {
  const required = (name: string) => requireSetting(env, name);
  const currentRelease = parsePinnedCandidateRelease(config.currentRelease);
  const historyRelease = parsePinnedCandidateRelease(config.historyRelease);
  preparedCandidateConfigurationSchema.parse(currentRelease.configuration);
  preparedCandidateConfigurationSchema.parse(historyRelease.configuration);
  if (currentRelease.capability !== "current" || historyRelease.capability !== "history"
    || currentRelease.environment !== historyRelease.environment) throw new Error("CORPUS_RUNTIME_RELEASE_MISMATCH");
  const current = { release: currentRelease, worker: { url: required("PREPARED_CURRENT_URL"),
    workerSha256: required("PREPARED_CURRENT_WORKER_SHA256"), token: required("PREPARED_TRANSPORT_TOKEN") } };
  const history = { release: historyRelease, worker: { url: required("PREPARED_HISTORY_URL"),
    workerSha256: required("PREPARED_HISTORY_WORKER_SHA256"), token: required("PREPARED_TRANSPORT_TOKEN") } };
  const sourceSettings = ["LEGAL_ANSWER_SOURCE_URL", "LEGAL_ANSWER_SOURCE_WORKER_SHA256", "LEGAL_ANSWER_SOURCE_TOKEN"];
  const sources = sourceSettings.some(name => env[name] !== undefined)
    ? { url: required("LEGAL_ANSWER_SOURCE_URL"), workerSha256: required("LEGAL_ANSWER_SOURCE_WORKER_SHA256"),
      token: required("LEGAL_ANSWER_SOURCE_TOKEN") } : undefined;
  // Construction validates loopback endpoints, worker identities and transport credentials without network I/O.
  createPreparedTransportPair({ discovery: current.worker, sources });
  createPreparedTransportPair({ discovery: history.worker, sources });
  const additions = (config.corpusAdditions ?? []).map(addition => {
    const current = parsePinnedCandidateRelease(addition.current.release);
    const history = parsePinnedCandidateRelease(addition.history.release);
    const currentArtifacts = preparedCandidateConfigurationSchema.parse(current.configuration).artifacts;
    const historyArtifacts = preparedCandidateConfigurationSchema.parse(history.configuration).artifacts;
    if (current.capability !== "current" || history.capability !== "history"
      || current.environment !== currentRelease.environment || history.environment !== currentRelease.environment
      || JSON.stringify(currentArtifacts) !== JSON.stringify(historyArtifacts)) throw new Error("CORPUS_ADDITION_RELEASE_MISMATCH");
    const token = required("PREPARED_TRANSPORT_TOKEN");
    const currentWorker = { url: addition.current.url, workerSha256: addition.current.workerSha256, token };
    const historyWorker = { url: addition.history.url, workerSha256: addition.history.workerSha256, token };
    const sourceWorker = { ...addition.sources, token };
    createPreparedTransportPair({ discovery: currentWorker, sources: sourceWorker });
    createPreparedTransportPair({ discovery: historyWorker, sources: sourceWorker });
    return { current: { release: current, worker: currentWorker }, history: { release: history, worker: historyWorker },
      sources: sourceWorker, replacements: new Set(addition.replacements.map(value => JSON.stringify(value))) };
  });
  const releaseIds = [currentRelease.id, historyRelease.id, ...additions.flatMap(part => [part.current.release.id, part.history.release.id])];
  if (new Set(releaseIds).size !== releaseIds.length) throw new Error("CORPUS_ADDITION_DUPLICATE");
  return { current, history, sources, additions };
}

/** Explicit deployment configuration; secrets remain in server environment and never enter source identity hashes. */
export function parseAnswerRuntimeConfiguration(value: unknown, env: RuntimeEnv) {
  const config = runtimeDocument(value);
  if (resolve(config.ledgerPath) === resolve(config.receiptPath)) throw new Error("ANSWER_FINANCIAL_PATH_CONFLICT");
  const { current, history, sources, additions } = parseCorpusRoutes(config, env);
  const models = { fast: "gpt-6-luna", deep: "gpt-6.1-terra" } as const;
  if (Object.values(models).some(model => !config.generationRates[model])) throw new Error("ANSWER_MODEL_RATES_MISSING");
  const publicUrl = new URL(requireSetting(env, "APP_URL"));
  if (publicUrl.username || publicUrl.password || !["http:", "https:"].includes(publicUrl.protocol)) {
    throw new Error("ANSWER_PUBLIC_ORIGIN_INVALID");
  }
  const sourceVersionHash = createHash("sha256").update(JSON.stringify({ currentRelease: current.release, historyRelease: history.release,
    workers: [current.worker.workerSha256, history.worker.workerSha256, sources?.workerSha256 ?? null],
    ...(additions.length > 0 ? { additions: config.corpusAdditions } : {}),
    generationSha256: config.generationSha256 })).digest("hex");
  // Deployment policy must still match the existing cumulative ledger exactly.
  const caps = config.spendingCaps ?? (config.purpose === "qualification"
    ? { generation: 6_000_000, embedding: 1_000_000 } : undefined);
  return { ...config, spendingCaps: caps, models, publicOrigin: publicUrl.origin, apiKey: requireSetting(env, "OPENAI_API_KEY"), sourceVersionHash,
    corpus: { current, history, sources, additions, generationSha256: config.generationSha256,
      automaticReadLimit: config.automaticReadLimit ?? 0, automaticReadScope: config.automaticReadScope ?? "provision",
      candidateReadScope: config.candidateReadScope ?? "provision",
      researchConcurrency: config.researchConcurrency ?? 3,
      entryNavigation: config.entryNavigation ?? false,
      questionFirstResearch: config.questionFirstResearch ?? false,
      prefetchInitialSearch: config.prefetchInitialSearch ?? false } };
}

async function loadRuntimeDocument(env: RuntimeEnv) {
  const path = env.LEGAL_ANSWER_RUNTIME_CONFIG;
  if (!path || !isAbsolute(path)) throw new Error("ANSWER_RUNTIME_CONFIGURATION_REQUIRED");
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    const maximum = 8 * 1024 * 1024;
    if (!stat.isFile() || stat.size < 1 || stat.size > maximum) throw new Error("ANSWER_RUNTIME_CONFIGURATION_INVALID");
    const bytes = Buffer.alloc(stat.size + 1);
    let total = 0;
    while (total < bytes.length) {
      const read = await file.read(bytes, total, bytes.length - total, null);
      if (!read.bytesRead) break;
      total += read.bytesRead;
    }
    if (total !== stat.size) throw new Error("ANSWER_RUNTIME_CONFIGURATION_INVALID");
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, total))); }
    catch { throw new Error("ANSWER_RUNTIME_CONFIGURATION_INVALID"); }
    return value;
  } finally { await file.close(); }
}

export async function loadAnswerRuntimeConfiguration(env: RuntimeEnv) {
  return parseAnswerRuntimeConfiguration(await loadRuntimeDocument(env), env);
}

export async function loadPreparedCorpusRoutes(env: RuntimeEnv) {
  return parseCorpusRoutes(runtimeDocument(await loadRuntimeDocument(env)), env);
}
