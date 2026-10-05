#!/usr/bin/env node
// Install this file and its contract beside one another in a root-owned directory.
// A root-only reviewed bundle authorizes one revision and its exact prior selection.
import assert from "node:assert/strict";
import {readFile,lstat,realpath} from "node:fs/promises";
import {execFileSync,spawn} from "node:child_process";
import {join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {parseEnv} from "node:util";
import {deploymentRequest,bindOperatorBundle,digest,runDeploymentPhase} from "./corpus-deployment-contract.mjs";
import {readCorpusCompatibility} from "./corpus-compatibility.mjs";
const run=(command,args)=>execFileSync(command,args,{encoding:"utf8",timeout:10000,stdio:["ignore","pipe","pipe"],env:{PATH:"/usr/local/bin:/usr/bin:/bin",HOME:"/root"}}).trim();
async function protectedPath(path){
 for(let current=path;current!=="/";current=dirname(current)){
  const info=await lstat(current);assert(!info.isSymbolicLink(),"Operator paths cannot contain symlinks");assert.equal(info.uid,0);assert.equal(info.mode&0o022,0);
 }
}
let activeChild;
function stopWorker(){if(activeChild?.pid){try{process.kill(-activeChild.pid,"SIGKILL");}catch(error){if(error.code!=="ESRCH")throw error;}}}
process.on("SIGTERM",()=>{stopWorker();process.exit(143);});
process.on("SIGINT",()=>{stopWorker();process.exit(130);});
const deadline=setTimeout(()=>{stopWorker();process.exit(1);},130000);deadline.unref();
async function main(){
 assert.equal(process.platform,"linux");assert.equal(process.getuid(),0);
 const request=deploymentRequest(process.argv.slice(2));
 const bundlePath=`/etc/juro/corpus-deployment/${request.environment}/${request.revision}.json`;
 await protectedPath(bundlePath);const bundle=bindOperatorBundle(request,JSON.parse(await readFile(bundlePath,"utf8")));
 if(bundle.mode==="retain"){
  const approval=readCorpusCompatibility(request.environment,request.revision);
  assert(approval);assert.equal(approval.acceptedRevision,bundle.acceptedRevision);
  assert.equal(approval.acceptanceSha256,bundle.acceptanceSha256);
 }
 await protectedPath(bundle.environmentFile);await protectedPath(bundle.manifest.file);
 const settings=parseEnv(await readFile(bundle.environmentFile,"utf8"));assert(settings.CORPUS_DATABASE_URL&&settings.CORPUS_OBJECT_STORAGE_PATH);
 const bytes=await readFile(bundle.manifest.file);assert.equal(bytes.length,bundle.manifest.sizeBytes);assert.equal(digest(bytes),bundle.manifest.sha256);
 const account=`juro-${request.environment}`;if(["juro-production","juro-staging"].includes(process.env.SUDO_USER))assert.equal(process.env.SUDO_USER,account);
 const uid=Number(run("id",["-u",account]));
 let processPins;
 async function guard(services){
  const lock=`/srv/juro/${request.environment}/.deploy-lock`;
  for(const file of [lock,join(lock,"owner.json")]){const info=await lstat(file);assert(!info.isSymbolicLink());assert([0,uid].includes(info.uid));assert.equal(info.mode&0o077,0);}
  const owner=JSON.parse(await readFile(join(lock,"owner.json"),"utf8"));
  for(const field of ["environment","revision","release","previous"])assert.equal(owner[field],request[field]);
  assert.equal(await realpath(request.release),request.release);
  assert.equal(run("runuser",["-u",account,"--","git","-C",request.release,"rev-parse","HEAD"]),request.revision);
  assert.equal(run("runuser",["-u",account,"--","git","-C",request.release,"status","--porcelain","--untracked-files=normal"]),"");
  assert.equal((await readFile(join(request.release,"apps/platform/.next/BUILD_ID"),"utf8")).trim(),request.revision);
  if(!services)return;
  assert.equal(await realpath(`/srv/juro/${request.environment}/current`),request.release);
  const pins=[];
  for(const name of ["platform","jobs","source-observer","website","admin","status",...(request.environment==="production"?["lawyer"]:[])]){
   const text=run("runuser",["-u",account,"--","env",`XDG_RUNTIME_DIR=/run/user/${uid}`,"systemctl","--user","show",`juro-${request.environment}-${name}.service`,"-p","MainPID","-p","ActiveState","-p","SubState"]);
   const info=Object.fromEntries(text.split("\n").map(line=>line.split("=")));assert.equal(info.ActiveState,"active");assert.equal(info.SubState,"running");assert(/^[1-9][0-9]*$/.test(info.MainPID));
   const app=name==="website"?"website":name==="admin"?"admin":"platform";
   const entry=name==="jobs"?"server/jobs.ts":name==="source-observer"?"server/source-observer.ts":name==="admin"?"src/server.ts":"server/index.ts";
   assert.equal(await realpath(`/proc/${info.MainPID}/cwd`),join(request.release,"apps",app));
   const argv=(await readFile(`/proc/${info.MainPID}/cmdline`,"utf8")).split("\0").filter(Boolean);
   assert.deepEqual(argv.slice(1),[join(request.release,"scripts/with-private-env.mjs"),"--import",join(request.release,"apps/platform/node_modules/tsx/dist/loader.mjs"),entry]);
   const status=await readFile(`/proc/${info.MainPID}/status`,"utf8");assert.equal(Number(status.match(/^Uid:\s+(\d+)/m)?.[1]),uid);
   const stat=await readFile(`/proc/${info.MainPID}/stat`,"utf8");pins.push([name,info.MainPID,stat.slice(stat.lastIndexOf(")")+2).split(" ")[19]]);
  }
  const serialized=JSON.stringify(pins);if(processPins)assert.equal(processPins,serialized);else processPins=serialized;
 }
 await guard(false);
 const workerPath=join(dirname(fileURLToPath(import.meta.url)),"corpus-deployment-worker.mjs");await protectedPath(workerPath);await protectedPath(join(dirname(workerPath),"corpus-deployment-contract.mjs"));
 const operator="juro-corpus-operator",operatorUid=Number(run("id",["-u",operator])),operatorGid=Number(run("id",["-g",operator]));assert(operatorUid>0&&operatorGid>0);assert.notEqual(operatorUid,uid);
 if(request.phase==="prepare"){
  assert((await lstat(join(request.release,".env.self-hosted"))).isSymbolicLink(),"Private environment must remain an excluded symlink");
  execFileSync("/usr/bin/setfacl",["-R","-P","-m",`u:${operatorUid}:rX`,request.release],{timeout:30000,stdio:["ignore","pipe","pipe"],env:{PATH:"/usr/bin:/bin"}});
  await guard(false);
 }

 const result=await new Promise((resolve,reject)=>{
  const child=spawn("/usr/sbin/runuser",["-u",operator,"--",process.execPath,"--import",join(request.release,"apps/platform/node_modules/tsx/dist/loader.mjs"),workerPath],{detached:true,cwd:request.release,env:{PATH:"/usr/local/bin:/usr/bin:/bin",HOME:"/nonexistent",NODE_ENV:"production"},stdio:["ignore","pipe","pipe","ipc"]});
  activeChild=child;let result;const timer=setTimeout(()=>{stopWorker();reject(Error("Corpus hook deadline exceeded"));},120000);
  // Product logs are never protocol output and may contain operational detail.
  child.stdout.resume();child.stderr.resume();
  child.on("message",async message=>{if(message.type==="guard"){try{await guard(message.services===true);child.send({type:"guard-result",id:message.id,ok:true});}catch{child.send({type:"guard-result",id:message.id,ok:false});}}else if(message.type==="result")result=message.result;else if(message.type==="failure"){const safe=value=>typeof value==="string"&&/^[A-Za-z0-9_-]{1,64}$/.test(value)?value:"unknown";console.error(JSON.stringify({stage:safe(message.stage),code:safe(message.code)}));}});
  child.on("error",error=>{clearTimeout(timer);reject(error);});child.on("exit",code=>{activeChild=undefined;clearTimeout(timer);code===0&&result?resolve(result):reject(Error("Corpus operator failed"));});
  child.send({type:"start",request,bundle,settings:{CORPUS_DATABASE_URL:settings.CORPUS_DATABASE_URL,CORPUS_OBJECT_STORAGE_PATH:settings.CORPUS_OBJECT_STORAGE_PATH},manifestText:bytes.toString()});
 });
 console.log(JSON.stringify(result));
}
main().catch(()=>{console.error("Corpus deployment hook refused operation; operator inspection required");process.exitCode=1;});
