import {
  verifyArchiveBytes,
  type ArchiveInspectionOptions,
} from "../../document-analysis/archive-inspector";

export const MAX_FILE_SIZE = 25_000_000;
export const DOCX_UPLOAD_LIMITS = {
  timeoutMs: 8_000,
  maxEntries: 500,
  maxUncompressedBytes: 25 * 1024 * 1024,
  maxExpansionRatio: 40,
} as const satisfies ArchiveInspectionOptions;
export const ALLOWED_ATTACHMENT_TYPES = new Map([
  ["application/pdf", ["pdf"]],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ["docx"]],
  ["image/jpeg", ["jpg", "jpeg"]],
  ["image/png", ["png"]],
]);

export function sanitizeFileName(input: string): string {
  const normalized = input.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim();
  const safe = normalized.replace(/^\.+/, "").slice(0, 180);
  return safe || "document";
}

export function validateUpload(file: File, signedPdfOnly = false): string | null {
  if (file.size <= 0) return "Файл пуст.";
  if (file.size > MAX_FILE_SIZE) return "Размер файла превышает 25 МБ.";
  const extension = file.name.split(".").pop()?.toLocaleLowerCase() ?? "";
  const allowed = ALLOWED_ATTACHMENT_TYPES.get(file.type);
  if (!allowed || !allowed.includes(extension)) return "Формат, MIME-тип или расширение файла не поддерживается.";
  if (signedPdfOnly && (file.type !== "application/pdf" || extension !== "pdf")) return "Подписанная версия должна быть PDF-файлом.";
  return null;
}

export type UploadInspectionCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE"
  | "CONTENT_TYPE_MISMATCH"
  | "CORRUPT_DOCX";

export type UploadInspection = {
  code: UploadInspectionCode;
  message: string;
};

export async function validateUploadBytes(
  file: File,
  bytes: Uint8Array,
  docxLimits: ArchiveInspectionOptions = DOCX_UPLOAD_LIMITS,
): Promise<UploadInspection | null> {
  const basicError = validateUpload(file);
  if (basicError) {
    const code: UploadInspectionCode = file.size <= 0
      ? "EMPTY_FILE"
      : file.size > MAX_FILE_SIZE
        ? "FILE_TOO_LARGE"
        : "UNSUPPORTED_FILE";
    return { code, message: basicError };
  }
  if (file.type === "application/pdf") {
    const signature = new TextDecoder().decode(bytes.slice(0, 5));
    if (signature !== "%PDF-") return { code: "CONTENT_TYPE_MISMATCH", message: "Содержимое файла не соответствует формату PDF." };
  } else if (file.type === "image/png") {
    const valid = bytes.length >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
    if (!valid) return { code: "CONTENT_TYPE_MISMATCH", message: "Содержимое файла не соответствует формату PNG." };
  } else if (file.type === "image/jpeg") {
    const valid = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
    if (!valid) return { code: "CONTENT_TYPE_MISMATCH", message: "Содержимое файла не соответствует формату JPEG." };
  } else if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      return { code: "CONTENT_TYPE_MISMATCH", message: "Содержимое файла не соответствует формату DOCX." };
    }
    await verifyArchiveBytes(bytes, file.type, docxLimits);
  }
  return null;
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digestInput = new Uint8Array(view.byteLength);
  digestInput.set(view);
  const digest = await crypto.subtle.digest("SHA-256", digestInput);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
