import {corpusSessionSchema, type CorpusSessionInput} from "../lib/legal-chat/corpus-session";
import {LegalResearchSession} from "./legal-research-session";
import {createCorpusResearch} from "../lib/legal-chat/corpus-research";
import { CITATION_EVIDENCE_PATH, handleCitationEvidenceRequest } from "../lib/legal-corpus/citation-evidence";
import {SOURCE_OBSERVATION_PATH, handleSourceObservationRequest} from "../lib/legal-corpus/source-observation-service";
import {
  handleOfficialEvidenceRequest,
  OFFICIAL_EVIDENCE_RESOLVE_PATH,
  type OfficialEvidenceEnv,
} from "../lib/legal-corpus/target-evidence";
import {
  handleReleaseLifecycleRequest,
  RELEASE_LIFECYCLE_RESOLVE_PATH,
  type ReleaseLifecycleEnv,
} from "../lib/legal-corpus/target-release";
import {
  createRuntimeLegalEvidenceServices, type TargetRetrievalRuntimeEnv,
} from "../lib/legal-corpus/target-runtime";
import {
  handleTargetActivationSetEvaluationRequest,
  TARGET_ACTIVATION_SET_EVALUATION_PATH,
} from "../lib/legal-corpus/target-evaluation";

type LegalCorpusWorkerEnv = OfficialEvidenceEnv & ReleaseLifecycleEnv
  & TargetRetrievalRuntimeEnv & {
    LEGAL_CORPUS_LEGACY_WRITES_ENABLED?: string;
  };

function response(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}

export function rejectDisabledLegacyCorpusWrite(
  request: Request,
  env: Pick<LegalCorpusWorkerEnv, "LEGAL_CORPUS_LEGACY_WRITES_ENABLED">,
): Response | null {
  if (env.LEGAL_CORPUS_LEGACY_WRITES_ENABLED !== "false") return null;
  const pathname = new URL(request.url).pathname;
  const isLegacyWrite = pathname.startsWith("/internal/legal-corpus/search-index-build/")
    || pathname.startsWith("/internal/legal-corpus/ai-search-projection/")
    || pathname === "/internal/legal-corpus/ai-search/configure-candidate";
  return isLegacyWrite
    ? response({ code: "LEGAL_CORPUS_LEGACY_WRITES_DISABLED" }, 503)
    : null;
}

export default class LegalCorpusWorker {
  constructor(readonly env: LegalCorpusWorkerEnv) {}
  async openLegalResearch(input:CorpusSessionInput) {
    const scope=corpusSessionSchema.parse(input);
    if(scope.environment!==this.env.APP_ENV)throw new Error("CORPUS_RESEARCH_ENVIRONMENT_MISMATCH");
    return new LegalResearchSession(scope,formulate=>createCorpusResearch({
      services:createRuntimeLegalEvidenceServices(this.env),formulate,
    }));
  }

  async fetch(input: Request | string | URL, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request && !init ? input : new Request(input, init);
    const env=this.env;
    const url = new URL(request.url);
    const legacyWriteRejection = rejectDisabledLegacyCorpusWrite(request, env);
    if (legacyWriteRejection) return legacyWriteRejection;
    if (url.pathname === SOURCE_OBSERVATION_PATH) return handleSourceObservationRequest(request, env);
    if (url.pathname === CITATION_EVIDENCE_PATH) return handleCitationEvidenceRequest(request, env);
    if (url.pathname === OFFICIAL_EVIDENCE_RESOLVE_PATH) {
      return handleOfficialEvidenceRequest(request, env);
    }
    if (url.pathname === RELEASE_LIFECYCLE_RESOLVE_PATH) {
      return handleReleaseLifecycleRequest(request, env);
    }
    if (url.pathname === TARGET_ACTIVATION_SET_EVALUATION_PATH) {
      return handleTargetActivationSetEvaluationRequest(request, env);
    }
    if (request.method !== "GET") return response({ code: "METHOD_NOT_ALLOWED" }, 405);
    if (url.pathname === "/health") {
      return response({
        service: "legal-corpus-worker",
        environment: env.APP_ENV,
        legacyCorpusEnabled: false,
        status: "ok",
      });
    }
    if (url.pathname === "/ready") {
      if (!env.LEGAL_DB) {
        return response({ service: "legal-corpus-worker", status: "not_ready" }, 503);
      }
      try {
        await env.LEGAL_DB.prepare("SELECT 1 AS ready").first();
        return response({ service: "legal-corpus-worker", status: "ready" });
      } catch {
        return response({ service: "legal-corpus-worker", status: "not_ready" }, 503);
      }
    }
    return response({ code: "NOT_FOUND" }, 404);
  }
}
