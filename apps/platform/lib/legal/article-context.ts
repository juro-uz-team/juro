import { detectArticleNumbers } from "./legal-language";
import { MAX_LEGAL_EVIDENCE_CHARACTERS } from "./legal-evidence-budget";
import type { NormalizedLegalSourceSnapshot } from "./source-parser";
import {isLegalArticleHeading,hasInlineArticleBody,isLegalAnnexHeading,unquotedArticleHeadings} from "./article-heading";

const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();

/** Some official decisions have no numbered articles. Keep their full source
 * distinct from article extraction; a failed article lookup is not permission
 * to replace a numbered instrument with arbitrary surrounding text. */
export function completeUnnumberedDocumentText(snapshot: NormalizedLegalSourceSnapshot): string | null {
  if (snapshot.blocks.some(block => block.semanticRole === "article" || isLegalArticleHeading(block))) return null;
  return completeDocumentText(snapshot);
}

/** A title or preamble identifies the instrument, not one numbered provision.
 * Preserve the entire bounded instrument; never infer an article from it or
 * use this path for fragments within the numbered operative text. */
export function completeInstrumentIntroductionContext(snapshot:NormalizedLegalSourceSnapshot,fragment:string):string|null {
  const text=completeDocumentText(snapshot);
  const normalized=normalize(fragment);
  if(!text||!normalized)return null;
  const first=text.indexOf(normalized);
  if(first<0||text.indexOf(normalized,first+1)>=0)return null;
  const boundary=snapshot.blocks.findIndex(block=>block.semanticRole==="article"||isLegalArticleHeading(block));
  if(boundary<1||unquotedArticleHeadings(snapshot.blocks).ambiguousFrom!==null)return null;
  const introduction=normalize(snapshot.blocks.slice(0,boundary).map(block=>block.text).join(" "));
  return introduction.includes(normalized)?text:null;
}

/** Whole-instrument evidence retains every block and makes no article claim. */
export function completeDocumentText(snapshot: NormalizedLegalSourceSnapshot, maximumCharacters=MAX_LEGAL_EVIDENCE_CHARACTERS): string | null {
  if (snapshot.blocks.length < 2) return null;
  const text = normalize(snapshot.blocks.map(block => block.text).join(" "));
  return !text || text.length > maximumCharacters || /:\s*$/u.test(text) ? null : text;
}

/** Imported publication footers can carry spurious article numbers. Accept only
 * complete, recognizable publication metadata, never a normative fragment. */
export function isPublicationMetadataText(text: string): boolean {
  const value = normalize(text);
  const russian = /^(?:[1-9]|[12]\d|3[01]) (?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря) \d{4} г\.,? № [\p{L}\d-]+\.?$/u;
  const month = "(?:yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|sentyabr|oktabr|oktyabr|noyabr|dekabr)";
  const date = `\\d{4}-yil (?:[1-9]|[12]\\d|3[01])-${month}da`;
  return russian.test(value) || new RegExp(`^${date} qabul qilingan Senat tomonidan ${date} ma[ʼ‘’ʻ']qullangan\\.?$`, "u").test(value);
}

/** Extract an unambiguous article without mistaking numbered list items for
 * article boundaries. The caller authenticates the snapshot and its identity. */
export function completeArticleText(
  blocks: NormalizedLegalSourceSnapshot["blocks"],
  article: string,
  originalText?: string,
): { heading: string; text: string } | null {
  return createCompleteArticleReader(blocks)(article, originalText);
}

/** Capture one authenticated parent's article boundaries once. The returned
 * reader owns its text references; later caller mutation cannot stale the index. */
export function createCompleteArticleReader(blocks: NormalizedLegalSourceSnapshot["blocks"]) {
  const index = createCompleteArticleIndex(blocks);
  return (article: string, originalText?: string): {heading: string; text: string} | null => {
    const {candidates, occurrences} = index(article);
    if (occurrences !== 1 || candidates.length !== 1) return null;
    const context = candidates[0]!;
    if (originalText && (!context.text.startsWith(normalize(originalText))
      || context.text.length <= normalize(originalText).length)) return null;
    return context;
  };
}

/** An enacting law and its annex can reuse article numbers. Keep every complete
 * occurrence; callers must resolve one using authenticated text, never order. */
const immutableArticleIndexes=new WeakMap<NormalizedLegalSourceSnapshot["blocks"],ReturnType<typeof buildCompleteArticleIndex>>();
export function createCompleteArticleIndex(blocks: NormalizedLegalSourceSnapshot["blocks"]) {
  const previous=immutableArticleIndexes.get(blocks);
  if(previous)return previous;
  const index=buildCompleteArticleIndex(blocks);
  // Only immutable normalized parents can share derived boundaries. Mutable
  // callers retain the existing capture semantics on every new invocation.
  // Weak ownership releases the index with its parent; no source bytes or
  // currentness decisions are retained here. Every lookup returns fresh values.
  if(Object.isFrozen(blocks)&&blocks.every(Object.isFrozen)){
    Object.freeze(index);immutableArticleIndexes.set(blocks,index);
  }
  return index;
}

