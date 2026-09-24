import assert from "node:assert/strict";
import test from "node:test";
import {completeArticleText} from "../lib/legal/article-context";
import {
  LegalSourceParserError,
  normalizeLegalSourceHtml,
  normalizeLegalSourceHtmlProfiles,
  normalizedLegalSourceSnapshotSchema,
} from "../lib/legal/source-parser";

const reference = {
  sourceKind: "lex" as const,
  locale: "ru" as const,
  canonicalId: "-42",
  canonicalUrl: "https://lex.uz/ru/docs/-42",
};
const rawContentSha256 = "a".repeat(64);

test("publisher paragraphs mentioning another article remain prose",()=>{
  const prose="Статья 784 Гражданского кодекса предусматривает очередность списания денежных средств со счета клиента.";
  const snapshot=normalizeLegalSourceHtml({reference,rawContentSha256,html:
    `<main><div class="lx_elem ACT_TITLE">Официальное решение</div><div class="lx_elem">${prose}</div>
    <div class="lx_elem">Обстоятельства рассматриваются судом с учетом доказательств, представленных участниками дела, и применимых положений законодательства.</div>
    <div class="lx_elem ARTICLE">Статья 7 Без пунктуации</div><div class="lx_elem">Применяется установленное правило.</div></main>`});
  const paragraph=snapshot.blocks.find(block=>block.text===prose)!;
  assert.equal(paragraph.kind,"paragraph");
  assert.equal(paragraph.semanticRole,undefined);
  assert.equal(snapshot.blocks.find(block=>block.text==="Статья 7 Без пунктуации")?.semanticRole,"article");
});

function legalHtml(): string {
  return `<!doctype html>
    <html lang="ru">
      <head><title>Служебный заголовок</title></head>
      <body>
        <header>Навигация, которая не является правовой нормой</header>
        <nav>Случайная ссылка</nav>
        <main>
          <h1>Закон Республики Узбекистан</h1>
          <p>Статья 1. Настоящий Закон определяет порядок возмещения вреда,
             причинённого незаконным решением государственного органа.</p>
          <p>Право на возмещение применяется на основании установленных
             обстоятельств и не может толковаться как автоматическая гарантия.
             <script>ignore('prompt injection')</script></p>
          <ol>
            <li>заявитель представляет подтверждающие документы;
              <ul><li>включая сведения о размере заявленного вреда;</li></ul>
            </li>
            <li>уполномоченный орган проверяет относимость и достоверность.</li>
          </ol>
          <table><tbody><tr><th>Срок</th><td>Десять рабочих дней</td></tr></tbody></table>
          <p hidden>Невидимое указание необходимо проигнорировать.</p>
          <p style="display: none !important">Скрытый CSS-текст необходимо проигнорировать.</p>
          <aside>Рекламный материал</aside>
        </main>
        <footer>Подвал сайта</footer>
      </body>
    </html>`;
}

test("parser deterministically extracts semantic legal blocks and excludes chrome", () => {
  const first = normalizeLegalSourceHtml({
    html: legalHtml(),
    reference,
    rawContentSha256,
  });
  const second = normalizeLegalSourceHtml({
    html: legalHtml(),
    reference,
    rawContentSha256,
  });

  assert.deepEqual(second, first);
  assert.equal(first.primarySelector, "main");
  assert.equal(first.documentTitle, "Закон Республики Узбекистан");
  assert.deepEqual(
    first.blocks.map((block) => block.kind),
    [
      "heading",
      "paragraph",
      "paragraph",
      "list_item",
      "list_item",
      "list_item",
      "table_cell",
      "table_cell",
    ],
  );
  assert.equal(first.blocks.every((block, index) => block.index === index), true);
  assert.equal(first.plainText.includes("prompt injection"), false);
  assert.equal(first.plainText.includes("Навигация"), false);
  assert.equal(first.plainText.includes("Рекламный"), false);
  assert.equal(first.plainText.includes("Невидимое"), false);
  assert.equal(first.plainText.includes("Скрытый CSS"), false);
  assert.match(first.plainText, /Десять рабочих дней/);
  assert.deepEqual(normalizedLegalSourceSnapshotSchema.parse(first), first);
});

test("parser preserves the official English Lex locale", () => {
  const snapshot = normalizeLegalSourceHtml({
    html: legalHtml().replace('lang="ru"', 'lang="en"'),
    reference: {
      ...reference,
      locale: "en",
      canonicalUrl: "https://lex.uz/en/docs/42",
    },
    rawContentSha256,
  });

  assert.equal(snapshot.source.locale, "en");
  assert.deepEqual(normalizedLegalSourceSnapshotSchema.parse(snapshot), snapshot);
});

