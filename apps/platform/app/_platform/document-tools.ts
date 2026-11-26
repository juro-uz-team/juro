import { useEffect, useState } from "react";
import type { PlatformLocale } from "../../lib/platform/routing";

export const documentTools = {
  ru: {
    library: "Мои документы", create: "Создать документ", createHint: "Составить документ по шаблону",
    check: "Проверить документ", checkHint: "Найти риски, сроки и условия, которые стоит уточнить.",
    compare: "Сравнить документы", compareHint: "Увидеть изменения в тексте и их правовые последствия.",
    select: "Выбрать для проверки или сравнения", pickOne: "Выберите документ для проверки", pickTwo: "Выберите исходный документ, затем новую редакцию",
    clear: "Снять выбор", choose: "Выбрать из моих документов", file: "Файл", link: "По ссылке", chooseFile: "Выберите или перетащите файл",
    loading: "Открываем выбранные документы…", unavailable: "Не удалось открыть документ. Проверьте доступ к скачиванию или выберите другой файл.",
    emptyText: "В документе пока нет текста. Добавьте текст в конструкторе и повторите проверку.",
    intake: "Новая проверка", queued: "Документ принят на проверку.", stages: ["Подготовка", "Извлечение текста", "Поиск правовых норм", "Анализ условий", "Сохранение"],
    quality: "Оценка документа", deadlines: "Сроки", sources: "Правовые источники", advice: "Рекомендации", disputes: "Противоречия",
    warnings: "Ограничения извлечения", emptyHistory: "После первой проверки здесь появится отчёт.", actions: "Действия с отчётом",
  },
  uz: {
    library: "Mening hujjatlarim", create: "Hujjat yaratish", createHint: "Shablon asosida hujjat tuzish",
    check: "Hujjatni tekshirish", checkHint: "Xavflar, muddatlar va aniqlashtiriladigan shartlarni ko‘ring.",
    compare: "Hujjatlarni taqqoslash", compareHint: "Matndagi o‘zgarishlar va ularning huquqiy ta’sirini ko‘ring.",
    select: "Tekshirish yoki taqqoslash uchun tanlash", pickOne: "Tekshirish uchun hujjatni tanlang", pickTwo: "Avval asl hujjatni, keyin yangi tahrirni tanlang",
    clear: "Tanlovni bekor qilish", choose: "Hujjatlarimdan tanlash", file: "Fayl", link: "Havola", chooseFile: "Faylni tanlang yoki shu yerga tashlang",
    loading: "Tanlangan hujjatlar ochilmoqda…", unavailable: "Hujjatni ochib bo‘lmadi. Yuklab olish ruxsatini tekshiring yoki boshqa fayl tanlang.",
    emptyText: "Hujjat matni bo‘sh. Konstruktorda matn qo‘shib, qayta urinib ko‘ring.",
    intake: "Yangi tekshiruv", queued: "Hujjat tekshiruvga qabul qilindi.", stages: ["Tayyorlash", "Matnni ajratish", "Huquqiy izlanish", "Shartlarni tekshirish", "Saqlash"],
    quality: "Hujjat bahosi", deadlines: "Muddatlar", sources: "Huquqiy manbalar", advice: "Tavsiyalar", disputes: "Ziddiyatlar",
    warnings: "Matnni ajratishdagi cheklovlar", emptyHistory: "Birinchi tekshiruvdan so‘ng hisobot shu yerda ko‘rinadi.", actions: "Hisobot amallari",
  },
  en: {
    library: "My documents", create: "Create a document", createHint: "Draft a document from a template",
    check: "Check a document", checkHint: "Find risks, deadlines and terms worth clarifying.",
    compare: "Compare documents", compareHint: "See exactly what changed and what it means for each party.",
    select: "Select for review or comparison", pickOne: "Choose a document to check", pickTwo: "Choose the original first, then the revised document",
    clear: "Clear selection", choose: "Choose from my documents", file: "File", link: "Public link", chooseFile: "Choose a file or drop it here",
    loading: "Opening selected documents…", unavailable: "This document could not be opened. Check your download access or choose another file.",
    emptyText: "This draft has no text yet. Add text in the builder and try again.",
    intake: "New check", queued: "Document submitted for review.", stages: ["Prepare file", "Extract text", "Research the law", "Review terms", "Save report"],
    quality: "Document quality", deadlines: "Deadlines", sources: "Legal sources", advice: "Recommendations", disputes: "Conflicting terms",
    warnings: "Extraction limitations", emptyHistory: "Your first report will appear here after you check a document.", actions: "Report actions",
  },
} as const;

// Only fixed, authenticated library routes can supply a tool input.
export function useDocumentToolFile(source: string | null, locale: PlatformLocale, onFile: (file: File) => void) {
  const [result, setResult] = useState({ source: "", error: "" });
  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    const copy = documentTools[locale];
    async function open() {
      const parts = source!.split(":");
      const [kind, id, fileId] = parts;
      if (!parts.slice(1).every(value => /^[\w-]{1,128}$/.test(value))) throw new Error(copy.unavailable);
      let path: string;
      if (kind === "doc" && parts.length === 2) path = `documents/${id}/tool-file`;
      else if (kind === "file" && parts.length === 2) path = `standalone-files/${id}`;
      else if (kind === "tool" && parts.length === 2) path = `/api/platform/document-review/files/${id}`;
      else if (kind === "signed" && parts.length === 3) path = `documents/${id}/files/${fileId}`;
      else throw new Error(copy.unavailable);
      const response = await fetch(path.startsWith("/") ? path : `/api/document-builder/${path}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 400 && kind === "doc" ? copy.emptyText : copy.unavailable);
      const name = response.headers.get("content-disposition")?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      if (!name) throw new Error(copy.unavailable);
      const blob = await response.blob();
      if (!controller.signal.aborted) onFile(new File([blob], decodeURIComponent(name), { type: blob.type }));
    }
    void open().then(() => {
      if (!controller.signal.aborted) setResult({ source, error: "" });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ source, error: error instanceof Error && error.message === copy.emptyText ? copy.emptyText : copy.unavailable });
    });
    return () => controller.abort();
  }, [source, locale, onFile]);
  return { loading: Boolean(source && source !== result.source), error: result.source === source ? result.error : "" };
}
