import { localDocumentConverter } from "./document-converter";
import { localMalwareScanner } from "./scanner";
import { operationalMetrics } from "./metrics";
import { localEmailCapture } from "./email";
import { createResendDelivery, emailDeliveryConfiguration } from "./email-delivery";
import { localAssets } from "./assets";
import { resolve } from "node:path";
import { database, corpusDatabase } from "../storage/connection";
import { LocalObjectStore } from "../storage/objects";
import { PostgresVectorIndex } from "../storage/vectors";
import {createVectorCandidateReader} from "../storage/vector-candidates";
import {createPreparedMembershipReader,createPreparedOrdinalReader} from "../storage/corpus-membership";
import { PostgresQueue } from "../storage/queue";
import { JOB_KINDS, QUEUE_BINDING_BY_KIND, expectedQueueName } from "../jobs/contract";
import LegalCorpusService from "../../worker/legal-corpus-worker";
import { handleCustomSearchRequest, type CustomSearchEnv } from "../legal-corpus/custom-search-service";
import {CustomRuntimeCache} from "../legal-corpus/custom-runtime-cache";
import {createNativeCorpusService} from "./native-corpus";
import {runtimeProductRevision,executingProductRevision} from "./product-revision";
import { handleTargetReasoningServiceRequest } from "../legal-corpus/target-reasoning-service";
import releases from "../../config/corpus-releases.json";
import type { BuilderRuntimeEnv } from "../document-builder/storage/runtime";
import type { PlatformJobEnv } from "../../worker/platform-jobs";
import { nativeHttpConfiguration } from "../../../../scripts/native-http.mjs";
import { nativeAdminOrigin } from "../../../../scripts/native-admin-http.mjs";
import { challengeSecretConfigured } from "../auth/native-challenge";
import { parseIdentityKeyring } from "../auth/keyring";

type Runtime = BuilderRuntimeEnv & PlatformJobEnv;
const state = globalThis as typeof globalThis & { juroRuntime?: Runtime; juroRuntimeProductRevision?:string };

