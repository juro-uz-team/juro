import "../lib/runtime/node-globals";
import {database} from "../lib/storage/connection";
import {readNativePublisherObservation} from "../lib/runtime/publisher-source-normalization";
import {runSourceObserverLoop} from "../lib/runtime/source-observer-loop";
import {refreshPublicSourceObservations} from "../lib/legal/source-observation-refresh";
import {nativeHttpConfiguration} from "../../../scripts/native-http.mjs";

nativeHttpConfiguration(process.env, "platform");
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
process.on("SIGINT", () => controller.abort());
try {
    await runSourceObserverLoop({
      signal: controller.signal,
      // The PostgreSQL adapter implements the query API; D1's unused dump API
      // is intentionally absent from the self-hosted storage boundary.
      refresh: () => refreshPublicSourceObservations({db: database("legal") as unknown as D1Database,
        readPublisher: (url, options) => readNativePublisherObservation(url, {...options,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])})}),
      reportError: error => console.error("Publisher observation refresh failed",
        error instanceof Error ? error.message : "Unknown error"),
    });
} finally {
  await database("legal").close();
}
