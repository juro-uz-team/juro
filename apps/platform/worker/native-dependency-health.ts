import type { PlatformJobEnv } from "./platform-jobs";
import { enqueueQueueHealthProbe, handleQueueHealthProbeBatch, type QueueHealthProbeConfig } from "./queue-health-probe";
import { runLocalDependencyProbes } from "./production-dependency-probes";

export function nativeHealthEnabled(env: Pick<PlatformJobEnv, "APP_ENV" | "NATIVE_DEPENDENCY_PROBES_ENABLED">) {
  return env.NATIVE_DEPENDENCY_PROBES_ENABLED === "true"
    && (env.APP_ENV === "production" || env.APP_ENV === "staging");
}

export function nativeHealthQueueName(environment: string) {
  if (environment !== "production" && environment !== "staging") throw new Error("NATIVE_HEALTH_ENVIRONMENT_INVALID");
  return `${environment}-native-health`;
}

function queueConfig(env: PlatformJobEnv): QueueHealthProbeConfig {
  if (env.APP_ENV !== "production" && env.APP_ENV !== "staging") throw new Error("NATIVE_HEALTH_ENVIRONMENT_INVALID");
  return {
    environment: env.APP_ENV, queueName: nativeHealthQueueName(env.APP_ENV),
    scheduleName: "native-queue-health", holderId: "native-queue-health",
    keyPrefix: `${env.APP_ENV}-native-health-v1`, cron: "*/5 * * * *",
    intervalMs: 5 * 60_000, consumptionTimeoutMs: 10 * 60_000, retryDelaySeconds: 30,
  };
}

export async function runNativeDependencyHealth(env: PlatformJobEnv) {
  if (!nativeHealthEnabled(env)) return null;
  // Only the consumer can record successful queue evidence. Merely enqueueing
  // a probe must not hide a stopped or stuck worker.
  const queue = await enqueueQueueHealthProbe({ env, enabled: true,
    queue: env.NATIVE_HEALTH_QUEUE, config: queueConfig(env) });
  const local = await runLocalDependencyProbes(env);
  return { queue, ...local };
}

export async function consumeNativeHealth(batch: MessageBatch<unknown>, env: PlatformJobEnv): Promise<boolean> {
  if (!nativeHealthEnabled(env) || batch.queue !== nativeHealthQueueName(env.APP_ENV)) return false;
  await handleQueueHealthProbeBatch({ batch, env, enabled: true, config: queueConfig(env) });
  return true;
}
