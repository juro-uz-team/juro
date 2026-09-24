import {resolve} from "node:path";
import {WorkerTaskPool} from "./worker-task-pool";
import type {publisherHtmlFingerprints} from "../legal/lex-document-status";

type Input = Parameters<typeof publisherHtmlFingerprints>[0];
type Result = Awaited<ReturnType<typeof publisherHtmlFingerprints>>;
// The self-hosted platform and jobs launch from the platform package directory.
// Threads retain no document cache; each task authenticates its supplied fetch.
const workers = new WorkerTaskPool<Input,Result>(resolve("server/publisher-source-worker.cjs"),2);

export function fingerprintPublisherHtml(input: Input, signal?: AbortSignal): Promise<Result> {
  const {sourceKind,locale,canonicalId,canonicalUrl}=input.reference;
  return workers.run({html:input.html,rawContentSha256:input.rawContentSha256,
    reference:{sourceKind,locale,canonicalId,canonicalUrl}},signal);
}
