/**
 * JURO-owned legal-query normalization for Russian and Uzbek (Latin/Cyrillic).
 *
 * This is a clean TypeScript implementation of a behavioural need identified
 * during the Huquq AI audit. It contains no upstream corpus or copied code.
 */

export type LegalDocumentAlias =
  | "constitution"
  | "civil_code"
  | "labor_code"
  | "criminal_code"
  | "tax_code"
  | "family_code"
  | "administrative_code";

export type LegalQueryLanguage = "ru" | "uz-Latn" | "uz-Cyrl" | "en" | "mixed";

const APOSTROPHES = /[’‘ʼ`´ʻ]/gu;
const CYRILLIC_UZBEK = new Map<string, string>([
  ["а", "a"], ["б", "b"], ["в", "v"], ["г", "g"], ["д", "d"], ["е", "e"],
  ["ё", "yo"], ["ж", "j"], ["з", "z"], ["и", "i"], ["й", "y"], ["к", "k"],
  ["л", "l"], ["м", "m"], ["н", "n"], ["о", "o"], ["п", "p"], ["р", "r"],
  ["с", "s"], ["т", "t"], ["у", "u"], ["ф", "f"], ["х", "x"], ["ц", "ts"],
  ["ч", "ch"], ["ш", "sh"], ["щ", "sh"], ["ъ", ""], ["ь", ""], ["э", "e"],
  ["ю", "yu"], ["я", "ya"], ["ў", "oʻ"], ["қ", "q"], ["ғ", "gʻ"], ["ҳ", "h"],
]);

const DOCUMENT_ALIASES: ReadonlyArray<readonly [LegalDocumentAlias, RegExp]> = [
  ["constitution", /(?:конституц|konstitutsiya)/iu],
  ["civil_code", /(?:гражданск\p{L}*\s+кодекс|fuqarolik\s+kodeksi|\bгк\b|\bfk\b)/iu],
  ["labor_code", /(?:трудов\p{L}*\s+кодекс|mehnat\s+kodeksi|\bтк\b|\bmk\b)/iu],
  ["criminal_code", /(?:уголовн\p{L}*\s+кодекс|jinoyat\s+kodeksi|\bук\b|\bjk\b)/iu],
  ["tax_code", /(?:налогов\p{L}*\s+кодекс|soliq\s+kodeksi|\bнк\b|\bsk\b)/iu],
  ["family_code", /(?:семейн\p{L}*\s+кодекс|oila\s+kodeksi|\bск\b|\bok\b)/iu],
  ["administrative_code", /(?:административн\p{L}*\s+кодекс|ma.muriy\s+javobgarlik|\bмжк\b|\bmjk\b)/iu],
];

const SUPERSCRIPT_DIGITS = new Map([
  ["⁰", "0"], ["¹", "1"], ["²", "2"], ["³", "3"], ["⁴", "4"],
  ["⁵", "5"], ["⁶", "6"], ["⁷", "7"], ["⁸", "8"], ["⁹", "9"],
]);
const ARTICLE_NUMBER = "\\d+(?:(?:[.-]\\d+)|(?:[⁰¹²³⁴⁵⁶⁷⁸⁹]+)|(?:\\s+prim(?:a|b|v)?))?";
const ARTICLE_PREFIX = new RegExp(
  "(?:стать(?:я|и|ю|ей|ёй|е)|ст\\.?|модда(?:си|нинг)?|modda(?:si|ning)?|article)\\s*[№#]?\\s*(" + ARTICLE_NUMBER + ")",
  "giu",
);
const ARTICLE_SUFFIX = new RegExp(
  "(" + ARTICLE_NUMBER + ")\\s*(?:-?\\s*)?(?:модда(?:си|нинг)?|modda(?:si|ning)?)",
  "giu",
);

const LEGAL_ABBREVIATIONS: Readonly<Record<string, readonly string[]>> = {
  "гк": ["гражданский кодекс", "fuqarolik kodeksi"],
  "тк": ["трудовой кодекс", "mehnat kodeksi"],
  "ук": ["уголовный кодекс", "jinoyat kodeksi"],
  "нк": ["налоговый кодекс", "soliq kodeksi"],
  "ск": ["семейный кодекс", "oila kodeksi"],
  "мжк": ["кодекс об административной ответственности", "ma'muriy javobgarlik kodeksi"],
  "фк": ["fuqarolik kodeksi", "гражданский кодекс"],
  "мк": ["mehnat kodeksi", "трудовой кодекс"],
  "жк": ["jinoyat kodeksi", "уголовный кодекс"],
  "скк": ["soliq kodeksi", "налоговый кодекс"],
};

function normalized(value: string): string {
  return value.normalize("NFKC").replace(APOSTROPHES, "ʻ").replace(/[‐‑–—]/gu, "-");
}

/** Normalizes apostrophes and Unicode form without translating official Latin text. */
export function normalizeUzbekLatin(value: string): string {
  return normalized(value);
}

/** Normalizes the Uzbek Cyrillic alphabet without translating it. */
export function normalizeUzbekCyrillic(value: string): string {
  return normalized(value)
    .replace(/[ЎҚҒҲ]/gu, (character) => character.toLowerCase())
    .replace(/[Ё]/gu, "ё");
}

/** Transliteration is query-only; it must never replace the displayed official source. */
export function transliterateUzbek(value: string): string {
  // Only Cyrillic characters reach this callback; their case mapping is not
  // locale-sensitive. Avoid initializing locale handling for each character.
  return normalizeUzbekCyrillic(value).replace(/[\p{Script=Cyrillic}]/gu, (character) =>
    CYRILLIC_UZBEK.get(character.toLowerCase()) ?? character,
  );
}

/** Query-only Latin-to-Cyrillic variant. Official quotations are never changed. */
export function transliterateUzbekToCyrillic(value: string): string {
  const normalizedValue = normalizeUzbekLatin(value).toLocaleLowerCase("uz");
  const digraphs: ReadonlyArray<readonly [RegExp, string]> = [
    [/oʻ/gu, "ў"], [/gʻ/gu, "ғ"], [/sh/gu, "ш"], [/ch/gu, "ч"],
    [/yo/gu, "ё"], [/yu/gu, "ю"], [/ya/gu, "я"], [/ts/gu, "ц"],
  ];
  let converted = normalizedValue;
  const protectedCharacters: string[] = [];
  for (const [pattern, replacement] of digraphs) {
    converted = converted.replace(pattern, () => {
      const marker = String.fromCodePoint(0xE000 + protectedCharacters.length);
      protectedCharacters.push(replacement);
      return marker;
    });
  }
  const latin = new Map<string, string>([
    ["a", "а"], ["b", "б"], ["d", "д"], ["e", "е"], ["f", "ф"],
    ["g", "г"], ["h", "ҳ"], ["i", "и"], ["j", "ж"], ["k", "к"],
    ["l", "л"], ["m", "м"], ["n", "н"], ["o", "о"], ["p", "п"],
    ["q", "қ"], ["r", "р"], ["s", "с"], ["t", "т"], ["u", "у"],
    ["v", "в"], ["x", "х"], ["y", "й"], ["z", "з"],
  ]);
  converted = converted.replace(/[a-z]/gu, (character) => latin.get(character) ?? character);
  return converted.replace(/[\uE000-\uF8FF]/gu, (marker) =>
    protectedCharacters[marker.codePointAt(0)! - 0xE000] ?? marker,
  );
}

/** Query-only Russian cleanup. It intentionally never changes stored quotations. */
export function normalizeRussianLegal(value: string): string {
  return normalized(value)
    .replace(/\bст\s*\.?\s*/giu, "статья ")
    .replace(/\bг\.?\s*к\.?\b/giu, "гк")
    .replace(/\bт\.?\s*к\.?\b/giu, "тк")
    .replace(/\bу\.?\s*к\.?\b/giu, "ук")
    .replace(/\bн\.?\s*к\.?\b/giu, "нк")
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizeArticleNumber(value: string): string {
  const superscriptsExpanded = value.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu, (digits) =>
    "-" + [...digits].map((digit) => SUPERSCRIPT_DIGITS.get(digit) ?? digit).join(""),
  );
  const compact = normalized(superscriptsExpanded)
    .replace(/\s+prim(?:a|b|v)?/giu, (match) => "-" + match.trim().toLocaleLowerCase())
    .replace(/[.‐‑–—]/gu, "-")
    .replace(/\s+/gu, "")
    .replace(/-+/gu, "-");
  return /^\d+(?:-[\p{L}\d]+)?$/iu.test(compact) ? compact : "";
}

/** Returns deterministic query expansions without replacing the user's input. */
export function expandLegalAbbreviations(value: string): string[] {
  const expansions = new Set<string>();
  for (const normalizedValue of [
    normalizeRussianLegal(value).toLocaleLowerCase("ru"),
    transliterateUzbek(value).toLocaleLowerCase("uz"),
  ]) {
    for (const word of normalizedValue.match(/[\p{L}]+/gu) ?? []) {
      for (const expansion of LEGAL_ABBREVIATIONS[word] ?? []) expansions.add(expansion);
    }
  }
  return [...expansions];
}

export function detectLegalQueryLanguage(value: string): LegalQueryLanguage {
  const letters = value.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return "mixed";
  const cyrillic = letters.filter((letter) => /\p{Script=Cyrillic}/u.test(letter)).length;
  const latin = letters.length - cyrillic;
  const uzCyrillicMarker = /[ўқғҳ]/iu.test(value);
  const russianMarker = /[ыэъё]/iu.test(value);
  if (cyrillic > 0 && latin > 0) return "mixed";
  if (cyrillic > 0) return uzCyrillicMarker && !russianMarker ? "uz-Cyrl" : "ru";
  const englishMarkers = /\b(?:the|and|law|article|code|uzbekistan)\b/iu.test(value);
  const uzbekMarkers = /\b(?:oʻzbekiston|ozbekiston|modda|kodeksi|qanday|uchun)\b/iu.test(value);
  return englishMarkers && !uzbekMarkers ? "en" : "uz-Latn";
}

export function normalizeLegalReference(value: string, locale: "ru" | "uz" = "uz"): string {
  const normalizedValue = locale === "uz" ? transliterateUzbek(value) : normalizeRussianLegal(value);
  return normalizedValue
    .replace(/\b(?:ст\.?|статья)\s*№?\s*(\d+)/giu, "статья $1")
    .replace(/\b(\d+)\s*-\s*(?:модда|modda)/giu, "$1-modda")
    .replace(/\s+/gu, " ")
    .trim();
}

/** All explicit references are returned in first-mention order and never invented. */
export function detectArticleNumbers(value: string): string[] {
  const found: string[] = [];
  const superscriptsExpanded = value.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu, (digits) =>
    "-" + [...digits].map((digit) => SUPERSCRIPT_DIGITS.get(digit) ?? digit).join(""),
  );
  for (const normalizedValue of [
    normalizeLegalReference(superscriptsExpanded, "ru"),
    normalizeLegalReference(superscriptsExpanded, "uz"),
  ]) {
    const matches: Array<{ index: number; number: string }> = [];
    for (const pattern of [ARTICLE_PREFIX, ARTICLE_SUFFIX]) {
      pattern.lastIndex = 0;
      for (const match of normalizedValue.matchAll(pattern)) {
        const number = match[1] ? normalizeArticleNumber(match[1]) : "";
        if (number) matches.push({ index: match.index ?? Number.MAX_SAFE_INTEGER, number });
      }
    }
    for (const match of matches.sort((left, right) => left.index - right.index)) {
      if (!found.includes(match.number)) found.push(match.number);
    }
  }
  return found;
}

export function detectDocumentAliases(value: string): LegalDocumentAlias[] {
  const found: LegalDocumentAlias[] = [];
  for (const normalizedValue of [
    normalizeLegalReference(value, "ru"),
    normalizeLegalReference(value, "uz"),
  ]) {
    for (const [alias, pattern] of DOCUMENT_ALIASES) {
      if (pattern.test(normalizedValue) && !found.includes(alias)) found.push(alias);
    }
  }
  return found;
}

/**
 * Candidate retrieval uses this normalized query. UI and citations keep their
 * original source language and text unchanged.
 */
export function normalizeLegalSearchQuery(value: string, locale: "ru" | "uz"): string {
  return normalizeLegalReference(value, locale).toLocaleLowerCase(locale === "ru" ? "ru" : "uz");
}
