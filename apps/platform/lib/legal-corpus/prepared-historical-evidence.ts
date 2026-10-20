import {createHash} from "node:crypto";
import {z} from "zod";
import {classifyLegalSourceUrl} from "../legal/source-fetch";
import {createCompleteArticleIndex} from "../legal/article-context";
import {createNormalizedSourceReader} from "./normalized-source-reader";
import {legalLanguageSchema,sha256Schema,utcInstantSchema} from "./target-domain-schemas";
import type {LegalEvidenceBucket} from "./target-evidence";

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
const fact=z.object({sourceRevisionId:z.string().regex(/^prepared-normalized-[a-f0-9]{64}$/u),sourceSha256:sha256Schema,
  officialUrl,languageTag:legalLanguageSchema,completeTextSha256:sha256Schema,
  articleNumber:z.string().min(1).max(100).nullable(),
  editorial:interval,editorialEvidence:evidence,
  applicability:interval,applicabilityEvidence:evidence.extend({kind:z.enum([
    "commencement_clause","amendment_act","repeal_act","official_timeline"])}),
}).strict();
const manifest=z.object({format:z.literal("prepared-historical-evidence-v1"),packageSha256:sha256Schema,
  facts:z.array(fact).min(1).max(10000)}).strict();

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
      const candidates=publication.facts.filter(row=>row.officialUrl===query.officialUrl&&row.languageTag===query.languageTag
        &&contains(row.editorial,instant)&&contains(row.applicability,instant));
      const revisions=new Map(candidates.map(row=>[row.sourceRevisionId,row.sourceSha256]));
      if(revisions.size!==1)throw Error(revisions.size?"PREPARED_HISTORY_AMBIGUOUS":"PREPARED_HISTORICAL_APPLICABILITY_REQUIRED");
      const [revisionId,sha256]=[...revisions][0]!;
      if(revisionId!==`prepared-normalized-${sha256}`)throw Error("PREPARED_HISTORY_SOURCE_MISMATCH");
      const parent=await read(revisionId,sha256);
      if(parent.snapshot.source.canonicalUrl!==query.officialUrl)throw Error("PREPARED_HISTORY_SOURCE_MISMATCH");
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
    await Promise.all([authenticate(selected.editorialEvidence),authenticate(selected.applicabilityEvidence)]);
    return {manifestSha256:input.manifestSha256,packageSha256:publication.packageSha256,instant,
      fact:structuredClone(selected)};
  }};
}
