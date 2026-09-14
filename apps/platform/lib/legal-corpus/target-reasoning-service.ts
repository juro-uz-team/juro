import { z } from "zod";
import { legalEnvironmentSchema, sha256Schema } from "./target-domain-schemas";
import { acceptsPrivateServiceRequest, declaredRequestBodyWithinLimit, privateServiceJson } from "./private-service-boundary";


export const TARGET_PRIVATE_NAME_CLASSIFICATION_PATH =
  "/internal/legal-corpus/privacy/classify-private-names";

const SERVICE_BINDING_MARKER = "target-retrieval-runtime-v1";
const MAX_CLASSIFICATION_BYTES = 8_192;

const classificationRequestSchema = z.object({
  text: z.string().trim().min(1).max(900),
  formulationSha256: sha256Schema,
  legalTitleSpans: z.array(z.string().trim().min(3).max(300)).max(12),
}).strict();
const classificationResponseSchema = z.object({
  classifierVersion: z.literal("juro-local-pii-v1"),
  formulationSha256: sha256Schema,
  status: z.enum(["complete", "uncertain"]),
  privateNameSpans: z.array(z.string().trim().min(1).max(300)).max(24),
}).strict();

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function literalPattern(value: string): RegExp {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(escaped, "gu");
}

/**
 * Conservative, provider-free proper-name attestation. Declared legal titles
 * are masked here but are independently authenticated against the pinned release
 * before the candidate adapter may preserve them.
 */
export async function classifyTargetPrivateNames(input: z.input<typeof classificationRequestSchema>) {
  const value = classificationRequestSchema.parse(input);
  const text = value.text.normalize("NFC");
  const expectedSha256 = await sha256Hex([
    "juro.private-name-classification.v1",
    text,
  ].join("\n"));
  if (expectedSha256 !== value.formulationSha256) {
    return classificationResponseSchema.parse({
      classifierVersion: "juro-local-pii-v1",
      formulationSha256: value.formulationSha256,
      status: "uncertain",
      privateNameSpans: [],
    });
  }
  let masked = text;
  const placeholders = new Map<string, string>();
  for (const [index, title] of [...new Set(value.legalTitleSpans)].entries()) {
    if (!text.includes(title)) {
      return classificationResponseSchema.parse({
        classifierVersion: "juro-local-pii-v1",
        formulationSha256: value.formulationSha256,
        status: "uncertain",
        privateNameSpans: [],
      });
    }
    const placeholder = `JURO_LEGAL_TITLE_${index}_TOKEN`;
    masked = masked.replace(literalPattern(title), placeholder);
    placeholders.set(placeholder, title);
  }
  const spans: string[] = [];
  const properName = /(?<!\p{L})\p{Lu}\p{Ll}{1,}(?:['’][\p{L}]+)?(?:\s+\p{Lu}\p{Ll}{1,}(?:['’][\p{L}]+)?){0,7}(?!\p{L})/gu;
  for (const match of masked.matchAll(properName)) {
    const span = match[0];
    if (!span || span.startsWith("JURO_LEGAL_TITLE_")) continue;
    const isSingleSentenceInitialWord = !span.includes(" ")
      && (match.index === 0 || /[.!?]\s*$/u.test(masked.slice(0, match.index)));
    if (isSingleSentenceInitialWord) continue;
    spans.push(span);
  }
  void placeholders;
  const unique = [...new Set(spans)];
  return classificationResponseSchema.parse({
    classifierVersion: "juro-local-pii-v1",
    formulationSha256: value.formulationSha256,
    status: unique.length <= 24 ? "complete" : "uncertain",
    privateNameSpans: unique.slice(0, 24),
  });
}

export async function handleTargetReasoningServiceRequest(
  request: Request,
  env: { APP_ENV?: string },
): Promise<Response> {
  const environment = legalEnvironmentSchema.safeParse(env.APP_ENV);
  if (!environment.success) return privateServiceJson({ code: "TARGET_REASONING_UNAVAILABLE" }, 503);
  const path = new URL(request.url).pathname;
  const maximumBytes = MAX_CLASSIFICATION_BYTES;
  if (!acceptsPrivateServiceRequest(request, {
    environment: environment.data,
    marker: SERVICE_BINDING_MARKER,
    method: "POST",
    path,
    requireJson: true,
  }) || path !== TARGET_PRIVATE_NAME_CLASSIFICATION_PATH || !declaredRequestBodyWithinLimit(request, maximumBytes)) {
    return privateServiceJson({ code: "TARGET_REASONING_PRIVATE_ROUTE_REJECTED" }, 404);
  }
  try {
    const bodyText = await request.text();
    if (new TextEncoder().encode(bodyText).byteLength > maximumBytes) {
      return privateServiceJson({ code: "TARGET_REASONING_REQUEST_TOO_LARGE" }, 413);
    }
    const body = JSON.parse(bodyText) as unknown;
    return privateServiceJson(await classifyTargetPrivateNames(
      classificationRequestSchema.parse(body),
    ));
  } catch (error) {
    const failure = error && typeof error === "object" ? error as {
      name?: unknown; code?: unknown; providerStatus?: unknown; providerErrorType?: unknown;
    } : {};
    console.log(JSON.stringify({
      event: "legal_target_reasoning_unavailable",
      name: typeof failure.name === "string" ? failure.name : "unknown",
      code: typeof failure.code === "string" ? failure.code : "unknown",
      providerStatus: typeof failure.providerStatus === "number" ? failure.providerStatus : null,
      providerErrorType: typeof failure.providerErrorType === "string"
        ? failure.providerErrorType : null,
      // Log only schema coordinates, never source text, prompts or rejected values.
      validationIssues: error instanceof z.ZodError
        ? error.issues.slice(0, 8).map((issue) => ({ code: issue.code, path: issue.path.join(".") }))
        : [],
    }));
    return privateServiceJson({ code: "TARGET_REASONING_UNAVAILABLE" }, 503);
  }
}