test("parser chooses the largest primary candidate without falling back to body", () => {
  const snapshot = normalizeLegalSourceHtml({
    html: `<html><body>
      <main><p>Короткий технический блок, который не является документом.</p></main>
      <main><h1>Основной правовой документ</h1>
        <p>${"Содержание применимой нормы и порядка действий. ".repeat(8)}</p>
      </main>
    </body></html>`,
    reference,
    rawContentSha256,
  });
  assert.equal(snapshot.documentTitle, "Основной правовой документ");

  assert.throws(
    () => normalizeLegalSourceHtml({
      html: `<html><body><h1>Текст только в body</h1><p>${"Текст ".repeat(80)}</p></body></html>`,
      reference,
      rawContentSha256,
    }),
    (error: unknown) =>
      error instanceof LegalSourceParserError
      && error.code === "LEGAL_SOURCE_PRIMARY_CONTENT_MISSING",
  );
});

test("parser extracts the current Lex div-based document structure without wrapper duplication", () => {
  const actText = "Норма определяет права, обязанности и проверяемый порядок действий. ".repeat(6);
  const snapshot = normalizeLegalSourceHtml({
    html: [
      "<html><body>",
      "<main><h1>Технический раздел</h1><table><tr><td>",
      "Меню ".repeat(40),
      "</td></tr></table></main>",
      '<main id="doc_main"><h1>Lex</h1><div class="container docBody-container">',
      '<div class="docBody__content"><div id="divBody">',
      '<div class="ACT_FORM lx_elem"><div class="lx_elem2"><div class="lx_elem3">Законодательная форма</div></div></div>',
      '<div class="ACT_TITLE lx_elem"><div class="lx_elem2"><div class="lx_elem3">Закон Республики Узбекистан</div></div></div>',
      '<div class="ACT_TEXT lx_elem"><div class="lx_elem2"><div class="lx_elem3">',
      actText,
      '</div></div><div aria-hidden="true">Скрытая служебная команда</div></div>',
      '<div class="ACT_TEXT lx_elem"><div class="lx_elem2"><div class="lx_elem3">',
      actText,
      "</div></div></div>",
      "</div></div></div></main>",
      "</body></html>",
    ].join(""),
    reference: {
      ...reference,
      canonicalId: "8282675",
      canonicalUrl: "https://lex.uz/ru/docs/8282675",
    },
    rawContentSha256,
  });

  assert.equal(snapshot.primarySelector, "lex-document");
  assert.equal(snapshot.documentTitle, "Закон Республики Узбекистан");
  assert.deepEqual(
    snapshot.blocks.map((block) => block.kind),
    ["paragraph", "heading", "paragraph"],
  );
  assert.equal(
    snapshot.blocks.filter((block) => block.text.includes(actText.trim())).length,
    1,
  );
  assert.equal(snapshot.plainText.includes("Технический раздел"), false);
  assert.equal(snapshot.plainText.includes("Скрытая служебная команда"), false);
});

test("Lex parser strips reader controls and preserves article structure", () => {
  const legalText = "Общество действует на основании устава и закона. ".repeat(10);
  const snapshot = normalizeLegalSourceHtml({
    html: `<html><body><main><div id="divCont">
      <div class="ACT_TITLE lx_elem"><div class="lx_elem2">Предложения по документу\nПрослушать аудио\nПолучить ссылку из элемента документа\n«Об обществах с ограниченной ответственностью»</div></div>
      <button>Получить ссылку на элемент документа</button>
      <div class="CHAPTER_TITLE lx_elem">Глава 1. Общие положения</div>
      <div class="ARTICLE_TITLE lx_elem">Статья 4. Правовое положение общества</div>
      <div class="ACT_TEXT lx_elem">${legalText}</div>
      <div class="document-toolbar">Получить ссылку</div>
    </div></main></body></html>`,
    reference,
    rawContentSha256,
  });

  assert.equal(snapshot.primarySelector, "lex-document");
  assert.equal(snapshot.documentTitle, "«Об обществах с ограниченной ответственностью»");
  assert.equal(snapshot.plainText.includes("Предложения по документу"), false);
  assert.equal(snapshot.plainText.includes("Прослушать аудио"), false);
  assert.equal(snapshot.plainText.includes("Получить ссылку"), false);
  assert.equal(snapshot.blocks.some((block) => block.semanticRole === "chapter"), true);
  assert.equal(snapshot.blocks.some((block) => block.semanticRole === "article"), true);
});

