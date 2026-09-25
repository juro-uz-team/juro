import type {NormalizedLegalSourceSnapshot} from "./source-parser";
import {isLegalArticleHeading,isLegalAnnexHeading} from "./article-heading";
import {MAX_LEGAL_EVIDENCE_CHARACTERS} from "./legal-evidence-budget";
import {completeTableSectionTexts} from "./table-sections";

const boundedComplete=(text:string)=>text.length<=MAX_LEGAL_EVIDENCE_CHARACTERS&&!/:\s*$/u.test(text);

/** Numbered clauses in unnumbered resolutions are not statutory articles.
 * Retain the instrument introduction and current section introduction with
 * every complete clause, including all its subordinate paragraphs. */
export function documentSections(snapshot:NormalizedLegalSourceSnapshot):{heading:string;text:string;complete:boolean}[] {
  const blocks=snapshot.blocks;
  if(blocks.some(block=>isLegalArticleHeading(block)||block.semanticRole==="article"))return [];
  // Whole annexes are stronger boundaries than inferred clause numbering.
  // Match the same adoption reference: quoted annexes of an amended, older
  // decision must remain inside the amending annex, not become sibling scopes.
  const firstAnnex=blocks.findIndex(block=>isLegalAnnexHeading(block)&&block.text.includes("\n"));
  if(firstAnnex>0){
    const adoption=blocks[firstAnnex]!.text.split("\n")[0];
    const starts=[0,...blocks.flatMap((block,index)=>isLegalAnnexHeading(block)
      &&block.text.split("\n")[0]===adoption?[index]:[])];
    const firstRule=blocks.findIndex(block=>/^(?:\d+|[IVXLCDM]+)\.\s/u.test(block.text));
    const introduction=blocks.slice(0,firstRule>0?firstRule:firstAnnex).map(block=>block.text);
    return starts.flatMap((start,index)=>{
      const part=blocks.slice(start,starts[index+1]),prefix=start?introduction:[];
      const text=[...prefix,...part.map(block=>block.text)].join(" ").replace(/\s+/gu," ").trim();
      if(text.length<=MAX_LEGAL_EVIDENCE_CHARACTERS)return [{heading:part[0]!.text.slice(0,240),text,complete:boundedComplete(text)}];
      const tableSections=completeTableSectionTexts(part,prefix);
      if(tableSections)return tableSections.map(text=>({heading:part[0]!.text.slice(0,240),text,complete:boundedComplete(text)}));
      const chapters=part.flatMap((block,index)=>block.semanticRole==="chapter"
        ||/^\d+\s*[-–]\s*(?:боб|bob)\.\s+\S/iu.test(block.text)?[index]:[]);
      if(chapters.length&&!part.slice(chapters[0]).some(block=>block.semanticRole==="section")){
        const context=[...prefix,...part.slice(0,chapters[0]).map(block=>block.text)];
        return chapters.map((chapter,index)=>{
          const text=[...context,...part.slice(chapter,chapters[index+1]).map(block=>block.text)].join(" ").replace(/\s+/gu," ").trim();
          return {heading:part[chapter]!.text.slice(0,240),text,complete:boundedComplete(text)};
        });
      }
      return [{heading:part[0]!.text.slice(0,240),text,complete:false}];
    });
  }
  // An amendment schedule names the affected decision at each top-level
  // clause. Its quoted replacement provisions can have arbitrary numbering.
  const decisionClause=/^\d+\.\s*«?.+»ги\s+(?:қарори\s+)?\d{4}\s+йил\s+\d{1,2}\s+\p{L}+даги\s+\d+\p{L}*-сонли\s+қарори?:$/u;
  const firstNumbered=blocks.find(block=>/^\d+\.\s/u.test(block.text));
  const amendingDecisions=!!firstNumbered&&decisionClause.test(firstNumbered.text);
  const boundaries:{index:number;structural:boolean;level:number}[]=[];
  let expected=1,quoted=0,ambiguousTail=false,afterStructure=false;
  for(const [index,block] of blocks.entries()){
    if(!quoted){
      const semantic=block.semanticRole==="section"||block.semanticRole==="chapter";
      if(semantic&&block.headingLevel===undefined){ambiguousTail=true;break;}
      const annex=isLegalAnnexHeading(block),roman=/^[IVXLCDM]+\.\s/u.test(block.text);
      const structural=semantic||annex||roman;
      const level=block.headingLevel??(annex?1:2);
      const number=block.kind==="paragraph"&&(!amendingDecisions||decisionClause.test(block.text))
        ?block.text.match(/^(\d+)\.\s/u)?.[1]:undefined;
      if(structural){boundaries.push({index,structural:true,level});if(annex)expected=1;afterStructure=true;}
      else if(number!==undefined){
        // A reset without a section marker may be a subordinate list. Its
        // depth was lost by normalization, so no clause can be certified.
        if(Number(number)!==expected&&!(afterStructure&&Number(number)===1)){ambiguousTail=true;break;}
        boundaries.push({index,structural:false,level:7});expected=Number(number)+1;afterStructure=false;
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
