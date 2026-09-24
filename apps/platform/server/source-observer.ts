import "../lib/runtime/node-globals";
import {database} from "../lib/storage/connection";
import {fingerprintPublisherHtml} from "../lib/runtime/publisher-source-normalization";
import {runSourceObserverLoop} from "../lib/runtime/source-observer-loop";
import {readLexPublisherObservation} from "../lib/legal/lex-document-status";
import {refreshPublicSourceObservations} from "../lib/legal/source-observation-refresh";

if (process.env.PRIVATE_DEVELOPMENT !== "true") throw new Error("This worker requires private development configuration");
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
process.on("SIGINT", () => controller.abort());
try {
    await runSourceObserverLoop({
      signal: controller.signal,
      // The PostgreSQL adapter implements the query API; D1's unused dump API
      // is intentionally absent from the self-hosted storage boundary.
      refresh: () => refreshPublicSourceObservations({db: database("legal") as unknown as D1Database,
        readPublisher: (url, options) => readLexPublisherObservation(url, {...options,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
          fingerprintHtml: fingerprintPublisherHtml})}),
      reportError: error => console.error("Publisher observation refresh failed",
        error instanceof Error ? error.message : "Unknown error"),
    });
} finally {
  await database("legal").close();
}
