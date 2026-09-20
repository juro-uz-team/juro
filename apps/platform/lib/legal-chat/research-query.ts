import type {QuestionInterpretation} from "../legal-corpus/legal-candidate-index";
import {classifyTargetPrivateNames} from "../legal-corpus/target-reasoning-service";

/** Search receives legal research language, not private case identifiers.
 * Model-declared public titles only survive when the pinned corpus attests
 * them independently. The local classifier makes no provider request. */
export async function privateResearchQueries(plan:QuestionInterpretation, trustedTitles:readonly string[]):Promise<QuestionInterpretation> {
  const formulations:QuestionInterpretation["formulations"]=[];
  for(const formulation of plan.formulations) {
    const text=formulation.text.normalize("NFC").trim();
    const legalTitleSpans=(formulation.legalTitleSpans??[]).filter(title=>
      trustedTitles.includes(title)&&text.includes(title));
    const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(
      `juro.private-name-classification.v1\n${text}`));
    const classification=await classifyTargetPrivateNames({text,legalTitleSpans,
      formulationSha256:[...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,"0")).join("")});
    if(classification.status!=="complete") throw new Error("RESEARCH_QUERY_PRIVACY_UNCERTAIN");
    let safe=text;
    for(const span of [...new Set([...formulation.privateNameSpans,...classification.privateNameSpans])]
      .sort((left,right)=>right.length-left.length)) {
      if(!text.includes(span)) throw new Error("RESEARCH_QUERY_PRIVATE_SPAN_INVALID");
      safe=safe.split(span).join(" ");
    }
    safe=safe.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu," ")
      .replace(/https?:\/\/[^\s]+/giu," ")
      .replace(/(?<!\d)(?:\+\d[\d ().-]{7,}\d|\d{9,}|\d{2,3}[- ]\d{3}[- ]\d{2}[- ]\d{2})(?!\d)/gu," ")
      .replace(/\s+/gu," ").trim();
    if(!safe||!/[\p{L}]/u.test(safe)) throw new Error("RESEARCH_QUERY_EMPTY_AFTER_PRIVACY");
    formulations.push({...formulation,text:safe,legalTitleSpans:legalTitleSpans.filter(title=>safe.includes(title)),privateNameSpans:[]});
  }
  return {...plan,formulations};
}
