import {createHash} from "node:crypto";
import workload from "../../config/chat-qualification.json";
import {stableSourceSnapshotJson} from "../legal-corpus/source-snapshot";

const hash=(value:unknown)=>createHash("sha256").update(stableSourceSnapshotJson(value)).digest("hex");

/** Qualification inputs only. Never used to plan, retrieve or write a Legal Answer. */
export const nativeChatWorkloadSha256=hash(workload);
export const nativeChatWorkload=["fast","deep"].flatMap(mode=>workload.scenarios.map(scenario=>{
  const input={...scenario,id:`${mode}:${scenario.id}`,mode,concurrency:workload.concurrency,
    ...(scenario.parent?{parent:`${mode}:${scenario.parent}`}:{})};
  return {...input,inputSha256:hash(input)};
}));
