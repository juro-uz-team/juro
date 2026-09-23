import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  canonicalPublicUrl,
  fetchPublicDocumentForAnalysis,
  isPublicIpAddress,
  parsePublicDocumentUrlIntent,
  PublicDocumentUrlError,
} from "../lib/document-analysis/url-import";
import {
  publicDocumentUrlImportDisabledMessage,
  publicDocumentUrlImportEnabled,
} from "../lib/document-analysis/public-url-import-feature";

test("public URL import feature defaults fail closed and localizes its safe unavailable state", () => {
  assert.equal(publicDocumentUrlImportEnabled(undefined), false);
  assert.equal(publicDocumentUrlImportEnabled("false"), false);
  assert.equal(publicDocumentUrlImportEnabled("TRUE"), false);
  assert.equal(publicDocumentUrlImportEnabled("true"), true);
  assert.equal(publicDocumentUrlImportDisabledMessage("ru"), "Импорт по публичной ссылке временно недоступен. Загрузите файл с устройства.");
  assert.equal(publicDocumentUrlImportDisabledMessage("uz"), "Ommaviy havola orqali import vaqtincha mavjud emas. Faylni qurilmadan yuklang.");
});

test("public URL contract accepts only credential-free HTTPS hostnames", () => {
  assert.equal(parsePublicDocumentUrlIntent({ url: "https://docs.example.uz/a.pdf#page=2", locale: "ru", consent: true }).url, "https://docs.example.uz/a.pdf");
  for (const value of [
    "http://docs.example.uz/a.pdf",
    "https://user:password@docs.example.uz/a.pdf",
    "https://docs.example.uz/a.pdf?access_token=secret",
    "https://docs.example.uz/a.pdf?X-Amz-Signature=secret",
    "https://localhost/a.pdf",
    "https://metadata.google.internal/a.pdf",
    "https://127.0.0.1/a.pdf",
    "https://[::1]/a.pdf",
    "https://[::ffff:127.0.0.1]/a.pdf",
    "file:///etc/passwd",
  ]) assert.throws(() => canonicalPublicUrl(value), PublicDocumentUrlError);
});

