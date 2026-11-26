import { ApiAuthError } from "./api";
import { IdentityProtectionError } from "../../auth/identity-protection";
import { ServiceUnavailableError } from "../storage/runtime";
import { DocumentVersionError } from "../document-versions";
import { subscriptionFailure } from "../../billing/usage";

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function apiError(error: unknown): Response {
  const subscription = subscriptionFailure(error);
  if (subscription) return jsonResponse({ code: subscription.code }, { status: subscription.status });
  if (error instanceof ApiAuthError) {
    return jsonResponse({
      error: error.message,
      code: error.status === 403 ? "FORBIDDEN" : "UNAUTHORIZED",
    }, { status: error.status });
  }
  if (error instanceof ServiceUnavailableError) {
    return jsonResponse({ error: error.message, code: error.code }, { status: 503 });
  }
  if (error instanceof DocumentVersionError) {
    const messages: Record<DocumentVersionError["code"], string> = {
      DOCUMENT_NOT_FOUND: "Документ не найден.",
      DOCUMENT_ARCHIVED: "Сначала восстановите документ из архива.",
      REVISION_CONFLICT: "Документ изменён в другой вкладке. Обновите страницу.",
      IDEMPOTENCY_CONFLICT: "Повторный запрос не совпадает с исходной операцией.",
      VERSION_NOT_FOUND: "Версия документа не найдена.",
      VERSION_NOT_READY: "Версия документа ещё не готова.",
      VERSION_OBJECT_INVALID: "Снимок версии повреждён или не прошёл проверку.",
      VERSION_STORAGE_FAILED: "Хранилище версий временно недоступно. Изменение не применено.",
    };
    return jsonResponse({ error: messages[error.code], code: error.code }, { status: error.status });
  }
  if (error instanceof IdentityProtectionError) {
    return jsonResponse({
      error: "Защищённое хранилище идентификационных данных временно недоступно.",
      code: "IDENTITY_PROTECTION_UNAVAILABLE",
    }, { status: 503 });
  }
  if (error instanceof SyntaxError) {
    return jsonResponse({ error: "Некорректный формат запроса.", code: "BAD_JSON" }, { status: 400 });
  }
  if (error instanceof Response) return error;
  return jsonResponse({ error: "Не удалось выполнить операцию. Попробуйте ещё раз.", code: "INTERNAL_ERROR" }, { status: 500 });
}

export function badRequest(message: string, code = "BAD_REQUEST"): Response {
  return jsonResponse({ error: message, code }, { status: 400 });
}

export function notFound(message = "Документ не найден."): Response {
  return jsonResponse({ error: message, code: "NOT_FOUND" }, { status: 404 });
}

export function forbidden(message = "У вас нет доступа к этому объекту."): Response {
  return jsonResponse({ error: message, code: "FORBIDDEN" }, { status: 403 });
}
