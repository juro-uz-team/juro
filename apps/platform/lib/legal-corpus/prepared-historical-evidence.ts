import {createHash} from "node:crypto";
import {z} from "zod";
import {classifyLegalSourceUrl} from "../legal/source-fetch";
import {createCompleteArticleIndex} from "../legal/article-context";
import {createNormalizedSourceReader} from "./normalized-source-reader";
import {legalLanguageSchema,sha256Schema,utcInstantSchema} from "./target-domain-schemas";
import type {LegalEvidenceBucket} from "./target-evidence";
import {readPreparedPublisherTimeline} from "./prepared-publisher-timeline";

const hash=(value:string|Uint8Array)=>createHash("sha256").update(value).digest("hex");
const normalized=(text:string)=>text.replace(/\s+/gu," ").trim();
// Preserve sub-millisecond boundaries and year zero; Date.parse loses precision.
function compare(left:string,right:string){
  const parts=(value:string)=>{const [whole,fraction=""]=value.slice(0,-1).split(".");
    return [whole!.length===16?whole+":00":whole!,fraction] as const;};
  const [a,af]=parts(left),[b,bf]=parts(right);
  if(a!==b)return a<b?-1:1;
  const length=Math.max(af.length,bf.length);const x=af.padEnd(length,"0"),y=bf.padEnd(length,"0");
  return x===y?0:x<y?-1:1;
}
const interval=z.object({from:utcInstantSchema,to:utcInstantSchema.nullable()}).strict().refine(
  value=>value.to===null||compare(value.from,value.to)<0,"Nonempty half-open interval required");
const officialUrl=z.string().refine(value=>{
  try{return classifyLegalSourceUrl(value).sourceKind==="lex";}catch{return false;}
});
const evidence=z.object({revisionId:z.string().regex(/^prepared-normalized-[a-f0-9]{64}$/u),
  sha256:sha256Schema,officialUrl,quote:z.string().min(10).max(32000)}).strict();
const publisherTimeline=z.object({kind:z.literal("publisher_timeline"),rawSha256:sha256Schema,
  officialUrl,selectedDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  nextDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable()}).strict();
const applicabilityEvidence=evidence.extend({kind:z.enum([
  "commencement_clause","amendment_act","repeal_act","official_timeline"])});
const fact=z.object({sourceRevisionId:z.string().regex(/^prepared-normalized-[a-f0-9]{64}$/u),sourceSha256:sha256Schema,
  officialUrl,languageTag:legalLanguageSchema,completeTextSha256:sha256Schema,
  articleNumber:z.string().min(1).max(100).nullable(),
  editorial:interval,editorialEvidence:z.union([evidence,publisherTimeline]),
  applicability:interval,applicabilityEvidence:z.union([applicabilityEvidence,z.array(applicabilityEvidence).min(1).max(8)]),
}).strict();
const manifest=z.object({format:z.enum(["prepared-historical-evidence-v1","prepared-historical-evidence-v2"]),packageSha256:sha256Schema,
  facts:z.array(fact).min(1).max(10000)}).strict().refine(value=>value.format==="prepared-historical-evidence-v2"
    ||value.facts.every(row=>!("kind" in row.editorialEvidence)&&!Array.isArray(row.applicabilityEvidence)),
  "Publisher timelines and multiple applicability sources require the versioned publication");

/** A pinned, reviewed applicability publication is the authority for intervals.
 * This reader authenticates its retained sources and exact rule scope; matching
 * a quote is not an automated legal interpretation. Admission must qualify the
 * publication's legal assertions before supplying its pin. ONDATE alone is
 * never an applicability assertion. Construct this reader per answer request.
 */
