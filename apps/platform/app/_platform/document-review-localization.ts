import type { PlatformLocale } from "../../lib/platform/routing";

type DocumentReviewCopy = {
  modeAria: string;
  loadError: string;
  completed: string;
  imported: string;
  hashing: string;
  finalizing: string;
  uploading: string;
  uploadPercent: (percent: number) => string;
  consentFile: string;
  consentUrl: string;
  supportedFiles: string;
  fileHint: string;
  chooseFileAria: string;
  addToCase: string;
  noCase: string;
  uploadProgressAria: string;
  uploadAndReview: string;
  analysisLanguage: string;
  analysisLanguageHint: string;
  russian: string;
  uzbek: string;
  importTitle: string;
  importHint: string;
  importAction: string;
  importUnavailableAria: string;
  importUnavailable: string;
  importUnavailableHint: string;
  recentFiles: string;
  noFiles: string;
  resultAria: string;
  selectFile: string;
  openFile: string;
  deleteAnalysis: string;
  case: string;
  saveCaseLink: string;
  caseSaveError: string;
  caseLinked: string;
  caseUnlinked: string;
  deleteAnalysisConfirm: string;
  deleteAnalysisError: string;
  summary: string;
  parties: string;
  dates: string;
  obligations: string;
  payments: string;
  risks: string;
  confidence: string;
  noRisks: string;
  missing: string;
  questions: string;
  disclaimer: string;
  revisionsTitle: string;
  revisionsDescription: string;
  correctedVersions: string;
  builderStale: string;
  toBuilder: string;
  clean: string;
  redline: string;
  normalizedNote: string;
  retry: string;
  loadingRevisions: string;
  noRevisions: string;
  noRevisionsHint: string;
  pageShort: string;
  originalText: string;
  proposedText: string;
  rationale: string;
  relatedSources: string;
  includeSelected: string;
  reject: string;
  accept: string;
  acceptedCount: (accepted: number, selected: number) => string;
  immutableVersion: string;
  applySelected: string;
  applyAll: string;
  confirmTitle: string;
  confirmAll: (count: number) => string;
  confirmSelected: (count: number) => string;
  cancel: string;
  createVersion: string;
  packageTitle: string;
  packageDescription: string;
  primary: string;
  confidenceLower: string;
  noRelationships: string;
  outputLanguageNote: string;
};

