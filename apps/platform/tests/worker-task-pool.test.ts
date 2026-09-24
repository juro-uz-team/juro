import assert from "node:assert/strict";
import test from "node:test";
import {resolve} from "node:path";
import {WorkerTaskPool} from "../lib/runtime/worker-task-pool";

const filename = resolve("tests/fixtures/worker-task.cjs");
test("worker admission bounds concurrent CPU work and preserves every queued result", async () => {
  const pool = new WorkerTaskPool<Record<string,unknown>,number>(filename,2);
  const counters = new SharedArrayBuffer(8);
  try {
    const results = await Promise.all(Array.from({length:8},(_,value)=>pool.run({value,counters,delay:40})));
    assert.deepEqual(results,[0,1,2,3,4,5,6,7]);
    assert.equal(new Int32Array(counters)[1],2);
  } finally {await pool.close();}
});

test("queued cancellation removes work and active cancellation terminates a blocked worker", {timeout:5000}, async () => {
  const pool = new WorkerTaskPool<Record<string,unknown>,number>(filename,1,1);
  const active = new AbortController(), queued = new AbortController();
  try {
    const started=new SharedArrayBuffer(4);
    const first = pool.run({spin:true,started},active.signal);
    const firstRejected = assert.rejects(first,/active cancelled/);
    while (!Atomics.load(new Int32Array(started),0)) await new Promise(resolve=>setTimeout(resolve,5));
    const second = pool.run({value:2},queued.signal);
    const secondRejected = assert.rejects(second,/queued cancelled/);
    await assert.rejects(pool.run({value:3}),/WORKER_QUEUE_FULL/);
    queued.abort(new Error("queued cancelled"));
    await secondRejected;
    const replacement = pool.run({value:4});
    active.abort(new Error("active cancelled"));
    await firstRejected;
    assert.equal(await replacement,4);
  } finally {await pool.close();}
});

test("worker crashes fail their request and a new worker serves remaining work", async () => {
  const pool = new WorkerTaskPool<Record<string,unknown>,number>(filename,1);
  try {
    const crash = assert.rejects(pool.run({crash:true}),/WORKER_EXITED:3/);
    const next = pool.run({value:7});
    await crash;
    assert.equal(await next,7);
  } finally {await pool.close();}
  await assert.rejects(pool.run({value:8}),/WORKER_POOL_CLOSED/);
});
