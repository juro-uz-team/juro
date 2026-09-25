import {createHash} from "node:crypto";
import {readFile,readdir} from "node:fs/promises";
import {readLexPublisherObservation} from "../legal/lex-document-status";
import {resolve} from "node:path";
import {WorkerTaskPool} from "./worker-task-pool";
import type {publisherHtmlFingerprints} from "../legal/lex-document-status";

type Input = Parameters<typeof publisherHtmlFingerprints>[0];
type Result = Awaited<ReturnType<typeof publisherHtmlFingerprints>>;
// The self-hosted platform and jobs launch from the platform package directory.
// Threads retain no document cache; each task authenticates its supplied fetch.
const workers = new WorkerTaskPool<Input,Result>(resolve("server/publisher-source-worker.cjs"),2);

export function fingerprintPublisherHtml(input: Input, signal?: AbortSignal): Promise<Result> {
  const {sourceKind,locale,canonicalId,canonicalUrl}=input.reference;
  return workers.run({html:input.html,rawContentSha256:input.rawContentSha256,
    reference:{sourceKind,locale,canonicalId,canonicalUrl}},signal);
}


let implementationPolicy:Promise<string>|undefined;
/** Conservative deployment identity includes parser/status/fetch code and its
 * locked dependencies. No prior-process projection survives a code change. */
export function publisherNormalizationPolicy():Promise<string> {
  return implementationPolicy??=(async()=>{
    const names=(await readdir(resolve("lib/legal"))).filter(name=>name.endsWith(".ts"))
      .map(name=>`lib/legal/${name}`).concat(["package-lock.json","server/publisher-source-worker.cjs",
        "lib/runtime/publisher-source-normalization.ts"]).sort();
    const hash=createHash("sha256");
    for(const name of names){const bytes=await readFile(resolve(name));hash.update(name+"\0"+bytes.byteLength+"\0");hash.update(bytes);}
    return hash.digest("hex");
  })();
}

export async function readNativePublisherObservation(url:string,options:Parameters<typeof readLexPublisherObservation>[1]={}) {
  return readLexPublisherObservation(url,{...options,fingerprintHtml:fingerprintPublisherHtml,
    normalizationPolicy:await publisherNormalizationPolicy()});
}