export const documentReviewCopy = {
  ru: {
    modeAria: "Режим анализа",
    loadError: "Анализы не загрузились.",
    completed: "Анализ завершён.",
    imported: "Файл защищённо импортирован для анализа.",
    hashing: "Проверяем целостность файла…",
    finalizing: "Защищённо сохраняем файл для анализа…",
    uploading: "Передаём файл…",
    uploadPercent: (percent) => `Передаём файл: ${percent}%`,
    consentFile: "Согласен(на) на приватное сохранение и автоматизированный анализ выбранного файла. Понимаю, что результат нужно проверить.",
    consentUrl: "Согласен(на) на приватное сохранение и автоматизированный анализ выбранного файла или публичной ссылки. Понимаю, что результат нужно проверить.",
    supportedFiles: "PDF, DOCX, JPG, PNG или ZIP",
    fileHint: "До 50 МБ · потоковая загрузка с SHA-256",
    chooseFileAria: "Выберите файл для анализа",
    addToCase: "Добавить анализ в дело",
    noCase: "Без дела",
    uploadProgressAria: "Прогресс загрузки файла",
    uploadAndReview: "Загрузить и проверить",
    analysisLanguage: "Язык анализа",
    analysisLanguageHint: "Юридический результат будет сформирован на выбранном языке.",
    russian: "Русский",
    uzbek: "Узбекский",
    importTitle: "Импортировать публичную ссылку",
    importHint: "Только HTTPS · без паролей и закрытых кабинетов · PDF, DOCX, JPG, PNG или ZIP",
    importAction: "Импортировать",
    importUnavailableAria: "Импорт по публичной ссылке временно недоступен",
    importUnavailable: "Импорт по публичной ссылке",
    importUnavailableHint: "Контролируемая beta-функция временно недоступна. Загрузите файл с устройства.",
    recentFiles: "Последние файлы",
    noFiles: "Загруженных файлов пока нет.",
    resultAria: "Результат анализа документа",
    selectFile: "Выберите файл для анализа",
    openFile: "Открыть файл",
    deleteAnalysis: "Удалить анализ",
    case: "Дело",
    saveCaseLink: "Сохранить привязку",
    caseSaveError: "Дело не сохранено.",
    caseLinked: "Анализ добавлен в дело.",
    caseUnlinked: "Анализ отвязан от дела.",
    deleteAnalysisConfirm: "Удалить анализ, исходный файл, результаты и экспорты без возможности восстановления?",
    deleteAnalysisError: "Анализ не удалён.",
    summary: "Краткое резюме",
    parties: "Стороны",
    dates: "Даты",
    obligations: "Обязательства",
    payments: "Платежи",
    risks: "Риски",
    confidence: "Уверенность",
    noRisks: "Структурированные риски не найдены.",
    missing: "Не хватает",
    questions: "Вопросы пользователю",
    disclaimer: "Автоматический анализ не заменяет проверку юриста.",
    revisionsTitle: "Предлагаемые исправления",
    revisionsDescription: "Откройте любое предложение. Доступные правки можно применить к отдельной версии документа.",
    correctedVersions: "Исправленные версии",
    builderStale: "Документ изменился после анализа — запустите новый анализ",
    toBuilder: "В конструктор",
    clean: "Чистая",
    redline: "С отметками",
    normalizedNote: "Исправления создают отдельный нормализованный Markdown-файл. Исходный PDF или DOCX и его форматирование не изменяются.",
    retry: "Повторить",
    loadingRevisions: "Загружаем исправления",
    noRevisions: "Для этого анализа нет применимых исправлений",
    noRevisionsHint: "Старые анализы могут не иметь нормализованной исходной версии. Новый анализ создаёт её автоматически.",
    pageShort: "стр.",
    originalText: "Исходный текст",
    proposedText: "Предлагаемый текст",
    rationale: "Обоснование:",
    relatedSources: "Связанные источники:",
    includeSelected: "Включить в выбранные",
    reject: "Отклонить",
    accept: "Принять",
    acceptedCount: (accepted, selected) => `Принято: ${accepted}. Выбрано: ${selected}.`,
    immutableVersion: "Каждое применение создаёт новую неизменяемую версию.",
    applySelected: "Применить выбранные",
    applyAll: "Применить все доступные",
    confirmTitle: "Создать новую нормализованную версию?",
    confirmAll: (count) => `Будут применены все доступные исправления: ${count}.`,
    confirmSelected: (count) => `Будут применены выбранные исправления: ${count}.`,
    cancel: "Отмена",
    createVersion: "Создать версию",
    packageTitle: "Связи документов в пакете",
    packageDescription: "JURO определил структуру по именам и содержимому файлов. Проверьте связи перед применением юридических выводов.",
    primary: "Основной",
    confidenceLower: "уверенность",
    noRelationships: "Явные связи не найдены; файлы будут проанализированы как единый пакет.",
    outputLanguageNote: "Язык результата соответствует языку интерфейса.",
  },
  uz: {
    modeAria: "Tahlil rejimi",
    loadError: "Tahlillar yuklanmadi.",
    completed: "Tahlil yakunlandi.",
    imported: "Fayl tahlil uchun himoyalangan tarzda import qilindi.",
    hashing: "Fayl yaxlitligi tekshirilmoqda…",
    finalizing: "Fayl tahlil uchun himoyalangan tarzda saqlanmoqda…",
    uploading: "Fayl yuborilmoqda…",
    uploadPercent: (percent) => `Fayl yuborilmoqda: ${percent}%`,
    consentFile: "Tanlangan faylni maxfiy saqlash va avtomatlashtirilgan tahlilga roziman. Natijani tekshirish kerakligini tushunaman.",
    consentUrl: "Tanlangan fayl yoki ommaviy havolani maxfiy saqlash va avtomatlashtirilgan tahlilga roziman. Natijani tekshirish kerakligini tushunaman.",
    supportedFiles: "PDF, DOCX, JPG, PNG yoki ZIP",
    fileHint: "50 MB gacha · SHA-256 bilan oqimli yuklash",
    chooseFileAria: "Tahlil uchun faylni tanlang",
    addToCase: "Tahlilni ishga qo‘shish",
    noCase: "Ishsiz",
    uploadProgressAria: "Fayl yuklash jarayoni",
    uploadAndReview: "Yuklash va tekshirish",
    analysisLanguage: "Tahlil tili",
    analysisLanguageHint: "Yuridik natija tanlangan tilda yaratiladi.",
    russian: "Rus tili",
    uzbek: "O‘zbek tili",
    importTitle: "Ommaviy havolani import qilish",
    importHint: "Faqat HTTPS · parol va yopiq kabinetlarsiz · PDF, DOCX, JPG, PNG yoki ZIP",
    importAction: "Import qilish",
    importUnavailableAria: "Ommaviy havola orqali import vaqtincha mavjud emas",
    importUnavailable: "Ommaviy havola orqali import",
    importUnavailableHint: "Nazorat qilinadigan beta-funksiya vaqtincha mavjud emas. Faylni qurilmadan yuklang.",
    recentFiles: "So‘nggi fayllar",
    noFiles: "Hozircha yuklangan fayllar yo‘q.",
    resultAria: "Hujjat tahlili natijasi",
    selectFile: "Tahlil uchun faylni tanlang",
    openFile: "Faylni ochish",
    deleteAnalysis: "Tahlilni o‘chirish",
    case: "Ish",
    saveCaseLink: "Bog‘lanishni saqlash",
    caseSaveError: "Ish saqlanmadi.",
    caseLinked: "Tahlil ishga qo‘shildi.",
    caseUnlinked: "Tahlil ishdan ajratildi.",
    deleteAnalysisConfirm: "Tahlil, asl fayl, natijalar va eksportlar tiklash imkoniyatisiz o‘chirilsinmi?",
    deleteAnalysisError: "Tahlil o‘chirilmadi.",
    summary: "Qisqa xulosa",
    parties: "Tomonlar",
    dates: "Sanalar",
    obligations: "Majburiyatlar",
    payments: "To‘lovlar",
    risks: "Xavflar",
    confidence: "Ishonch",
    noRisks: "Tuzilgan xavflar topilmadi.",
    missing: "Yetishmaydi",
    questions: "Foydalanuvchiga savollar",
    disclaimer: "Avtomatik tahlil yurist tekshiruvini almashtirmaydi.",
    revisionsTitle: "Taklif etilgan tuzatishlar",
    revisionsDescription: "Istalgan taklifni oching. Mavjud tahrirlarni hujjatning alohida nusxasiga qo‘llash mumkin.",
    correctedVersions: "Tuzatilgan nusxalar",
    builderStale: "Hujjat tahlildan keyin o‘zgardi — yangi tahlilni boshlang",
    toBuilder: "Konstruktorga",
    clean: "Toza",
    redline: "Belgilar bilan",
    normalizedNote: "Tuzatishlar alohida normallashtirilgan Markdown faylini yaratadi. Asl PDF yoki DOCX va uning formatlanishi o‘zgarmaydi.",
    retry: "Takrorlash",
    loadingRevisions: "Tuzatishlar yuklanmoqda",
    noRevisions: "Bu tahlil uchun qo‘llanadigan tuzatishlar yo‘q",
    noRevisionsHint: "Eski tahlillarda normallashtirilgan manba nusxasi bo‘lmasligi mumkin. Yangi tahlil uni avtomatik yaratadi.",
    pageShort: "sah.",
    originalText: "Asl matn",
    proposedText: "Taklif etilgan matn",
    rationale: "Asos:",
    relatedSources: "Bog‘langan manbalar:",
    includeSelected: "Tanlanganlarga qo‘shish",
    reject: "Rad etish",
    accept: "Qabul qilish",
    acceptedCount: (accepted, selected) => `Qabul qilindi: ${accepted}. Tanlandi: ${selected}.`,
    immutableVersion: "Har bir qo‘llash yangi o‘zgarmas nusxani yaratadi.",
    applySelected: "Tanlanganlarni qo‘llash",
    applyAll: "Barcha mavjudlarini qo‘llash",
    confirmTitle: "Yangi normallashtirilgan nusxa yaratilsinmi?",
    confirmAll: (count) => `Barcha mavjud tuzatishlar qo‘llanadi: ${count}.`,
    confirmSelected: (count) => `Tanlangan tuzatishlar qo‘llanadi: ${count}.`,
    cancel: "Bekor qilish",
    createVersion: "Nusxa yaratish",
    packageTitle: "Paketdagi hujjatlar aloqasi",
    packageDescription: "JURO tuzilmani fayl nomlari va mazmuni bo‘yicha aniqladi. Huquqiy xulosalarni qo‘llashdan oldin aloqalarni tekshiring.",
    primary: "Asosiy",
    confidenceLower: "ishonch",
    noRelationships: "Aniq aloqalar topilmadi; fayllar yagona paket sifatida tahlil qilinadi.",
    outputLanguageNote: "Natija tili interfeys tiliga mos keladi.",
  },
  en: {
    modeAria: "Analysis mode",
    loadError: "Analyses could not be loaded.",
    completed: "Analysis complete.",
    imported: "The file was securely imported for analysis.",
    hashing: "Verifying file integrity…",
    finalizing: "Securely saving the file for analysis…",
    uploading: "Uploading file…",
    uploadPercent: (percent) => `Uploading file: ${percent}%`,
    consentFile: "I consent to the private storage and automated analysis of the selected file. I understand that the result must be reviewed.",
    consentUrl: "I consent to the private storage and automated analysis of the selected file or public link. I understand that the result must be reviewed.",
    supportedFiles: "PDF, DOCX, JPG, PNG or ZIP",
    fileHint: "Up to 50 MB · streaming upload with SHA-256 verification",
    chooseFileAria: "Choose a file to analyse",
    addToCase: "Add analysis to a case",
    noCase: "No case",
    uploadProgressAria: "File upload progress",
    uploadAndReview: "Upload and review",
    analysisLanguage: "Analysis language",
    analysisLanguageHint: "Legal analysis is currently available in Russian and Uzbek. Choose the language for findings and suggested wording.",
    russian: "Russian",
    uzbek: "Uzbek",
    importTitle: "Import a public link",
    importHint: "HTTPS only · no passwords or private portals · PDF, DOCX, JPG, PNG or ZIP",
    importAction: "Import",
    importUnavailableAria: "Public-link import is temporarily unavailable",
    importUnavailable: "Public-link import",
    importUnavailableHint: "This controlled beta feature is temporarily unavailable. Upload a file from your device instead.",
    recentFiles: "Recent files",
    noFiles: "No files have been uploaded yet.",
    resultAria: "Document analysis result",
    selectFile: "Choose a file to analyse",
    openFile: "Open file",
    deleteAnalysis: "Delete analysis",
    case: "Case",
    saveCaseLink: "Save case link",
    caseSaveError: "The case link could not be saved.",
    caseLinked: "The analysis was added to the case.",
    caseUnlinked: "The analysis was removed from the case.",
    deleteAnalysisConfirm: "Permanently delete this analysis, its source file, results and exports? This action cannot be undone.",
    deleteAnalysisError: "The analysis could not be deleted.",
    summary: "Executive summary",
    parties: "Parties",
    dates: "Dates",
    obligations: "Obligations",
    payments: "Payments",
    risks: "Risks",
    confidence: "Confidence",
    noRisks: "No structured risks were identified.",
    missing: "Missing information",
    questions: "Questions for you",
    disclaimer: "Automated analysis does not replace review by a qualified lawyer.",
    revisionsTitle: "Suggested revisions",
    revisionsDescription: "Open any suggestion to review it. Apply eligible edits to a separate version of the document.",
    correctedVersions: "Corrected versions",
    builderStale: "The document changed after this analysis. Run a new analysis before applying corrections.",
    toBuilder: "Apply in builder",
    clean: "Clean",
    redline: "Redline",
    normalizedNote: "Corrections create a separate normalized Markdown file. The source PDF or DOCX and its formatting remain unchanged.",
    retry: "Try again",
    loadingRevisions: "Loading suggested revisions",
    noRevisions: "No applicable revisions are available for this analysis",
    noRevisionsHint: "Older analyses may not include a normalized source version. New analyses create one automatically.",
    pageShort: "p.",
    originalText: "Original text",
    proposedText: "Proposed text",
    rationale: "Rationale:",
    relatedSources: "Related sources:",
    includeSelected: "Include in selection",
    reject: "Reject",
    accept: "Accept",
    acceptedCount: (accepted, selected) => `Accepted: ${accepted}. Selected: ${selected}.`,
    immutableVersion: "Each application creates a new immutable version.",
    applySelected: "Apply selected",
    applyAll: "Apply all available",
    confirmTitle: "Create a new normalized version?",
    confirmAll: (count) => `All available revisions will be applied: ${count}.`,
    confirmSelected: (count) => `Selected revisions will be applied: ${count}.`,
    cancel: "Cancel",
    createVersion: "Create version",
    packageTitle: "Document relationships in this package",
    packageDescription: "JURO inferred the structure from file names and content. Review these relationships before relying on the legal findings.",
    primary: "Primary",
    confidenceLower: "confidence",
    noRelationships: "No explicit relationships were found; the files will be analysed as one package.",
    outputLanguageNote: "Legal findings and suggested wording use the analysis language selected above; JURO does not translate source clauses automatically.",
  },
} satisfies Record<PlatformLocale, DocumentReviewCopy>;

export function reviewText(locale: PlatformLocale, ru: string, uz: string, en: string): string {
  return { ru, uz, en }[locale];
}
