import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import PizZip from "pizzip";
import { PracticeError } from "./domain";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const children = (node: Node): Node[] =>
  "childNodes" in node ? node.childNodes : [];
const tag = (node: Node): string => ("tagName" in node ? node.tagName : "");
export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const plain = (node: Node): string =>
  "value" in node
    ? node.value
    : children(node)
        .map(plain)
        .join(tag(node) === "br" ? "\n" : "");
const permitted = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "br",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "blockquote",
]);
const dropped = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "svg",
  "math",
  "template",
  "form",
  "input",
  "img",
  "audio",
  "video",
]);
function clean(node: Node): string {
  if ("value" in node) return escapeHtml(node.value);
  const name = tag(node);
  if (dropped.has(name)) return "";
  const content = children(node).map(clean).join("");
  if (!permitted.has(name)) return content;
  const normalized = name === "div" ? "p" : name;
  return normalized === "br"
    ? "<br>"
    : `<${normalized}>${content}</${normalized}>`;
}
export function sanitizeHtml(html: string): string {
  if (Buffer.byteLength(html, "utf8") > 500_000)
    throw new PracticeError("CONTENT_TOO_LARGE", 413);
  return parseFragment(html).childNodes.map(clean).join("") || "<p></p>";
}
export type Run = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};
export type Block = {
  kind: "paragraph" | "heading" | "list" | "table";
  runs: Run[];
  rows?: Run[][][];
  level?: number;
};
function runs(node: Node, inherited: Omit<Run, "text"> = {}): Run[] {
  if ("value" in node) return [{ text: node.value, ...inherited }];
  if (tag(node) === "br") return [{ text: "\n", ...inherited }];
  const style = {
    ...inherited,
    ...(["b", "strong", "th"].includes(tag(node)) ? { bold: true } : {}),
    ...(["i", "em"].includes(tag(node)) ? { italic: true } : {}),
    ...(tag(node) === "u" ? { underline: true } : {}),
  };
  return children(node).flatMap((child) => runs(child, style));
}
export function contentBlocks(html: string): Block[] {
  const result: Block[] = [];
  function walk(node: Node) {
    const name = tag(node);
    if (name === "table") {
      const rows: Run[][][] = [];
      const visit = (candidate: Node) => {
        if (tag(candidate) === "tr")
          rows.push(
            children(candidate)
              .filter((cell) => ["td", "th"].includes(tag(cell)))
              .map((cell) => runs(cell)),
          );
        else children(candidate).forEach(visit);
      };
      visit(node);
      if (rows.length > 300 || rows.some((row) => row.length > 20))
        throw new PracticeError("TABLE_TOO_LARGE");
      result.push({ kind: "table", runs: [], rows });
    } else if (["p", "h1", "h2", "h3", "li", "blockquote"].includes(name))
      result.push({
        kind: name.startsWith("h")
          ? "heading"
          : name === "li"
            ? "list"
            : "paragraph",
        runs: runs(node),
        level: name.startsWith("h") ? Number(name[1]) : undefined,
      });
    else if ("value" in node && node.value.trim())
      result.push({ kind: "paragraph", runs: [{ text: node.value }] });
    else children(node).forEach(walk);
  }
  parseFragment(sanitizeHtml(html)).childNodes.forEach(walk);
  return result;
}
export const contentText = (html: string) =>
  contentBlocks(html)
    .map((block) =>
      block.kind === "table"
        ? block
            .rows!.map((row) =>
              row
                .map((cell) => cell.map((run) => run.text).join(""))
                .join("\t"),
            )
            .join("\n")
        : block.runs.map((run) => run.text).join(""),
    )
    .join("\n");

