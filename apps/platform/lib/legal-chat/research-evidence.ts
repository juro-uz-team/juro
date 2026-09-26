import type {LegalEvidence} from "./answer-engine";
import {timeIdentity} from "./evidence-boundary";
import {detectArticleNumbers} from "../legal/legal-language";
import {sameInstrumentArticleReferences} from "../legal/referenced-article-context";

/** Selection removes irrelevant whole provisions, never text within a provision.
 * Explicit references keep their available same-revision dependencies transitively. */
export function selectResearchEvidence(candidates:readonly LegalEvidence[],sourceIds:readonly string[],
  available:readonly LegalEvidence[]=candidates):LegalEvidence[] {
  const selected=new Set(sourceIds);
  if(selected.size!==sourceIds.length||sourceIds.some(id=>!candidates.some(item=>item.source.id===id))) {
    throw new Error("RESEARCH_SELECTION_EVIDENCE_INVALID");
  }
  const instrument=(item:LegalEvidence)=>{
    const url=new URL(item.source.officialUrl);url.hash="";
    return JSON.stringify([url.href,item.source.locale,item.source.contentSha256,
      item.source.revisionDate,timeIdentity(item.endpoint)]);
  };
  for(let changed=true;changed;) {
    changed=false;
    for(const item of available) {
      if(!selected.has(item.source.id))continue;
      const references=new Set(sameInstrumentArticleReferences(item.text));
      for(const other of available) {
        const article=other.source.article;
        const number=article?(detectArticleNumbers(article)[0]??article):"";
        if(!selected.has(other.source.id)&&instrument(other)===instrument(item)&&references.has(number)) {
          selected.add(other.source.id);changed=true;
        }
      }
    }
  }
  return available.filter(item=>selected.has(item.source.id));
}
