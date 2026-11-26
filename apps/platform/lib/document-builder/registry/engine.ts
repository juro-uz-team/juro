import type { RenderedParagraph } from "../types";
import type {
  AnswerScalar,
  AnswerValue,
  DocumentDefinition,
  FieldCondition,
  QuestionnaireAnswers,
  QuestionnaireField,
  RegistryLanguage,
} from "./types";

export type BuilderLanguage = Extract<RegistryLanguage, "ru" | "uz">;

export function localize(value: { ru: string; uz: string }, language: BuilderLanguage): string {
  return language === "uz" ? value.uz : value.ru;
}

export function getAnswer(answers: QuestionnaireAnswers | Record<string, unknown>, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(answers, path)) return answers[path];
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, answers);
}

export function setAnswer(answers: QuestionnaireAnswers, path: string, value: AnswerValue): QuestionnaireAnswers {
  return { ...answers, [path]: value };
}

export function conditionMatches(condition: FieldCondition | undefined, answers: QuestionnaireAnswers): boolean {
  if (!condition) return true;
  const actual = getAnswer(answers, condition.field);
  const text = String(actual ?? "").trim();
  switch (condition.operator) {
    case "equals": return actual === condition.value;
    case "not-equals": return actual !== condition.value;
    case "includes": return Array.isArray(actual) && actual.includes(condition.value);
    case "truthy": return Boolean(actual);
    case "falsy": return !actual;
    case "filled": return Array.isArray(actual) ? actual.length > 0 : text.length > 0;
    case "empty": return Array.isArray(actual) ? actual.length === 0 : text.length === 0;
  }
}

function defaultValue(field: QuestionnaireField): AnswerValue {
  if (field.type === "checkbox") return false;
  if (field.type === "multiselect") return [];
  if (field.type === "repeatable-group" || field.type === "table" || field.type === "witnesses") return [];
  return "";
}

export function createQuestionnaireAnswers(definition: DocumentDefinition): QuestionnaireAnswers {
  const answers: QuestionnaireAnswers = {};
  definition.questionnaire.forEach((step) => step.fields.forEach((field) => { answers[field.id] = defaultValue(field); }));
  return answers;
}

export function visibleFields(definition: DocumentDefinition, answers: QuestionnaireAnswers): QuestionnaireField[] {
  return definition.questionnaire.flatMap((step) => step.fields.filter((field) => conditionMatches(field.condition, answers)));
}

function isFilled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length > 0;
  return String(value ?? "").trim().length > 0;
}

export function validateQuestionnaire(definition: DocumentDefinition, answers: QuestionnaireAnswers): Record<string, string> {
  const errors: Record<string, string> = {};
  visibleFields(definition, answers).forEach((field) => {
    const value = getAnswer(answers, field.id);
    if (field.required && !isFilled(value)) errors[field.id] = "required";
    if (typeof value === "string" && field.validation?.minLength && value.trim().length < field.validation.minLength) errors[field.id] = "minLength";
    if (typeof value === "string" && field.validation?.maxLength && value.length > field.validation.maxLength) errors[field.id] = "maxLength";
    if (typeof value === "string" && value && field.validation?.pattern && !(new RegExp(field.validation.pattern).test(value))) errors[field.id] = "pattern";
  });
  return errors;
}

export function calculateQuestionnaireProgress(definition: DocumentDefinition, answers: QuestionnaireAnswers): number {
  const required = visibleFields(definition, answers).filter((field) => field.required);
  if (!required.length) return 0;
  return Math.round((required.filter((field) => isFilled(getAnswer(answers, field.id))).length / required.length) * 100);
}

function allFields(definition: DocumentDefinition): QuestionnaireField[] {
  return definition.questionnaire.flatMap((step) => step.fields.flatMap((field) => [field, ...(field.fields ?? []), ...(field.columns ?? [])]));
}

function formatDate(value: string, language: BuilderLanguage): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "uz" ? "uz-UZ" : "ru-RU", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function displayValue(definition: DocumentDefinition, key: string, value: unknown, language: BuilderLanguage, localFields?: QuestionnaireField[]): string {
  if (value === undefined || value === null || value === "") return "__________";
  if (typeof value === "boolean") return value ? (language === "uz" ? "Ha" : "Да") : (language === "uz" ? "Yo‘q" : "Нет");
  if (Array.isArray(value)) return value.map(String).join(", ");
  const field = (localFields ?? allFields(definition)).find((item) => item.id === key || item.id.split(".").at(-1) === key);
  const option = field?.options?.find((item) => item.value === String(value));
  if (option) return localize(option.label, language);
  if (field?.type === "date") return formatDate(String(value), language);
  return String(value);
}

function interpolate(
  template: string,
  definition: DocumentDefinition,
  answers: QuestionnaireAnswers,
  language: BuilderLanguage,
  localItem?: Record<string, AnswerScalar>,
  localFields?: QuestionnaireField[],
  row?: { group: string; index: number },
): Pick<RenderedParagraph, "text" | "parts"> {
  const parts: NonNullable<RenderedParagraph["parts"]> = [];
  let end = 0;
  for (const match of template.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) {
    const [, key] = match;
    const useRow = Boolean(localItem && (Object.hasOwn(localItem, key) || localFields?.some(field => field.id === key)));
    const value = useRow && localItem ? localItem[key] : getAnswer(answers, key);
    if (match.index > end) parts.push({ text: template.slice(end, match.index) });
    parts.push({ text: displayValue(definition, key, value, language, useRow ? localFields : undefined), field: { key, row: useRow ? row : undefined } });
    end = match.index + match[0].length;
  }
  if (end < template.length) parts.push({ text: template.slice(end) });
  return { text: parts.map(part => part.text).join(""), parts };
}

export function renderConfiguredDocument(definition: DocumentDefinition, answers: QuestionnaireAnswers, language: BuilderLanguage, includeFields = false): { title: string; paragraphs: RenderedParagraph[]; plainText: string } {
  const fields = allFields(definition);
  const paragraphs: RenderedParagraph[] = [];
  definition.generationSchema.paragraphs.forEach((paragraph) => {
    if (!conditionMatches(paragraph.condition, answers)) return;
    const text = localize(paragraph.text, language);
    if (paragraph.repeatFor) {
      const items = getAnswer(answers, paragraph.repeatFor);
      const group = fields.find((field) => field.id === paragraph.repeatFor);
      if (Array.isArray(items)) items.forEach((item, index) => {
        if (!item || typeof item !== "object") return;
        paragraphs.push({ id: `${paragraph.id}-${index}`, kind: paragraph.kind, ...interpolate(text, definition, answers, language, item as Record<string, AnswerScalar>, group?.fields ?? group?.columns, { group: paragraph.repeatFor!, index }) });
      });
      return;
    }
    paragraphs.push({ id: paragraph.id, kind: paragraph.kind, ...interpolate(text, definition, answers, language) });
  });
  return {
    title: language === "uz" ? definition.titleUz : definition.titleRu,
    paragraphs: includeFields ? paragraphs : paragraphs.map(({ parts: _parts, ...paragraph }) => paragraph),
    plainText: paragraphs.map((paragraph) => paragraph.text).join("\n\n"),
  };
}
