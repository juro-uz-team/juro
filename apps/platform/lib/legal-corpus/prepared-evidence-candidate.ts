import type {CandidatePacket} from "./legal-candidate-index";
import {parseRevalidatedCandidates} from "./target-retrieval";
import type {createPreparedEvidenceSession} from "./prepared-evidence-session";

type Resolved=Awaited<ReturnType<ReturnType<typeof createPreparedEvidenceSession>["resolve"]>>;
type Candidate=CandidatePacket["candidates"][number];

/** Bind research identities only after official evidence correspondence succeeds.
 * The prepared package revision is not substituted for the captured revision. */
export function bindPreparedEvidenceCandidate(candidate:Candidate,resolved:Resolved){
  const expected=`/prepared/${resolved.discovery.vectorOrdinal}/${resolved.discovery.membershipOrdinal}`;
  if(!candidate.itemKey.endsWith(expected))throw Error("PREPARED_EVIDENCE_CANDIDATE_MISMATCH");
  const original=resolved.source.resolution.controlling;
  const validated=parseRevalidatedCandidates([{candidate,canonicalChunkId:resolved.discovery.canonicalChunkId,
    provisionRenditionId:original.provisionRenditionId,textRevisionId:original.textRevisionId,
    provisionConceptId:original.provisionConceptId,textualAuthority:original.textualAuthority,
    languageFamily:original.languageTag.startsWith("uz-")?"uz":original.languageTag}])[0]!;
  const complete=resolved.source.resolution.articleContext??resolved.source.resolution.documentContext;
  if(!complete)throw Error("PREPARED_COMPLETE_CONTEXT_UNAVAILABLE");
  return {candidate:validated,citationLabel:resolved.source.resolution.materialCitation.label,
    provisionText:complete.provisionText,resolution:resolved.source.resolution,discovery:resolved.discovery};
}
