import {spawn} from "node:child_process";
import {once} from "node:events";
import {setTimeout as pause} from "node:timers/promises";
import {fileURLToPath} from "node:url";

export async function startNativePlatform(port=3099, application="platform") {
  const cwd=fileURLToPath(new URL(application === "website" ? "../../../website/" : "../../",import.meta.url));
  const loader=fileURLToPath(new URL("../../node_modules/tsx/dist/loader.mjs",import.meta.url));
  let output="";
  const child=spawn(process.execPath,["--import",loader,"server/index.ts"],{cwd,windowsHide:true,
    env:{...process.env,NODE_ENV:"production",PRIVATE_DEVELOPMENT:"true",PORT:String(port),WEBSITE_PORT:String(port)},stdio:["ignore","pipe","pipe"]});
  for(const stream of [child.stdout,child.stderr])stream.on("data",chunk=>{output=(output+String(chunk)).slice(-8000)});
  const origin=`http://localhost:${port}`;
  const stop=async()=>{if(child.exitCode!==null)return;child.kill("SIGTERM");await Promise.race([once(child,"exit"),pause(5000)]);if(child.exitCode===null)child.kill("SIGKILL")};
  for(let attempt=0;attempt<120;attempt++){
    if(child.exitCode!==null)throw Error(`Native server exited: ${output}`);
    try{const response=await fetch(origin+'/robots.txt');await response.arrayBuffer();return{origin,stop}}catch{}
    await pause(250);
  }
  await stop();throw Error(`Native server did not become ready: ${output}`);
}