function buildCompleteArticleIndex(blocks: NormalizedLegalSourceSnapshot["blocks"]) {
  const captured = blocks.map(block => ({text: block.text, kind:block.kind, semanticRole: block.semanticRole}));
  const headings=unquotedArticleHeadings(captured);
  const ancestry=new Map<number,string[]>();
  let annex:string|undefined,section:string|undefined,chapter:string|undefined,subsection:string|undefined;
  for(const [position,block] of captured.entries()){
    if(!headings.unquotedBlocks.has(block))continue;
    if(isLegalAnnexHeading(block)){annex=block.text.slice(0,240);section=undefined;chapter=undefined;subsection=undefined;}
    else if(block.semanticRole==="section"){section=block.text.slice(0,240);chapter=undefined;subsection=undefined;}
    else if(block.semanticRole==="chapter"){chapter=block.text.slice(0,240);subsection=undefined;}
    else if(block.semanticRole==="subsection")subsection=block.text.slice(0,240);
    if(headings.has(block))ancestry.set(position,[annex,section,chapter,subsection].filter((value):value is string=>value!==undefined));
  }
  const ranges = new Map<string, {start: number; end: number}[]>();
  let nextBoundary = captured.length;
  for (let index = captured.length - 1; index >= 0; index--) {
    const block = captured[index]!;
    if (headings.has(block)) {
      const article = detectArticleNumbers(block.text)[0];
      if (article !== undefined) {
        const occurrences = ranges.get(article) ?? [];
        occurrences.unshift({start: index, end: nextBoundary});
        ranges.set(article, occurrences);
      }
      nextBoundary = index;
    } else if (block.semanticRole === "chapter" || block.semanticRole === "section" || isLegalAnnexHeading(block)
      ||block.semanticRole==="subsection"&&headings.unquotedBlocks.has(block)) nextBoundary = index;
  }
  // Locate discovery spans once in the captured parent's normalized text.
  // Looking up a paragraph must not materialize every article in a large code.
  const starts:number[]=[],ends:number[]=[],parts:string[]=[];
  let length=0;
  for(const block of captured){
    const text=normalize(block.text);
    if(text&&length)length++;
    starts.push(length);
    if(text){parts.push(text);length+=text.length;}
    ends.push(length);
  }
  const source=parts.join(" ");
  const read = (article: string) => {
    const occurrences = ranges.get(article) ?? [];
    const candidates = occurrences.flatMap(({start, end}) => {
      if(headings.ambiguousFrom!==null&&end>headings.ambiguousFrom)return [];
      if (end - start < 2 && !hasInlineArticleBody(captured[start]!)) return [];
      const text = normalize(captured.slice(start, end).map(block => block.text).join(" "));
      if (text.length > MAX_LEGAL_EVIDENCE_CHARACTERS || /:\s*$/u.test(text)) return [];
      return [{heading: captured[start]!.text.slice(0, 240), text}];
    });
    return {occurrences: occurrences.length, candidates};
  };
  return Object.assign(read, {
    /** Publisher order and enclosing scopes for discovery, never extra rule text. */
    outline() {
      return [...ranges].flatMap(([article,occurrences])=>{
        const result=read(article);
        return result.candidates.length===result.occurrences
          ?result.candidates.map((candidate,index)=>({start:occurrences[index]!.start,
            ...candidate,article,hierarchy:[...(ancestry.get(occurrences[index]!.start)??[]),candidate.heading]})):[];
      }).sort((a,b)=>a.start-b.start).map(({start,...item})=>item);
    },
    // Enumerate complete occurrences for discovery only. Callers must still
    // join a unique span and authenticate the resulting evidence context.
    all() {return [...ranges.keys()].flatMap(article=>{
      const result=read(article);
      return result.candidates.length===result.occurrences
        ?result.candidates.map(candidate=>({...candidate,article})):[];
    });},
    containing(fragment:string) {
    const first=source.indexOf(fragment);
    if(!fragment||first<0||source.indexOf(fragment,first+1)>=0)return [];
    return [...ranges.keys()].flatMap(article=>{
      if(!ranges.get(article)!.some(({start,end})=>first>=starts[start]!
        &&first+fragment.length<=ends[end-1]!))return [];
      const result=read(article);
      return result.candidates.length===result.occurrences
        ?result.candidates.filter(candidate=>candidate.text.includes(fragment)).map(candidate=>({...candidate,article})):[];
    });
  }});
}

/** An introduction may name a year that a legacy importer mistook for an
 * article. It does not identify any one following rule. Only the complete
 * unnumbered instrument can supply its context, within the citation limit;
 * the smaller answer budget still controls admission to model evidence. */
export function completeResolutionIntroductionContext(snapshot:NormalizedLegalSourceSnapshot,fragment?:string):string|null {
  if(snapshot.blocks.some(block=>block.semanticRole==="article"||isLegalArticleHeading(block)))return null;
  const first=snapshot.blocks.findIndex(block=>/^1\.\s/u.test(block.text));
  if(first<1)return null;
  const introductions=snapshot.blocks.slice(0,first).filter(block=>/(?:qaror qiladi|қарор қилади|постановляет):\s*$/iu.test(block.text));
  if(introductions.length!==1||fragment!==undefined&&normalize(introductions[0]!.text)!==fragment)return null;
  return completeDocumentText(snapshot,200_000);
}


/** A draft's articles must retain the publisher's draft label and the enclosing
 * decision. A standalone article would lose its material applicability scope. */
export function isDraftContextFragment(snapshot:NormalizedLegalSourceSnapshot,fragment:string):boolean {
  const blocks=snapshot.blocks;
  const markers=blocks.flatMap((block,index)=>/^(?:Проект|Loyiha|Лойиҳа|Draft)$/iu.test(block.text.trim())?[index]:[]);
  return !!fragment&&markers.some(start=>
    normalize(blocks.slice(start).map(block=>block.text).join(" ")).includes(fragment)
      &&blocks.slice(start+1).some(isLegalArticleHeading));
}