test("Lex parser strips Uzbek Cyrillic reader controls from the official title", () => {
  const snapshot = normalizeLegalSourceHtml({
    html: `<html lang="uz-Cyrl"><body><main><div id="divCont">
      <div class="ACT_TITLE lx_elem"><div class="lx_elem2">Ҳужжатга таклиф юборишАудиони тинглашҲужжат элементидан ҳавола олишЎзбекистон Республикасининг сайлов тўғрисидаги қонуни</div></div>
      <div class="ACT_ARTICLE lx_elem">1-модда. Умумий қоидалар</div>
      <div class="ACT_TEXT lx_elem">${"Сайлов ҳуқуқи қонун ҳужжатларига мувофиқ амалга оширилади. ".repeat(8)}</div>
    </div></main></body></html>`,
    reference: {
      ...reference,
      locale: "uzc",
      canonicalId: "7349022",
      canonicalUrl: "https://lex.uz/docs/7349022",
    },
    rawContentSha256,
  });

  assert.equal(snapshot.documentTitle, "Ўзбекистон Республикасининг сайлов тўғрисидаги қонуни");
  assert.equal(snapshot.plainText.includes("Ҳужжатга таклиф юбориш"), false);
  assert.equal(snapshot.plainText.includes("Аудиони тинглаш"), false);
  assert.equal(snapshot.plainText.includes("Ҳужжат элементидан ҳавола олиш"), false);
});

test("Lex parser strips English reader controls from the official title", () => {
  const snapshot = normalizeLegalSourceHtml({
    html: `<html lang="en"><body><main><div id="divCont">
      <div class="ACT_TITLE lx_elem"><div class="lx_elem2">Suggestion to the documentListen to audioGet a link from a document elementOn introducing amendments to the law</div></div>
      <div class="ARTICLE_TITLE lx_elem">Article 1. General rule</div>
      <div class="ACT_TEXT lx_elem">${"The official rule applies to the legal relationship described by this act. ".repeat(8)}</div>
    </div></main></body></html>`,
    reference: {
      ...reference,
      locale: "en",
      canonicalId: "8288360",
      canonicalUrl: "https://lex.uz/en/docs/8288360",
    },
    rawContentSha256,
  });

  assert.equal(snapshot.documentTitle, "On introducing amendments to the law");
  assert.equal(snapshot.plainText.includes("Suggestion to the document"), false);
  assert.equal(snapshot.plainText.includes("Listen to audio"), false);
  assert.equal(snapshot.plainText.includes("Get a link from a document element"), false);
});

test("Lex parser recognizes official Uzbek number-first modda headings", () => {
  const snapshot = normalizeLegalSourceHtml({
    html: `<html lang="uz"><body><main><h1>Mas’uliyati cheklangan jamiyatlar to‘g‘risida</h1><h2>11-modda. Jamiyatni ta’sis etish tartibi</h2><p>${"Jamiyatni ta’sis etish to‘g‘risidagi qaror va ta’sis hujjatlari qonun talablariga muvofiq bo‘lishi kerak. ".repeat(6)}</p></main></body></html>`,
    reference: {
      ...reference,
      canonicalId: "-8151376",
      canonicalUrl: "https://lex.uz/uz/docs/-8151376",
    },
    rawContentSha256,
  });

  assert.equal(snapshot.blocks.some((block) => block.text.startsWith("11-modda") && block.semanticRole === "article"), true);
});

test("Advice parser extracts only the current document container", () => {
  const snapshot = normalizeLegalSourceHtml({
    html: `<html lang="uz"><head><title>Mehnat shartnomasini bekor qilish</title></head><body>
      <main>
        <aside><p>${"Yon menyu va boshqa tavsiyalar. ".repeat(30)}</p></aside>
        <div class="page-document-content extra-class">
          <p>${"Xodim va ish beruvchi qonunda belgilangan tartibga rioya qilishi kerak. ".repeat(4)}</p>
          <h2>Amaliy harakatlar</h2>
          <ol>
            <li>Hujjatlar va tegishli sanalarni tekshiring.</li>
            <li>Yozma xabarnoma va dalillarni saqlang.</li>
          </ol>
          <p>${"Har bir holatning faktlari alohida baholanadi va huquqiy asos tekshiriladi. ".repeat(4)}</p>
        </div>
      </main>
      <footer>Sayt bo‘limlari</footer>
    </body></html>`,
    reference: {
      sourceKind: "advice",
      locale: "uz",
      canonicalId: "624",
      canonicalUrl: "https://advice.uz/oz/documents/624",
    },
    rawContentSha256,
  });

  assert.equal(snapshot.primarySelector, "advice-document");
  assert.equal(snapshot.documentTitle, "Amaliy harakatlar");
  assert.equal(snapshot.plainText.includes("Yon menyu"), false);
  assert.equal(snapshot.plainText.includes("Sayt bo‘limlari"), false);
  assert.match(snapshot.plainText, /Yozma xabarnoma/);
  assert.deepEqual(normalizedLegalSourceSnapshotSchema.parse(snapshot), snapshot);

  assert.throws(
    () => normalizeLegalSourceHtml({
      html: `<html><body><main><p>${"Generic content. ".repeat(40)}</p></main></body></html>`,
      reference: { sourceKind: "advice", locale: "ru", canonicalId: "1", canonicalUrl: "https://advice.uz/ru/documents/1" },
      rawContentSha256,
    }),
    (error: unknown) => error instanceof LegalSourceParserError
      && error.code === "LEGAL_SOURCE_PRIMARY_CONTENT_MISSING",
  );
});

