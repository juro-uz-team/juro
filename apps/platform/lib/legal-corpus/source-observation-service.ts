import {z} from "zod";
import {observeCurrentLexDocument} from "../legal/lex-document-status";
import {createSharedLexDocumentObservationReader} from "../legal/shared-source-observation";
import {sourceObservationSchema, type SourceObservation} from "../legal/source-observation";
import {classifyLegalSourceUrl, readBoundedLegalSourceBytes} from "../legal/source-fetch";
import {acceptsPrivateServiceRequest, declaredRequestBodyWithinLimit, privateServiceJson} from "./private-service-boundary";
import {legalEnvironmentSchema} from "./target-domain-schemas";

export const SOURCE_OBSERVATION_PATH = "/internal/legal-corpus/source-observation";
const MARKER = "source-observation-v1";
const responseSchema = z.object({version: z.literal(1), observation: sourceObservationSchema}).strict();

export async function handleSourceObservationRequest(request: Request, env: {
  APP_ENV: string; LEGAL_DB?: D1Database; LEGAL_SOURCE_OBSERVATIONS_ENABLED?: string;
}, dependencies?: {observe: (url: string) => Promise<SourceObservation>}): Promise<Response> {
  const environment = legalEnvironmentSchema.safeParse(env.APP_ENV);
  if (!environment.success || !acceptsPrivateServiceRequest(request, {environment: environment.data,
    marker: MARKER, method: "POST", path: SOURCE_OBSERVATION_PATH, requireJson: true})) {
    return privateServiceJson({code: "SOURCE_OBSERVATION_PRIVATE_ROUTE_REJECTED"}, 404);
  }
  try {
    if (!declaredRequestBodyWithinLimit(request, 2048)) throw new TypeError("SOURCE_OBSERVATION_REQUEST_INVALID");
    const {officialUrl} = z.object({officialUrl: z.url().max(1000)}).strict().parse(await request.json());
    const reference = classifyLegalSourceUrl(officialUrl);
    if (reference.sourceKind !== "lex" || reference.revisionDate || reference.canonicalUrl !== officialUrl) {
      throw new TypeError("SOURCE_OBSERVATION_IDENTITY_INVALID");
    }
    if (env.LEGAL_SOURCE_OBSERVATIONS_ENABLED === "true" && !env.LEGAL_DB) throw new TypeError("SOURCE_OBSERVATION_UNAVAILABLE");
    const observe = dependencies?.observe ?? (env.LEGAL_SOURCE_OBSERVATIONS_ENABLED === "true"
      ? createSharedLexDocumentObservationReader(env.LEGAL_DB!) : observeCurrentLexDocument);
    return privateServiceJson(responseSchema.parse({version: 1, observation: await observe(officialUrl)}));
  } catch {return privateServiceJson({code: "SOURCE_OBSERVATION_UNAVAILABLE"}, 503);}
}

export function createSourceObservationClient(input: {service: Fetcher; environment: z.infer<typeof legalEnvironmentSchema>}) {
  return async (officialUrl: string): Promise<SourceObservation> => {
    const response = await input.service.fetch(`http://legal-corpus.internal${SOURCE_OBSERVATION_PATH}`, {
      method: "POST", headers: {"content-type": "application/json", "x-juro-service-binding": MARKER,
        "x-juro-legal-environment": input.environment}, body: JSON.stringify({officialUrl}),
    });
    if (!response.ok) throw new TypeError("SOURCE_OBSERVATION_UNAVAILABLE");
    const bytes = await readBoundedLegalSourceBytes(response, 4096, 4000);
    const parsed = responseSchema.parse(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)));
    if (parsed.observation.officialUrl !== officialUrl) throw new TypeError("SOURCE_OBSERVATION_IDENTITY_INVALID");
    return parsed.observation;
  };
}
