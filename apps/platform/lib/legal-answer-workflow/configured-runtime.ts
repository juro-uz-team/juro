import { CategorySpendingLedger } from "../ai/category-spending-ledger";
import type { Pool } from "pg";
import type { LegalRequest } from "./contracts";
import type { ProvisionObjects } from "./evidence";
import { createAnswerExecution } from "./execution";
import { ProviderReceiptJournal } from "./receipt-journal";
import type { parseAnswerRuntimeConfiguration } from "./runtime-configuration";
import type { executeSignedInAnswer } from "./signed-request";
import { openRegisteredEvidenceStore } from "./evidence-registration";
import { OperatingUsageLedger } from "./operating-usage";

type Configuration = ReturnType<typeof parseAnswerRuntimeConfiguration>;
type Store = Parameters<typeof createAnswerExecution>[0]["corpus"]["store"];

export async function openConfiguredAnswerRuntime(configuration: Configuration, bindings: {
  corpusPool: Pool; privateObjects: ProvisionObjects;
}, deadlineAt: number, signal: AbortSignal) {
  const { store } = await openRegisteredEvidenceStore(bindings.corpusPool, configuration.generationSha256, deadlineAt, signal, { readOnly: true });
  signal.throwIfAborted();
  return createConfiguredAnswerRuntime(configuration, { store, privateObjects: bindings.privateObjects });
}

/** One shared durable funding boundary per server runtime; request executions remain isolated. */
export function createConfiguredAnswerRuntime(configuration: Configuration, bindings: {
  store: Store; privateObjects: ProvisionObjects;
}) {
  if (bindings.store.namespace !== `legal-prepared-${configuration.generationSha256}`) throw new Error("CITATION_STORE_IDENTITY");
  if (configuration.purpose === "qualification" && !configuration.spendingCaps) throw new Error("ANSWER_SPENDING_CAP_REQUIRED");
  const ledger = configuration.spendingCaps
    ? new CategorySpendingLedger(configuration.ledgerPath, configuration.spendingCaps,
      configuration.purpose === "production" ? ["operating"] : ["diagnostic", "final"])
    : new OperatingUsageLedger(configuration.ledgerPath);
  let journal: ProviderReceiptJournal;
  try { journal = new ProviderReceiptJournal(configuration.receiptPath); }
  catch (error) { ledger.close(); throw error; }
  let closed = false;
  return {
    dependencies(mode: LegalRequest["mode"]): Parameters<typeof executeSignedInAnswer>[1] {
      if (closed) throw new Error("ANSWER_RUNTIME_CLOSED");
      const model = configuration.models[mode];
      return { model, legalDatabaseAsOf: configuration.legalDatabaseAsOf, sourceVersionHash: configuration.sourceVersionHash,
        privateObjects: bindings.privateObjects,
        async createExecution(input) {
          if (closed) throw new Error("ANSWER_RUNTIME_CLOSED");
          if (input.model !== model || input.request.mode !== mode) throw new Error("ANSWER_MODEL_ROUTE_MISMATCH");
          return createAnswerExecution({ ...input, apiKey: configuration.apiKey,
            corpus: { ...configuration.corpus, store: bindings.store }, ledger,
            receipt: async record => { journal.append(record); }, embeddingInputRate: configuration.embeddingInputRate,
            generation: { purpose: configuration.purpose, phase: configuration.phase, rates: configuration.generationRates[model],
              reasoningEffort: configuration.reasoningEffort?.[model],
              serviceTier: configuration.serviceTier?.[model], continuationServiceTier: configuration.continuationServiceTier?.[model], fastRates: configuration.fastGenerationRates?.[model],
              inputTokenCounting: configuration.inputTokenCounting?.[model],
              countInputAfterWriting: configuration.countInputAfterWriting?.[model],
              issueWriting: configuration.issueWriting,
              continuationReasoningEffort: configuration.continuationReasoningEffort?.[model],
              maximumRequestMicrousd: configuration.maximumRequestGenerationMicrousd },
          });
        },
      };
    },
    close() {
      if (closed) return;
      closed = true;
      try { journal.close(); } finally { ledger.close(); }
    },
  };
}
