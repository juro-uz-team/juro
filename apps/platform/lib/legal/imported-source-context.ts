import type {NormalizedLegalSourceSnapshot} from "./source-parser";
import {createCompleteArticleIndex} from "./article-context";
import {isLegalArticleHeading,isLegalAnnexHeading} from "./article-heading";
import {detectArticleNumbers} from "./legal-language";
import {documentSections} from "./document-sections";
import {MAX_LEGAL_EVIDENCE_CHARACTERS} from "./legal-evidence-budget";

const normalize=(text:string)=>text.replace(/\s+/gu," ").trim();
export const isImportedChapterHeading=(text:string)=>/^\d+\s*[-–]\s*(?:боб|bob)\.\s+\S/iu.test(text);

/** Compatibility scopes for immutable imports whose provision boundaries
 * included a chapter title or the adoption line of the following annex.
 * Every candidate contains complete source scopes, never an arbitrary window. */
export function importedSourceContexts(snapshot:NormalizedLegalSourceSnapshot) {
  const blocks=snapshot.blocks,contexts:{text:string;headingOnly?:string}[]=[];
  const chapters=blocks.flatMap((block,index)=>isImportedChapterHeading(block.text)?[index]:[]);
  for(const [position,start] of chapters.entries()){
    const part=blocks.slice(start,chapters[position+1]);
    if(part.some(isLegalAnnexHeading))continue;
    const headings=part.filter(isLegalArticleHeading),index=createCompleteArticleIndex(part);
    if(!headings.length||headings.some(heading=>{
      const article=detectArticleNumbers(heading.text)[0];if(!article)return true;
      const result=index(article);return result.candidates.length!==result.occurrences||result.occurrences===0;
    }))continue;
    const text=normalize([...blocks.slice(0,chapters[0]),...part].map(block=>block.text).join(" "));
    if(text.length<=MAX_LEGAL_EVIDENCE_CHARACTERS&&!/:\s*$/u.test(text))contexts.push({text,headingOnly:normalize(blocks[start]!.text)});
  }
  for(const section of documentSections(snapshot)){
    if(!section.complete||section.containsArticles)continue;
    const starts=blocks.flatMap((block,index)=>block.text.slice(0,240)===section.heading&&isLegalAnnexHeading(block)?[index]:[]);
    if(starts.length!==1)continue;
    const start=starts[0]!,adoption=blocks[start]!.text.split("\n");if(adoption.length!==2)continue;
    const next=blocks.findIndex((block,index)=>index>start&&isLegalAnnexHeading(block)&&block.text.split("\n")[0]===adoption[0]);
    if(next<0)continue;
    const body=normalize(blocks.slice(start,next).map(block=>block.text).join(" "));
    if(!section.text.endsWith(body))continue;
    const text=section.text+" "+adoption[0];
    if(text.length<=MAX_LEGAL_EVIDENCE_CHARACTERS)contexts.push({text});
  }
  return contexts;
}
