import { createCorpusTransport } from "./corpus-transport";

type Worker = Parameters<typeof createCorpusTransport>[0];

/** Separately pinned complete-source service; existing discovery coordinates remain unchanged. */
export function createPreparedTransportPair(input: { discovery: Worker; sources?: Worker }) {
  const discovery = createCorpusTransport(input.discovery);
  const sources = input.sources ? createCorpusTransport(input.sources) : discovery;
  return { execute: discovery.execute, readExact: discovery.readExact, readSources: sources.readSources,
    readSourceReference: sources.readSourceReference, readAsset: sources.readAsset };
}
