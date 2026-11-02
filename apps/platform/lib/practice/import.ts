import PizZip from "pizzip";
import type { PoolClient } from "pg";
import { parseFragment } from "parse5";
import { audit } from "./access";
import { crmCommand } from "./crm";
import { isLegal, PracticeError, type Actor } from "./domain";
import { commandSchema } from "./domain";
import { ZodError } from "zod";

function csv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0],
    delimiter = first.includes("\t")
      ? "\t"
      : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0)
        ? ";"
        : ",";
  const rows: string[][] = [],
    row: string[] = [];
  let value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (ch === delimiter || ch === "\n")) {
      row.push(value.replace(/\r$/, ""));
      value = "";
      if (ch === "\n") {
        rows.push([...row]);
        row.length = 0;
      }
    } else value += ch;
    if (value.length > 20_000 || rows.length > 2000 || row.length > 50)
      throw new PracticeError("IMPORT_LIMIT");
  }
  if (quoted) throw new PracticeError("INVALID_CSV");
  if (value || row.length) {
    row.push(value);
    rows.push([...row]);
  }
  return rows;
}
function textXml(value: string): string {
  const fragment = parseFragment(
    value.replace(/<\/?(?:\w+:)?(?:t|r|rPr|si)\b[^>]*>/g, ""),
  );
  const walk = (node: any): string =>
    typeof node.value === "string"
      ? node.value
      : (node.childNodes ?? []).map(walk).join("");
  return walk(fragment);
}
function preflightZip(bytes: Uint8Array) {
  if (bytes.length < 22) throw new PracticeError("INVALID_XLSX");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (
    end >= Math.max(0, bytes.length - 65557) &&
    view.getUint32(end, true) !== 0x06054b50
  )
    end--;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50)
    throw new PracticeError("INVALID_XLSX");
  const count = view.getUint16(end + 10, true),
    offset = view.getUint32(end + 16, true);
  if (count > 300 || count < 1 || offset >= end)
    throw new PracticeError("IMPORT_LIMIT");
  let cursor = offset,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50)
      throw new PracticeError("INVALID_XLSX");
    const compressed = view.getUint32(cursor + 20, true),
      size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true),
      extra = view.getUint16(cursor + 30, true),
      comment = view.getUint16(cursor + 32, true);
    const name = new TextDecoder().decode(
      bytes.slice(cursor + 46, cursor + 46 + nameLength),
    );
    if (
      /vba|activeX|embeddings|externalLinks|\.\.\//i.test(name) ||
      size > 10_000_000 ||
      size > Math.max(1, compressed) * 100 ||
      view.getUint16(cursor + 8, true) & 1
    )
      throw new PracticeError("ACTIVE_CONTENT_REJECTED");
    total += size;
    if (total > 25_000_000) throw new PracticeError("IMPORT_LIMIT");
    cursor += 46 + nameLength + extra + comment;
  }
}
function xlsx(bytes: Uint8Array): string[][] {
  preflightZip(bytes);
  const zip = new PizZip(bytes),
    shared = zip.file("xl/sharedStrings.xml")?.asText() ?? "";
  const strings = [...shared.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(
    (match) => textXml(match[1]),
  );
  const workbook = zip.file("xl/workbook.xml")?.asText() ?? "",
    relationships = zip.file("xl/_rels/workbook.xml.rels")?.asText() ?? "";
  const firstId = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  let sheetPath = "xl/worksheets/sheet1.xml";
  if (firstId)
    for (const relation of relationships.matchAll(/<Relationship\b[^>]*\/>/g)) {
      if (/\bId="([^"]+)"/.exec(relation[0])?.[1] !== firstId) continue;
      const target = /\bTarget="([^"]+)"/.exec(relation[0])?.[1];
      if (target && !target.includes("..") && !/^https?:/i.test(target))
        sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    }
  const sheet = zip.file(sheetPath)?.asText();
  if (!sheet) throw new PracticeError("INVALID_XLSX");
  const rows = [...sheet.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)].map(
    (match) => {
      const row: string[] = [];
      for (const cell of match[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const ref = /\br="([A-Z]+)\d+"/.exec(cell[1])?.[1];
        if (!ref) continue;
        const column =
          [...ref].reduce(
            (value, char) => value * 26 + char.charCodeAt(0) - 64,
            0,
          ) - 1;
        if (column > 49) throw new PracticeError("IMPORT_LIMIT");
        // Formulas are never evaluated; require explicit values for imported cells.
        const raw = /<f\b/.test(cell[2])
          ? ""
          : (/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(cell[2])?.[1] ?? "");
        row[column] = /\bt="s"/.test(cell[1])
          ? (strings[Number(raw)] ?? "")
          : /\bt="inlineStr"/.test(cell[1])
            ? textXml(cell[2].replace(/<\/?is>/g, ""))
            : textXml(raw);
      }
      return Array.from({ length: row.length }, (_, i) => row[i] ?? "");
    },
  );
  if (rows.length > 2001) throw new PracticeError("IMPORT_LIMIT");
  return rows;
}
export function parseImport(fileName: string, bytes: Uint8Array) {
  if (bytes.length > 5_000_000) throw new PracticeError("IMPORT_LIMIT", 413);
  const rows = /\.xlsx$/i.test(fileName)
    ? xlsx(bytes)
    : /\.csv$/i.test(fileName)
      ? csv(
          new TextDecoder("utf-8", { fatal: true })
            .decode(bytes)
            .replace(/^\uFEFF/, ""),
        )
      : (() => {
          throw new PracticeError("INVALID_IMPORT_FORMAT");
        })();
  const [columns, ...data] = rows.filter((row) =>
    row.some((value) => value.trim()),
  );
  if (!columns || columns.length > 50 || !data.length)
    throw new PracticeError("EMPTY_IMPORT");
  return { columns, rows: data };
}
export async function previewImport(
  client: PoolClient,
  actor: Actor,
  name: string,
  bytes: Uint8Array,
) {
  if (!isLegal(actor)) throw new PracticeError("ACCESS_DENIED", 403);
  const parsed = parseImport(name, bytes),
    id = crypto.randomUUID();
  await client.query(
    `INSERT INTO practice_imports(id,workspace_id,user_id,rows,columns) VALUES($1,$2,$3,$4,$5)`,
    [
      id,
      actor.workspaceId,
      actor.userId,
      JSON.stringify(parsed.rows),
      JSON.stringify(parsed.columns),
    ],
  );
  return {
    id,
    columns: parsed.columns,
    preview: parsed.rows.slice(0, 10),
    rowCount: parsed.rows.length,
    formulasIgnored: true,
  };
}
export async function confirmImport(
  client: PoolClient,
  actor: Actor,
  input: {
    importId: string;
    kind: "contacts" | "cases";
    mapping: Record<string, number>;
    duplicate: "skip" | "create";
    pipelineId?: string;
    stageId?: string;
    source?: string;
  },
) {
  if (!isLegal(actor)) throw new PracticeError("ACCESS_DENIED", 403);
  const stored = (
    await client.query(
      `SELECT rows FROM practice_imports WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND expires_at>now()`,
      [input.importId, actor.workspaceId, actor.userId],
    )
  ).rows[0];
  if (!stored) throw new PracticeError("IMPORT_EXPIRED", 404);
  let created = 0,
    skipped = 0;
  const errors: { row: number; code: string; field?: string }[] = [];
  for (let i = 0; i < stored.rows.length; i++) {
    const row: string[] = stored.rows[i],
      value = (key: string) => (row[input.mapping[key]] ?? "").trim();
    await client.query("SAVEPOINT import_row");
    try {
      const name = value("name");
      if (input.kind === "contacts") {
        if (input.duplicate === "skip") {
          const exists = (
            await client.query(
              `SELECT 1 FROM practice_contacts p JOIN contacts c ON c.id=p.contact_id WHERE p.workspace_id=$1 AND lower(c.full_name)=lower($2) AND coalesce(p.email,'')= $3 AND ($4 IN ('owner','admin') OR c.owner_user_id=$5 OR EXISTS(SELECT 1 FROM practice_matters m JOIN practice_assignments a ON a.case_id=m.case_id WHERE m.contact_id=p.contact_id AND m.workspace_id=p.workspace_id AND a.user_id=$5)) LIMIT 1`,
              [
                actor.workspaceId,
                name,
                value("email"),
                actor.role,
                actor.userId,
              ],
            )
          ).rows[0];
          if (exists) {
            skipped++;
            await client.query("RELEASE SAVEPOINT import_row");
            continue;
          }
        }
        await crmCommand(
          client,
          actor,
          commandSchema.parse({
            action: "contact.create",
            name,
            kind: value("kind") === "company" ? "company" : "person",
            email: value("email"),
            phone: value("phone"),
            companyName: value("companyName"),
            requisites: value("requisites")
              ? { details: value("requisites") }
              : {},
          }),
        );
      } else {
        if (!input.pipelineId || !input.stageId || !input.source)
          throw new PracticeError("IMPORT_SETTINGS_REQUIRED");
        if (input.duplicate === "skip") {
          const exists = (
            await client.query(
              `SELECT 1 FROM practice_matters m JOIN cases c ON c.id=m.case_id WHERE m.workspace_id=$1 AND lower(c.title)=lower($2) AND m.contact_id=$3 AND ($4 IN ('owner','admin') OR EXISTS(SELECT 1 FROM practice_assignments a WHERE a.case_id=m.case_id AND a.user_id=$5)) LIMIT 1`,
              [
                actor.workspaceId,
                name,
                value("contactId"),
                actor.role,
                actor.userId,
              ],
            )
          ).rows[0];
          if (exists) {
            skipped++;
            await client.query("RELEASE SAVEPOINT import_row");
            continue;
          }
        }
        await crmCommand(
          client,
          actor,
          commandSchema.parse({
            action: "case.create",
            title: name,
            description: value("description"),
            contactId: value("contactId"),
            pipelineId: input.pipelineId,
            stageId: input.stageId,
            responsibleUserId: actor.userId,
            source: input.source,
            expected: value("expected") || "0",
            currency: value("currency") || "UZS",
          }),
        );
      }
      created++;
      await client.query("RELEASE SAVEPOINT import_row");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT import_row");
      await client.query("RELEASE SAVEPOINT import_row");
      errors.push({
        row: i + 2,
        code: error instanceof PracticeError ? error.code : "INVALID_ROW",
        ...(error instanceof ZodError && error.issues[0]?.path[0]
          ? { field: String(error.issues[0].path[0]) }
          : {}),
      });
    }
  }
  await audit(client, actor, "import", input.importId, "import.confirmed", {
    created,
    skipped,
    errors: errors.length,
  });
  return { created, skipped, failed: errors.length, errors };
}
export function csvExport(items: Record<string, unknown>[]) {
  const columns = [...new Set(items.flatMap((item) => Object.keys(item)))];
  const cell = (value: unknown) => {
    let str =
      value !== null && typeof value === "object"
        ? JSON.stringify(value)
        : String(value ?? "");
    if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
    return '"' + str.replace(/"/g, '""') + '"';
  };
  return (
    "\uFEFF" +
    [columns, ...items.map((item) => columns.map((column) => item[column]))]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
