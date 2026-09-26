import {validateFinalSourceObservations} from "../legal/final-source-observation";
import type {LegalSourceContext} from "../legal/source-context";
import type {SourceObservation} from "../legal/source-observation";
import type {LegalEvidence} from "./answer-engine";

/** Keep independently valid sources when another publisher read fails. Never
 * replace the pinned text or refresh a historical endpoint to today's law. */
export async function validateAnswerSources(input:{evidence:readonly LegalEvidence[];
  observe:(url:string)=>Promise<SourceObservation>;signal?:AbortSignal;
}):Promise<Map<string,LegalSourceContext>> {
  const validated=new Map<string,LegalSourceContext>();
  const reads=new Map<string,Promise<SourceObservation>>();
  const observe=async(url:string)=>{
    input.signal?.throwIfAborted();
    let read=reads.get(url);
    if(!read){read=input.observe(url);reads.set(url,read);}
    const observation=await read;
    input.signal?.throwIfAborted();
    return observation;
  };
  // Independent publications need not wait for one another. Bound publisher
  // load, share same-URL reads, and retain input order regardless of completion.
  for(let offset=0;offset<input.evidence.length;offset+=4) {
    const results=await Promise.all(input.evidence.slice(offset,offset+4).map(async item=>{
      input.signal?.throwIfAborted();
      const source={...item.source,applicabilityStatus:item.endpoint.kind==="current"?"current" as const:"historical" as const};
      try {
        const result=await validateFinalSourceObservations({sources:[source],sourceIds:[source.id],observe});
        return result.get(source.id);
      } catch {input.signal?.throwIfAborted();return undefined;}
    }));
    for(const source of results)if(source)validated.set(source.id,source);
  }
  // A source can expire while a later source is read. Recheck all survivors
  // without another publisher attempt or a timestamp manufactured by us.
  for(const source of validated.values()) {
    input.signal?.throwIfAborted();
    try {
      await validateFinalSourceObservations({sources:[source],sourceIds:[source.id],observe:async()=>{
        throw new Error("FINAL_SOURCE_OBSERVATION_EXPIRED");
      }});
    } catch {validated.delete(source.id);}
  }
  return validated;
}
