import { z } from "zod";

import {
  acceptsPrivateServiceRequest,
  declaredRequestBodyWithinLimit,
  privateServiceJson,
} from "./private-service-boundary";
import type {TargetRetrievalRuntimeEnv} from "./target-runtime";

export const TARGET_ACTIVATION_SET_EVALUATION_PATH =
  "/internal/legal-corpus/target/evaluation/activation-set/answer";

const ACTIVATION_SET_SERVICE_BINDING_MARKER = "target-activation-set-evaluation-v1";
const MAXIMUM_REQUEST_BYTES = 8_192;
const activationSetRequestSchema = z.object({
  activationSetId: z.string().trim().min(1).max(300)
    .regex(/^[A-Za-z0-9._:-]+$/u),
  historyReconciliationRunId: z.string().trim().min(1).max(300)
    .regex(/^[A-Za-z0-9._:-]+$/u),
  historyReportSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  question: z.object({
    id: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/u),
    question: z.string().trim().min(1).max(4_000),
  }).strict(),
}).strict();

export type TargetActivationSetEvaluationRequest = z.input<typeof activationSetRequestSchema>;

export async function handleTargetActivationSetEvaluationRequest(
  request: Request,
  env: TargetRetrievalRuntimeEnv,
): Promise<Response> {
  if (env.APP_ENV !== "staging" || env.LEGAL_CORPUS_SHADOW_MODE !== "true"
    || !acceptsPrivateServiceRequest(request, {
      environment: "staging",
      marker: ACTIVATION_SET_SERVICE_BINDING_MARKER,
      method: "POST",
      path: TARGET_ACTIVATION_SET_EVALUATION_PATH,
      requireJson: true,
    })) return privateServiceJson({ code: "TARGET_ACTIVATION_SET_EVALUATION_REJECTED" }, 404);
  try {
    if (!declaredRequestBodyWithinLimit(request, MAXIMUM_REQUEST_BYTES)) {
      throw new TypeError("TARGET_ACTIVATION_SET_EVALUATION_REQUEST_TOO_LARGE");
    }
    const bodyText = await request.text();
    if (new TextEncoder().encode(bodyText).byteLength > MAXIMUM_REQUEST_BYTES) {
      throw new TypeError("TARGET_ACTIVATION_SET_EVALUATION_REQUEST_TOO_LARGE");
    }
    activationSetRequestSchema.parse(JSON.parse(bodyText) as unknown);
    // This endpoint belonged to the retired answer engine. Preserve its private
    // boundary and explicit unavailability until replacement release evaluation
    // exists; never qualify a candidate by silently using the active release.
    return privateServiceJson({ code: "TARGET_ACTIVATION_SET_EVALUATION_UNAVAILABLE" }, 503);
  } catch {
    return privateServiceJson({ code: "TARGET_ACTIVATION_SET_EVALUATION_UNAVAILABLE" }, 503);
  }
}

export function createTargetActivationSetEvaluationClient(input: {
  service: Fetcher;
  environment: "staging";
}) {
  return {
    async answer(untrustedInput: TargetActivationSetEvaluationRequest): Promise<unknown> {
      const body = activationSetRequestSchema.parse(untrustedInput);
      const response = await input.service.fetch(
        `http://legal-corpus.internal${TARGET_ACTIVATION_SET_EVALUATION_PATH}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-juro-service-binding": ACTIVATION_SET_SERVICE_BINDING_MARKER,
            "x-juro-legal-environment": input.environment,
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw new TypeError("TARGET_ACTIVATION_SET_EVALUATION_UNAVAILABLE");
      return z.object({ result: z.unknown(), observation: z.unknown() }).strict()
        .parse(await response.json());
    },
  };
}
