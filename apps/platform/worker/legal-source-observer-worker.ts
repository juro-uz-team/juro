import {refreshPublicSourceObservations, SOURCE_OBSERVATION_REFRESH_CRON} from "../lib/legal/source-observation-refresh";

type SourceObserverEnv = {LEGAL_DB: D1Database; LEGAL_SOURCE_OBSERVATIONS_ENABLED?: string};

export default {
  async scheduled(controller: ScheduledController, env: SourceObserverEnv) {
    if (env.LEGAL_SOURCE_OBSERVATIONS_ENABLED !== "true" || controller.cron !== SOURCE_OBSERVATION_REFRESH_CRON) return;
    await refreshPublicSourceObservations({db: env.LEGAL_DB});
  },
  async fetch() {return new Response(null, {status: 404});},
} satisfies ExportedHandler<SourceObserverEnv>;