export function createPreparedHistoricalEvidenceReader(input:{manifestBytes:Uint8Array;manifestSha256:string;
  packageSha256:string;bucket:Pick<LegalEvidenceBucket,"get">}){
  if(input.manifestBytes.byteLength>16*1024*1024||hash(input.manifestBytes)!==sha256Schema.parse(input.manifestSha256)){
    throw Error("PREPARED_HISTORY_MANIFEST_MISMATCH");
  }
  const publication=manifest.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(input.manifestBytes)));
  if(publication.packageSha256!==input.packageSha256)throw Error("PREPARED_HISTORY_PACKAGE_MISMATCH");
  const read=createNormalizedSourceReader(input.bucket);
  const contains=(period:z.infer<typeof interval>,instant:string)=>compare(period.from,instant)<=0
    &&(period.to===null||compare(instant,period.to)<0);
  async function authenticate(proof:z.infer<typeof evidence>){
    if(proof.revisionId!==`prepared-normalized-${proof.sha256}`)throw Error("PREPARED_HISTORY_SOURCE_MISMATCH");
    const parent=await read(proof.revisionId,proof.sha256);
    if(parent.snapshot.source.canonicalUrl!==proof.officialUrl)throw Error("PREPARED_HISTORY_SOURCE_MISMATCH");
    const text=normalized(parent.snapshot.blocks.map(block=>block.text).join(" ")),quote=normalized(proof.quote);
    const position=text.indexOf(quote);
    if(!quote||position<0||text.indexOf(quote,position+1)>=0)throw Error("PREPARED_HISTORY_PROOF_UNAVAILABLE");
  }
  return {packageSha256:publication.packageSha256,manifestSha256:input.manifestSha256,
    async readCapture(query:{officialUrl:string;languageTag:z.infer<typeof legalLanguageSchema>;instant:string}){
      const instant=utcInstantSchema.parse(query.instant);
      const discovery=classifyLegalSourceUrl(query.officialUrl);
      // Discovery may name a different publisher edition. The requested instant
      // selects a proved capture of the same instrument and language; resolve()
      // still authenticates the exact complete text and applicability evidence.
      const candidates=publication.facts.filter(row=>{
        const source=classifyLegalSourceUrl(row.officialUrl);
        return discovery.sourceKind==="lex"&&source.canonicalId===discovery.canonicalId
          &&source.locale===discovery.locale&&row.languageTag===query.languageTag
          &&contains(row.editorial,instant)&&contains(row.applicability,instant);
      });
      const revisions=new Map(candidates.map(row=>[JSON.stringify([row.sourceRevisionId,row.sourceSha256,row.officialUrl]),row]));
      if(revisions.size!==1)throw Error(revisions.size?"PREPARED_HISTORY_AMBIGUOUS":"PREPARED_HISTORICAL_APPLICABILITY_REQUIRED");
      const selected=[...revisions.values()][0]!;
      const {sourceRevisionId:revisionId,sourceSha256:sha256}=selected;
      if(revisionId!==`prepared-normalized-${sha256}`)throw Error("PREPARED_HISTORY_SOURCE_MISMATCH");
      const parent=await read(revisionId,sha256);
      if(parent.snapshot.source.canonicalUrl!==selected.officialUrl)throw Error("PREPARED_HISTORY_SOURCE_MISMATCH");
      // Selection only locates retained bytes. resolve() must still prove the
      // exact complete rule and both interval assertions before admission.
      return {revisionId,parent};
    },async resolve(query:{sourceRevisionId:string;sourceSha256:string;officialUrl:string;
    languageTag:z.infer<typeof legalLanguageSchema>;completeText:string;articleNumber:string|null;instant:string}){
    const instant=utcInstantSchema.parse(query.instant);
    const candidates=publication.facts.filter(row=>row.sourceRevisionId===query.sourceRevisionId
      &&row.sourceSha256===query.sourceSha256&&row.officialUrl===query.officialUrl&&row.languageTag===query.languageTag
      &&row.completeTextSha256===hash(query.completeText)&&row.articleNumber===query.articleNumber
      &&contains(row.editorial,instant)&&contains(row.applicability,instant));
    if(candidates.length!==1)throw Error(candidates.length?"PREPARED_HISTORY_AMBIGUOUS":"PREPARED_HISTORICAL_APPLICABILITY_REQUIRED");
    const selected=candidates[0]!;
    if(selected.sourceRevisionId!==`prepared-normalized-${selected.sourceSha256}`)throw Error("PREPARED_HISTORY_SOURCE_MISMATCH");
    const source=await read(selected.sourceRevisionId,selected.sourceSha256);
    const language=({ru:"ru",uz:"uz-Latn",uzc:"uz-Cyrl",en:"en"} as const)[source.snapshot.source.locale];
    if(source.snapshot.source.canonicalUrl!==selected.officialUrl||language!==selected.languageTag){
      throw Error("PREPARED_HISTORY_SOURCE_MISMATCH");
    }
    if(selected.articleNumber!==null){
      const article=createCompleteArticleIndex(source.snapshot.blocks)(selected.articleNumber);
      if(article.occurrences!==1||article.candidates.length!==1||article.candidates[0]!.text!==query.completeText){
        throw Error("PREPARED_HISTORY_RULE_MISMATCH");
      }
    }else if(normalized(source.snapshot.blocks.map(block=>block.text).join(" "))!==normalized(query.completeText)){
      throw Error("PREPARED_HISTORY_RULE_MISMATCH");
    }
    const editorial=selected.editorialEvidence;
    if("kind" in editorial){
      if(editorial.officialUrl!==selected.officialUrl||editorial.rawSha256!==source.snapshot.source.rawContentSha256){
        throw Error("PREPARED_HISTORY_SOURCE_MISMATCH");
      }
      const object=await input.bucket.get(`corpus/publisher/${editorial.rawSha256}.html`);
      if(!object||object.size>16*1024*1024)throw Error("PREPARED_EDITORIAL_SOURCE_UNAVAILABLE");
      const bytes=await object.bytes();
      if(bytes.byteLength!==object.size||hash(bytes)!==editorial.rawSha256)throw Error("PREPARED_HISTORY_SOURCE_MISMATCH");
      const timeline=readPreparedPublisherTimeline(new TextDecoder("utf-8",{fatal:true}).decode(bytes),editorial.officialUrl);
      if(timeline.selectedDate!==editorial.selectedDate||timeline.nextDate!==editorial.nextDate
        ||compare(selected.editorial.from,timeline.from)<0
        ||(timeline.to!==null&&(selected.editorial.to===null||compare(selected.editorial.to,timeline.to)>0))){
        throw Error("PREPARED_EDITORIAL_INTERVAL_MISMATCH");
      }
    }else await authenticate(editorial);
    await Promise.all((Array.isArray(selected.applicabilityEvidence)?selected.applicabilityEvidence:[selected.applicabilityEvidence]).map(authenticate));
    return {manifestSha256:input.manifestSha256,packageSha256:publication.packageSha256,instant,
      fact:structuredClone(selected)};
  }};
}