test("public IP classification blocks private, metadata, documentation and transition ranges", () => {
  for (const address of ["10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "198.18.0.1", "203.0.113.8", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "2002::1"]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress("1.1.1.1"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
  assert.equal(isPublicIpAddress("not-an-ip"), false);
});

test("URL fetch is manually redirected, DNS rechecked, bounded and streamed to private R2", async () => {
  const bytes = new TextEncoder().encode("%PDF-1.7\nJURO");
  const bucket = new MemoryBucket();
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    requests.push({ url, init });
    if (url.endsWith("/start")) return new Response(null, { status: 302, headers: { location: "/contract.pdf" } });
    return new Response(bytes, { status: 200, headers: { "content-type": "application/pdf", "content-length": String(bytes.byteLength) } });
  };
  const result = await fetchPublicDocumentForAnalysis({
    bucket: bucket.value,
    workspaceId: "workspace-a",
    userId: "user-a",
    url: "https://files.example.uz/start",
    fetcher,
    resolver: async () => ["1.1.1.1", "2606:4700:4700::1111"],
  });
  assert.equal(result.fileName, "contract.pdf");
  assert.equal(result.mimeType, "application/pdf");
  assert.equal(result.sizeBytes, bytes.byteLength);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.match(result.temporaryKey, /^url-import-v1\/workspace-a\//);
  assert.doesNotMatch(result.temporaryKey, /contract|example/i);
  assert.equal(requests.length, 2);
  assert.equal(requests.every((item) => item.init?.redirect === "manual" && item.init.credentials === "omit"), true);
  assert.equal(requests.some((item) => new Headers(item.init?.headers).has("authorization")), false);
  assert.equal(bucket.objects.has(result.temporaryKey), true);
});

test("URL fetch fails closed on DNS rebinding, missing length, compression and unsupported MIME", async () => {
  const bytes = new TextEncoder().encode("%PDF-1.7");
  let lookup = 0;
  await assert.rejects(fetchPublicDocumentForAnalysis({
    bucket: new MemoryBucket().value,
    workspaceId: "workspace-a",
    userId: "user-a",
    url: "https://files.example.uz/a.pdf",
    fetcher: async () => new Response(bytes, { headers: { "content-type": "application/pdf", "content-length": String(bytes.byteLength) } }),
    resolver: async () => (++lookup === 1 ? ["1.1.1.1"] : ["10.0.0.1"]),
  }), /публичной сети/i);
  const headerSets: HeadersInit[] = [
    { "content-type": "application/pdf" },
    { "content-type": "text/html", "content-length": "12" },
    { "content-type": "application/pdf", "content-length": "12", "content-encoding": "gzip" },
  ];
  for (const headers of headerSets) {
    await assert.rejects(fetchPublicDocumentForAnalysis({
      bucket: new MemoryBucket().value,
      workspaceId: "workspace-a",
      userId: "user-a",
      url: "https://files.example.uz/a.pdf",
      fetcher: async () => new Response(bytes, { headers }),
      resolver: async () => ["1.1.1.1"],
    }), PublicDocumentUrlError);
  }
});

test("URL import route and RU/UZ/EN UI expose no credential forwarding or fake success", async () => {
  const [route, ui, copy, config] = await Promise.all([
    readFile(new URL("../app/api/platform/document-analysis/url-import/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/DocumentReviewClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/document-review-localization.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/runtime/self-hosted.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /assertSafeWrite/);
  assert.match(route, /requireApiUser/);
  assert.match(route, /PUBLIC_DOCUMENT_URL_IMPORT_DISABLED/);
  assert.match(route, /publicDocumentUrlImportDisabledMessage\(operationalLocaleFromRequest\(request\)\)/);
  assert.ok(route.indexOf("if (!publicDocumentUrlImportEnabled") < route.indexOf("const parsed = await parseJsonRequest"));
  assert.match(route, /workspaceForContentEditor/);
  assert.match(route, /parseJsonRequest\(request, publicDocumentUrlIntentSchema, 4_096\)/);
  assert.match(route, /ANALYSIS_QUEUED/);
  assert.doesNotMatch(route, /requireQuarantineR2|quarantined|MALWARE_SCAN|FILE_SCAN_/);
  assert.match(ui, /publicUrlImportEnabled \? <form className="review-url-import"/);
  assert.match(ui, /review-url-import-disabled/);
  assert.match(copy, /Контролируемая beta-функция временно недоступна/);
  assert.match(copy, /Nazorat qilinadigan beta-funksiya vaqtincha mavjud emas/);
  assert.match(copy, /This controlled beta feature is temporarily unavailable/);
  assert.match(copy, /Импортировать публичную ссылку/);
  assert.match(copy, /Ommaviy havolani import qilish/);
  assert.match(copy, /Import a public link/);
  assert.match(ui, /type="url"/);
  assert.match(ui, /uploadDocumentForAnalysis\(file, locale, setUploadProgress, uploadCaseId \|\| null, analysisLocale\)/);
  assert.match(ui, /!publicUrlImportEnabled \|\| !publicUrl\.trim\(\)/);
  assert.match(await readFile(new URL("../lib/document-analysis/client-upload.ts", import.meta.url), "utf8"), /"x-juro-locale": locale/);

  assert.match(config, /PUBLIC_DOCUMENT_URL_IMPORT_ENABLED: "false"/);
});

class MemoryBucket {
  readonly objects = new Map<string, Uint8Array>();
  readonly value = {
    put: async (key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob) => {
      const bytes = new Uint8Array(await new Response(value as BodyInit | null).arrayBuffer());
      this.objects.set(key, bytes);
      const sha256 = await crypto.subtle.digest("SHA-256", bytes);
      return { key, size: bytes.byteLength, checksums: { sha256 } } as R2Object;
    },
    delete: async (key: string) => { this.objects.delete(key); },
  } as unknown as R2Bucket;
}
