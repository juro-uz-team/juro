import {LEGAL_INTERPRETATION_FORMULATION_LIMIT} from "../legal/question-interpretation-limits";

/** Read only closed query objects from the strict planner envelope. This is
 * speculative work input; the provider's complete response must still validate. */
export function completedResearchQueries(text:string):unknown[] {
  if(text.length>256_000)throw new Error("RESEARCH_PLAN_OUTPUT_EXCEEDED");
  const prefix=/^\s*\{\s*"queries"\s*:\s*\[/u.exec(text);
  if(!prefix)return [];
  const result:unknown[]=[];
  let start=-1,depth=0,quoted=false,escaped=false;
  for(let index=prefix[0].length;index<text.length;index++){
    const char=text[index]!;
    if(start<0){
      if(/\s|,/u.test(char))continue;
      if(char==="]")break;
      if(char!=="{")throw new Error("RESEARCH_PLAN_STREAM_INVALID");
      start=index;depth=1;continue;
    }
    if(quoted){if(escaped)escaped=false;else if(char==="\\")escaped=true;else if(char==='"')quoted=false;continue;}
    if(char==='"')quoted=true;
    else if(char==="{"||char==="[")depth++;
    else if(char==="}"||char==="]")depth--;
    if(depth===0){
      result.push(JSON.parse(text.slice(start,index+1)));
      if(result.length>LEGAL_INTERPRETATION_FORMULATION_LIMIT)throw new Error("RESEARCH_PLAN_OUTPUT_EXCEEDED");
      start=-1;
    }
  }
  return result;
}
