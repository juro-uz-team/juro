import type { ModelOperation, OfficialProvision } from "./contracts";
import type { ProvisionObjects } from "./evidence";
import { withinSignal } from "./lifetime";
import { SourceFileContextLimit, sourceFileContextLimits } from "./source-file-contract";

/** Read the prepared original for visual interpretation without re-certifying corpus integrity. */
export async function sourceFilesForEvidence(evidence: readonly OfficialProvision[], objects: ProvisionObjects,
  signal: AbortSignal): Promise<NonNullable<ModelOperation["sourceFiles"]>> {
  signal.throwIfAborted();
  const selected = evidence.filter(item => item.sourceFile);
  if (selected.length > sourceFileContextLimits.count
    || selected.reduce((sum, item) => sum + item.sourceFile!.byteCount, 0) > sourceFileContextLimits.bytes) {
    throw new SourceFileContextLimit();
  }
  const files: NonNullable<ModelOperation["sourceFiles"]>[number][] = [];
  for (const item of selected) {
    const expected = item.sourceFile!;
    const raw = await withinSignal(signal, () => objects.get(expected.objectKey, signal));
    if (!raw) throw new Error("SOURCE_FILE_UNAVAILABLE");
    files.push({ sourceId: item.identity, sha256: expected.sha256, bytes: new Uint8Array(raw) });
  }
  signal.throwIfAborted();
  return files;
}
