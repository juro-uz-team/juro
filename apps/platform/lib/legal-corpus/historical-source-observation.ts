import {classifyLegalSourceUrl} from "../legal/source-fetch";
import {isFreshSourceObservation,type SourceObservation} from "../legal/source-observation";
import type {ResolvedOfficialEvidence} from "./target-evidence";
import type {LegalTime} from "../legal-chat/answer-engine";

/** A repeal banner can exclude an instrument; it never proves commencement
 * or the applicability of a preceding version. Original temporal gates remain. */
export function createHistoricalSourceVerifier(input:{observe:(url:string)=>Promise<SourceObservation>;now?:()=>number}) {
  return async(evidence:Pick<ResolvedOfficialEvidence,"officialCitation"|"languageTag">,endpoint:LegalTime)=>{
    if(endpoint.kind!=="timestamp")throw Error("HISTORICAL_SOURCE_ENDPOINT_INVALID");
    const instant=Date.parse(endpoint.instant);
    if(!Number.isFinite(instant))throw Error("HISTORICAL_SOURCE_ENDPOINT_INVALID");
    const original=classifyLegalSourceUrl(evidence.officialCitation.url);
    if(original.sourceKind!=="lex"||original.canonicalUrl!==evidence.officialCitation.url)
      throw Error("HISTORICAL_SOURCE_IDENTITY_INVALID");
    const url=new URL(evidence.officialCitation.url);url.search="";
    const reference=classifyLegalSourceUrl(url.href);
    if(reference.sourceKind!=="lex"||reference.canonicalUrl!==url.href
      ||({ru:"ru",uz:"uz-Latn",uzc:"uz-Cyrl",en:"en"}[reference.locale])!==evidence.languageTag)
      throw Error("HISTORICAL_SOURCE_IDENTITY_INVALID");
    const observation=await input.observe(reference.canonicalUrl);
    if(!isFreshSourceObservation(observation,reference.canonicalUrl,(input.now??Date.now)())
      ||(!observation.current&&!observation.lifecycle?.repealedOn)
      ||(observation.current&&observation.lifecycle?.repealedOn))throw Error("HISTORICAL_SOURCE_STATUS_UNAVAILABLE");
    // Lex dates are Uzbekistan civil dates (UTC+05:00), not UTC midnights.
    const boundary=observation.lifecycle?.repealedOn
      ?Date.parse(`${observation.lifecycle.repealedOn}T00:00:00+05:00`):null;
    return {eligible:boundary===null||instant<boundary,observation};
  };
}
