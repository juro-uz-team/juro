import type {NormalizedLegalSourceSnapshot} from "./source-parser";
import {isLegalArticleHeading,isLegalAnnexHeading} from "./article-heading";
import {MAX_LEGAL_EVIDENCE_CHARACTERS} from "./legal-evidence-budget";

/** Numbered clauses in unnumbered resolutions are not statutory articles.
 * Retain the instrument introduction and current section introduction with
 * every complete clause, including all its subordinate paragraphs. */
export function documentSections(snapshot:NormalizedLegalSourceSnapshot):{heading:string;text:string;complete:boolean}[] {
  const blocks=snapshot.blocks;
  if(blocks.some(block=>isLegalArticleHeading(block)||block.semanticRole==="article"))return [];
  // An amendment schedule names the affected decision at each top-level
  // clause. Its quoted replacement provisions can have arbitrary numbering.
  const decisionClause=/^\d+\.\s*«?.+»ги\s+(?:қарори\s+)?\d{4}\s+йил\s+\d{1,2}\s+\p{L}+даги\s+\d+\p{L}*-сонли\s+қарори?:$/u;
  const firstNumbered=blocks.find(block=>/^\d+\.\s/u.test(block.text));
  const amendingDecisions=!!firstNumbered&&decisionClause.test(firstNumbered.text);
  const boundaries:{index:number;structural:boolean;level:number}[]=[];
  let expected=1,quoted=0,ambiguousTail=false;
  for(const [index,block] of blocks.entries()){
    if(!quoted){
      const semantic=block.semanticRole==="section"||block.semanticRole==="chapter";
      if(semantic&&block.headingLevel===undefined){ambiguousTail=true;break;}
      const annex=isLegalAnnexHeading(block),roman=/^[IVXLCDM]+\.\s/u.test(block.text);
      const structural=semantic||annex||roman;
      const level=block.headingLevel??(annex?1:2);
      const number=block.kind==="paragraph"&&(!amendingDecisions||decisionClause.test(block.text))
        ?block.text.match(/^(\d+)\.\s/u)?.[1]:undefined;
      if(structural){boundaries.push({index,structural:true,level});expected=1;}
      else if(number!==undefined){
        // A reset without a section marker may be a subordinate list. Its
        // depth was lost by normalization, so no clause can be certified.
        if(Number(number)!==expected){ambiguousTail=true;break;}
        boundaries.push({index,structural:false,level:7});expected++;
      }
    }
    for(const character of block.text){if(character==="«"||character==="“")quoted++;
      else if(character==="»"||character==="”")quoted=Math.max(0,quoted-1);}
  }
  if(quoted)ambiguousTail=true;
  const first=boundaries[0];if(!first)return [];
  const introduction=blocks.slice(0,first.index).map(block=>block.text);
  const result:{heading:string;text:string;complete:boolean}[]=[];
  const ancestors:{level:number;text:string[]}[]=[];
  for(const [position,boundary] of boundaries.entries()){
    const end=boundaries[position+1]?.index??blocks.length;
    const body=blocks.slice(boundary.index,end).map(block=>block.text);
    if(boundary.structural){
      while(ancestors.length&&ancestors.at(-1)!.level>=boundary.level)ancestors.pop();
      ancestors.push({level:boundary.level,text:body});
      const next=boundaries[position+1];
      if(next&&(!next.structural||next.level>boundary.level))continue;
    }
    const text=[...introduction,...ancestors.flatMap(ancestor=>ancestor.text),...(boundary.structural?[]:body)]
      .join(" ").replace(/\s+/gu," ").trim();
    result.push({heading:blocks[boundary.index]!.text.slice(0,240),text,
      complete:!(ambiguousTail&&position===boundaries.length-1)
        &&text.length<=MAX_LEGAL_EVIDENCE_CHARACTERS&&!/:\s*$/u.test(text)});
  }
  return result;
}

export function completeDocumentSections(snapshot:NormalizedLegalSourceSnapshot):{heading:string;text:string}[] {
  return documentSections(snapshot).filter(section=>section.complete).map(({heading,text})=>({heading,text}));
}
