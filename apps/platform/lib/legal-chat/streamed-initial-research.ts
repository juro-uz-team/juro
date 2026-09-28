import {completedResearchQueries} from "./streamed-research-queries";

function containerEnd(text:string,start:number):number|null {
  let depth=0,quoted=false,escaped=false;
  for(let index=start;index<text.length;index++) {
    const char=text[index]!;
    if(quoted){if(escaped)escaped=false;else if(char==="\\")escaped=true;else if(char==='"')quoted=false;continue;}
    if(char==='"')quoted=true;
    else if(char==="{"||char==="[")depth++;
    else if(char==="}"||char==="]") {if(--depth===0)return index+1;}
  }
  return null;
}

/** Closed values only. Final response validation remains authoritative. An
 * unexpected property order simply leaves discovery to the completed plan. */
export function completedInitialResearch(text:string):{interpretation:unknown;queries:unknown[]}|null {
  if(text.length>256_000)throw new Error("RESEARCH_PLAN_OUTPUT_EXCEEDED");
  const prefix=/^\s*\{\s*"interpretation"\s*:\s*(?=\{)/u.exec(text);
  if(!prefix)return null;
  const end=containerEnd(text,prefix[0].length);
  if(end===null)return null;
  const interpretation=JSON.parse(text.slice(prefix[0].length,end));
  const research=/^\s*,\s*"research"\s*:\s*\{\s*"directQueries"\s*:\s*(?=\[)/u.exec(text.slice(end));
  if(!research)return {interpretation,queries:[]};
  const start=end+research[0].length;
  const queries=completedResearchQueries('{"queries":'+text.slice(start));
  const directEnd=containerEnd(text,start);
  if(directEnd===null)return {interpretation,queries};
  const underlying=/^\s*,\s*"underlyingRuleQueries"\s*:\s*(?=\[)/u.exec(text.slice(directEnd));
  if(underlying)queries.push(...completedResearchQueries('{"queries":'+text.slice(directEnd+underlying[0].length)));
  return {interpretation,queries};
}
