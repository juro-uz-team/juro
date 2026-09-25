import {execFileSync,type ExecFileSyncOptionsWithStringEncoding} from "node:child_process";
import {readFileSync} from "node:fs";
import {join} from "node:path";

declare const __JURO_COMPILED_PRODUCT_REVISION__:string|undefined;

/** Uncommitted or unavailable source cannot claim a qualified implementation. */
export function readWorkingTreeProductRevision(directory=process.cwd()):string {
  try {
    const options:ExecFileSyncOptionsWithStringEncoding={cwd:directory,encoding:"utf8",stdio:["ignore","pipe","ignore"]};
    if(execFileSync("git",["status","--porcelain","--untracked-files=normal"],options).trim())return "unqualified";
    const revision=execFileSync("git",["rev-parse","HEAD"],options).trim();
    return /^[a-f0-9]{40}$/u.test(revision)?revision:"unqualified";
  } catch {return "unqualified";}
}

const loadedRevision=typeof __JURO_COMPILED_PRODUCT_REVISION__==="string"
  ?__JURO_COMPILED_PRODUCT_REVISION__:readWorkingTreeProductRevision();

export function executingProductRevision():string {return loadedRevision;}

/** Source-run handlers and compiled routes must agree with their own loaded
 * revision as well as the checkout and persisted build. */
export function verifyProductRevision(directory:string,executingRevision:string):string {
  const revision=readWorkingTreeProductRevision(directory);
  try {
    return revision!=="unqualified"&&revision===executingRevision
      &&readFileSync(join(directory,".next","BUILD_ID"),"utf8").trim()===revision
      ?revision:"unqualified";
  }catch{return "unqualified";}
}

export function runtimeProductRevision():string {
  return verifyProductRevision(process.cwd(),executingProductRevision());
}