export function getSelfHostedRuntime(): Runtime {
  if (state.juroRuntime) {
    if(state.juroRuntimeProductRevision&&state.juroRuntimeProductRevision!=="unqualified"
      &&state.juroRuntimeProductRevision!==executingProductRevision())throw Error("NATIVE_RUNTIME_BUILD_MISMATCH");
    return state.juroRuntime;
  }
  const productRevision=runtimeProductRevision();
  const config = nativeHttpConfiguration(process.env, "platform");
  if (!config.privateMode) {
    if (!challengeSecretConfigured(process.env.AUTH_CHALLENGE_SECRET)) throw new Error("Public authentication requires AUTH_CHALLENGE_SECRET");
    if (!parseIdentityKeyring(process.env.IDENTITY_KEYRING)) throw new Error("Public authentication requires IDENTITY_KEYRING");
    if (process.env.IDENTITY_PROTECTION_MODE !== "dual_write") throw new Error("Public authentication requires IDENTITY_PROTECTION_MODE=dual_write");
  }
  const appEnvironment = config.privateMode ? "development" : process.env.DEPLOYMENT_ENVIRONMENT!;
  const application = database("app");
  if (Boolean(process.env.CORPUS_DATABASE_URL) !== Boolean(process.env.CORPUS_OBJECT_STORAGE_PATH)) throw new Error("Shared corpus database and object path must be configured together");
  const corpus = corpusDatabase("app");
  const catalog = corpusDatabase("legal");
  const observations = database("legal");
  const root = resolve(process.env.OBJECT_STORAGE_PATH ?? "../../.data/objects");
  const bucket = (name: string) => new LocalObjectStore(application.pool, root, name);
  const corpusRoot = resolve(process.env.CORPUS_OBJECT_STORAGE_PATH ?? root);
  const corpusBucket = (name: string) => new LocalObjectStore(corpus.pool, corpusRoot, name, true);
  const email = emailDeliveryConfiguration(process.env);
  const env = { ...process.env, APP_ENV: appEnvironment, ASYNC_RUNTIME_ENABLED: "true", JOB_SCHEMA_VERSION: "1",
    CRON_ENABLED: "true", LEGAL_LEX_INGESTION_ENABLED: "false", LEGAL_ADVICE_INGESTION_ENABLED: "false",
    LEGAL_LEX_RSS_DISCOVERY_ENABLED: "false", LEGAL_ADVICE_SITEMAP_DISCOVERY_ENABLED: "false",
    LEGAL_LEX_METADATA_MONITOR_ENABLED: "false", LEGAL_DIRECT_RETRIEVAL_ENABLED: "true",
    GUEST_AI_ENABLED: "true", LAWYER_PROFILE_DIRECTORY_ENABLED: "true",
    LEGAL_CORPUS_USER_UPLOAD_AUTO_TRUST: "false", PUBLIC_DOCUMENT_URL_IMPORT_ENABLED: "false",
    ACCOUNT_DELETION_PURGE_ENABLED: "true", PAYMENT_FOUNDATION_ENABLED: "false", PAYMENT_PRODUCTION_APPROVED: "false",
    STAGING_LEGAL_EVALUATION_ENABLED: "false", STAGING_SYNTHETIC_PROBES_ENABLED: "false", PRODUCTION_SYNTHETIC_PROBES_ENABLED: "false",
    LOCAL_AUTH_BYPASS: "false", ALLOW_PLATFORM_AUTH_HEADERS: "false",
    TURNSTILE_SECRET_KEY: config.privateMode ? "private-local" : process.env.AUTH_CHALLENGE_SECRET,
    TURNSTILE_SITE_KEY: config.privateMode ? "private-local" : "native-altcha",
    RESEND_API_KEY: email.apiKey, EMAIL_FROM: email.from,
    EMAIL_DELIVERY: email.mode === "capture" ? localEmailCapture : createResendDelivery(email.apiKey),
    OCR: localDocumentConverter, MALWARE_SCANNER: localMalwareScanner, MALWARE_SCAN_ENABLED: "true",
    PLATFORM_ANALYTICS: operationalMetrics,
    ASSETS: localAssets(resolve("public")),
    DB: application, BUCKET: bucket("application"), QUARANTINE_BUCKET: bucket("quarantine"),
    LEX_UZ_INDEX: new PostgresVectorIndex(corpus.pool, "lex"),
    ADVICE_UZ_INDEX: new PostgresVectorIndex(corpus.pool, "advice"),
    USER_DOCUMENTS_INDEX: new PostgresVectorIndex(application.pool, "user-documents"),
    APP_URL: process.env.APP_URL ?? "http://localhost:3000", PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL ?? "http://localhost:3001",
    ADMIN_CONSOLE_ORIGIN: nativeAdminOrigin(process.env),
    LEGAL_RETRIEVAL_ENVIRONMENT: "production",
  };
  const search = (configuration: typeof releases.current) => {
      // The historical lexicons and document table alone occupy about 145 MB.
      // Keep room for authenticated posting blocks without evicting that base.
      const cache = new CustomRuntimeCache(512*1024*1024);
      return {
        async fetch(input: RequestInfo | URL, init?: RequestInit) {
          const index = new PostgresVectorIndex(corpus.pool, configuration.vectorCollection,
            process.env.VECTOR_CANDIDATE_URL ? createVectorCandidateReader(process.env.VECTOR_CANDIDATE_URL) : undefined);
          if (!await index.isReady()) return Response.json({ code: "CORPUS_IMPORT_NOT_VERIFIED" }, { status: 503 });
          return handleCustomSearchRequest(new Request(input, init), {
            ...configuration.variables, OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "", CATALOG_DB: catalog, BUDGET_DB: observations,
            ARTIFACTS: corpusBucket(configuration.artifactNamespace),
            RUNTIME_CACHE: cache,
            PREPARED_ORDINALS:createPreparedOrdinalReader(corpus.pool),
            DENSE: index,
          } as unknown as CustomSearchEnv);
        },
      };
  };
  const legal = new LegalCorpusService({
    LEGAL_PREPARED_MEMBERSHIP:createPreparedMembershipReader(corpus.pool),
    ...releases.catalog, LEGAL_DB: catalog, LEGAL_OBSERVATION_DB: observations, LEGAL_SOURCE_OBSERVATIONS_ENABLED:"true",
    LEGAL_EVIDENCE_BUCKET: corpusBucket(releases.evidenceNamespace),
    LEGAL_HISTORY_EVIDENCE_BUCKET: corpusBucket(releases.historyEvidenceNamespace),
    LEGAL_CUSTOM_ARTIFACT_BUCKET: corpusBucket(releases.current.artifactNamespace),
    LEGAL_CUSTOM_SEARCH_SERVICE: search(releases.current), LEGAL_CUSTOM_HISTORY_SEARCH_SERVICE: search(releases.history),
    LEGAL_CORPUS_REASONING_SERVICE: { fetch: (input: RequestInfo | URL, init?: RequestInit) => handleTargetReasoningServiceRequest(new Request(input, init), env as unknown as Parameters<typeof handleTargetReasoningServiceRequest>[1]) },
  } as unknown as ConstructorParameters<typeof LegalCorpusService>[0]);
  const queues = Object.fromEntries(JOB_KINDS.map(kind => [QUEUE_BINDING_BY_KIND[kind], new PostgresQueue(application.pool, expectedQueueName(kind, appEnvironment))]));
  const deadLetters = Object.fromEntries(Object.entries(queues).map(([binding, queue]) => [binding.replace(/_QUEUE$/, "_DLQ"), new PostgresQueue(application.pool, queue.name + "-dlq")]));
  const retrieval=createNativeCorpusService({pool:corpus.pool,catalog,observations,objectRoot:corpusRoot,
    candidateUrl:process.env.VECTOR_CANDIDATE_URL??"",apiKey:process.env.OPENAI_API_KEY??"",
    productRevision,fallback:legal});
  state.juroRuntimeProductRevision=productRevision;
  state.juroRuntime = { ...env, ...queues, ...deadLetters, LEGAL_RETRIEVAL_SERVICE: retrieval } as unknown as Runtime;
  return state.juroRuntime;
}
