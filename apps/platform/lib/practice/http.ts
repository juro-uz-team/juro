import { z } from "zod";
import {
  requireApiUser,
  assertSafeWrite,
  ApiAuthError,
} from "../document-builder/auth/api";
import { parseJsonRequest } from "../auth/input";
import { practiceActor, transaction } from "./access";
import { executeCommand, idempotent } from "./service";
import { readPractice } from "./read";
import { documentAllowed } from "./documents";
import { invoiceAllowed } from "./finance";
import { exportContent, invoiceHtml } from "./export";
import { downloadFile, uploadFile } from "./files";
import { confirmImport, csvExport, previewImport } from "./import";
import { importDocx } from "./content";
import {
  googleCalendars,
  googleDisconnect,
  googleSelect,
  oauthCallback,
  oauthStart,
  resolveGoogleConflict,
  syncGoogle,
} from "./calendar";
import {
  hash,
  isLegal,
  PracticeError,
  type Actor,
  type Locale,
} from "./domain";
import { validateUploadBytes } from "../document-builder/storage/file-validation";
import {
  quarantineScanAndStorePrivateObject,
  QuarantinedUploadError,
} from "../document-builder/storage/quarantined-upload";
import { practiceAi } from "./ai";
import { message } from "./localization";
import { juroMaterial, juroMaterialFile } from "./juro";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", pragma: "no-cache" },
  });
const id = z.string().min(1).max(100);
const importSchema = z
  .object({
    importId: id,
    kind: z.enum(["contacts", "cases"]),
    mapping: z.record(z.string(), z.number().int().min(0).max(49)),
    duplicate: z.enum(["skip", "create"]),
    pipelineId: id.optional(),
    stageId: id.optional(),
    source: z.string().min(1).max(100).optional(),
  })
  .strict();
