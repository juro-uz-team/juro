import {readR2NativeDiscoveryMetadata} from "./target-evidence";

/** Overlap bounded public observation with discovery, only after authenticating
 * metadata. This does not establish evidence eligibility or replace final
 * pinned-source verification. A reader belongs to one research session. */
export function createDiscoveryMetadataReader(input:{
  observeCurrent:(url:string)=>Promise<unknown>;
  signal:()=>AbortSignal|undefined;
}):typeof readR2NativeDiscoveryMetadata {
  const prefetched=new Set<string>();
  return async(...args)=>{
    const metadata=await readR2NativeDiscoveryMetadata(...args);
    const [,identity,endpoint]=args;
    const signal=input.signal();
    if(metadata&&endpoint.kind==="current"&&signal&&!signal.aborted
      &&prefetched.size<4&&!prefetched.has(identity.citation.url)) {
      prefetched.add(identity.citation.url);
      // Use the caller's existing observation reader, including its in-flight
      // sharing and freshness rules. Failure is not a discovery result; final
      // evidence verification still decides whether this source is usable.
      void Promise.resolve().then(()=>{
        signal.throwIfAborted();
        return input.observeCurrent(identity.citation.url);
      }).catch(()=>undefined);
    }
    return metadata;
  };
}