function decodeXml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
function docxParagraph(xml: string) {
  const content = [...xml.matchAll(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g)]
    .map(([run]) => {
      let value = [
        ...run.matchAll(
          /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(?:br|tab)\b[^>]*\/>/g,
        ),
      ]
        .map((match) =>
          match[1] !== undefined ? escapeHtml(decodeXml(match[1])) : "<br>",
        )
        .join("");
      if (
        /<w:b(?:\s[^>]*)?\s*\/>/.test(run) &&
        !/<w:b\s+w:val="(?:0|false)"/.test(run)
      )
        value = `<strong>${value}</strong>`;
      if (/<w:i(?:\s[^>]*)?\s*\/>/.test(run)) value = `<em>${value}</em>`;
      if (/<w:u\b/.test(run)) value = `<u>${value}</u>`;
      return value;
    })
    .join("");
  const heading = /<w:pStyle\s+w:val="(?:Heading|heading)([1-3])"/.exec(
    xml,
  )?.[1];
  const element = heading ? `h${heading}` : /<w:numPr>/.test(xml) ? "li" : "p";
  return `<${element}>${content}</${element}>`;
}
export function importDocx(bytes: Uint8Array) {
  const zip = new PizZip(bytes);
  if (
    Object.keys(zip.files).some((name) =>
      /vbaProject|activeX|embeddings\//i.test(name),
    )
  )
    throw new PracticeError("ACTIVE_CONTENT_REJECTED");
  const xml = zip.file("word/document.xml")?.asText();
  if (!xml) throw new PracticeError("INVALID_DOCX");
  const blocks = [
    ...xml.matchAll(
      /<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,
    ),
  ];
  const html = blocks
    .map(([block]) =>
      block.startsWith("<w:tbl")
        ? `<table><tbody>${[...block.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)].map(([row]) => `<tr>${[...row.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map(([cell]) => `<td>${[...cell.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(([p]) => docxParagraph(p)).join("")}</td>`).join("")}</tr>`).join("")}</tbody></table>`
        : docxParagraph(block),
    )
    .join("");
  const warnings = ["basic_styles_only"];
  if (
    /<w:(?:drawing|object|pict|fldChar|footnoteReference|commentReference|sdt|tblGrid|gridSpan|vMerge)\b/.test(
      xml,
    )
  )
    warnings.push("unsupported_word_elements");
  return {
    html: sanitizeHtml(html),
    fields: [
      ...new Set(
        [...contentText(html).matchAll(/\{\{([\w.]+)\}\}/g)].map(
          (match) => match[1],
        ),
      ),
    ],
    warnings,
  };
}
export function fillFields(html: string, values: Record<string, string>) {
  return sanitizeHtml(
    html.replace(/\{\{([\w.]+)\}\}/g, (match, key) =>
      values[key] === undefined ? match : escapeHtml(values[key]),
    ),
  );
}
export const autoFields = [
  "client.name",
  "client.requisites",
  "provider.name",
  "provider.requisites",
  "case.title",
  "services",
  "amount",
  "currency",
  "deadline",
  "stages",
  "number",
  "date",
];

export function templateCatalog(locale: "ru" | "uz" | "en") {
  const titles = {
    ru: [
      "Договор юридических услуг",
      "Дополнительное соглашение",
      "Акт",
      "Коммерческое предложение",
      "Претензия",
      "Заявление",
      "Уведомление",
      "Сопроводительное письмо",
    ],
    uz: [
      "Yuridik xizmatlar shartnomasi",
      "Qo‘shimcha kelishuv",
      "Dalolatnoma",
      "Tijorat taklifi",
      "Talabnoma",
      "Ariza",
      "Bildirishnoma",
      "Ilova xati",
    ],
    en: [
      "Legal services agreement",
      "Supplemental agreement",
      "Acceptance certificate",
      "Service proposal",
      "Demand letter",
      "Application",
      "Notice",
      "Cover letter",
    ],
  }[locale];
  const kinds = [
    "services",
    "addendum",
    "act",
    "proposal",
    "demand",
    "application",
    "notice",
    "letter",
  ];
  const body = {
    ru: `<p>Проект для проверки юристом.</p><p>Номер {{number}} · {{date}}</p><p>Клиент: {{client.name}}</p><p>Исполнитель: {{provider.name}}</p><h2>Предмет</h2><p>{{services}}</p><h2>Условия</h2><p>Дело: {{case.title}}. Срок: {{deadline}}.</p><p>Этапы: {{stages}}</p><p>Стоимость: {{amount}} {{currency}}.</p><h2>Реквизиты</h2><p>{{client.requisites}}</p><p>{{provider.requisites}}</p>`,
    uz: `<p>Yurist tekshiruvi uchun loyiha.</p><p>Raqam {{number}} · {{date}}</p><p>Mijoz: {{client.name}}</p><p>Ijrochi: {{provider.name}}</p><h2>Predmet</h2><p>{{services}}</p><h2>Shartlar</h2><p>Ish: {{case.title}}. Muddat: {{deadline}}.</p><p>Bosqichlar: {{stages}}</p><p>Narx: {{amount}} {{currency}}.</p><h2>Rekvizitlar</h2><p>{{client.requisites}}</p><p>{{provider.requisites}}</p>`,
    en: `<p>Draft for review by a lawyer.</p><p>Number {{number}} · {{date}}</p><p>Client: {{client.name}}</p><p>Service provider: {{provider.name}}</p><h2>Scope</h2><p>{{services}}</p><h2>Terms</h2><p>Matter: {{case.title}}. Deadline: {{deadline}}.</p><p>Stages: {{stages}}</p><p>Fee: {{amount}} {{currency}}.</p><h2>Details</h2><p>{{client.requisites}}</p><p>{{provider.requisites}}</p>`,
  }[locale];
  const specific = {
    ru: [
      `<h2>Поручение и объём услуг</h2><p>Клиент поручает, а исполнитель принимает работу по делу «{{case.title}}»: {{services}}.</p><h2>Порядок работы</h2><p>Согласованные этапы: {{stages}}. Срок выполнения: {{deadline}}. Перед началом стороны уточняют необходимые документы, формат результата, обязанности и порядок обмена конфиденциальными сведениями.</p><h2>Вознаграждение</h2><p>Стоимость: {{amount}} {{currency}}. График оплаты и реквизиты сторон подлежат заполнению и согласованию. Подписание и оплата фиксируются отдельно.</p>`,
      `<h2>Изменяемые условия</h2><p>К договору № {{number}} от {{date}} по делу «{{case.title}}» стороны предлагают следующие изменения: {{services}}.</p><p>Новый срок: {{deadline}}. Этапы: {{stages}}. Изменение стоимости: {{amount}} {{currency}}.</p><p>Укажите дату вступления изменений в силу и положения основного договора, которые сохраняются.</p>`,
      `<h2>Переданные результаты</h2><p>По делу «{{case.title}}» исполнитель передаёт клиенту следующие результаты: {{services}}.</p><p>Период / этап: {{stages}}. Стоимость результата: {{amount}} {{currency}}.</p><h2>Замечания и приёмка</h2><p>Укажите замечания клиента либо согласованное подтверждение приёмки. Срок устранения замечаний: {{deadline}}. Этот проект сам по себе не подтверждает приёмку или оплату.</p>`,
      `<h2>Предложение</h2><p>Для {{client.name}} предлагаем сопровождение вопроса «{{case.title}}».</p><p>Состав услуг: {{services}}. Этапы: {{stages}}. Срок: {{deadline}}.</p><h2>Стоимость и условия</h2><p>Предлагаемая стоимость: {{amount}} {{currency}}. Уточните срок действия предложения, исключения из объёма работ и порядок заключения договора.</p>`,
      `<p>Адресат: {{client.name}}</p><h2>Обстоятельства и требование</h2><p>{{services}}</p><p>Связанный вопрос: {{case.title}}. Заявленная сумма: {{amount}} {{currency}}.</p><h2>Ответ и приложения</h2><p>Просим направить ответ в срок {{deadline}}. Юрист должен проверить основание требования и допустимость указанного срока. Приложения: {{stages}}.</p>`,
      `<p>Адресат: {{client.name}}</p><h2>Содержание заявления</h2><p>{{services}}</p><p>Связанный вопрос: {{case.title}}.</p><h2>Просьба и приложения</h2><p>Укажите конкретную просьбу, обстоятельства и подтверждающие документы. Приложения: {{stages}}. Применимый срок и основание: {{deadline}} — проверить юристу.</p>`,
      `<p>Получатель: {{client.name}}</p><h2>Содержание уведомления</h2><p>По вопросу «{{case.title}}» сообщаем: {{services}}.</p><p>Дата / срок действия: {{deadline}}. Связанные этапы: {{stages}}.</p><p>Уточните требуемый способ вручения и необходимость подтверждения получения.</p>`,
      `<p>Получатель: {{client.name}}</p><h2>Передача материалов</h2><p>Направляем материалы по вопросу «{{case.title}}»: {{services}}.</p><p>Опись приложений: {{stages}}. Просьба подтвердить получение / ответить до {{deadline}}.</p>`,
    ],
    uz: [
      `<h2>Topshiriq va xizmatlar hajmi</h2><p>Mijoz «{{case.title}}» ishi bo‘yicha quyidagi xizmatlarni topshiradi: {{services}}.</p><h2>Ish tartibi</h2><p>Kelishilgan bosqichlar: {{stages}}. Muddat: {{deadline}}. Tomonlar hujjatlar, natija shakli, majburiyatlar va maxfiy ma’lumot almashish tartibini aniqlashtiradi.</p><h2>Haq</h2><p>Narx: {{amount}} {{currency}}. To‘lov jadvali va rekvizitlar to‘ldiriladi hamda kelishiladi. Imzolash va to‘lov alohida qayd etiladi.</p>`,
      `<h2>O‘zgartiriladigan shartlar</h2><p>{{date}} sanadagi {{number}}-son shartnomaga, «{{case.title}}» ishi bo‘yicha o‘zgarishlar: {{services}}.</p><p>Yangi muddat: {{deadline}}. Bosqichlar: {{stages}}. Narx o‘zgarishi: {{amount}} {{currency}}.</p><p>O‘zgarishlar kuchga kiradigan sana va saqlanadigan shartlarni kiriting.</p>`,
      `<h2>Topshiriladigan natijalar</h2><p>«{{case.title}}» ishi bo‘yicha natijalar: {{services}}.</p><p>Davr / bosqich: {{stages}}. Narx: {{amount}} {{currency}}.</p><h2>Izohlar va qabul qilish</h2><p>Mijoz izohlari yoki kelishilgan qabul tasdig‘ini kiriting. Tuzatish muddati: {{deadline}}. Loyiha qabul yoki to‘lovni o‘zi tasdiqlamaydi.</p>`,
      `<h2>Taklif</h2><p>{{client.name}} uchun «{{case.title}}» masalasi bo‘yicha xizmat taklif qilamiz: {{services}}.</p><p>Bosqichlar: {{stages}}. Muddat: {{deadline}}.</p><h2>Narx va shartlar</h2><p>Taklif narxi: {{amount}} {{currency}}. Taklif muddati, istisnolar va shartnoma tuzish tartibini aniqlashtiring.</p>`,
      `<p>Qabul qiluvchi: {{client.name}}</p><h2>Holatlar va talab</h2><p>{{services}}</p><p>Masala: {{case.title}}. Talab summasi: {{amount}} {{currency}}.</p><h2>Javob va ilovalar</h2><p>Javob muddati: {{deadline}}. Talab asosi va muddatni yurist tekshiradi. Ilovalar: {{stages}}.</p>`,
      `<p>Qabul qiluvchi: {{client.name}}</p><h2>Ariza mazmuni</h2><p>{{services}}</p><p>Masala: {{case.title}}.</p><h2>So‘rov va ilovalar</h2><p>Aniq so‘rov, holatlar va dalillarni kiriting. Ilovalar: {{stages}}. Muddat va asos: {{deadline}} — yurist tekshiradi.</p>`,
      `<p>Qabul qiluvchi: {{client.name}}</p><h2>Bildirishnoma</h2><p>«{{case.title}}» masalasi bo‘yicha ma’lum qilamiz: {{services}}.</p><p>Sana / muddat: {{deadline}}. Bosqichlar: {{stages}}.</p><p>Yetkazish usuli va qabul tasdig‘i zarurligini aniqlashtiring.</p>`,
      `<p>Qabul qiluvchi: {{client.name}}</p><h2>Materiallarni yuborish</h2><p>«{{case.title}}» masalasi bo‘yicha materiallar: {{services}}.</p><p>Ilovalar ro‘yxati: {{stages}}. Qabulni tasdiqlash / javob muddati: {{deadline}}.</p>`,
    ],
    en: [
      `<h2>Instruction and scope</h2><p>The client instructs the provider in matter “{{case.title}}”: {{services}}.</p><h2>Working arrangements</h2><p>Agreed stages: {{stages}}. Deadline: {{deadline}}. Specify required documents, deliverables, responsibilities and confidential communication arrangements.</p><h2>Fees</h2><p>Fee: {{amount}} {{currency}}. Complete and agree the payment schedule and party details. Signature and payment are recorded separately.</p>`,
      `<h2>Amended terms</h2><p>Proposed changes to agreement {{number}} dated {{date}} for matter “{{case.title}}”: {{services}}.</p><p>Revised deadline: {{deadline}}. Stages: {{stages}}. Fee adjustment: {{amount}} {{currency}}.</p><p>Specify when the amendments take effect and which original terms remain in force.</p>`,
      `<h2>Delivered work</h2><p>Results delivered for matter “{{case.title}}”: {{services}}.</p><p>Period / stage: {{stages}}. Value: {{amount}} {{currency}}.</p><h2>Comments and acceptance</h2><p>Record the client's comments or agreed acceptance. Rectification deadline: {{deadline}}. This draft does not itself confirm acceptance or payment.</p>`,
      `<h2>Proposal</h2><p>For {{client.name}}, we propose assistance with “{{case.title}}”: {{services}}.</p><p>Stages: {{stages}}. Deadline: {{deadline}}.</p><h2>Fees and terms</h2><p>Proposed fee: {{amount}} {{currency}}. Specify proposal validity, exclusions and the process for agreeing an engagement.</p>`,
      `<p>Recipient: {{client.name}}</p><h2>Circumstances and demand</h2><p>{{services}}</p><p>Matter: {{case.title}}. Amount demanded: {{amount}} {{currency}}.</p><h2>Response and attachments</h2><p>Response requested by {{deadline}}. A lawyer must verify the basis of the demand and the deadline. Attachments: {{stages}}.</p>`,
      `<p>Recipient: {{client.name}}</p><h2>Application</h2><p>{{services}}</p><p>Matter: {{case.title}}.</p><h2>Request and attachments</h2><p>Specify the precise request, facts and supporting documents. Attachments: {{stages}}. Deadline and basis: {{deadline}} — for lawyer verification.</p>`,
      `<p>Recipient: {{client.name}}</p><h2>Notice</h2><p>Regarding “{{case.title}}”, we give notice of: {{services}}.</p><p>Effective date / deadline: {{deadline}}. Stages: {{stages}}.</p><p>Specify the required delivery method and whether receipt must be acknowledged.</p>`,
      `<p>Recipient: {{client.name}}</p><h2>Documents enclosed</h2><p>We enclose materials for “{{case.title}}”: {{services}}.</p><p>Enclosure list: {{stages}}. Please acknowledge receipt / respond by {{deadline}}.</p>`,
    ],
  }[locale];
  const header = body.slice(0, body.indexOf("<h2>"));
  const footer = body.slice(body.lastIndexOf("<h2>"));
  return titles.map((name, index) => ({
    id: `standard:${locale}:${kinds[index]}`,
    name,
    kind: kinds[index],
    language: locale,
    is_draft: true,
    content: { html: `<h1>${name}</h1>${header}${specific[index]}${footer}` },
    fields: autoFields,
  }));
}
