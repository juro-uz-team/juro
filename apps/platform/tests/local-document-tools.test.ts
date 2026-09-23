import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { localDocumentConverter } from "../lib/runtime/document-converter";
import { localMalwareScanner } from "../lib/runtime/scanner";

test("local PDF conversion preserves readable text without any external provider", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("The agreement requires written notice thirty days before termination.");
  const bytes = await pdf.save();
  const result = await localDocumentConverter.toMarkdown({ name: "document.pdf", blob: new Blob([Uint8Array.from(bytes).buffer], { type: "application/pdf" }) });
  assert.match(result.data, /written notice thirty days/);
  assert.equal(result.name, "document.pdf");
  assert.ok(result.tokens > 0);
});

test("scanner rejects an incorrect digest before accepting document bytes", async () => {
  const response = await localMalwareScanner.fetch("http://local/v1/scan", { method: "POST", body: "test",
    headers: { "content-length": "4", "x-content-sha256": "0".repeat(64) } });
  assert.equal(response.status, 400);
});

test("local ClamAV reports clean text and the standard harmless EICAR test signature", async () => {
  for (const [text, verdict] of [["A clean legal document.", "clean"], ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*", "infected"]]) {
    const response = await localMalwareScanner.fetch("http://local/v1/scan", { method: "POST", body: text,
      headers: { "content-length": String(Buffer.byteLength(text)), "x-content-sha256": createHash("sha256").update(text).digest("hex") } });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { verdict: string }).verdict, verdict);
  }
});
