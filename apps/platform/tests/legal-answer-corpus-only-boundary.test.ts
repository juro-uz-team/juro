import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

test("signed, guest and saved-citation runtime excludes publisher preparation and retired chat execution", async () => {
  const result = await build({ entryPoints: ["lib/legal-answer-workflow/platform-entry.ts"], bundle: true,
    platform: "node", format: "esm", packages: "external", write: false, metafile: true, logLevel: "silent" });
  const prohibited = ["/lib/legal-chat/", ...["corpus-adapter", "official-document", "official-capture", "publisher-html",
    "publisher-edition", "official-pdf", "official-image", "inline-media", "provision-selection"]
    .map(name => `/legal-answer-workflow/${name}.ts`)];
  const inputs = Object.keys(result.metafile.inputs).map(path => `/${path.replaceAll("\\", "/")}`);
  assert.ok(inputs.some(path => path.endsWith("/legal-answer-workflow/prepared-stored-reader.ts")));
  assert.deepEqual(inputs.filter(path => prohibited.some(forbidden => path.includes(forbidden))), []);
});
