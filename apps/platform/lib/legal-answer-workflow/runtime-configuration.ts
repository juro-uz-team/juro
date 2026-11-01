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
const common = {
  format: z.literal("legal-answer-runtime-v1"), legalDatabaseAsOf: z.iso.date(),
  generationSha256: z.string().regex(/^[a-f0-9]{64}$/u), currentRelease: z.unknown(), historyRelease: z.unknown(),
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

/** Explicit deployment configuration; secrets remain in server environment and never enter source identity hashes. */
export function parseAnswerRuntimeConfiguration(value: unknown, env: Readonly<Record<string, string | undefined>>) {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("ANSWER_RUNTIME_CONFIGURATION_INVALID");
  const config = result.data;
  if (resolve(config.ledgerPath) === resolve(config.receiptPath)) throw new Error("ANSWER_FINANCIAL_PATH_CONFLICT");
  const required = (name: string) => {
    const value = env[name];
    if (!value?.trim()) throw new Error("ANSWER_RUNTIME_SETTING_MISSING");
    return value;
  };
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
  const models = { fast: "gpt-6-luna", deep: "gpt-6.1-terra" } as const;
  if (Object.values(models).some(model => !config.generationRates[model])) throw new Error("ANSWER_MODEL_RATES_MISSING");
  const publicUrl = new URL(required("APP_URL"));
  if (publicUrl.username || publicUrl.password || !["http:", "https:"].includes(publicUrl.protocol)) {
    throw new Error("ANSWER_PUBLIC_ORIGIN_INVALID");
  }
  const sourceVersionHash = createHash("sha256").update(JSON.stringify({ currentRelease, historyRelease,
    workers: [current.worker.workerSha256, history.worker.workerSha256, sources?.workerSha256 ?? null],
    generationSha256: config.generationSha256 })).digest("hex");
  // Deployment policy must still match the existing cumulative ledger exactly.
  const caps = config.spendingCaps ?? (config.purpose === "qualification"
    ? { generation: 6_000_000, embedding: 1_000_000 } : undefined);
  return { ...config, spendingCaps: caps, models, publicOrigin: publicUrl.origin, apiKey: required("OPENAI_API_KEY"), sourceVersionHash,
    corpus: { current, history, sources, generationSha256: config.generationSha256,
      automaticReadLimit: config.automaticReadLimit ?? 0, automaticReadScope: config.automaticReadScope ?? "provision",
      candidateReadScope: config.candidateReadScope ?? "provision",
      researchConcurrency: config.researchConcurrency ?? 3,
      entryNavigation: config.entryNavigation ?? false,
      questionFirstResearch: config.questionFirstResearch ?? false,
      prefetchInitialSearch: config.prefetchInitialSearch ?? false } };
}

export async function loadAnswerRuntimeConfiguration(env: Readonly<Record<string, string | undefined>>) {
  const path = env.LEGAL_ANSWER_RUNTIME_CONFIG;
  if (!path || !isAbsolute(path)) throw new Error("ANSWER_RUNTIME_CONFIGURATION_REQUIRED");
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > 256 * 1024) throw new Error("ANSWER_RUNTIME_CONFIGURATION_INVALID");
    const bytes = Buffer.alloc(256 * 1024 + 1);
    let total = 0;
    while (total < bytes.length) {
      const read = await file.read(bytes, total, bytes.length - total, null);
      if (!read.bytesRead) break;
      total += read.bytesRead;
    }
    if (total > 256 * 1024) throw new Error("ANSWER_RUNTIME_CONFIGURATION_INVALID");
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, total))); }
    catch { throw new Error("ANSWER_RUNTIME_CONFIGURATION_INVALID"); }
    return parseAnswerRuntimeConfiguration(value, env);
  } finally { await file.close(); }
}
