import type { PlatformLocale } from "../platform/routing";
import { defaultDocumentAnalysisLocale, type SupportedDocumentAnalysisLocale } from "./language";

export type SecureDocumentUploadResult = {
  analysis: {
    id: string;
    fileId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    status: string;
    errorCode?: string | null;
    caseId?: string | null;
  };
  message?: string;
  code?: string;
};

export type SecureDocumentUploadProgress = {
  phase: "hashing" | "uploading" | "finalizing";
  loaded: number;
  total: number;
};

export async function uploadDocumentForAnalysis(
  file: File,
  locale: PlatformLocale,
  onProgress?: (progress: SecureDocumentUploadProgress) => void,
  caseId?: string | null,
  analysisLocale: SupportedDocumentAnalysisLocale = defaultDocumentAnalysisLocale(locale),
  workspaceId?: string,
): Promise<SecureDocumentUploadResult> {
  if (file.size <= 0 || file.size > 50 * 1024 * 1024) {
    throw new Error(locale === "ru"
      ? "Размер файла должен быть от 1 байта до 50 МБ."
      : locale === "uz"
        ? "Fayl hajmi 1 baytdan 50 MB gacha bo‘lishi kerak."
        : "The file size must be between 1 byte and 50 MB.");
  }
  onProgress?.({ phase: "hashing", loaded: 0, total: file.size });
  const sha256 = await fileSha256(file);
  const idempotencyKey = crypto.randomUUID();
  const init = await jsonRequest<SecureDocumentUploadResult>(
    "/api/platform/document-analysis/uploads",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        ...(workspaceId ? {"x-juro-workspace-id":workspaceId} : {}),
        "x-juro-csrf": "1",
        "x-juro-locale": locale,
      },
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        sha256,
        locale: analysisLocale,
        mode: "quick",
        caseId: caseId || null,
        consent: true,
      }),
    },
    [],
    locale,
  );
  const analysisId = init.analysis.id;
  await putFileWithProgress(
    `/api/platform/document-analysis/uploads/${encodeURIComponent(analysisId)}`,
    file,
    sha256,
    locale,
    (loaded, total) => onProgress?.({ phase: "uploading", loaded, total }),
    workspaceId,
  );
  onProgress?.({ phase: "finalizing", loaded: file.size, total: file.size });
  return jsonRequest<SecureDocumentUploadResult>(
    `/api/platform/document-analysis/uploads/${encodeURIComponent(analysisId)}/finalize`,
    { method: "POST", headers: { "x-juro-csrf": "1", ...(workspaceId ? {"x-juro-workspace-id":workspaceId} : {}) } },
    [202],
    locale,
  );
}

export async function importDocumentUrlForAnalysis(
  url: string,
  locale: PlatformLocale,
  caseId?: string | null,
  analysisLocale: SupportedDocumentAnalysisLocale = defaultDocumentAnalysisLocale(locale),
): Promise<SecureDocumentUploadResult> {
  return jsonRequest<SecureDocumentUploadResult>(
    "/api/platform/document-analysis/url-import",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `url-import-${crypto.randomUUID()}`,
        "x-juro-csrf": "1",
        "x-juro-locale": locale,
      },
      body: JSON.stringify({ url: url.trim(), locale: analysisLocale, mode: "quick", caseId: caseId || null, consent: true }),
    },
    [202],
    locale,
  );
}

function putFileWithProgress(
  url: string,
  file: File,
  sha256: string,
  locale: PlatformLocale,
  onProgress: (loaded: number, total: number) => void,
  workspaceId?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    if(workspaceId)request.setRequestHeader("x-juro-workspace-id",workspaceId);
    request.setRequestHeader("content-type", file.type);
    request.setRequestHeader("x-juro-csrf", "1");
    request.setRequestHeader("x-juro-file-sha256", sha256);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    });
    const fallback = uploadFailure(locale);
    request.addEventListener("error", () => reject(new Error(fallback)));
    request.addEventListener("abort", () => reject(new Error(fallback)));
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) return resolve();
      try {
        const body = JSON.parse(request.responseText) as { error?: string };
        reject(new Error(locale === "en" ? fallback : body.error || fallback));
      } catch {
        reject(new Error(fallback));
      }
    });
    request.send(file);
  });
}

async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function uploadFailure(locale: PlatformLocale): string {
  return locale === "ru"
    ? "Не удалось обработать файл."
    : locale === "uz"
      ? "Faylni qayta ishlash imkoni bo‘lmadi."
      : "The file could not be processed.";
}

async function jsonRequest<T>(
  url: string,
  init: RequestInit,
  acceptedStatuses: number[] = [],
  locale: PlatformLocale = "ru",
): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json() as T & { error?: string };
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    const fallback = uploadFailure(locale);
    throw new Error(locale === "en" ? fallback : body.error || fallback);
  }
  return body;
}
