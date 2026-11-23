import { createInterface } from "node:readline";
import { z } from "zod";
import { requestDocumentEmbeddings } from "../lib/legal-corpus/document-embedding-build";

const group = z.array(z.string().min(1).max(1_048_576)).min(1).max(32);
const packet = z.object({
  data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: z.array(z.number().finite()).length(3072) })),
});
const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error("MAINTENANCE_EMBEDDING_PROVIDER_UNAVAILABLE");

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  try {
    const inputs = group.parse(JSON.parse(line));
    const response = await requestDocumentEmbeddings(key, {
      model: "text-embedding-3-large", dimensions: 3072, encoding_format: "float", input: inputs,
    });
    if (!response.ok) {
      await response.body?.cancel();
      process.stdout.write(JSON.stringify({ rejected: response.status }) + "\n");
      continue;
    }
    const rows = packet.parse(await response.json()).data.sort((first, second) => first.index - second.index);
    if (rows.length !== inputs.length || rows.some((row, index) => row.index !== index)) {
      throw new Error("MAINTENANCE_EMBEDDING_RESPONSE_INVALID");
    }
    process.stdout.write(JSON.stringify({ vectors: rows.map(row => row.embedding) }) + "\n");
  } catch {
    process.stdout.write('{"unresolved":true}\n');
  }
}
