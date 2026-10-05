import type { PlatformLocale } from "./routing";

type Names = [ru: string, uz: string, en: string];
const localized = (rows: Names[], locale: PlatformLocale) => rows.map(row => row[locale === "ru" ? 0 : locale === "uz" ? 1 : 2]);

// Regional names: https://olddata.gov.uz/ru/datasets/15031
// Suggestions are deliberately non-exhaustive; all location fields accept custom places.
const regions: Names[] = [
  ["Ташкент", "Toshkent shahri", "Tashkent city"], ["Ташкентская область", "Toshkent viloyati", "Tashkent Region"],
  ["Республика Каракалпакстан", "Qoraqalpog‘iston Respublikasi", "Republic of Karakalpakstan"],
  ["Андижанская область", "Andijon viloyati", "Andijan Region"], ["Бухарская область", "Buxoro viloyati", "Bukhara Region"],
  ["Джизакская область", "Jizzax viloyati", "Jizzakh Region"], ["Кашкадарьинская область", "Qashqadaryo viloyati", "Kashkadarya Region"],
  ["Навоийская область", "Navoiy viloyati", "Navoi Region"], ["Наманганская область", "Namangan viloyati", "Namangan Region"],
  ["Самаркандская область", "Samarqand viloyati", "Samarkand Region"], ["Сурхандарьинская область", "Surxondaryo viloyati", "Surkhandarya Region"],
  ["Сырдарьинская область", "Sirdaryo viloyati", "Syrdarya Region"], ["Ферганская область", "Farg‘ona viloyati", "Fergana Region"],
  ["Хорезмская область", "Xorazm viloyati", "Khorezm Region"],
];
const cities: Names[] = [["Ташкент", "Toshkent", "Tashkent"], ["Самарканд", "Samarqand", "Samarkand"], ["Бухара", "Buxoro", "Bukhara"], ["Андижан", "Andijon", "Andijan"], ["Наманган", "Namangan", "Namangan"], ["Фергана", "Farg‘ona", "Fergana"], ["Нукус", "Nukus", "Nukus"], ["Карши", "Qarshi", "Karshi"], ["Термез", "Termiz", "Termez"], ["Джизак", "Jizzax", "Jizzakh"], ["Навои", "Navoiy", "Navoi"], ["Гулистан", "Guliston", "Gulistan"], ["Ургенч", "Urganch", "Urgench"], ["Нурафшан", "Nurafshon", "Nurafshon"], ["Коканд", "Qo‘qon", "Kokand"], ["Чирчик", "Chirchiq", "Chirchiq"]];

export function profileOptions(locale: PlatformLocale) {
  return {
    cities: localized(cities, locale), regions: localized(regions, locale),
    education: localized([
      ["Бакалавр юриспруденции", "Yurisprudensiya bakalavri", "Bachelor’s degree in law"],
      ["Магистр юриспруденции", "Yurisprudensiya magistri", "Master’s degree in law"],
      ["Специалист по юриспруденции", "Yurisprudensiya mutaxassisi", "Specialist degree in law"],
      ["Доктор философии (PhD) по юридическим наукам", "Yuridik fanlar bo‘yicha falsafa doktori (PhD)", "PhD in law"],
      ["Доктор юридических наук (DSc)", "Yuridik fanlar doktori (DSc)", "Doctor of Science (DSc) in law"],
    ], locale),
    specialties: localized([["Семейное право", "Oila huquqi", "Family law"], ["Трудовое право", "Mehnat huquqi", "Employment law"], ["Гражданское право", "Fuqarolik huquqi", "Civil law"], ["Уголовное право", "Jinoyat huquqi", "Criminal law"], ["Корпоративное право", "Korporativ huquq", "Corporate law"], ["Налоговое право", "Soliq huquqi", "Tax law"], ["Недвижимость", "Ko‘chmas mulk", "Real estate"]], locale),
    languages: localized([["Узбекский", "O‘zbekcha", "Uzbek"], ["Русский", "Ruscha", "Russian"], ["Английский", "Inglizcha", "English"], ["Каракалпакский", "Qoraqalpoqcha", "Karakalpak"]], locale),
    consultationFormats: localized([["Чат", "Chat", "Chat"], ["Телефон", "Telefon", "Phone"], ["Видеозвонок", "Videoqo‘ng‘iroq", "Video call"], ["Очно", "Yuzma-yuz", "In person"]], locale),
    additionalServices: localized([["Письменное заключение", "Yozma xulosa", "Written opinion"], ["Проверка договора", "Shartnomani tekshirish", "Contract review"], ["Подготовка документов", "Hujjatlarni tayyorlash", "Document preparation"], ["Представительство в суде", "Sudda vakillik", "Court representation"]], locale),
  };
}
