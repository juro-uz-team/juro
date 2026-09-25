import {parse, type DefaultTreeAdapterTypes} from "parse5";
import { classifyLegalSourceUrl, fetchLegalSource, fetchLexPdfRepresentation, type FetchedLegalSource } from "./source-fetch";
import {normalizeLegalSourceHtml, normalizeLegalSourceHtmlProfiles, type NormalizedLegalSourceSnapshot} from "./source-parser";
import {createSourceObservationReader, sourceObservationSchema, type SourceObservation, type SourceObservationStore} from "./source-observation";

/** Compare normalized official text and identity, excluding volatile raw HTML. */
export async function publisherTextFingerprint(snapshot: NormalizedLegalSourceSnapshot): Promise<string> {
  // Corpus snapshots namespace document IDs; live parsing retains publisher IDs.
  // The authenticated canonical URL is the shared document identity for both.
  const canonicalId = classifyLegalSourceUrl(snapshot.source.canonicalUrl).canonicalId;
  const value = {sourceKind: snapshot.source.sourceKind, locale: snapshot.source.locale,
    canonicalId, canonicalUrl: snapshot.source.canonicalUrl,
    parser: snapshot.parser, documentTitle: snapshot.documentTitle, blocks: snapshot.blocks, plainText: snapshot.plainText};
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function publisherHtmlFingerprints(input: Parameters<typeof normalizeLegalSourceHtmlProfiles>[0]) {
  const {snapshot,structuredSnapshot}=normalizeLegalSourceHtmlProfiles(input);
  const [normalizedTextSha256,normalizedTextSha256V2]=await Promise.all([
    publisherTextFingerprint(snapshot),publisherTextFingerprint(structuredSnapshot),
  ]);
  return {normalizedTextSha256,normalizedTextSha256V2};
}

export async function readLexPublisherObservation(url: string, options?: {previous?:SourceObservation;normalizationPolicy?:string;wait?: (delayMs: number) => Promise<void>;signal?:AbortSignal;
  fingerprintHtml?:(input:Parameters<typeof publisherHtmlFingerprints>[0],signal?:AbortSignal)=>ReturnType<typeof publisherHtmlFingerprints>}): Promise<SourceObservation> {
  options?.signal?.throwIfAborted();
  const fetchOptions={
    ...(options?.wait ? {wait: options.wait} : {}),
    ...(options?.signal ? {fetchImpl:(input:RequestInfo|URL,init?:RequestInit)=>{
      options.signal!.throwIfAborted();
      return fetch(input,{...init,signal:init?.signal
        ?AbortSignal.any([options.signal!,init.signal]):options.signal});
    }} : {}),
    timeoutMs: 4_000, maxBytes: 16 * 1024 * 1024};
  const fetched = await fetchLegalSource(url, {adviceEnabled: false, crawlDelayMode: options?.wait ? "wait" : "proceed",...fetchOptions});
  options?.signal?.throwIfAborted();
  const html=new TextDecoder("utf-8",{fatal:true}).decode(fetched.bytes);
  const lifecycle={repealedOn:lexDocumentRepealedOn(html)};
  const standard=/<header\b[^>]*\bid=["']doc_header["'][^>]*>[\s\S]*?<\/header>/iu.test(html);
  const previous=sourceObservationSchema.safeParse(options?.previous);
  // A fresh full publisher fetch authenticates unchanged bytes. Reuse only
  // derived HTML fingerprints from the exact same implementation policy.
  // PDF wrapper bytes do not authenticate the separately fetched PDF.
  if(standard&&options?.normalizationPolicy&&previous.success
    &&previous.data.normalizationPolicy===options.normalizationPolicy
    &&previous.data.officialUrl===fetched.canonicalUrl
    &&previous.data.rawContentSha256===fetched.contentSha256
    &&previous.data.normalizedTextSha256V2) {
    return {...previous.data,lifecycle,observedAt:fetched.fetchedAt};
  }
  const policy=options?.normalizationPolicy?{normalizationPolicy:options.normalizationPolicy}:{};
  if (options?.fingerprintHtml) {
    const html=new TextDecoder("utf-8",{fatal:true}).decode(fetched.bytes);
    if (/<header\b[^>]*\bid=["']doc_header["'][^>]*>[\s\S]*?<\/header>/iu.test(html)) {
      const fingerprints=await options.fingerprintHtml({html,reference:fetched,rawContentSha256:fetched.contentSha256},options.signal);
      options.signal?.throwIfAborted();
      return {version:2,officialUrl:fetched.canonicalUrl,observedAt:fetched.fetchedAt,
        current:!lexDocumentIsRepealed(html),lifecycle,rawContentSha256:fetched.contentSha256,...fingerprints,...policy};
    }
  }
  const {snapshot,current,structuredSnapshot}=await normalizeLexPublisherDocument(fetched,{...fetchOptions,signal:options?.signal,includeStructured:true});
  const normalizedTextSha256V2 = structuredSnapshot ? await publisherTextFingerprint(structuredSnapshot) : undefined;
  options?.signal?.throwIfAborted();
  return {version: 2, officialUrl: fetched.canonicalUrl, observedAt: fetched.fetchedAt,
    current,lifecycle, rawContentSha256: fetched.contentSha256,...policy,
    normalizedTextSha256: await publisherTextFingerprint(snapshot),
    ...(normalizedTextSha256V2 ? {normalizedTextSha256V2} : {})};
}

/** Normalize the actual publisher representation while retaining the canonical
 * HTML identity and returning PDF provenance for durable capture callers. */
export async function normalizeLexPublisherDocument(fetched:FetchedLegalSource,
  options:Parameters<typeof fetchLexPdfRepresentation>[1]&{signal?:AbortSignal;includeStructured?:boolean}) {
  options.signal?.throwIfAborted();
  const html=new TextDecoder("utf-8",{fatal:true}).decode(fetched.bytes);
  const standard=/<header\b[^>]*\bid=["']doc_header["'][^>]*>[\s\S]*?<\/header>/iu.test(html);
  if(standard){
    const input={html,reference:fetched,rawContentSha256:fetched.contentSha256};
    const normalized=options.includeStructured ? normalizeLegalSourceHtmlProfiles(input)
      : {snapshot:normalizeLegalSourceHtml(input),structuredSnapshot:undefined};
    return {...normalized,current:!lexDocumentIsRepealed(html),representation:undefined};
  }
  const header=pdfHeaderText(html);
  const reference=classifyLegalSourceUrl(fetched.canonicalUrl);
  const representationIds=[...html.matchAll(/PDFObject\.embed\(\s*["']\/pdffile\/(\d+)["']\s*,\s*["']#pdfBody["']/gu)].map(match=>match[1]);
  if(!header||representationIds.length!==1||representationIds[0]!==reference.canonicalId.replace(/^-/u,"")) {
    throw new Error("LEX_DOCUMENT_STATUS_UNAVAILABLE");
  }
  const representation=await fetchLexPdfRepresentation(fetched.canonicalUrl,options);
  const {normalizeLexPdfRepresentation}=await import("./source-normalization");
  const snapshot=await normalizeLexPdfRepresentation({bytes:representation.bytes,reference,rawContentSha256:fetched.contentSha256,signal:options.signal});
  return {snapshot,structuredSnapshot:undefined,current:!isRepealedText(header),representation};
}

function pdfHeaderText(html:string):string|undefined {
  const document=parse(html,{sourceCodeLocationInfo:true});
  const text=(node:DefaultTreeAdapterTypes.Node):string=>node.nodeName==="#text"
    ?(node as DefaultTreeAdapterTypes.TextNode).value
    :"childNodes" in node?node.childNodes.map(text).join(" "):"";
  const headers:DefaultTreeAdapterTypes.Element[]=[];
  const visit=(node:DefaultTreeAdapterTypes.Node)=>{
    if("tagName" in node&&node.tagName==="div"&&node.attrs.some(attr=>attr.name==="class"&&attr.value.split(/\s+/u).includes("docHeader")))headers.push(node);
    if("childNodes" in node)node.childNodes.forEach(visit);
  };
  visit(document);
  const header=headers.length===1?headers[0]:undefined;
  return header?.sourceCodeLocation?.endTag?text(header):undefined;
}

export function createLexDocumentObservationReader(store?: SourceObservationStore) {
  return createSourceObservationReader({readPublisher: readLexPublisherObservation, store});
}
export const observeCurrentLexDocument = createLexDocumentObservationReader();

/** Read the publisher's document-level banner, never repeal language inside
 * an operative provision (which may repeal a different instrument). */
export function lexDocumentIsRepealed(html: string): boolean {
  const header = html.match(/<header\b[^>]*\bid=["']doc_header["'][^>]*>([\s\S]*?)<\/header>/iu)?.[1];
  if (!header) return isRepealedText(pdfHeaderText(html)??"");
  return isRepealedText(header.replace(/<[^>]+>/gu, " ").replace(/&nbsp;|&#160;/gu, " "));
}

/** Only a whole-document status banner supplies the exclusion date. */
export function lexDocumentRepealedOn(html:string):string|null {
  const header=html.match(/<header\b[^>]*\bid=["']doc_header["'][^>]*>([\s\S]*?)<\/header>/iu)?.[1];
  const text=(header?header.replace(/<[^>]+>/gu," ").replace(/&nbsp;|&#160;/gu," "):pdfHeaderText(html)??"").replace(/\s+/gu," ");
  const dates=[...text.matchAll(/(?:(?:документ|акт)\s+утратил\s+силу|hujjat\s+kuchini\s+yo[‘’ʼʻ']?qotgan|ҳужжат\s+кучини\s+йўқотган|document\s+(?:has\s+)?(?:lost\s+(?:its\s+)?force|ceased\s+to\s+be\s+in\s+force))\s*(\d{2})\.(\d{2})\.(\d{4})(?!\d)/giu)];
  if(dates.length!==1)return null;
  const [,day,month,year]=dates[0]!;
  const iso=`${year}-${month}-${day}`,date=new Date(`${iso}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===iso?iso:null;
}

function isRepealedText(value:string):boolean {
  const text=value.replace(/\s+/gu," ");
  return /(?:(?:документ|акт)\s+утратил\s+силу|hujjat\s+kuchini\s+yo[‘’ʼʻ']?qotgan|ҳужжат\s+кучини\s+йўқотган|document\s+(?:has\s+)?(?:lost\s+(?:its\s+)?force|ceased\s+to\s+be\s+in\s+force))/iu.test(text);
}
