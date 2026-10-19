import {createHash} from "node:crypto";
import {classifyLegalSourceUrl,type FetchedLegalSource} from "../legal/source-fetch";
import {normalizeLexPublisherDocument,publisherTextFingerprint} from "../legal/lex-document-status";
import {sourceObservationSchema} from "../legal/source-observation";
import {stableSourceSnapshotJson} from "./source-snapshot";
import {createNormalizedSourceReader} from "./normalized-source-reader";
import type {LegalEvidenceBucket} from "./target-evidence";
import type {CitationEvidenceReceipt} from "./citation-evidence";

type Store=NonNullable<CitationEvidenceReceipt["store"]>;
type CaptureBucket=Pick<LegalEvidenceBucket,"get">&{put(key:string,bytes:Uint8Array):Promise<unknown>};
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");

/** Persist an authenticated parent before any provision can cite it.
 *
 * The caller supplies a registered generation store and an official fetch.
 * Discovery-span correspondence, article completeness and historical
 * applicability are separate admission checks; this function establishes none
 * of them merely by normalizing a publisher document.
 */
export async function capturePreparedSource(input:{
  fetched:FetchedLegalSource;store:Store;bucket:CaptureBucket;
  options:Parameters<typeof normalizeLexPublisherDocument>[1];
}){
  const {fetched,store}=input;
  input.options.signal?.throwIfAborted();
  if(!/^legal-prepared-[a-f0-9]{64}$/u.test(store.namespace)||!/^[a-f0-9]{64}$/u.test(store.generationSha256)){
    throw Error("PREPARED_SOURCE_STORE_INVALID");
  }
  const reference=classifyLegalSourceUrl(fetched.canonicalUrl);
  if(reference.sourceKind!=="lex"||["sourceKind","locale","canonicalId","host","revisionDate"].some(
    key=>reference[key as keyof typeof reference]!==fetched[key as keyof FetchedLegalSource])
    ||sha(fetched.bytes)!==fetched.contentSha256){
    throw Error("PREPARED_SOURCE_CAPTURE_MISMATCH");
  }
  // Both parser profiles and the status observation derive from this capture.
  // A PDF viewer retains its separately fetched representation provenance.
  const normalized=await normalizeLexPublisherDocument(fetched,{...input.options,includeStructured:true});
  const snapshot=normalized.structuredSnapshot??normalized.snapshot;
  const bytes=new TextEncoder().encode(stableSourceSnapshotJson(snapshot));
  if(bytes.byteLength>8_000_000)throw Error("PREPARED_SOURCE_PARENT_TOO_LARGE");
  const hash=sha(bytes),revisionId=`prepared-normalized-${hash}`,key=`corpus/normalized/${revisionId}.json`;
  const fingerprints={normalizedTextSha256:await publisherTextFingerprint(normalized.snapshot),
    ...(normalized.structuredSnapshot?{normalizedTextSha256V2:await publisherTextFingerprint(normalized.structuredSnapshot)}:{})};
  // Historical URLs must never populate the current-source observation cache.
  const observation=reference.revisionDate?null:sourceObservationSchema.parse({version:2,
    officialUrl:fetched.canonicalUrl,observedAt:fetched.fetchedAt,current:normalized.current,
    rawContentSha256:fetched.contentSha256,...fingerprints});
  input.options.signal?.throwIfAborted();
  const existing=await input.bucket.get(key);
  if(existing){
    if(existing.size!==bytes.byteLength)throw Error("PREPARED_SOURCE_PARENT_CONFLICT");
    const retained=await existing.bytes();
    if(retained.byteLength!==bytes.byteLength||sha(retained)!==hash){
      throw Error("PREPARED_SOURCE_PARENT_CONFLICT");
    }
  }else await input.bucket.put(key,bytes);
  // A successful write acknowledgement alone is not durable evidence proof.
  const parent=await createNormalizedSourceReader(input.bucket)(revisionId,hash);
  input.options.signal?.throwIfAborted();
  return {revisionId,parent,store:{...store},observation,
    capture:{officialUrl:fetched.canonicalUrl,rawContentSha256:fetched.contentSha256,fetchedAt:fetched.fetchedAt,
      ...(normalized.representation?{representation:{url:normalized.representation.representationUrl,
        sha256:normalized.representation.contentSha256,fetchedAt:normalized.representation.fetchedAt}}:{})}};
}
