import "../lib/runtime/node-globals";
import { setTimeout as pause } from "node:timers/promises";
import { resolve } from "node:path";
import { reclaimObjects } from "../lib/storage/object-reclamation";
import { database } from "../lib/storage/connection";
import { PostgresQueue } from "../lib/storage/queue";
import { getSelfHostedRuntime } from "../lib/runtime/self-hosted";
import { JOB_KINDS, expectedQueueName, handleQueue } from "../worker/platform-jobs";
import { dispatchOutbox } from "../worker/platform-outbox";
import { handleScheduled } from "../worker/platform-scheduled";

if (process.env.PRIVATE_DEVELOPMENT !== "true") throw new Error("This worker requires private development configuration");
const env = getSelfHostedRuntime();
const pool = database().pool;
const names = [...new Set(JOB_KINDS.map(kind => expectedQueueName(kind, env.APP_ENV)))];
const queues = [...names, ...names.map(name => `${name}-dlq`)].map(name => new PostgresQueue(pool, name));
let stopping = false;
let lastHousekeeping = 0;
const documentQueue = (name: string) => /-(document-analysis|document-export|ocr-processing|malware-scan)(-dlq)?$/.test(name);
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

while (!stopping) {
  try {
    if (Date.now() - lastHousekeeping >= 300_000) {
      lastHousekeeping = Date.now();
      await reclaimObjects(pool, resolve(process.env.OBJECT_STORAGE_PATH ?? "../../.data/objects"));
      try { await handleScheduled({ cron: "*/5 * * * *", scheduledTime: Date.now(), noRetry() {} }, env); }
      catch (error) { console.error("Scheduled housekeeping failed", error instanceof Error ? error.message : "Unknown error"); }
    }
    await dispatchOutbox(env);
    let processed = false;
    for (const queue of queues) {
      if (stopping) break;
      const claim = await queue.claim();
      if (!claim) continue;
      processed = true;
      if (queue.name.endsWith("-dlq") && (!documentQueue(queue.name) || claim.attempts > 11)) {
        await queue.park(claim);
        continue;
      }
      // Heartbeats fence acknowledgements after a lost lease, including process pauses.
      let leaseLost = false;
      const heartbeat = setInterval(() => {
        void queue.renew(claim).then(renewed => { if (!renewed) leaseLost = true; }).catch(() => { leaseLost = true; });
      }, 30_000);
      let retrySeconds: number | undefined;
      const retry = (options?: { delaySeconds?: number }) => { retrySeconds = options?.delaySeconds ?? 30; };
      const message = { ...claim, ack() { retrySeconds = undefined; }, retry };
      try {
        await handleQueue({ queue: queue.name, metadata: { metrics: await queue.metrics() },
          messages: [message], ackAll: message.ack, retryAll: retry }, env);
        if (!leaseLost) {
          if (retrySeconds === undefined) await queue.acknowledge(claim);
          else if (claim.attempts >= (documentQueue(queue.name) ? 4 : 6) && !queue.name.endsWith("-dlq")) await queue.deadLetter(claim);
          else await queue.retry(claim, retrySeconds);
        }
      } catch {
        if (!leaseLost) {
          if (claim.attempts >= (documentQueue(queue.name) ? 4 : 6) && !queue.name.endsWith("-dlq")) await queue.deadLetter(claim);
          else await queue.retry(claim, 30);
        }
      } finally { clearInterval(heartbeat); }
    }
    if (!processed) await pause(1000);
  } catch (error) {
    console.error("Job worker iteration failed", error instanceof Error ? error.message : "Unknown error");
    await pause(5000);
  }
}
await Promise.all([database("app").close(), database("legal").close()]);
