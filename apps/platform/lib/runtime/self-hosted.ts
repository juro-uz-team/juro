import { localDocumentConverter } from "./document-converter";
import { localMalwareScanner } from "./scanner";
import { operationalMetrics } from "./metrics";
import { localEmailCapture } from "./email";
import { localAssets } from "./assets";
import { resolve } from "node:path";
import { database } from "../storage/connection";
import { LocalObjectStore } from "../storage/objects";
import { PostgresVectorIndex } from "../storage/vectors";
import {createPreparedMembershipReader,createPreparedOrdinalReader} from "../storage/corpus-membership";
import { PostgresQueue } from "../storage/queue";
import { JOB_KINDS, QUEUE_BINDING_BY_KIND, expectedQueueName } from "../jobs/contract";
import LegalCorpusService from "../../worker/legal-corpus-worker";
import { handleCustomSearchRequest, type CustomSearchEnv } from "../legal-corpus/custom-search-service";
import {CustomRuntimeCache} from "../legal-corpus/custom-runtime-cache";
import { handleTargetReasoningServiceRequest } from "../legal-corpus/target-reasoning-service";
import releases from "../../config/corpus-releases.json";
import type { BuilderRuntimeEnv } from "../document-builder/storage/runtime";
import type { PlatformJobEnv } from "../../worker/platform-jobs";

type Runtime = BuilderRuntimeEnv & PlatformJobEnv;
const state = globalThis as typeof globalThis & { juroRuntime?: Runtime };

export function getSelfHostedRuntime(): Runtime {
  if (state.juroRuntime) return state.juroRuntime;
  const application = database("app");
  const catalog = database("legal");
  const root = resolve(process.env.OBJECT_STORAGE_PATH ?? "../../.data/objects");
  const bucket = (name: string) => new LocalObjectStore(application.pool, root, name);
  const env = { ...process.env, APP_ENV: "development", ASYNC_RUNTIME_ENABLED: "true", JOB_SCHEMA_VERSION: "1",
    CRON_ENABLED: "true", LEGAL_LEX_INGESTION_ENABLED: "false", LEGAL_ADVICE_INGESTION_ENABLED: "false",
    LEGAL_LEX_RSS_DISCOVERY_ENABLED: "false", LEGAL_ADVICE_SITEMAP_DISCOVERY_ENABLED: "false",
    LEGAL_LEX_METADATA_MONITOR_ENABLED: "false", LEGAL_DIRECT_RETRIEVAL_ENABLED: "true",
    GUEST_AI_ENABLED: "true", LAWYER_PROFILE_DIRECTORY_ENABLED: "true",
    LEGAL_CORPUS_USER_UPLOAD_AUTO_TRUST: "false", PUBLIC_DOCUMENT_URL_IMPORT_ENABLED: "false",
    ACCOUNT_DELETION_PURGE_ENABLED: "true", PAYMENT_FOUNDATION_ENABLED: "false", PAYMENT_PRODUCTION_APPROVED: "false",
    STAGING_LEGAL_EVALUATION_ENABLED: "false", STAGING_SYNTHETIC_PROBES_ENABLED: "false", PRODUCTION_SYNTHETIC_PROBES_ENABLED: "false",
    LOCAL_AUTH_BYPASS: "false", ALLOW_PLATFORM_AUTH_HEADERS: "false",
    TURNSTILE_SECRET_KEY: "private-local", TURNSTILE_SITE_KEY: "private-local",
    RESEND_API_KEY: "local-capture", EMAIL_FROM: "JURO <noreply@localhost>",
    EMAIL_DELIVERY: localEmailCapture,
    OCR: localDocumentConverter, MALWARE_SCANNER: localMalwareScanner, MALWARE_SCAN_ENABLED: "true",
    PLATFORM_ANALYTICS: operationalMetrics,
    ASSETS: localAssets(resolve("public")),
    DB: application, BUCKET: bucket("application"), QUARANTINE_BUCKET: bucket("quarantine"),
    LEX_UZ_INDEX: new PostgresVectorIndex(application.pool, "lex"),
    ADVICE_UZ_INDEX: new PostgresVectorIndex(application.pool, "advice"),
    USER_DOCUMENTS_INDEX: new PostgresVectorIndex(application.pool, "user-documents"),
    APP_URL: process.env.APP_URL ?? "http://localhost:3000", PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL ?? "http://localhost:3001",
    ADMIN_CONSOLE_ORIGIN: process.env.ADMIN_CONSOLE_ORIGIN ?? "http://localhost:3002",
    LEGAL_RETRIEVAL_ENVIRONMENT: "production",
  };
  const search = (configuration: typeof releases.current) => {
      // The historical lexicons and document table alone occupy about 145 MB.
      // Keep room for authenticated posting blocks without evicting that base.
      const cache = new CustomRuntimeCache(512*1024*1024);
      return {
        async fetch(input: RequestInfo | URL, init?: RequestInit) {
          const index = new PostgresVectorIndex(application.pool, configuration.vectorCollection);
          if (!await index.isReady()) return Response.json({ code: "CORPUS_IMPORT_NOT_VERIFIED" }, { status: 503 });
          return handleCustomSearchRequest(new Request(input, init), {
            ...configuration.variables, OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "", CATALOG_DB: catalog,
            ARTIFACTS: bucket(configuration.artifactNamespace),
            RUNTIME_CACHE: cache,
            PREPARED_ORDINALS:createPreparedOrdinalReader(application.pool),
            DENSE: index,
          } as unknown as CustomSearchEnv);
        },
      };
  };
  const legal = new LegalCorpusService({
    LEGAL_PREPARED_MEMBERSHIP:createPreparedMembershipReader(application.pool),
    ...releases.catalog, LEGAL_DB: catalog, LEGAL_SOURCE_OBSERVATIONS_ENABLED:"true",
    LEGAL_EVIDENCE_BUCKET: bucket(releases.evidenceNamespace),
    LEGAL_HISTORY_EVIDENCE_BUCKET: bucket(releases.historyEvidenceNamespace),
    LEGAL_CUSTOM_ARTIFACT_BUCKET: bucket(releases.current.artifactNamespace),
    LEGAL_CUSTOM_SEARCH_SERVICE: search(releases.current), LEGAL_CUSTOM_HISTORY_SEARCH_SERVICE: search(releases.history),
    LEGAL_CORPUS_REASONING_SERVICE: { fetch: (input: RequestInfo | URL, init?: RequestInit) => handleTargetReasoningServiceRequest(new Request(input, init), env as unknown as Parameters<typeof handleTargetReasoningServiceRequest>[1]) },
  } as unknown as ConstructorParameters<typeof LegalCorpusService>[0]);
  const queues = Object.fromEntries(JOB_KINDS.map(kind => [QUEUE_BINDING_BY_KIND[kind], new PostgresQueue(application.pool, expectedQueueName(kind, "development"))]));
  const deadLetters = Object.fromEntries(Object.entries(queues).map(([binding, queue]) => [binding.replace(/_QUEUE$/, "_DLQ"), new PostgresQueue(application.pool, queue.name + "-dlq")]));
  state.juroRuntime = { ...env, ...queues, ...deadLetters, LEGAL_RETRIEVAL_SERVICE: legal } as unknown as Runtime;
  return state.juroRuntime;
}
