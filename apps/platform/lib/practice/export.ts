import { readFile } from "node:fs/promises";
import { join } from "node:path";
import PizZip from "pizzip";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { contentBlocks, escapeHtml, type Block, type Run } from "./content";
import { displayMoney, PracticeError, type Locale } from "./domain";

const xml = (value: string) => escapeHtml(value).replace(/'/g, "&apos;");
function runXml(run: Run) {
  return run.text
    .split("\n")
    .map(
      (line, i) =>
        `${i ? "<w:r><w:br/></w:r>" : ""}<w:r><w:rPr>${run.bold ? "<w:b/>" : ""}${run.italic ? "<w:i/>" : ""}${run.underline ? '<w:u w:val="single"/>' : ""}</w:rPr><w:t xml:space="preserve">${xml(line)}</w:t></w:r>`,
    )
    .join("");
}
function paragraph(runs: Run[], heading = false, list = false) {
  return `<w:p><w:pPr><w:spacing w:after="140" w:line="280"/>${heading ? '<w:keepNext/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr>' : ""}</w:pPr>${list ? "<w:r><w:t>• </w:t></w:r>" : ""}${runs.map((run) => runXml({ ...run, bold: heading || run.bold })).join("")}</w:p>`;
}
function tableXml(block: Block) {
  const rows = block.rows ?? [],
    cols = Math.max(1, ...rows.map((row) => row.length));
  return `<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((side) => `<w:${side} w:val="single" w:sz="4" w:color="CCCCCC"/>`).join("")}</w:tblBorders></w:tblPr><w:tblGrid>${Array(
    cols,
  )
    .fill(`<w:gridCol w:w="${Math.floor(9638 / cols)}"/>`)
    .join(
      "",
    )}</w:tblGrid>${rows.map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9638 / cols)}" w:type="dxa"/></w:tcPr>${paragraph(cell)}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;
}
export async function exportDocx(
  html: string,
  title: string,
  locale: Locale,
): Promise<Uint8Array> {
  const template = await readFile(
    join(process.cwd(), "public/document-templates/receipt-ru.docx"),
  );
  const zip = new PizZip(template),
    source = zip.file("word/document.xml")!.asText();
  const section = source.slice(
    source.lastIndexOf("<w:sectPr"),
    source.lastIndexOf("</w:body>"),
  );
  const body = contentBlocks(html)
    .map((block) =>
      block.kind === "table"
        ? tableXml(block)
        : paragraph(
            block.runs,
            block.kind === "heading",
            block.kind === "list",
          ),
    )
    .join("");
  zip.file(
    "word/document.xml",
    source.slice(0, source.indexOf("<w:body>") + 8) +
      body +
      section +
      "</w:body></w:document>",
  );
  const settings = zip.file("word/styles.xml")?.asText();
  if (settings)
    zip.file(
      "word/styles.xml",
      settings.replace(
        /w:lang w:val="[^"]*"/g,
        `w:lang w:val="${{ ru: "ru-RU", uz: "uz-Latn-UZ", en: "en-GB" }[locale]}"`,
      ),
    );
  if (zip.file("docProps/core.xml"))
    zip.file(
      "docProps/core.xml",
      zip
        .file("docProps/core.xml")!
        .asText()
        .replace(
          /<dc:title>[\s\S]*?<\/dc:title>/,
          `<dc:title>${xml(title)}</dc:title>`,
        ),
    );
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}
type Word = { text: string; bold?: boolean; underline?: boolean };
function lines(
  runs: Run[],
  regular: PDFFont,
  bold: PDFFont,
  width: number,
  size: number,
): Word[][] {
  const result: Word[][] = [[]];
  let used = 0;
  for (const run of runs)
    for (const token of run.text.split(/(\s+)/).filter(Boolean)) {
      if (token.includes("\n")) {
        for (let n = 0; n < token.split("\n").length - 1; n++) result.push([]);
        used = 0;
        continue;
      }
      const font = run.bold ? bold : regular;
      // Split long unbroken values so they cannot overflow page or table margins.
      const pieces: string[] = [];
      let piece = "";
      for (const char of token) {
        if (piece && font.widthOfTextAtSize(piece + char, size) > width) {
          pieces.push(piece);
          piece = "";
        }
        piece += char;
      }
      if (piece) pieces.push(piece);
      for (const part of pieces) {
        const w = font.widthOfTextAtSize(part, size);
        if (used + w > width && result[result.length - 1].length) {
          result.push([]);
          used = 0;
        }
        if (!used && !part.trim()) continue;
        result[result.length - 1].push({
          text: part,
          bold: run.bold,
          underline: run.underline,
        });
        used += w;
      }
    }
  return result;
}
export async function exportPdf(
  html: string,
  title: string,
  locale: Locale,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(title);
  pdf.setCreator("JURO Practice");
  const root = join(process.cwd(), "public/document-templates");
  const [regular, bold] = await Promise.all([
    pdf.embedFont(await readFile(join(root, "DejaVuSans-JURO.ttf")), {
      subset: true,
    }),
    pdf.embedFont(await readFile(join(root, "DejaVuSans-Bold-JURO.ttf")), {
      subset: true,
    }),
  ]);
  let page: PDFPage = pdf.addPage([595.28, 841.89]),
    y = 785;
  const next = () => {
    page = pdf.addPage([595.28, 841.89]);
    y = 785;
  };
  const draw = (line: Word[], x: number, baseline: number, size: number) => {
    let cursor = x;
    for (const word of line) {
      const font = word.bold ? bold : regular;
      page.drawText(word.text, {
        x: cursor,
        y: baseline,
        size,
        font,
        color: rgb(0.12, 0.14, 0.16),
      });
      const width = font.widthOfTextAtSize(word.text, size);
      if (word.underline)
        page.drawLine({
          start: { x: cursor, y: baseline - 2 },
          end: { x: cursor + width, y: baseline - 2 },
          thickness: 0.6,
        });
      cursor += width;
    }
  };
  for (const block of contentBlocks(html)) {
    if (block.kind === "table") {
      const cols = Math.max(1, ...(block.rows ?? []).map((row) => row.length)),
        width = 483 / cols;
      for (const row of block.rows ?? []) {
        const wrapped = row.map((cell) =>
          lines(cell, regular, bold, width - 12, 9),
        );
        const count = Math.max(1, ...wrapped.map((cell) => cell.length));
        // A large cell is split across pages, with its borders repeated per page.
        for (let start = 0; start < count; ) {
          if (y < 85) next();
          const fit = Math.max(
              1,
              Math.min(count - start, Math.floor((y - 65) / 13)),
            ),
            height = fit * 13 + 10;
          wrapped.forEach((cell, column) => {
            const x = 56 + column * width;
            page.drawRectangle({
              x,
              y: y - height,
              width,
              height,
              borderColor: rgb(0.75, 0.77, 0.78),
              borderWidth: 0.5,
            });
            cell
              .slice(start, start + fit)
              .forEach((line, index) =>
                draw(line, x + 6, y - 14 - index * 13, 9),
              );
          });
          y -= height;
          start += fit;
          if (start < count) next();
        }
      }
      y -= 12;
    } else {
      const size = block.kind === "heading" ? 14 : 10.5;
      const runs =
        block.kind === "list" ? [{ text: "• " }, ...block.runs] : block.runs;
      const wrapped = lines(
        runs.map((run) => ({
          ...run,
          bold: block.kind === "heading" || run.bold,
        })),
        regular,
        bold,
        483,
        size,
      );
      if (block.kind === "heading" && y < 105) next();
      for (const line of wrapped) {
        if (y < 75) next();
        draw(line, 56, y - 16, size);
        y -= size + 5;
      }
      y -= 8;
    }
  }
  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    const label = `${{ ru: "Страница", uz: "Sahifa", en: "Page" }[locale]} ${index + 1} / ${pages.length}`;
    p.drawText("JURO Practice", { x: 56, y: 30, size: 8, font: regular });
    p.drawText(label, { x: 400, y: 30, size: 8, font: regular });
  });
  return pdf.save();
}
export function invoiceHtml(invoice: Record<string, any>, locale: Locale) {
  const labels = {
    ru: [
      "Счёт",
      "Исполнитель",
      "Клиент",
      "Срок оплаты",
      "Услуга",
      "Количество",
      "Цена",
      "Итого",
    ],
    uz: [
      "Hisob",
      "Ijrochi",
      "Mijoz",
      "To‘lov muddati",
      "Xizmat",
      "Soni",
      "Narx",
      "Jami",
    ],
    en: [
      "Invoice",
      "Provider",
      "Client",
      "Due date",
      "Service",
      "Quantity",
      "Price",
      "Total",
    ],
  }[locale];
  const details = (value: Record<string, unknown>) =>
    Object.entries(value)
      .map(
        ([key, val]) =>
          `<p>${escapeHtml(key)}: ${escapeHtml(typeof val === "object" ? JSON.stringify(val) : String(val ?? ""))}</p>`,
      )
      .join("");
  const date = (value: string | Date) =>
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value.slice(0, 10);
  return `<h1>${labels[0]} ${escapeHtml(invoice.number)}</h1><p>${date(invoice.issued_on)}</p><h2>${labels[1]}</h2>${details(invoice.provider_snapshot)}<h2>${labels[2]}</h2>${details(invoice.customer_snapshot)}<p>${labels[3]}: ${date(invoice.due_on)}</p><table><tr>${labels
    .slice(4)
    .map((label) => `<th>${label}</th>`)
    .join(
      "",
    )}</tr>${invoice.lines.map((line: any) => `<tr><td>${escapeHtml(line.description)}${line.minutes ? ` (${line.minutes} ${{ ru: "мин", uz: "daqiqa", en: "min" }[locale]})` : ""}${line.stageName ? ` · ${escapeHtml(line.stageName)}` : ""}</td><td>${line.quantity}</td><td>${displayMoney(line.unitMinor, invoice.currency)}</td><td>${displayMoney(line.totalMinor, invoice.currency)}</td></tr>`).join("")}</table><h2>${labels[7]}: ${displayMoney(invoice.total_minor, invoice.currency)}</h2>`;
}
export async function exportContent(
  format: string,
  html: string,
  title: string,
  locale: Locale,
) {
  if (format === "docx")
    return {
      bytes: await exportDocx(html, title, locale),
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  if (format === "pdf")
    return {
      bytes: await exportPdf(html, title, locale),
      mime: "application/pdf",
    };
  throw new PracticeError("INVALID_FORMAT");
}
