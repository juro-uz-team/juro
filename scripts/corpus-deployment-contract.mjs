import assert from "node:assert/strict";
import {createHash} from "node:crypto";
export const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export function deploymentRequest(args) {
 const [phase,environment,revision,release,previous,...extra]=args;
 assert(!extra.length && ["prepare","activate","status"].includes(phase));
 assert(["production","staging"].includes(environment) && /^[a-f0-9]{40}$/.test(revision));
 assert(new RegExp(`^/srv/juro/${environment}/releases/${revision}-[0-9]+$`).test(release));
 assert(previous==="" || new RegExp(`^/srv/juro/${environment}/releases/[a-f0-9]{40}-[a-zA-Z0-9-]+$`).test(previous));
 return {phase,environment,revision,release,previous:previous||null};
}
export function bindOperatorBundle(request,bundle) {
 assert.equal(bundle.version,1);assert.equal(bundle.environment,request.environment);assert.equal(bundle.revision,request.revision);
 assert.equal(bundle.previous,request.previous);assert(/^[a-f0-9]{64}$/.test(bundle.expectedParent));assert(/^[a-f0-9]{64}$/.test(bundle.acceptanceSha256));
 assert(bundle.mode===undefined || bundle.mode==="retain");
 if(bundle.mode==="retain") { assert.equal(bundle.expectedParent,bundle.acceptanceSha256);assert(/^[a-f0-9]{40}$/.test(bundle.acceptedRevision)); }
 else assert.notEqual(bundle.expectedParent,bundle.acceptanceSha256);
 assert(bundle.manifest && /^[a-f0-9]{64}$/.test(bundle.manifest.sha256) && Number.isSafeInteger(bundle.manifest.sizeBytes) && bundle.manifest.sizeBytes>0);
 assert(bundle.environmentFile.startsWith("/etc/juro/") && bundle.manifest.file.startsWith("/etc/juro/corpus-deployment/"));
 return bundle;
}
export function selectionState(actual,bundle){return actual===bundle.expectedParent?"original":actual===bundle.acceptanceSha256?"committed":"ambiguous";}
export async function runDeploymentPhase(request,bundle,operations){
 await operations.guard(false);
 const before=selectionState(await operations.selected(),bundle);
 if(request.phase==="status")return receipt(before);
 assert.equal(before,"original","Selection differs from reviewed parent");
 await operations.qualify();
 if(request.phase==="prepare"){await operations.fences();await operations.guard(false);assert.equal(await operations.selected(),bundle.expectedParent);return receipt("original");}
 await operations.guard(true);
 if(bundle.mode==="retain") { await operations.fences();await operations.guard(true); }
 else await operations.activate();
 assert.equal(await operations.selected(),bundle.acceptanceSha256,"Committed selection readback mismatch");return receipt("committed");
 function receipt(state){return {version:1,...request,originalSelectionSha256:bundle.expectedParent,selectionState:state};}
}