async function body<T extends z.ZodType>(
  request: Request,
  schema: T,
  max = 1000000,
): Promise<z.infer<T>> {
  const parsed = await parseJsonRequest(request, schema, max);
  if (!parsed.ok)
    throw new PracticeError(
      parsed.error === "payload_too_large"
        ? "PAYLOAD_TOO_LARGE"
        : "INVALID_INPUT",
      parsed.error === "payload_too_large" ? 413 : 400,
    );
  return parsed.data as z.infer<T>;
}
function fileResponse(bytes: Uint8Array, mime: string, name: string) {
  return new Response(new Uint8Array(bytes).buffer, {
    headers: {
      "content-type": mime,
      "content-disposition": `attachment; filename="document.${name.split(".").pop()}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
export async function practiceHttp(request: Request, segments: string[]) {
  const url = new URL(request.url),
    locale: Locale = ["uz", "en"].includes(
      request.headers.get("x-juro-locale") ??
        url.searchParams.get("locale") ??
        "",
    )
      ? ((request.headers.get("x-juro-locale") ??
          url.searchParams.get("locale")) as Locale)
      : "ru";
  try {
    const user = await requireApiUser(request),
      resource = segments.join("/") || "bootstrap",
      workspaceId = url.searchParams.get("workspaceId") ?? "";
    if (request.method !== "GET") assertSafeWrite(request);
    if (resource === "google/callback" && request.method === "GET") {
      if (url.searchParams.has("error"))
        return Response.redirect(
          new URL("/practice?google=denied", url.origin),
        );
      const target = await transaction(async (client) => {
        const state = url.searchParams.get("state") ?? "",
          code = url.searchParams.get("code") ?? "";
        const stored = (
          await client.query(
            `SELECT workspace_id FROM practice_oauth_states WHERE hash=$1 AND user_id=$2`,
            [hash(state), user.id],
          )
        ).rows[0];
        if (!stored) throw new PracticeError("OAUTH_STATE_INVALID", 403);
        await practiceActor(client, user.id, stored.workspace_id, true);
        return oauthCallback(client, user.id, code, state);
      });
      return Response.redirect(
        new URL(
          `/practice?workspaceId=${encodeURIComponent(target)}&locale=${locale}`,
          url.origin,
        ),
      );
    }
    if (resource === "invitation/accept" && request.method === "POST") {
      const input = await body(
        request,
        z.object({ token: z.string().min(30).max(256) }).strict(),
        2048,
      );
      return transaction(async (client) => {
        if (process.env.PRACTICE_ENABLED !== "true")
          throw new PracticeError("MODULE_DISABLED", 503);
        const verified = (
          await client.query(
            `SELECT email_verified_at FROM user_profiles WHERE id=$1`,
            [user.id],
          )
        ).rows[0];
        if (!verified?.email_verified_at)
          throw new PracticeError("VERIFIED_ACCOUNT_REQUIRED", 403);
        const invite = (
          await client.query(
            `UPDATE practice_invitations SET accepted_by=$2,accepted_at=now() WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() RETURNING workspace_id`,
            [hash(input.token), user.id],
          )
        ).rows[0];
        if (!invite) throw new PracticeError("INVITATION_EXPIRED", 409);
        return json({ ok: true, pendingConfirmation: true });
      });
    }
    if (resource === "invitation/preview" && request.method === "GET") {
      return transaction(async (client) => {
        const row = (
          await client.query(
            `SELECT w.name FROM practice_invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE i.token_hash=$1 AND i.revoked_at IS NULL AND i.expires_at>now()`,
            [hash(url.searchParams.get("token") ?? "")],
          )
        ).rows[0];
        if (!row) throw new PracticeError("INVITATION_EXPIRED", 404);
        return json({ workspaceName: row.name });
      });
    }
    if (!workspaceId || workspaceId.length > 100)
      throw new PracticeError("WORKSPACE_REQUIRED");
    if (resource === "commands" && request.method === "POST")
      return json(
        await executeCommand(
          user.id,
          workspaceId,
          request.headers.get("idempotency-key") ?? "",
          await body(request, z.unknown()),
        ),
      );
    if (resource === "ai" && request.method === "POST") {
      const input = await body(
        request,
        z
          .object({
            caseId: id,
            task: z.enum(["summary", "tasks", "plan", "document"]),
            instruction: z.string().max(4000),
            documentIds: z.array(id).max(10),
          })
          .strict(),
        8192,
      );
      return json(
        await practiceAi(
          user.id,
          workspaceId,
          request.headers.get("idempotency-key") ?? "",
          input,
          locale,
        ),
      );
    }
    return await transaction(async (client) => {
      const write =
        request.method !== "GET" && !["google/disconnect"].includes(resource);
      const actor = await practiceActor(client, user.id, workspaceId, write);
      if (request.method === "GET") {
        if (segments[0] === "source-files" && segments[1]) {
          const result = await juroMaterialFile(client, actor, segments[1]);
          return fileResponse(
            result.bytes,
            result.file.mime_type,
            result.file.file_name,
          );
        }
        if (segments[0] === "files" && segments[1]) {
          const result = await downloadFile(client, actor, segments[1]);
          return fileResponse(
            result.bytes,
            result.file.mime_type,
            result.file.file_name,
          );
        }
        if (segments[0] === "export" && segments[1] && segments[2]) {
          const format = url.searchParams.get("format") ?? "pdf";
          let html: string,
            title: string,
            language = locale;
          if (segments[1] === "document") {
            const doc = await documentAllowed(client, actor, segments[2]);
            let content = doc.content;
            const requestedVersion = url.searchParams.get("versionId");
            const versionId =
              requestedVersion ??
              (actor.role === "client" ? doc.published_version_id : null);
            if (versionId) {
              const stored = (
                await client.query(
                  `SELECT content,reason FROM practice_document_versions WHERE id=$1 AND document_id=$2`,
                  [versionId, doc.document_id],
                )
              ).rows[0];
              if (
                !stored ||
                (actor.role === "client" &&
                  !["published", "agreed"].includes(stored.reason))
              )
                throw new PracticeError("NOT_FOUND", 404);
              content = stored.content;
            }
            html = content.html;
            title = doc.title;
            language = doc.language;
          } else if (segments[1] === "material") {
            const doc = await juroMaterial(client, actor, segments[2], true);
            html = doc.html;
            title = doc.title;
            language =
              doc.language === "uz"
                ? "uz"
                : doc.language === "en"
                  ? "en"
                  : "ru";
          } else if (segments[1] === "invoice") {
            const invoice = await invoiceAllowed(client, actor, segments[2]);
            language = invoice.language;
            html = invoiceHtml(invoice, language);
            title = invoice.number;
          } else throw new PracticeError("NOT_FOUND", 404);
          const output = await exportContent(format, html, title, language);
          return fileResponse(
            output.bytes,
            output.mime,
            `${title.replace(/[\\/:*?"<>|\r\n]/g, "-").slice(0, 120)}.${format}`,
          );
        }
        if (resource === "google/calendars")
          return json(await googleCalendars(client, actor));
        if (url.searchParams.get("format") === "csv") {
          if (
            ![
              "contacts",
              "cases",
              "invoices",
              "payments",
              "expenses",
              "time",
            ].includes(resource)
          )
            throw new PracticeError("INVALID_FORMAT");
          const items: Record<string, unknown>[] = [],
            params = new URLSearchParams(url.searchParams);
          for (let page = 1; page <= 334; page++) {
            params.set("page", String(page));
            const result = (await readPractice(
              client,
              actor,
              resource,
              params,
              locale,
            )) as { items: Record<string, unknown>[]; total: number };
            if (result.total > 10000)
              throw new PracticeError("EXPORT_LIMIT", 413);
            items.push(...result.items);
            if (items.length >= result.total) break;
          }
          return fileResponse(
            new TextEncoder().encode(csvExport(items)),
            "text/csv; charset=utf-8",
            `${resource}.csv`,
          );
        }
        return json(
          await readPractice(client, actor, resource, url.searchParams, locale),
        );
      }
      if (resource === "google/connect")
        return json(await oauthStart(client, actor));
      if (resource === "google/select")
        return json(
          await googleSelect(
            client,
            actor,
            (await body(request, z.object({ calendarId: id }).strict()))
              .calendarId,
          ),
        );
      if (resource === "google/disconnect")
        return json(await googleDisconnect(client, actor));
      if (resource === "google/sync")
        return json(await syncGoogle(client, actor));
      if (resource === "google/resolve") {
        const input = await body(
          request,
          z
            .object({ eventId: id, choice: z.enum(["local", "remote"]) })
            .strict(),
        );
        return json(
          await resolveGoogleConflict(
            client,
            actor,
            input.eventId,
            input.choice,
          ),
        );
      }
      if (
        ["uploads", "imports/preview", "templates/import"].includes(resource)
      ) {
        const form = await request.formData(),
          file = form.get("file");
        if (!(file instanceof File) || file.size > 10_000_000)
          throw new PracticeError("FILE_TOO_LARGE", 413);
        const bytes = new Uint8Array(await file.arrayBuffer());
        return json(
          await idempotent(
            client,
            actor,
            request.headers.get("idempotency-key") ?? "",
            hash(bytes) +
              hash(
                JSON.stringify(
                  [...form.keys()]
                    .filter((key) => key !== "file")
                    .map((key) => [key, form.get(key)]),
                ),
              ),
            async () => {
              if (resource === "imports/preview")
                return previewImport(client, actor, file.name, bytes);
              if (resource === "templates/import") {
                if (!isLegal(actor))
                  throw new PracticeError("ACCESS_DENIED", 403);
                if (
                  !/\.docx$/i.test(file.name) ||
                  file.type !==
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                )
                  throw new PracticeError("INVALID_DOCX");
                const invalid = await validateUploadBytes(file, bytes);
                if (invalid) throw new PracticeError(invalid.code);
                const imported = importDocx(bytes),
                  templateId = crypto.randomUUID(),
                  key = `practice/${actor.workspaceId}/templates/${templateId}`;
                await quarantineScanAndStorePrivateObject({
                  key,
                  bytes,
                  mimeType: file.type,
                });
                const language = ["uz", "en"].includes(
                  String(form.get("language")),
                )
                  ? String(form.get("language"))
                  : "ru";
                await client.query(
                  `INSERT INTO practice_document_templates(id,workspace_id,name,kind,language,content,docx_key,fields,created_by) VALUES($1,$2,$3,'uploaded',$4,$5,$6,$7,$8)`,
                  [
                    templateId,
                    actor.workspaceId,
                    file.name.replace(/\.docx$/i, ""),
                    language,
                    JSON.stringify({ html: imported.html }),
                    key,
                    JSON.stringify(imported.fields),
                    actor.userId,
                  ],
                );
                return { id: templateId, ...imported };
              }
              return uploadFile(client, actor, file, {
                caseId: String(form.get("caseId") ?? ""),
                documentId: form.get("documentId")
                  ? String(form.get("documentId"))
                  : undefined,
                purpose: String(form.get("purpose") ?? "material"),
                versionId: form.get("versionId")
                  ? String(form.get("versionId"))
                  : undefined,
                clientVisible: form.get("clientVisible") === "true",
              });
            },
          ),
        );
      }
      if (resource === "imports/confirm") {
        const input = await body(request, importSchema, 8192);
        return json(
          await idempotent(
            client,
            actor,
            request.headers.get("idempotency-key") ?? "",
            hash(JSON.stringify(input)),
            () => confirmImport(client, actor, input),
          ),
        );
      }
      throw new PracticeError("NOT_FOUND", 404);
    });
  } catch (error) {
    if (error instanceof ApiAuthError)
      return json(
        { code: "UNAUTHORIZED", error: message(locale, "UNAUTHORIZED") },
        error.status,
      );
    if (error instanceof QuarantinedUploadError)
      return json(
        { code: error.code, error: message(locale, error.code) },
        error.code === "FILE_UNSAFE" ? 400 : 503,
      );
    if (error instanceof PracticeError)
      return json(
        { code: error.code, error: message(locale, error.code) },
        error.status,
      );
    const code = (error as { code?: string }).code;
    if (code === "23505")
      return json(
        { code: "RECORD_EXISTS", error: message(locale, "RECORD_EXISTS") },
        409,
      );
    if (["23503", "23514", "22008", "22007"].includes(code ?? ""))
      return json(
        { code: "INVALID_INPUT", error: message(locale, "INVALID_INPUT") },
        400,
      );
    console.error(
      "Practice request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return json(
      { code: "UNAVAILABLE", error: message(locale, "UNAVAILABLE") },
      503,
    );
  }
}
