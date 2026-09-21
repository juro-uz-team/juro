import {parse,type DefaultTreeAdapterTypes} from "parse5";
import {canonicalSecondaryInternetUrl} from "../legal/secondary-internet-url";

const MAX_PAGE_BYTES=512*1024;
const MAX_REDIRECTS=2;
const TIMEOUT_MS=10_000;
const MAX_EXCERPT_LENGTH=3000;
const invisibleElements=new Set(["script","style","template","noscript","head","svg"]);

function pageText(html:string):string {
  const parts:string[]=[];
  const visit=(node:DefaultTreeAdapterTypes.Node)=>{
    if("tagName" in node&&(invisibleElements.has(node.tagName)||node.attrs.some(attribute=>
      attribute.name==="hidden"||(attribute.name==="aria-hidden"&&attribute.value==="true"))))return;
    if(node.nodeName==="#text"&&"value" in node)parts.push(node.value);
    if("childNodes" in node)for(const child of node.childNodes)visit(child);
  };
  visit(parse(html));
  return parts.join(" ").replace(/\s+/gu," ").trim();
}

/** Independently fetch secondary context. Neither discovery snippets nor this
 * page reader establish legal authority or correctness of the page's claims. */
export async function fetchSecondaryPage(input:{url:string;fetchImpl?:typeof fetch;signal?:AbortSignal}):Promise<{
  canonicalUrl:string;text:string;
}> {
  let url=canonicalSecondaryInternetUrl(input.url);
  if(!url)throw new Error("SECONDARY_PAGE_URL_REJECTED");
  const signal=AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS),...(input.signal?[input.signal]:[])]);
  const fetchPage=input.fetchImpl??fetch;
  for(let redirects=0;redirects<=MAX_REDIRECTS;redirects++) {
    signal.throwIfAborted();
    const response:Response=await fetchPage(url,{redirect:"manual",credentials:"omit",signal,
      headers:{accept:"text/html, text/plain;q=0.9"}});
    if(signal.aborted) {await response.body?.cancel();signal.throwIfAborted();}
    if([301,302,303,307,308].includes(response.status)) {
      await response.body?.cancel();
      const location:string|null=response.headers.get("location");
      let next:string|null=null;
      try {next=location?canonicalSecondaryInternetUrl(new URL(location,url).href):null;} catch { /* Invalid redirect. */ }
      if(!next)throw new Error("SECONDARY_PAGE_REDIRECT_REJECTED");
      if(redirects===MAX_REDIRECTS)throw new Error("SECONDARY_PAGE_REDIRECT_LIMIT");
      url=next;continue;
    }
    if(!response.ok) {await response.body?.cancel();throw new Error("SECONDARY_PAGE_UNAVAILABLE");}
    const contentType=response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if(contentType!=="text/html"&&contentType!=="text/plain") {
      await response.body?.cancel();throw new Error("SECONDARY_PAGE_CONTENT_TYPE_REJECTED");
    }
    if(Number(response.headers.get("content-length"))>MAX_PAGE_BYTES) {
      await response.body?.cancel();throw new Error("SECONDARY_PAGE_TOO_LARGE");
    }
    const reader=response.body?.getReader();
    if(!reader)throw new Error("SECONDARY_PAGE_EMPTY_CONTENT");
    const decoder=new TextDecoder("utf-8",{fatal:true});
    let bytes=0,content="";
    const abort=()=>{void reader.cancel().catch(()=>{});};
    signal.addEventListener("abort",abort,{once:true});
    try {
      while(true) {
        signal.throwIfAborted();
        const part=await reader.read();
        signal.throwIfAborted();
        if(part.done)break;
        bytes+=part.value.byteLength;
        if(bytes>MAX_PAGE_BYTES)throw new Error("SECONDARY_PAGE_TOO_LARGE");
        content+=decoder.decode(part.value,{stream:true});
      }
      content+=decoder.decode();
    } finally {
      signal.removeEventListener("abort",abort);
      await reader.cancel();
      reader.releaseLock();
    }
    const text=contentType==="text/html"?pageText(content):content.replace(/\s+/gu," ").trim();
    if(!text)throw new Error("SECONDARY_PAGE_EMPTY_CONTENT");
    return {canonicalUrl:url,text};
  }
  throw new Error("SECONDARY_PAGE_REDIRECT_LIMIT");
}

const words=(text:string)=>new Set(text.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[]);

/** A lexical locator for attributed excerpts, never a semantic verifier.
 * Return only a contiguous portion of fetched text, never the proposed text. */
export function selectRelevantSecondaryPassage(input:{proposedExcerpt:string;pageText:string}):string|null {
  const proposed=words(input.proposedExcerpt);
  if(proposed.size<5)return null;
  const tokens=[...input.pageText.matchAll(/[\p{L}\p{N}]{3,}/gu)];
  let best:{text:string;score:number}|null=null;
  for(const token of tokens) {
    if(!proposed.has(token[0].toLocaleLowerCase()))continue;
    const start=Math.max(0,token.index-MAX_EXCERPT_LENGTH/3);
    const end=Math.min(input.pageText.length,start+MAX_EXCERPT_LENGTH);
    const text=input.pageText.slice(start,end);
    const actual=words(text);
    const score=[...proposed].filter(word=>actual.has(word)).length/proposed.size;
    if(score>=0.6&&(!best||score>best.score))best={text,score};
  }
  return best?.text??null;
}
