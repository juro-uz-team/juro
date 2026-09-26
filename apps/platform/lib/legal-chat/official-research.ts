import {retrieveDirectLegalSources,fetchDirectOfficialLexDocument} from "../legal/direct-retrieval";
import {detectArticleNumbers} from "../legal/legal-language";
import {fitsLegalEvidenceBudget} from "../legal/legal-evidence-budget";
import type {QuestionInterpretation} from "../legal-corpus/legal-candidate-index";
import {privateResearchQueries} from "./research-query";
import type {ResearchPacket,ResearchRequest,ResearchNeed,ResearchObservation} from "./research";
import type {LegalEvidence} from "./answer-engine";
import type {LegalSourceLocale} from "../legal/source-fetch";
import {MAX_OFFICIAL_RESEARCH_QUERY_CHARACTERS} from "./research-formulation";

const MAX_OFFICIAL_ARTICLES=12;
const OFFICIAL_READ_TIMEOUT_MS=10_000;
const digest=async(text:string)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)))]
  .map(byte=>byte.toString(16).padStart(2,"0")).join("");

/** Live discovery contributes no snippet as legal evidence. Each discovered
 * article is independently reopened in complete-article mode before admission.
 * Historical applicability remains the indexed history reader's responsibility. */
export function createOfficialResearch(input:{
  formulate:(request:ResearchRequest)=>Promise<QuestionInterpretation>;
  retrieve?:typeof retrieveDirectLegalSources;
  fetchArticle?:typeof fetchDirectOfficialLexDocument;
}):(request:ResearchRequest)=>Promise<ResearchPacket> {
  const retrieve=input.retrieve??retrieveDirectLegalSources;
  const fetchArticle=input.fetchArticle??fetchDirectOfficialLexDocument;
  const saved=new Map<string,LegalEvidence>();
  const failed=new Map<string,ResearchNeed[]>();
  const titles=new Set<string>();
  let owner:string|undefined;
  return async request=>{
    const signal=request.question.signal;
    const check=()=>signal?.throwIfAborted();
    check();
    const identity=JSON.stringify([request.question.question,request.question.temporalScope,
      request.question.priorTurns??[],request.question.caseFacts??[]]);
    if(owner!==undefined&&owner!==identity)throw new Error("OFFICIAL_RESEARCH_REQUEST_MISMATCH");
    owner=identity;
    const scope=request.question.temporalScope;
    const times=scope.kind==="comparison"?[scope.left,scope.right]:[scope];
    const observations:ResearchObservation[]=times.some(time=>time.kind==="timestamp")
      ?[{kind:"historical_live_unavailable",lane:"official",omitted:times.filter(time=>time.kind==="timestamp").length}]:[];
    if(!times.some(time=>time.kind==="current"))return {evidence:[],needs:[],observations};
    const plan=await privateResearchQueries(await input.formulate(request),[...titles]);
    check();
    const needs:ResearchNeed[]=[];
    const resolved:NonNullable<ResearchPacket["resolved"]>[number][]=[];
    const evidence=new Map<string,LegalEvidence>();
    const candidates=new Map<string,{url:string;article:string;title:string;locale:LegalSourceLocale}>();
    for(const formulation of plan.formulations) {
      check();
      // The official site's retained search interface accepts 100 characters.
      // Never silently search an arbitrary prefix of a longer formulation.
      if(formulation.text.length>MAX_OFFICIAL_RESEARCH_QUERY_CHARACTERS) {
        observations.push({kind:"search_query_limit",lane:"official",omitted:1});
        continue;
      }
      const locale=request.question.locale==="uz"?"uz":"ru";
      try {
        const found=await retrieve(formulation.text,locale,{searchQueries:[formulation.text],signal,
          budgetMs:OFFICIAL_READ_TIMEOUT_MS,limit:3});
        check();
        if(found.errors.length)needs.push({reason:"source_unavailable",detail:"An official live source search or fetch was unavailable."});
        for(const source of found.sources) {
          if(source.sourceType!=="lex"||source.verificationState!=="direct_validated")continue;
          titles.add(source.actTitle);
          if(source.locale!=="ru"&&source.locale!=="uz"&&source.locale!=="uzc"&&source.locale!=="en")continue;
          for(const article of new Set((source.spans??[]).flatMap(span=>detectArticleNumbers(span.article??"")))) {
            candidates.set(JSON.stringify([source.officialUrl,article]),{url:source.officialUrl,article,title:source.actTitle,locale:source.locale});
          }
        }
      } catch {
        check();
        needs.push({reason:"source_unavailable",detail:"An official live source search or fetch was unavailable."});
      }
    }
    let reads=0,excluded=0;
    for(const [key,candidate] of candidates) {
      check();
      if(!saved.has(key)&&reads>=MAX_OFFICIAL_ARTICLES) {excluded++;continue;}
      try {
        let item=saved.get(key);
        if(!item) {
          reads++;
          const result=await fetchArticle(candidate.url,candidate.locale,{query:`Article ${candidate.article}`,
            completeArticle:true,signal,budgetMs:OFFICIAL_READ_TIMEOUT_MS});
          check();
          const source=result.source;
          if(source.officialUrl!==candidate.url||source.locale!==candidate.locale
            ||result.evidence.sourceId!==source.id||result.evidence.contentSha256!==source.contentSha256
            ||result.evidence.canonicalUrl!==source.officialUrl||result.evidence.validationStatus!=="validated"
            ||source.verificationState!=="direct_validated"||source.applicabilityStatus!=="current"
            ||!source.spans?.length||source.spans.some(span=>!detectArticleNumbers(span.article??"").includes(candidate.article))) {
            throw new Error("OFFICIAL_ARTICLE_IDENTITY_INVALID");
          }
          const text=source.spans.map(span=>span.text).join(" ");
          const textSha256=await digest(text);
          const id=`live-${await digest(JSON.stringify([source.officialUrl,source.locale,candidate.article,source.contentSha256,textSha256]))}`;
          item={source:{...source,id,status:"current",sourceClass:"OFFICIAL_LEGISLATION",article:candidate.article},
            text,textSha256,endpoint:{kind:"current"},origin:"live"};
          saved.set(key,item);
        }
        if(!evidence.has(item.source.id)&&!fitsLegalEvidenceBudget([...evidence.values()].map(value=>value.text).concat(item.text))) {
          observations.push({kind:"candidate_context_limit",lane:"official",omitted:1});continue;
        }
        evidence.set(item.source.id,item);
        for(const need of failed.get(key)??[])resolved.push({need,sourceIds:[item.source.id]});
      } catch(error) {
        check();
        const code=error instanceof Error?error.message:"";
        const need:ResearchNeed={reason:code==="LEGAL_SOURCE_PROVISION_INCOMPLETE"?"missing_rule":
          code==="OFFICIAL_ARTICLE_IDENTITY_INVALID"||code==="LEGAL_SOURCE_DOCUMENT_REPEALED"?"ambiguous_revision":"source_unavailable",
          detail:`${candidate.title.slice(0,400)} — article ${candidate.article} (lookup ${await digest(key)}): `+
            (code==="LEGAL_SOURCE_PROVISION_INCOMPLETE"?"The complete article could not be recovered.":
              code==="OFFICIAL_ARTICLE_IDENTITY_INVALID"||code==="LEGAL_SOURCE_DOCUMENT_REPEALED"?"The requested official source identity or current revision could not be established.":
                "The official article reader was unavailable.")};
        failed.set(key,[...new Map([...(failed.get(key)??[]),need].map(value=>[JSON.stringify(value),value])).values()]);needs.push(need);
      }
    }
    if(excluded)observations.push({kind:"candidate_read_limit",lane:"official",omitted:excluded});
    return {evidence:[...evidence.values()],needs:[...new Map(needs.map(need=>[JSON.stringify(need),need])).values()],resolved,observations};
  };
}