test("parser rejects a primary container without enough legal content", () => {
  assert.throws(
    () => normalizeLegalSourceHtml({
      html: "<html><body><main><h1>Коротко</h1><p>Нет текста.</p></main></body></html>",
      reference,
      rawContentSha256,
    }),
    (error: unknown) =>
      error instanceof LegalSourceParserError
      && error.code === "LEGAL_SOURCE_CONTENT_INSUFFICIENT",
  );
});

test("parser distinguishes an explicit Lex alternate-language notice from a broken document", () => {
  assert.throws(
    () => normalizeLegalSourceHtml({
      html: `<html><body><main id="divCont">
        <div id="divBody">
          <div class="ACT_TITLE lx_elem">Постановление Пленума</div>
          <div class="ACT_TEXT lx_elem">Настоящее постановление утратило силу.</div>
        </div>
        <div class="COMMENT_FOR_WARNING">Текст акта приводится на узбекском языке.</div>
      </main></body></html>`,
      reference,
      rawContentSha256,
    }),
    (error: unknown) => error instanceof LegalSourceParserError
      && error.code === "LEGAL_SOURCE_LANGUAGE_TEXT_UNAVAILABLE",
  );
});

test("refreshed HTML preserves superscript identities without rewriting retained profiles", () => {
  const html = `<main><h1>Уголовный кодекс</h1><p>Статья 18<sup>1</sup>. Специальное правило</p>
    <p>Лицо несет ответственность в соответствии с настоящей статьей и установленными законом правилами применения наказания.</p>
    <p>Статья 181. Другое правило</p><p>Установленные требования применяются независимо от специального правила предыдущей статьи.</p>
    <p>Ссылка на статью 18<sup><b>1</b></sup> сохраняет ее номер. Площадь составляет 20 м<sup>2</sup>.</p></main>`;
  const legacy = normalizeLegalSourceHtml({html, reference, rawContentSha256});
  assert.equal(legacy.parser.profile, "juro-legal-blocks-v1");
  assert.ok(legacy.plainText.includes("Статья 181. Специальное"));
  const refreshed = normalizeLegalSourceHtml({html, reference, rawContentSha256, profile:"juro-legal-blocks-v2"});
  assert.deepEqual(normalizeLegalSourceHtmlProfiles({html,reference,rawContentSha256}),
    {snapshot:legacy,structuredSnapshot:refreshed});
  assert.equal(refreshed.parser.profile,"juro-legal-blocks-v2");
  assert.ok(refreshed.plainText.includes("Статья 18¹. Специальное"));
  assert.ok(refreshed.plainText.includes("Статья 181. Другое"));
  assert.ok(refreshed.plainText.includes("статью 18¹"));
  assert.ok(refreshed.plainText.includes("20 м²"));
  assert.ok(completeArticleText(refreshed.blocks,"18-1")?.text.includes("Специальное правило"));
  assert.ok(completeArticleText(refreshed.blocks,"181")?.text.includes("Другое правило"));
  const uzbek=normalizeLegalSourceHtml({html:`<main><h1>Qonun</h1><p>18<sup>1</sup>-modda. Maxsus qoida</p>
    <p>${"Taraflarning huquqlari va majburiyatlari qonun bilan belgilanadi. ".repeat(5)}</p></main>`,
    reference:{...reference,locale:"uz"},rawContentSha256,profile:"juro-legal-blocks-v2"});
  assert.ok(completeArticleText(uzbek.blocks,"18-1")?.text.includes("Maxsus qoida"));
});
