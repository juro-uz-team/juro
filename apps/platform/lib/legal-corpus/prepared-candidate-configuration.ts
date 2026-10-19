import {z} from "zod";
import {candidateConfigurationIdSchema, legalIdentifierSchema, providerProjectIdSchema,
  sha256Schema} from "./target-domain-schemas";

/** Artifact identities are admission requirements, not evidence of qualification.
 * Activation must authenticate the named manifests and their qualification receipts. */
export const preparedCandidateConfigurationSchema = z.object({
  backend: z.literal("prepared-corpus-v1"),
  identity: candidateConfigurationIdSchema,
  embeddingModel: z.literal("openai/text-embedding-3-large"),
  dimensions: z.literal(3_072),
  artifacts: z.object({
    packageSha256: sha256Schema,
    vectorCompletionSha256: sha256Schema,
    vectorIdentitySha256: sha256Schema,
    membershipSha256: sha256Schema,
    workIndexSha256: sha256Schema,
    navigationSha256: sha256Schema,
    sparseSha256: sha256Schema,
  }).strict(),
  // Prepared classifications and publication observations guide discovery only.
  // Currentness and historical applicability still require verified source evidence.
  evidenceSemantics: z.literal("discovery-only"),
  categoryRanking: z.discriminatedUnion("mode", [
    z.object({mode: z.literal("disabled")}).strict(),
    z.object({
      mode: z.literal("qualified"),
      policySha256: sha256Schema,
      qualificationSha256: sha256Schema,
    }).strict(),
  ]),
  gatewayIdentity: legalIdentifierSchema,
  providerProjectIdentity: providerProjectIdSchema,
  gatewayPayloadLogging: z.literal(false),
  gatewayCaching: z.literal(false),
  similarityCaching: z.literal(false),
}).strict();

export type PreparedCandidateConfiguration = z.infer<typeof preparedCandidateConfigurationSchema>;
