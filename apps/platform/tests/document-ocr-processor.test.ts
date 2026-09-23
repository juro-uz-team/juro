import type { DocumentConverter, ConversionInput } from "../lib/runtime/document-converter";
import assert from "node:assert/strict";
import test from "node:test";
import PizZip from "pizzip";
import {
  executeOcrProcessingJob,
  loadCompletedOcrExtraction,
  OcrProcessingError,
  scheduleOcrProcessing,
} from "../lib/document-analysis/ocr-processor";
import { localDocumentConversionFixture } from "./helpers/sqlite-d1";

const now = "2026-07-31T00:00:00.000Z";

class FakeR2Bucket {
  readonly objects = new Map<string, { bytes: Uint8Array; sha256: string }>();
  getCalls = 0;
  putCalls = 0;

  async seed(key: string, bytes: Uint8Array) {
    this.objects.set(key, { bytes: bytes.slice(), sha256: await sha256Hex(bytes) });
  }

  async head(key: string) {
    const value = this.objects.get(key);
    return value ? this.metadata(key, value) : null;
  }

  async get(key: string) {
    this.getCalls += 1;
    const value = this.objects.get(key);
    if (!value) return null;
    const bytes = value.bytes.slice();
    return {
      ...this.metadata(key, value),
      body: new Blob([bytes]).stream(),
      bodyUsed: false,
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
      async text() { return new TextDecoder().decode(bytes); },
      async json<T>() { return JSON.parse(new TextDecoder().decode(bytes)) as T; },
      async blob() { return new Blob([bytes]); },
    };
  }

  async put(key: string, value: unknown, options?: { onlyIf?: Headers; sha256?: string }) {
    this.putCalls += 1;
    if (options?.onlyIf?.get("if-none-match") === "*" && this.objects.has(key)) return null;
    if (!(value instanceof Uint8Array)) throw new TypeError("Expected Uint8Array derivative.");
    const bytes = value.slice();
    const sha256 = await sha256Hex(bytes);
    assert.equal(options?.sha256, sha256);
    const stored = { bytes, sha256 };
    this.objects.set(key, stored);
    return this.metadata(key, stored);
  }

  private metadata(key: string, value: { bytes: Uint8Array; sha256: string }) {
    return {
      key,
      version: "synthetic",
      size: value.bytes.byteLength,
      etag: value.sha256,
      httpEtag: `"${value.sha256}"`,
      uploaded: new Date(now),
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: {},
      range: undefined,
      checksums: { sha256: hexArrayBuffer(value.sha256) },
      storageClass: "Standard",
      ssecKeyMd5: undefined,
      writeHttpMetadata() {},
    };
  }
}

