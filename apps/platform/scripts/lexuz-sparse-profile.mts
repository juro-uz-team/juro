import { createInterface } from "node:readline";
import { prepareSparseProfile } from "../lib/legal-corpus/prepared-sparse-profile";

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  const { id, members, fields } = JSON.parse(line);
  process.stdout.write(JSON.stringify({ id, ...prepareSparseProfile(fields, members) }) + "\n");
}
