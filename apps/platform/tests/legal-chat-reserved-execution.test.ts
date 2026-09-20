import assert from "node:assert/strict";
import test from "node:test";
import {runReservedLegalChat} from "../lib/legal-chat/reserved-execution";

test("a request renews ownership before work and atomic save",async()=>{
  const events:string[]=[];
  const result=await runReservedLegalChat({renew:async()=>{events.push("renew");return true;},
    work:async()=>{events.push("work");return "verified";},
    commit:async value=>{events.push("save");return value;},release:async()=>assert.fail("Successful work is not released")});
  assert.equal(result,"verified");
  assert.deepEqual(events,["renew","work","renew","save"]);
});

test("losing a lease cancels work and fences even a late provider result",async()=>{
  let renewals=0,commits=0;const releases:string[]=[];
  let complete!:(value:string)=>void;
  const pending=runReservedLegalChat({heartbeatMs:1,renew:async()=>++renewals===1,
    work:async()=>new Promise<string>(resolve=>{complete=resolve;}),
    commit:async value=>{commits++;return value;},release:async reason=>{releases.push(reason);}});
  await assert.rejects(pending,/LEASE_LOST/);
  complete("late result");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(commits,0);
  assert.deepEqual(releases,["lease_lost"]);
});

test("caller cancellation releases pending work without saving",async()=>{
  const controller=new AbortController();const releases:string[]=[];
  const pending=runReservedLegalChat({signal:controller.signal,renew:async()=>true,
    work:async()=>{controller.abort();return "late result";},
    commit:async()=>assert.fail("No save after cancellation"),release:async reason=>{releases.push(reason);}});
  await assert.rejects(pending);
  assert.deepEqual(releases,["cancelled"]);
});

test("a disconnect during atomic commit does not turn a saved answer into reported cancellation",async()=>{
  const controller=new AbortController();
  const result=await runReservedLegalChat({signal:controller.signal,renew:async()=>true,work:async()=>"verified",
    commit:async value=>{controller.abort();return value;},release:async()=>assert.fail("The result was committed")});
  assert.equal(result,"verified");
});

test("healthy heartbeats cannot prolong a stuck request beyond its execution window",async()=>{
  const releases:string[]=[];
  await assert.rejects(runReservedLegalChat({timeoutMs:5,heartbeatMs:1,renew:async()=>true,
    work:async()=>new Promise<string>(()=>undefined),commit:async()=>assert.fail("No save after deadline"),
    release:async reason=>{releases.push(reason);}}),/EXECUTION_TIMEOUT/);
  assert.deepEqual(releases,["failed"]);
});