test("OCR queue stores a tenant-scoped derivative and chains analysis exactly once", async () => {
  const { sqlite, d1 } = localDocumentConversionFixture();
  const bucket = new FakeR2Bucket();
  try {
    const source = new TextEncoder().encode("synthetic scanned contract image");
    const sourceSha256 = await seedOcrAnalysis(sqlite, bucket, source);
    await scheduleOcrProcessing(d1, scheduleInput(sourceSha256));
    assert.deepEqual(
      { ...sqlite.prepare(
        "SELECT queue_binding AS queueBinding,job_type AS jobType,status FROM job_outbox WHERE job_type='ocr.process'",
      ).get() as object },
      { queueBinding: "OCR_PROCESSING_QUEUE", jobType: "ocr.process", status: "pending" },
    );

    let aiCalls = 0;
    const ai = {
      async toMarkdown(document: ConversionInput) {
        aiCalls += 1;
        assert.equal(document.name, "document.png");
        assert.equal(document.blob.type, "image/png");
        return {
          id: "conversion-a",
          name: document.name,
          mimeType: document.blob.type,
          format: "markdown" as const,
          tokens: 14,
          data: "# Договор\n\nСрок исполнения — 10 дней.",
        };
      },
    } as unknown as DocumentConverter;
    const env = { DB: d1, BUCKET: bucket as unknown as R2Bucket, OCR: ai };
    assert.equal((await executeOcrProcessingJob(env, "analysis-a", "workspace-a")).status, "completed");
    assert.equal((await executeOcrProcessingJob(env, "analysis-a", "workspace-a")).status, "already_completed");
    assert.equal(aiCalls, 1);
    assert.equal(bucket.putCalls, 1);

    const state = sqlite.prepare(
      `SELECT a.status AS analysisStatus,x.status AS extractionStatus,x.r2_key AS r2Key,
       x.text_sha256 AS textSha256,x.error_code AS errorCode
       FROM document_analyses a JOIN file_extractions x ON x.analysis_id=a.id WHERE a.id='analysis-a'`,
    ).get() as { analysisStatus: string; extractionStatus: string; r2Key: string; textSha256: string; errorCode: string | null };
    assert.equal(state.analysisStatus, "ready");
    assert.equal(state.extractionStatus, "completed");
    assert.match(state.r2Key, /^derivatives\/workspace-a\/analysis-a\//);
    assert.match(state.textSha256, /^[a-f0-9]{64}$/);
    assert.equal(state.errorCode, null);
    assert.equal(
      Number((sqlite.prepare("SELECT count(*) AS count FROM job_outbox WHERE job_type='document.analyze'").get() as { count: number }).count),
      1,
    );
    const extracted = await loadCompletedOcrExtraction(env, {
      analysisId: "analysis-a",
      workspaceId: "workspace-a",
      fileId: "file-a",
      sourceSha256,
    });
    assert.equal(extracted?.detectedLanguage, "ru");
    assert.match(extracted?.text ?? "", /10 дней/);
  } finally {
    sqlite.close();
  }
});

test("OCR queue converts every verified ZIP member in one bounded provider batch", async () => {
  const { sqlite, d1 } = localDocumentConversionFixture();
  const bucket = new FakeR2Bucket();
  try {
    const source = packageBytes({
      "01-contract.docx": docxBytes(["ДОГОВОР", "Срок исполнения — 10 дней."]),
      "02-ilova.png": Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    const sourceSha256 = await seedOcrAnalysis(sqlite, bucket, source, {
      fileName: "documents.zip",
      mimeType: "application/zip",
    });
    await scheduleOcrProcessing(d1, scheduleInput(sourceSha256));

    let aiCalls = 0;
    const ai = {
      async toMarkdown(documents: ConversionInput | ConversionInput[]) {
        aiCalls += 1;
        assert.ok(Array.isArray(documents));
        assert.deepEqual(documents.map((document) => document.name), ["document-01.docx", "document-02.png"]);
        assert.deepEqual(documents.map((document) => document.blob.type), [
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "image/png",
        ]);
        return documents.map((document, index) => ({
          id: `conversion-${index + 1}`,
          name: document.name,
          mimeType: document.blob.type,
          format: "markdown" as const,
          tokens: 10 + index,
          data: index === 0
            ? "# Договор\n\nСтороны подтверждают обязательства. Заказчик оплачивает услуги, а исполнитель передаёт результат в срок 10 дней."
            : "# ILOVA\n\nBuyurtmachi ilovani yozma shaklda qabul qiladi.",
        })).reverse();
      },
    } as unknown as DocumentConverter;
    const env = { DB: d1, BUCKET: bucket as unknown as R2Bucket, OCR: ai };
    assert.equal((await executeOcrProcessingJob(env, "analysis-a", "workspace-a")).status, "completed");
    assert.equal(aiCalls, 1);
    assert.equal(bucket.putCalls, 1);

    const extracted = await loadCompletedOcrExtraction(env, {
      analysisId: "analysis-a",
      workspaceId: "workspace-a",
      fileId: "file-a",
      sourceSha256,
    });
    assert.equal(extracted?.mimeType, "application/zip");
    assert.equal(extracted?.detectedLanguage, "mixed");
    assert.equal(extracted?.textQuality, "limited");
    assert.equal(
      extracted?.warningCode,
      "PACKAGE_MULTI_DOCUMENT,LOCAL_DOCUMENT_CONVERSION_USED,AI_OCR_REVIEW_REQUIRED",
    );
    assert.match(extracted?.text ?? "", /ФАЙЛ: "01-contract\.docx"/);
    assert.match(extracted?.text ?? "", /ФАЙЛ: "02-ilova\.png"/);
    assert.ok(extracted?.sections.some((section) => section.heading?.startsWith("02-ilova.png")));
    assert.equal(extracted?.packageContext?.primaryMemberId, "package-member-01");
    assert.deepEqual(extracted?.packageContext?.members.map(({ role }) => role), ["primary", "annex"]);
    assert.ok(extracted?.packageContext?.relationships.some((relationship) =>
      relationship.fromMemberId === "package-member-02"
      && relationship.toMemberId === "package-member-01"
      && relationship.kind === "annex_to"));
    assert.equal(
      (sqlite.prepare("SELECT token_estimate AS tokenEstimate FROM file_extractions").get() as { tokenEstimate: number }).tokenEstimate,
      21,
    );
  } finally {
    sqlite.close();
  }
});

test("package OCR rejects duplicate or missing provider member identities without persisting a derivative", async () => {
  const { sqlite, d1 } = localDocumentConversionFixture();
  const bucket = new FakeR2Bucket();
  try {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const source = packageBytes({ "01.png": png, "02.png": png });
    const sourceSha256 = await seedOcrAnalysis(sqlite, bucket, source, {
      fileName: "documents.zip",
      mimeType: "application/zip",
    });
    await scheduleOcrProcessing(d1, scheduleInput(sourceSha256));
    await assert.rejects(
      executeOcrProcessingJob({
        DB: d1,
        BUCKET: bucket as unknown as R2Bucket,
        OCR: {
          async toMarkdown(documents: ConversionInput | ConversionInput[]) {
            assert.ok(Array.isArray(documents));
            return documents.map(() => ({
              id: crypto.randomUUID(),
              name: "document-01.png",
              mimeType: "image/png",
              format: "markdown" as const,
              tokens: 2,
              data: "Readable synthetic scan.",
            }));
          },
        } as unknown as DocumentConverter,
      }, "analysis-a", "workspace-a"),
      (error: unknown) => error instanceof OcrProcessingError
        && error.code === "OCR_PROVIDER_REJECTED" && !error.retryable,
    );
    assert.equal(bucket.putCalls, 0);
    assert.deepEqual(
      { ...sqlite.prepare(
        `SELECT a.status AS analysisStatus,x.status AS extractionStatus,x.error_code AS errorCode
         FROM document_analyses a JOIN file_extractions x ON x.analysis_id=a.id WHERE a.id='analysis-a'`,
      ).get() as object },
      {
        analysisStatus: "failed",
        extractionStatus: "failed",
        errorCode: "OCR_PROVIDER_REJECTED",
      },
    );
    assert.equal(
      Number((sqlite.prepare("SELECT count(*) AS count FROM job_outbox WHERE job_type='document.analyze'").get() as { count: number }).count),
      0,
    );
  } finally {
    sqlite.close();
  }
});

test("OCR queue denies cross-tenant identifiers before object or converter access", async () => {
  const { sqlite, d1 } = localDocumentConversionFixture();
  const bucket = new FakeR2Bucket();
  try {
    const source = new TextEncoder().encode("synthetic image");
    const sourceSha256 = await seedOcrAnalysis(sqlite, bucket, source);
    await scheduleOcrProcessing(d1, scheduleInput(sourceSha256));
    let aiCalls = 0;
    await assert.rejects(
      executeOcrProcessingJob({
        DB: d1,
        BUCKET: bucket as unknown as R2Bucket,
        OCR: { async toMarkdown() { aiCalls += 1; throw new Error("must not run"); } } as unknown as DocumentConverter,
      }, "analysis-a", "workspace-b"),
      (error: unknown) => error instanceof OcrProcessingError && error.code === "OCR_ANALYSIS_NOT_FOUND",
    );
    assert.equal(bucket.getCalls, 0);
    assert.equal(aiCalls, 0);
  } finally {
    sqlite.close();
  }
});

test("missing local converter binding is retryable and never creates false success", async () => {
  const { sqlite, d1 } = localDocumentConversionFixture();
  const bucket = new FakeR2Bucket();
  try {
    const source = new TextEncoder().encode("synthetic image");
    const sourceSha256 = await seedOcrAnalysis(sqlite, bucket, source);
    await scheduleOcrProcessing(d1, scheduleInput(sourceSha256));
    await assert.rejects(
      executeOcrProcessingJob({ DB: d1, BUCKET: bucket as unknown as R2Bucket }, "analysis-a", "workspace-a"),
      (error: unknown) => error instanceof OcrProcessingError
        && error.code === "OCR_PROVIDER_UNAVAILABLE" && error.retryable,
    );
    const state = sqlite.prepare(
      `SELECT a.status AS analysisStatus,x.status AS extractionStatus,x.r2_key AS r2Key
       FROM document_analyses a JOIN file_extractions x ON x.analysis_id=a.id WHERE a.id='analysis-a'`,
    ).get() as { analysisStatus: string; extractionStatus: string; r2Key: string | null };
    assert.deepEqual({ ...state }, { analysisStatus: "awaiting_ocr", extractionStatus: "retrying", r2Key: null });
    assert.equal(bucket.putCalls, 0);
  } finally {
    sqlite.close();
  }
});

test("source checksum mismatch fails closed before local converter", async () => {
  const { sqlite, d1 } = localDocumentConversionFixture();
  const bucket = new FakeR2Bucket();
  try {
    const source = new TextEncoder().encode("original source");
    const sourceSha256 = await seedOcrAnalysis(sqlite, bucket, source);
    await bucket.seed("safe/workspace-a/analysis-a/file-a", new TextEncoder().encode("tampered source"));
    await scheduleOcrProcessing(d1, scheduleInput(sourceSha256));
    let aiCalls = 0;
    await assert.rejects(
      executeOcrProcessingJob({
        DB: d1,
        BUCKET: bucket as unknown as R2Bucket,
        OCR: { async toMarkdown() { aiCalls += 1; throw new Error("must not run"); } } as unknown as DocumentConverter,
      }, "analysis-a", "workspace-a"),
      (error: unknown) => error instanceof OcrProcessingError && error.code === "OCR_INTEGRITY_FAILED",
    );
    assert.equal(aiCalls, 0);
    assert.deepEqual(
      { ...sqlite.prepare(
        `SELECT a.status AS analysisStatus,x.status AS extractionStatus
         FROM document_analyses a JOIN file_extractions x ON x.analysis_id=a.id WHERE a.id='analysis-a'`,
      ).get() as object },
      { analysisStatus: "failed", extractionStatus: "failed" },
    );
  } finally {
    sqlite.close();
  }
});

test("corrupt PDF structure fails closed before local converter", async () => {
  const { sqlite, d1 } = localDocumentConversionFixture();
  const bucket = new FakeR2Bucket();
  try {
    const source = new TextEncoder().encode("%PDF-1.7 not a complete document");
    const sourceSha256 = await seedOcrAnalysis(sqlite, bucket, source, {
      fileName: "contract.pdf",
      mimeType: "application/pdf",
    });
    await scheduleOcrProcessing(d1, scheduleInput(sourceSha256));
    let aiCalls = 0;
    await assert.rejects(
      executeOcrProcessingJob({
        DB: d1,
        BUCKET: bucket as unknown as R2Bucket,
        OCR: { async toMarkdown() { aiCalls += 1; throw new Error("must not run"); } } as unknown as DocumentConverter,
      }, "analysis-a", "workspace-a"),
      (error: unknown) => error instanceof OcrProcessingError && error.code === "OCR_PDF_CORRUPT",
    );
    assert.equal(aiCalls, 0);
    assert.deepEqual(
      { ...sqlite.prepare(
        `SELECT a.status AS analysisStatus,a.error_code AS analysisError,x.status AS extractionStatus,x.error_code AS extractionError
         FROM document_analyses a JOIN file_extractions x ON x.analysis_id=a.id WHERE a.id='analysis-a'`,
      ).get() as object },
      {
        analysisStatus: "failed",
        analysisError: "OCR_PDF_CORRUPT",
        extractionStatus: "failed",
        extractionError: "OCR_PDF_CORRUPT",
      },
    );
  } finally {
    sqlite.close();
  }
});

async function seedOcrAnalysis(
  sqlite: ReturnType<typeof localDocumentConversionFixture>["sqlite"],
  bucket: FakeR2Bucket,
  source: Uint8Array,
  options: { fileName?: string; mimeType?: string } = {},
): Promise<string> {
  const sourceSha256 = await sha256Hex(source);
  const fileName = options.fileName ?? "scan.png";
  const mimeType = options.mimeType ?? "image/png";
  sqlite.prepare(
    "INSERT INTO user_profiles(id,email,created_at,updated_at) VALUES (?,?,?,?),(?,?,?,?)",
  ).run("user-a", "a@example.test", now, now, "user-b", "b@example.test", now, now);
  sqlite.prepare(
    "INSERT INTO workspaces(id,type,name,created_at,updated_at) VALUES (?,?,?,?,?),(?,?,?,?,?)",
  ).run("workspace-a", "individual", "A", now, now, "workspace-b", "individual", "B", now, now);
  sqlite.prepare(
    `INSERT INTO document_files
     (id,workspace_id,owner_user_id,kind,r2_key,file_name,mime_type,size_bytes,sha256,created_at,updated_at)
     VALUES ('file-a','workspace-a','user-a','analysis_safe','safe/workspace-a/analysis-a/file-a',
      ?,?,?,?,?,?)`,
  ).run(fileName, mimeType, source.byteLength, sourceSha256, now, now);
  sqlite.prepare(
    `INSERT INTO document_analyses
     (id,workspace_id,owner_user_id,uploaded_file_id,status,summary_json,error_code,consent_version,created_at,updated_at)
     VALUES ('analysis-a','workspace-a','user-a','file-a','processing','{"mode":"full","locale":"ru"}',NULL,'2026-07-31',?,?)`,
  ).run(now, now);
  await bucket.seed("safe/workspace-a/analysis-a/file-a", source);
  return sourceSha256;
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function docxBytes(paragraphs: string[]): Uint8Array {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file("_rels/.rels", "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"/>");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((paragraph) => `<w:p><w:r><w:t>${xmlEscape(paragraph)}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`,
  );
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}

function packageBytes(files: Record<string, Uint8Array>): Uint8Array {
  const zip = new PizZip();
  for (const [name, bytes] of Object.entries(files)) zip.file(name, bytes, { binary: true });
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}

function scheduleInput(sourceSha256: string) {
  return {
    analysisId: "analysis-a",
    fileId: "file-a",
    workspaceId: "workspace-a",
    ownerUserId: "user-a",
    sourceSha256,
  };
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(value).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexArrayBuffer(value: string): ArrayBuffer {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
}
