import type { ModelOperation } from "./contracts";
import { sourceFileContextLimits } from "./source-file-contract";

/** Inline files avoid hosted uploads. Neither base64 size nor OCR text estimates image tokens. */
export function providerSourceFiles(operation: ModelOperation) {
  const files = operation.sourceFiles ?? [];
  if (!files.length) return [];
  if (!["assess", "write"].includes(operation.stage) || files.length > sourceFileContextLimits.count) throw new Error("PROVIDER_FILE_INPUT");
  const ids = new Set<string>();
  let total = 0;
  return files.flatMap(file => {
    if (typeof file.sourceId !== "string" || !file.sourceId.length || file.sourceId.length > 240
      || /[\r\n\u0000-\u001f]/u.test(file.sourceId) || ids.has(file.sourceId)
      || !/^[a-f0-9]{64}$/u.test(file.sha256) || !(file.bytes instanceof Uint8Array)
      || file.bytes.byteLength < 5 || file.bytes.byteLength > 16 * 1024 * 1024) throw new Error("PROVIDER_FILE_INPUT");
    ids.add(file.sourceId);
    total += file.bytes.byteLength;
    const bytes = Buffer.from(file.bytes);
    if (total > sourceFileContextLimits.bytes || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("PROVIDER_FILE_INPUT");
    return [{ type: "input_text", text: `Official source attachment: ${file.sourceId}` },
      { type: "input_file", filename: `${file.sha256}.pdf`, detail: "high",
        file_data: `data:application/pdf;base64,${bytes.toString("base64")}` }];
  });
}
