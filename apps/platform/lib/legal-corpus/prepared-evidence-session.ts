import {classifyLegalSourceUrl,type FetchedLegalSource} from "../legal/source-fetch";
import {capturePreparedSource} from "./prepared-source-capture";
import {resolvePreparedSourceEvidence,resolvePreparedSourceReferences} from "./prepared-source-evidence";
import {preparedCandidateConfigurationSchema,type PreparedCandidateConfiguration} from "./prepared-candidate-configuration";
import type {createPreparedDiscoveryCatalog} from "./prepared-discovery-catalog";
import {createPinnedSourceVerifier} from "./pinned-source-observation";
import type {ResolvedOfficialEvidence} from "./target-evidence";

type Packet=Awaited<ReturnType<ReturnType<typeof createPreparedDiscoveryCatalog>["read"]>>;
type CaptureInput=Parameters<typeof capturePreparedSource>[0];
type Capture=Awaited<ReturnType<typeof capturePreparedSource>>;

function sourceLanguage(language:string,script:string){
  if(language==="ru"&&script==="Cyrl")return {locale:"ru",tag:"ru"} as const;
  if(language==="en"&&script==="Latn")return {locale:"en",tag:"en"} as const;
  if(["uz","uz-Latn"].includes(language)&&script==="Latn")return {locale:"uz",tag:"uz-Latn"} as const;
  if(["uz","uzc","uz-Cyrl"].includes(language)&&script==="Cyrl")return {locale:"uzc",tag:"uz-Cyrl"} as const;
  throw Error("PREPARED_DISCOVERY_LANGUAGE_UNSUPPORTED");
}

/** One answer request owns capture reuse. Discovery provenance remains separate
 * from the captured revision and complete evidence. Currentness is still checked
 * by the answer's existing finalization/verifier path. */
export function createPreparedEvidenceSession(input:{configuration:PreparedCandidateConfiguration;
  fetch:(url:string)=>Promise<FetchedLegalSource>;bucket:CaptureInput["bucket"];store:CaptureInput["store"];
  options:CaptureInput["options"];captureLimit?:number}){
  const configuration=preparedCandidateConfigurationSchema.parse(input.configuration);
  const limit=input.captureLimit??16;
  if(!Number.isSafeInteger(limit)||limit<1||limit>32)throw Error("PREPARED_CAPTURE_LIMIT_INVALID");
  const captures=new Map<string,Promise<Capture>>();let attempts=0;
  const verify=createPinnedSourceVerifier({bucket:input.bucket,observe:async url=>{
    const captured=await captures.get(url);
    if(!captured?.observation)throw Error("PREPARED_CURRENT_OBSERVATION_UNAVAILABLE");
    return captured.observation;
  }});
  return {async verifyCurrentSource(evidence:ResolvedOfficialEvidence){
    input.options.signal?.throwIfAborted();
    if(evidence.evidence.store?.namespace!==input.store.namespace
      ||evidence.evidence.store?.generationSha256!==input.store.generationSha256){
      throw Error("PREPARED_EVIDENCE_GENERATION_MISMATCH");
    }
    const result=await verify(evidence);input.options.signal?.throwIfAborted();return result;
  },references(evidence:{capture:Capture;source:Awaited<ReturnType<typeof resolvePreparedSourceEvidence>>},
    remaining:number,articles?:readonly string[]){
    return resolvePreparedSourceReferences({...evidence,bucket:input.bucket,limit:remaining,articles});
  },async resolve(packet:Packet,reference:[number,number]){
    input.options.signal?.throwIfAborted();const pins=configuration.artifacts;
    if(packet.package_sha256!==pins.packageSha256||packet.membership_sha256!==pins.membershipSha256
      ||packet.work_index_sha256!==pins.workIndexSha256||packet.vector_completion_sha256!==pins.vectorCompletionSha256){
      throw Error("PREPARED_EVIDENCE_GENERATION_MISMATCH");
    }
    const records=packet.records.filter(row=>row.vector_ordinal===reference[0]&&row.membership_ordinal===reference[1]);
    if(records.length!==1)throw Error("PREPARED_EVIDENCE_REFERENCE_MISSING");
    const record=records[0]!;const source=packet.sources[record.work];
    if(!source||typeof source.inventory.url!=="string")throw Error("PREPARED_EVIDENCE_SOURCE_MISSING");
    const original=classifyLegalSourceUrl(source.inventory.url);
    if(original.sourceKind!=="lex")throw Error("PREPARED_EVIDENCE_OFFICIAL_SOURCE_REQUIRED");
    if(original.revisionDate)throw Error("PREPARED_HISTORICAL_APPLICABILITY_REQUIRED");
    const language=sourceLanguage(record.chunk.language,record.chunk.script);
    // Selecting a publisher language route is not an assertion of equivalence:
    // the discovered span must occur uniquely in the captured official text.
    const url=classifyLegalSourceUrl(`https://lex.uz/${language.locale}/docs/${original.canonicalId}`).canonicalUrl;
    let pending=captures.get(url);
    if(!pending){
      if(attempts>=limit)throw Error("PREPARED_CAPTURE_BUDGET_EXHAUSTED");
      attempts++;
      pending=(async()=>{
        const fetched=await input.fetch(url);
        if(fetched.canonicalUrl!==url)throw Error("PREPARED_CAPTURE_REQUEST_MISMATCH");
        return capturePreparedSource({fetched,bucket:input.bucket,store:input.store,options:input.options});
      })();
      captures.set(url,pending);
      void pending.catch(()=>{if(captures.get(url)===pending)captures.delete(url);});
    }
    const capture=await pending;input.options.signal?.throwIfAborted();
    const sourceEvidence=await resolvePreparedSourceEvidence({capture,bucket:input.bucket,
      discovery:{officialUrl:url,text:record.chunk.officialText,textSha256:record.chunk.officialTextSha256,languageTag:language.tag}});
    return {capture,source:sourceEvidence,
      discovery:{packageSha256:packet.package_sha256,vectorOrdinal:reference[0],membershipOrdinal:reference[1],
        canonicalChunkId:record.chunk.id,work:record.work,unit:record.unit,originalUrl:original.canonicalUrl,originalInputHash:record.original_input_hash,
        publisherMetadata:source.prepared},
      // The caller supplies its remaining reserved-reference budget explicitly.
      references:(remaining:number,articles?:readonly string[])=>resolvePreparedSourceReferences({capture,source:sourceEvidence,bucket:input.bucket,limit:remaining,articles}),
    };
  }};
}
