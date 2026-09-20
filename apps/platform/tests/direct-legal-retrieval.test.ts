import assert from "node:assert/strict";
import test from "node:test";

import {
  DIRECT_RETRIEVAL_BUDGET_MS,
  directSourceCards,
  fetchDirectOfficialLexDocument,
  retrieveDirectLegalSources as retrieveDirectLegalSourcesActual,
} from "../lib/legal/direct-retrieval";

type Call = { url: string; init: RequestInit | undefined };

test("failed official discovery drains the still-running Lex search before returning", async () => {
  let releaseSearch!: () => void;
  const search = new Promise<void>(resolve => {releaseSearch = resolve;});
  let discoveryFailed!: () => void;
  const failed = new Promise<void>(resolve => {discoveryFailed = resolve;});
  let settled = false;
  const pending = retrieveDirectLegalSources("unrelated question", "ru", {
    searchQueries: ["unrelated question"], wait: async () => undefined,
    fetchImpl: async () => {await search; return responseHtml("<html><body>No results</body></html>");},
    discoverOfficialUrls: async () => {discoveryFailed(); throw new Error("discovery unavailable");},
  }).finally(() => {settled = true;});
  await failed;
  await new Promise(resolve => setImmediate(resolve));
  const returnedBeforeSearchFinished = settled;
  releaseSearch();
  await pending;
  assert.equal(returnedBeforeSearchFinished, false);
});

test("known official candidates are fetched and validated without repeating title discovery", async () => {
  const result = await retrieveDirectLegalSourcesActual("трудовой договор", "ru", {
    knownOfficialUrls: ["https://lex.uz/ru/docs/777", "https://evil.example/docs/777"],
    searchQueries: ["трудовой договор"],
    fetchImpl: async input => {
      const url = String(input);
      assert.ok(url === "https://lex.uz/robots.txt" || url === "https://lex.uz/ru/docs/777");
      return url.endsWith("/robots.txt") ? new Response("User-agent: *\nAllow: /", {headers:{"content-type":"text/plain"}})
        : responseHtml(officialDocument("Трудовой договор", "Статья 17. Условия договора"));
    },
  });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0]?.verificationState, "direct_validated");
});

test("explicit complete-article evidence retains every list continuation and stops at the next article", async () => {
  const items = Array.from({length: 12}, (_, index) => `<p>${index + 1}) Условие перечня ${index + 1}: ${"Подробное обязательное условие применения нормы. ".repeat(9)}</p>`).join("");
  const html = `<!doctype html><main class="page-document-content"><h1>Закон о договорах</h1>
    <h2>Статья 17. Основания применения</h2><p>Применяются следующие основания:</p>${items}
    <h2>Статья 18. Другая норма</h2><p>Не относящееся к запрошенной статье положение.</p></main>`;
  const {source} = await fetchDirectOfficialLexDocument("https://lex.uz/ru/docs/777", "ru", {
    query: "Article 17", completeArticle: true,
    fetchImpl: async input => String(input).endsWith("/robots.txt")
      ? new Response("User-agent: *\nAllow: /", {headers: {"content-type":"text/plain"}})
      : responseHtml(html),
  });
  const text = source.spans!.map(span => span.text).join(" ");
  for (let index=1; index<=12; index++) assert.ok(text.includes(`Условие перечня ${index}:`));
  assert.doesNotMatch(text, /Другая норма|Не относящееся/u);
  assert.ok(source.spans!.every(span => span.article?.startsWith("Статья 17.")));
  assert.equal(source.spans!.length,1);
  const long=await fetchDirectOfficialLexDocument("https://lex.uz/ru/docs/777", "ru", {
    query: "Article 17", completeArticle: true,
    fetchImpl: async input => String(input).endsWith("/robots.txt")
      ? new Response("User-agent: *\nAllow: /", {headers: {"content-type":"text/plain"}})
      : responseHtml(`<main class="page-document-content"><h1>Закон о договорах</h1><h2>Статья 17. Основания</h2><p>${"длинное условие ".repeat(250)}</p></main>`),
  });
  assert.equal(long.source.spans![0]!.text.match(/длинное условие/gu)?.length,250,
    "Complete-article evidence preserves a long sentence rather than clipping it into ranked snippets");
});

function responseHtml(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

test("complete official articles preserve English and Cyrillic Uzbek publication identity",async()=>{
  for(const locale of ["en","uzc"] as const) {
    const heading=locale==="en"?"Article 17. Records":"17-модда. Маълумотлар";
    const body=locale==="en"?"An applicant may obtain the requested official record under the conditions stated in this article. ":
      "Ариза берувчи қонун ҳужжатларида белгиланган шартларга мувофиқ сўралган маълумотларни олиши мумкин. ";
    const next=locale==="en"?"Article 18. Other rules":"18-модда. Бошқа қоидалар";
    const fetched=await fetchDirectOfficialLexDocument(`https://lex.uz/${locale}/docs/777`,locale,{
      query:"Article 17",completeArticle:true,fetchImpl:async input=>String(input).endsWith("/robots.txt")
        ?new Response("User-agent: *\nAllow: /",{headers:{"content-type":"text/plain"}})
        :responseHtml(`<main class="page-document-content"><h1>${locale==="en"?"Official record rules":"Маълумотларни бериш қоидалари"}</h1><h2>${heading}</h2><p>${body.repeat(5)}</p><h2>${next}</h2><p>${body}</p></main>`),
    });
    assert.equal(fetched.source.locale,locale);
    assert.equal(fetched.source.officialUrl,locale==="uzc"?"https://lex.uz/docs/777":"https://lex.uz/en/docs/777");
    assert.ok(fetched.source.spans![0]!.text.startsWith(heading));
    assert.ok(!fetched.source.spans![0]!.text.includes(next));
  }
});

function officialDocument(title: string, heading: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><main class="page-document-content"><h1>${title}</h1><h2>${heading}</h2><p>${"Официальный текст нормы и правовое регулирование договора. ".repeat(10)}</p></main></body></html>`;
}

function retrieveDirectLegalSources(
  question: string,
  locale: "ru" | "uz",
  options: Parameters<typeof retrieveDirectLegalSourcesActual>[2] = {},
) {
  return retrieveDirectLegalSourcesActual(question, locale, options);
}

test("direct retrieval uses only query-scoped official Lex links", async () => {
  const calls: Call[] = [];
  const responses = [
    responseHtml('<a href="/ru/docs/42">Lex result</a><a href="https://evil.example/ru/docs/13">bad</a>'),
    new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain; charset=utf-8" } }),
    responseHtml(officialDocument("Трудовой договор", "Статья 12. Условия")),
  ];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected network request");
    return next;
  }) as typeof fetch;

  const result = await retrieveDirectLegalSources("трудовой договор", "ru", {
    fetchImpl,
    now: () => new Date("2026-08-06T12:00:00.000Z"),
    wait: async () => undefined,
    searchQueries: ["Трудовой кодекс Республики Узбекистан"],
  });

  assert.equal(result.sourceAccessMode, "direct");
  assert.equal(result.sourceValidationStatus, "validated");
  assert.deepEqual(result.sources.map((source) => source.sourceType), ["lex"]);
  assert.equal(result.sources[0]?.officialUrl, "https://lex.uz/ru/docs/42");
  assert.equal((result.sources[0]?.excerpt?.length ?? 0) > 0, true);
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence.every((item) => item.validationStatus === "validated"), true);
  const cards = directSourceCards(result.sources);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards.map((source) => source.sourceId), result.sources.map((source) => source.id));
  assert.equal(new URL(calls[0]!.url).searchParams.get("query"), "Трудовой кодекс Республики Узбекистан");
  assert.deepEqual(calls.slice(1).map((item) => item.url), [
    "https://lex.uz/robots.txt",
    "https://lex.uz/ru/docs/42",
  ]);
  assert.equal(calls.every((item) => new URL(item.url).hostname === "lex.uz"), true);
});

test("model-understood legal wording selects the dedicated Labour Code guarantees without topic rules", async () => {
  const responses = [
    responseHtml('<a href="/ru/docs/6257291">Трудовой кодекс Республики Узбекистан</a>'),
    new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain; charset=utf-8" } }),
    responseHtml(`<!doctype html><main class="page-document-content">
      <h1>Трудовой кодекс Республики Узбекистан</h1>
      <h2>Статья 320. Возмещение вреда работнику</h2>
      <p>${"Работодатель возмещает работнику причиненный вред. ".repeat(8)}</p>
      <h2>Статья 408. Гарантии для беременных женщин при прекращении трудового договора</h2>
      <p>${"Прекращение трудового договора с беременными женщинами по инициативе работодателя не допускается, кроме установленных законом случаев. ".repeat(4)}</p>
      <h2>Статья 409. Гарантии при прекращении трудового договора с работником, имеющим ребенка в возрасте до трех лет</h2>
      <p>${"Прекращение трудового договора по инициативе работодателя с работником, имеющим ребенка в возрасте до трех лет, допускается только по установленным основаниям. ".repeat(4)}</p>
    </main>`),
  ];
  const fetchImpl = (async () => {
    const next = responses.shift();
    if (!next) throw new Error("Unexpected network request");
    return next;
  }) as typeof fetch;

  const semanticQuery = "прекращение трудового договора работодателем с работником в отпуске по уходу за ребенком до трех лет";
  const result = await retrieveDirectLegalSources(semanticQuery, "ru", {
    fetchImpl,
    now: () => new Date("2026-08-28T00:00:00.000Z"),
    wait: async () => undefined,
    searchQueries: ["прекращение трудового договора работник ребенок до трех лет"],
  });

  assert.equal(result.sourceValidationStatus, "validated");
  assert.match(result.sources[0]?.spans?.[0]?.article ?? "", /Статья 40[89]/u);
  assert.match(result.sources[0]?.spans?.[0]?.text ?? "", /прекращение трудового договора/iu);
});

test("live Lex full-text search resolves the colloquial maternity-leave question without agent discovery", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.href);
    if (url.pathname === "/ru/search/nat") {
      assert.match(url.searchParams.get("query") ?? "", /прекращение трудового договора/iu);
      return responseHtml('<a href="/ru/docs/6257291?query=matched">Трудовой кодекс Республики Узбекистан</a>');
    }
    if (url.pathname === "/ru/search/all") return responseHtml("");
    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/ru/docs/6257291") {
      return responseHtml(`<!doctype html><main class="page-document-content">
        <h1>Трудовой кодекс Республики Узбекистан</h1>
        <h2>Статья 409. Гарантии при прекращении трудового договора с работником, имеющим ребенка в возрасте до трех лет</h2>
        <p>${"Прекращение трудового договора по инициативе работодателя с работником, имеющим ребенка в возрасте до трех лет, допускается только по основаниям, установленным законом. ".repeat(5)}</p>
      </main>`);
    }
    throw new Error(`Unexpected network request: ${url.href}`);
  }) as typeof fetch;

  const result = await retrieveDirectLegalSources("можно ли уволить сотрудника в декрете", "ru", {
    fetchImpl,
    wait: async () => undefined,
    searchQueries: ["прекращение трудового договора работник ребенок до трех лет"],
  });

  assert.equal(result.sourceValidationStatus, "validated");
  assert.equal(result.sources[0]?.officialUrl, "https://lex.uz/ru/docs/6257291");
  assert.match(result.sources[0]?.spans?.[0]?.article ?? "", /Статья 409/u);
  assert.equal(calls.some((url) => new URL(url).pathname === "/ru/search/nat"), true);
});

test("live retrieval starts immediately and an agent-discovered parent act resolves the colloquial maternity-leave query", async () => {
  const calls: string[] = [];
  const discoveryCalls: string[] = [];
  let resolveQueries!: (queries: readonly string[]) => void;
  const searchQueries = new Promise<readonly string[]>((resolve) => { resolveQueries = resolve; });
  const question = "можно ли уволить сотрудника в декрете";
  const semanticQuery = "прекращение трудового договора по инициативе работодателя с работником имеющим ребенка до трех лет";
  const resultPromise = retrieveDirectLegalSources(question, "ru", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/search/nat")) return responseHtml("");
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      if (url === "https://lex.uz/ru/docs/9001") {
        return responseHtml(`<!doctype html><main class="page-document-content">
          <h1>Трудовой кодекс Республики Узбекистан</h1>
          <h2>Статья 409. Гарантии при прекращении трудового договора с работником, имеющим ребенка в возрасте до трех лет</h2>
          <p>${"Прекращение трудового договора по инициативе работодателя с работником, имеющим ребенка в возрасте до трех лет, допускается только по основаниям, установленным законом. ".repeat(5)}</p>
        </main>`);
      }
      throw new Error(`Unexpected network request: ${url}`);
    }) as typeof fetch,
    wait: async () => undefined,
    searchQueries,
    discoverOfficialUrls: async (query) => {
      discoveryCalls.push(query);
      return ["https://lex.uz/ru/docs/9001"];
    },
  });

  await Promise.resolve();
  assert.equal(new URL(calls[0]!).searchParams.get("query"), question);
  assert.equal(discoveryCalls.length, 0);
  resolveQueries([semanticQuery]);
  const result = await resultPromise;

  assert.match(discoveryCalls[0] ?? "", /можно ли уволить сотрудника в декрете/u);
  assert.match(discoveryCalls[0] ?? "", /прекращение трудового договора/u);
  assert.equal(result.sourceValidationStatus, "validated");
  assert.equal(result.sources[0]?.officialUrl, "https://lex.uz/ru/docs/9001");
  assert.match(result.sources[0]?.spans?.[0]?.article ?? "", /Статья 409/u);
});

test("direct retrieval uses a model-produced registration query for official search", async () => {
  const calls: Call[] = [];
  const responses = [
    responseHtml('<a href="/ru/docs/42">Lex result</a>'),
    new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain; charset=utf-8" } }),
    responseHtml(officialDocument("Регистрация ООО", "Статья 12. Порядок регистрации")),
    responseHtml(""),
  ];
  const result = await retrieveDirectLegalSources(
    "Какие основные шаги нужны для регистрации ООО в Узбекистане? Дайте краткий ответ с официальными источниками.",
    "ru",
    {
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return responses.shift() ?? new Response("offline", { status: 503 });
      }) as typeof fetch,
      now: () => new Date("2026-08-09T12:00:00.000Z"),
      wait: async () => undefined,
      searchQueries: ["общество с ограниченной ответственностью"],
    },
  );

  assert.equal(
    new URL(calls[0]!.url).searchParams.get("query"),
    "общество с ограниченной ответственностью",
  );
  assert.equal(result.sourceValidationStatus, "validated");
  assert.deepEqual(result.sources.map((source) => source.officialUrl), ["https://lex.uz/ru/docs/42"]);
});

test("direct retrieval uses a model-produced act query for a short colloquial question", async () => {
  const calls: Call[] = [];
  const responses = [
    responseHtml('<a href="/ru/docs/8152146">Lex result</a>'),
    new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain; charset=utf-8" } }),
    responseHtml(officialDocument("Об обществах с ограниченной ответственностью", "Статья 1. Общие положения")),
  ];
  const result = await retrieveDirectLegalSources("как открыть ООО?", "ru", {
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return responses.shift() ?? new Response("offline", { status: 503 });
    }) as typeof fetch,
    now: () => new Date("2026-08-13T12:00:00.000Z"),
    wait: async () => undefined,
    searchQueries: ["общество с ограниченной ответственностью"],
  });

  assert.equal(
    new URL(calls[0]!.url).searchParams.get("query"),
    "общество с ограниченной ответственностью",
  );
  assert.equal(result.sourceValidationStatus, "validated");
  assert.deepEqual(result.sources.map((source) => source.officialUrl), ["https://lex.uz/ru/docs/8152146"]);
});

test("LLC formation span ranking prefers the formation chapter over later amendment paperwork", async () => {
  const articles = [
    ["Статья 3. Правовое положение обществ с ограниченной ответственностью", "Общество приобретает статус юридического лица с момента его государственной регистрации."],
    ["Статья 11. Порядок учреждения общества", "Учредители заключают учредительный договор и утверждают устав общества."],
    ["Статья 12. Учредительные документы общества", "Учредительными документами общества являются учредительный договор и устав общества."],
    ["Статья 13. Учредительный договор общества", "В учредительном договоре учредители обязуются создать общество и определяют порядок совместной деятельности."],
    ["Статья 14. Устав общества", "Устав общества должен содержать фирменное наименование, место нахождения и сведения об уставном фонде."],
    ...Array.from({ length: 12 }, (_, index) => [
      `Статья ${20 + index}. Изменение доли`,
      "Документы для государственной регистрации изменений должны быть представлены регистрирующему органу.",
    ]),
  ];
  const document = `<!doctype html><html><head><title>Об обществах с ограниченной ответственностью</title></head><body><main class="page-document-content"><h1>Об обществах с ограниченной ответственностью</h1>${articles.map(([heading, body]) => `<h2>${heading}</h2><p>${body} ${"Официальный текст правовой нормы. ".repeat(8)}</p>`).join("")}</main></body></html>`;
  const result = await retrieveDirectLegalSources("как открыть ООО и какие документы нужны", "ru", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search/nat")) return responseHtml('<a href="/ru/docs/42">base act</a>');
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      return responseHtml(document);
    }) as typeof fetch,
    wait: async () => undefined,
    searchQueries: ["учреждение общества учредительный договор устав общества"],
  });
  const selectedArticles = result.sources[0]?.spans?.map((span) => span.article) ?? [];
  assert.equal(selectedArticles.some((article) => /^Статья 11(?:\.|$)/u.test(article ?? "")), true, JSON.stringify(selectedArticles));
  assert.equal(selectedArticles.some((article) => /^Статья 12(?:\.|$)/u.test(article ?? "")), true, JSON.stringify(selectedArticles));
  assert.equal(selectedArticles.some((article) => /^Статья 14(?:\.|$)/u.test(article ?? "")), true, JSON.stringify(selectedArticles));
  assert.equal(result.sources[0]?.spans?.some((span) =>
    span.text.includes("Учредительными документами общества являются")), true);
});

test("LLC span ranking prefers the dedicated rights article over a repeated participant reference", async () => {
  const articles = [
    ["Статья 8. Права и обязанности участников общества", "Участники общества вправе участвовать в управлении делами общества и получать информацию о его деятельности."],
    ["Статья 21. Переход доли участника общества", "Участник общества вправе передать долю другому участнику общества. Участник общества уведомляет общество о переходе доли."],
    ["Статья 22. Залог доли участника общества", "Участник общества вправе передать долю в залог с согласия участников общества."],
    ["Статья 23. Приобретение обществом доли участника", "Общество приобретает долю участника общества в предусмотренных законом случаях."],
  ];
  const document = `<!doctype html><html><head><title>Об обществах с ограниченной ответственностью</title></head><body><main class="page-document-content"><h1>Об обществах с ограниченной ответственностью</h1>${articles.map(([heading, body]) => `<h2>${heading}</h2><p>${body} ${"Официальный текст правовой нормы. ".repeat(8)}</p>`).join("")}</main></body></html>`;
  const result = await retrieveDirectLegalSources("какие права есть у участника ООО", "ru", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search/nat")) return responseHtml('<a href="/ru/docs/42">base act</a>');
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      return responseHtml(document);
    }) as typeof fetch,
    wait: async () => undefined,
  });

  assert.equal(result.sources[0]?.spans?.[0]?.article?.startsWith("Статья 8."), true);
  assert.equal(result.sources[0]?.spans?.[0]?.text.includes("участвовать в управлении"), true);
});

test("LLC span ranking prefers the charter-contents paragraph within the same article", async () => {
  const document = `<!doctype html><html><head><title>Об обществах с ограниченной ответственностью</title></head><body><main class="page-document-content"><div class="ACT_TITLE lx_elem">Об обществах с ограниченной ответственностью</div><div class="ACT_ARTICLE lx_elem">Статья 14. Устав общества</div><div class="ACT_TEXT lx_elem">Устав общества должен содержать:</div><div class="ACT_TEXT lx_elem">полное фирменное наименование;</div><div class="ACT_TEXT lx_elem">место нахождения общества;</div><div class="ACT_TEXT lx_elem">состав и компетенцию органов;</div><div class="ACT_TEXT lx_elem">сведения об уставном фонде.</div><div class="ACT_TEXT lx_elem">Изменения в уставе вступают в силу после государственной регистрации. ${"Документы для регистрации изменений. ".repeat(12)}</div><div class="ACT_ARTICLE lx_elem">Статья 19. Увеличение уставного фонда</div><div class="ACT_TEXT lx_elem">${"Документы для государственной регистрации изменений в уставе должны быть представлены регистрирующему органу. ".repeat(10)}</div></main></body></html>`;
  const result = await retrieveDirectLegalSources("что должен содержать устав ООО", "ru", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search/nat")) return responseHtml('<a href="/ru/docs/42">base act</a>');
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      return responseHtml(document);
    }) as typeof fetch,
    wait: async () => undefined,
  });

  const charterContentsSpan = result.sources[0]?.spans?.find((span) => span.text.includes("должен содержать"));
  assert.equal(Boolean(charterContentsSpan), true, JSON.stringify(result.sources[0]?.spans));
  assert.equal(/^Статья 14(?:\.|$)/u.test(charterContentsSpan?.article ?? ""), true, charterContentsSpan?.article ?? "missing article");
});

test("article-level chunks retain the structured compact heading as metadata", async () => {
  const document = `<!doctype html><html><head><title>Об обществах с ограниченной ответственностью</title></head><body><main class="page-document-content"><div class="ACT_TITLE lx_elem">Об обществах с ограниченной ответственностью</div><div class="ACT_ARTICLE lx_elem">Статья 5. Фирменное наименование общества и его место нахождения</div><div class="ACT_TEXT lx_elem">Общество должно иметь почтовый адрес, по которому с ним осуществляется связь.</div>${Array.from({ length: 8 }, (_, index) => `<div class="ACT_TEXT lx_elem">Официальное правило о почтовом адресе общества ${index + 1}.</div>`).join("")}</main></body></html>`;
  const result = await retrieveDirectLegalSources("обязано ли ООО иметь почтовый адрес", "ru", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search/nat")) return responseHtml('<a href="/ru/docs/42">base act</a>');
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      return responseHtml(document);
    }) as typeof fetch,
    wait: async () => undefined,
  });

  assert.equal(result.sources[0]?.spans?.[0]?.article, "Статья 5. Фирменное наименование общества и его место нахождения");
  assert.equal((result.sources[0]?.spans?.[0]?.article?.length ?? 0) < 100, true);
});

test("RU retrieval rejects a Cyrillic Uzbek document behind a RU-shaped URL", async () => {
  const uzbekCyrillic = `<!doctype html><html><head><title>ЎЗБЕКИСТОН РЕСПУБЛИКАСИНИНГ ФУҚАРОЛИК КОДЕКСИ</title></head><body><main class="page-document-content"><h1>ЎЗБЕКИСТОН РЕСПУБЛИКАСИНИНГ ФУҚАРОЛИК КОДЕКСИ</h1><h2>1-модда. Асосий қоидалар</h2><p>${"Ўзбекистон Республикасида ҳуқуқ ва мажбуриятлар қонун ҳужжатларига мувофиқ белгиланади. ".repeat(16)}</p></main></body></html>`;
  const result = await retrieveDirectLegalSources("гражданский договор", "ru", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search/nat")) return responseHtml('<a href="/ru/docs/42">candidate</a>');
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      return responseHtml(uzbekCyrillic);
    }) as typeof fetch,
    wait: async () => undefined,
  });

  assert.equal(result.sources.length, 0);
  assert.equal(result.sourceValidationStatus, "unavailable");
});

test("one-source live lookup stays inside the interactive budget and does not wait for crawler delay", async () => {
  const calls: Call[] = [];
  const responses = [
    responseHtml('<a href="/ru/docs/42">Lex result</a>'),
    new Response("User-agent: *\nCrawl-delay: 20\n", { headers: { "content-type": "text/plain; charset=utf-8" } }),
    responseHtml(officialDocument("Трудовой договор", "Статья 12. Условия")),
  ];
  const requestedDelays: number[] = [];
  const result = await retrieveDirectLegalSources("трудовой договор", "ru", {
    limit: 1,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return responses.shift() ?? new Response("unexpected", { status: 503 });
    }) as typeof fetch,
    now: () => new Date("2026-08-09T12:00:00.000Z"),
    wait: async (delayMs) => { requestedDelays.push(delayMs); },
    searchQueries: ["Трудовой кодекс Республики Узбекистан"],
  });

  assert.equal(DIRECT_RETRIEVAL_BUDGET_MS <= 3_000, true);
  assert.equal(result.sourceValidationStatus, "validated");
  assert.equal(result.sources.length, 1);
  assert.deepEqual(requestedDelays, []);
  assert.equal(new URL(calls[0]!.url).searchParams.get("query"), "Трудовой кодекс Республики Узбекистан");
  assert.deepEqual(calls.slice(1).map((item) => item.url), [
    "https://lex.uz/robots.txt",
    "https://lex.uz/ru/docs/42",
  ]);
});

test("direct retrieval supports the official UZ path without relaxing the Lex allowlist", async () => {
  const calls: Call[] = [];
  const responses = [
    responseHtml('<a href="/uz/docs/42">Lex result</a>'),
    new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain; charset=utf-8" } }),
    responseHtml(`<!doctype html><html lang="uz"><head><title>Mehnat shartnomasi</title></head><body><main><h1>Mehnat shartnomasi</h1><h2>Modda 12. Shartlar</h2><p>${"Rasmiy huquqiy norma mehnat shartnomasi taraflarining huquq va majburiyatlarini belgilaydi. ".repeat(8)}</p></main></body></html>`),
  ];
  const result = await retrieveDirectLegalSources("mehnat shartnomasi", "uz", {
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return responses.shift() ?? new Response("offline", { status: 503 });
    }) as typeof fetch,
    now: () => new Date("2026-08-06T12:00:00.000Z"),
    wait: async () => undefined,
    searchQueries: ["O‘zbekiston Respublikasining Mehnat kodeksi"],
  });

  assert.equal(result.sourceValidationStatus, "validated");
  assert.deepEqual(result.sources.map((source) => source.officialUrl), ["https://lex.uz/uz/docs/42"]);
  assert.equal(new URL(calls[0]!.url).searchParams.get("query"), "O‘zbekiston Respublikasining Mehnat kodeksi");
  assert.deepEqual(calls.slice(1).map((item) => item.url), [
    "https://lex.uz/robots.txt",
    "https://lex.uz/uz/docs/42",
  ]);
  assert.equal(calls.every((item) => new URL(item.url).hostname === "lex.uz"), true);
});

test("direct retrieval excludes technically valid but unrelated search documents", async () => {
  const result = await retrieveDirectLegalSources("трудовой договор", "ru", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search/nat")) return responseHtml('<a href="/ru/docs/42">Unrelated</a><a href="/ru/docs/43">Relevant</a>');
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
      if (url.endsWith("/42")) return responseHtml(officialDocument("Потребительские права", "Статья 1. Общие нормы"));
      if (url.endsWith("/43")) return responseHtml(officialDocument("Трудовой договор", "Статья 12. Условия"));
      return new Response("offline", { status: 503 });
    }) as typeof fetch,
    now: () => new Date("2026-08-06T12:00:00.000Z"),
    wait: async () => undefined,
  });
  assert.deepEqual(result.sources.map((source) => source.officialUrl), ["https://lex.uz/ru/docs/43"]);
});

test("direct retrieval retains a broad official code when the narrower topic is in its excerpt", async () => {
  const responses = [
    responseHtml('<a href="/ru/docs/42">Lex result</a>'),
    new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain; charset=utf-8" } }),
    responseHtml(officialDocument("Трудовой кодекс Республики Узбекистан", "Статья 12. Трудовой договор")),
    responseHtml(""),
  ];
  const result = await retrieveDirectLegalSources("трудовой договор", "ru", {
    fetchImpl: (async () => responses.shift() ?? new Response("offline", { status: 503 })) as typeof fetch,
    now: () => new Date("2026-08-09T12:00:00.000Z"),
    wait: async () => undefined,
  });
  assert.deepEqual(result.sources.map((source) => source.officialUrl), ["https://lex.uz/ru/docs/42"]);
});

test("direct retrieval does not treat jurisdiction or platform words as document relevance", async () => {
  const responses = [
    responseHtml('<a href="/ru/docs/42">Unrelated but official</a>'),
    new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain; charset=utf-8" } }),
    responseHtml(officialDocument("Апостиль на официальных документах Республики Узбекистан", "Статья 1. Общие правила")),
    responseHtml(""),
  ];
  const result = await retrieveDirectLegalSources(
    "Staging QA: какие официальные источники JURO использует для ответов по праву Узбекистана? Ответьте кратко.",
    "ru",
    {
      fetchImpl: (async () => responses.shift() ?? new Response("offline", { status: 503 })) as typeof fetch,
      now: () => new Date("2026-08-07T12:00:00.000Z"),
      wait: async () => undefined,
    },
  );
  assert.equal(result.sources.length, 0);
  assert.equal(result.sourceValidationStatus, "unavailable");
});

test("direct retrieval strips reader controls from a quoted Lex act title", async () => {
  const responses = [
    responseHtml('<a href="/ru/docs/42">Lex result</a>'),
    new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain; charset=utf-8" } }),
    responseHtml(officialDocument("Предложения по документу Прослушать аудио «Трудовой договор»", "Статья 12. Условия")),
    responseHtml(""),
  ];
  const result = await retrieveDirectLegalSources("трудовой договор", "ru", {
    fetchImpl: (async () => responses.shift() ?? new Response("offline", { status: 503 })) as typeof fetch,
    now: () => new Date("2026-08-06T12:00:00.000Z"),
    wait: async () => undefined,
  });
  assert.equal(result.sources[0]?.actTitle, "«Трудовой договор»");
});

test("direct retrieval follows only a bounded same-host search redirect", async () => {
  const calls: Call[] = [];
  const responses = [
    new Response("", {
      status: 302,
      headers: { location: "/ru/search/nat?query=%D0%B4%D0%BE%D0%B3%D0%BE%D0%B2%D0%BE%D1%80" },
    }),
    responseHtml('<a href="/ru/docs/42">Lex result</a>'),
    new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain; charset=utf-8" } }),
    responseHtml(officialDocument("Договор", "Статья 12. Условия")),
    new Response("offline", { status: 503, headers: { "content-type": "text/html" } }),
  ];
  const result = await retrieveDirectLegalSources("договор", "ru", {
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return responses.shift() ?? new Response("offline", { status: 503 });
    }) as typeof fetch,
    now: () => new Date("2026-08-06T12:00:00.000Z"),
    wait: async () => undefined,
  });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0]?.officialUrl, "https://lex.uz/ru/docs/42");
  assert.equal(calls[0]?.init?.redirect, "manual");
  assert.equal(calls[1]?.url, "https://lex.uz/ru/search/nat?query=%D0%B4%D0%BE%D0%B3%D0%BE%D0%B2%D0%BE%D1%80");
});

test("direct retrieval returns an honest unavailable state and writes no corpus", async () => {
  const result = await retrieveDirectLegalSources("договор", "ru", {
    fetchImpl: (async () => new Response("offline", { status: 503, headers: { "content-type": "text/html" } })) as typeof fetch,
    now: () => new Date("2026-08-06T12:00:00.000Z"),
  });
  assert.equal(result.sources.length, 0);
  assert.equal(result.sourceValidationStatus, "unavailable");
  assert.equal(result.freshness.status, "unavailable");
  assert.equal(result.errors.length, 1);
  assert.deepEqual(result.errors.map((error) => error.code), ["LEGAL_SOURCE_SEARCH_HTTP_503"]);
});

test("UZ LLC ranking keeps the base law and rejects company tariff decisions", async () => {
  const baseTitle = "Mas’uliyati cheklangan jamiyatlar to‘g‘risida";
  const tariffTitle = "Nishon tumani mas’uliyati cheklangan jamiyatining ichimlik suvi narxlari (tariflari) to‘g‘risida";
  const uzDocument = (title: string) => `<!doctype html><html lang="uz"><body><main><h1>${title}</h1><h2>Modda 1. Umumiy qoidalar</h2><p>${"Rasmiy huquqiy norma mas’uliyati cheklangan jamiyat faoliyati va davlat ro‘yxatidan o‘tishini belgilaydi. ".repeat(8)}</p></main></body></html>`;
  const result = await retrieveDirectLegalSources("mas’uliyati cheklangan jamiyat", "uz", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search/nat")) return responseHtml('<a href="/uz/docs/1">base</a><a href="/uz/docs/2">tariff</a>');
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      if (url.endsWith("/1")) return responseHtml(uzDocument(baseTitle));
      if (url.endsWith("/2")) return responseHtml(uzDocument(tariffTitle));
      return new Response("offline", { status: 503 });
    }) as typeof fetch,
    wait: async () => undefined,
  });
  assert.deepEqual(result.sources.map((source) => source.officialUrl), ["https://lex.uz/uz/docs/1"]);
});

test("UZ LLC formation selects number-first modda spans from the live document", async () => {
  const legalParagraph = (text: string) => `${text} ${"Ushbu norma jamiyat ishtirokchilari, ta’sis hujjatlari va davlat ro‘yxatidan o‘tkazish tartibini belgilaydi. ".repeat(5)}`;
  const result = await retrieveDirectLegalSourcesActual("O‘zbekistonda MChJni qanday ochaman?", "uz", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search/nat")) return responseHtml('<a href="/uz/docs/-8151376">asosiy qonun</a>');
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      if (url.endsWith("/-8151376")) {
        return responseHtml(`<!doctype html><html lang="uz"><body><main>
          <h1>Mas’uliyati cheklangan jamiyatlar to‘g‘risida</h1>
          <h2>3-modda. Jamiyatning huquqiy holati</h2><p>${legalParagraph("Jamiyat davlat ro‘yxatidan o‘tkazilgan paytdan e’tiboran yuridik shaxs maqomiga ega bo‘ladi.")}</p>
          <h2>11-modda. Jamiyatni ta’sis etish tartibi</h2><p>${legalParagraph("Muassislar jamiyatni ta’sis etish to‘g‘risida qaror qabul qiladilar.")}</p>
          <h2>12-modda. Jamiyatning ta’sis hujjatlari</h2><p>${legalParagraph("Jamiyatning ustavi uning ta’sis hujjatidir.")}</p>
          <h2>40-modda. Keyingi o‘zgartirishlar</h2><p>${legalParagraph("Keyingi o‘zgartirishlar alohida tartibda amalga oshiriladi.")}</p>
        </main></body></html>`);
      }
      return new Response("offline", { status: 503 });
    }) as typeof fetch,
    wait: async () => undefined,
    searchQueries: ["mas’uliyati cheklangan jamiyatni ta’sis etish ustav"],
  });

  assert.equal(
    result.sources[0]?.officialUrl,
    "https://lex.uz/uz/docs/-8151376",
    JSON.stringify({ errors: result.errors, validation: result.sourceValidationStatus }),
  );
  assert.match(result.sources[0]?.article ?? "", /(?:11|12)-modda/iu);
  assert.equal(result.sources[0]?.spans?.some((span) => /(?:11|12)-modda/iu.test(span.article ?? "")), true);
  assert.equal(result.sources[0]?.spans?.slice(0, 2).some((span) => /40-modda/iu.test(span.article ?? "")), false);
});

test("UZ LLC rights and duties ranking prefers dedicated articles over share transfer", async () => {
  const articles = [
    ["9-modda. Jamiyat ishtirokchilarining huquqlari", "Jamiyat ishtirokchilari jamiyat ishlarini boshqarishda ishtirok etishga va faoliyat haqida axborot olishga haqlidir."],
    ["10-modda. Jamiyat ishtirokchilarining majburiyatlari", "Jamiyat ishtirokchilari ustavda belgilangan tartibda hissa qoʻshishi va maxfiy axborotni oshkor etmasligi shart."],
    ["21-modda. Jamiyat ishtirokchisining ulushi boshqa shaxslarga oʻtishi", "Jamiyat ishtirokchisi oʻz ulushini boshqa ishtirokchiga oʻtkazishi mumkin va oluvchiga ulush bilan bogʻliq huquqlari oʻtadi."],
  ];
  const document = `<!doctype html><html><head><title>Masʼuliyati cheklangan jamiyatlar toʻgʻrisida</title></head><body><main class="page-document-content"><h1>Masʼuliyati cheklangan jamiyatlar toʻgʻrisida</h1>${articles.map(([heading, body]) => `<p>${heading}</p><p>${body} ${"Rasmiy huquqiy qoida. ".repeat(10)}</p>`).join("")}</main></body></html>`;
  const retrieve = (question: string) => retrieveDirectLegalSources(question, "uz", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search/nat")) return responseHtml('<a href="/uz/docs/42">base act</a>');
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      return responseHtml(document);
    }) as typeof fetch,
    wait: async () => undefined,
  });

  const rights = await retrieve("MChJ ishtirokchisining huquqlari qanday?");
  const duties = await retrieve("MChJ ishtirokchisining majburiyatlari qanday?");
  assert.equal(rights.sources[0]?.spans?.[0]?.article?.startsWith("9-modda"), true);
  assert.equal(duties.sources[0]?.spans?.[0]?.article?.startsWith("10-modda"), true);
  assert.match(duties.sources[0]?.spans?.[0]?.text ?? "", /hissa qoʻshishi/iu);
});

test("number-first multi-digit UZ articles are never fragmented into a smaller article number", async () => {
  const document = `<!doctype html><html><head><title>Masʼuliyati cheklangan jamiyatlar toʻgʻrisida</title></head><body><main class="page-document-content"><h1>Masʼuliyati cheklangan jamiyatlar toʻgʻrisida</h1><p>14-modda. Jamiyat ustavi</p><p>Jamiyat ustavida firma nomi, pochta manzili, organlar, ustav kapitali, huquqlar va majburiyatlar ko‘rsatilishi kerak. ${"Rasmiy huquqiy qoida. ".repeat(16)}</p></main></body></html>`;
  const result = await retrieveDirectLegalSources("MChJ ustavida nimalar ko‘rsatilishi kerak?", "uz", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search/nat")) return responseHtml('<a href="/uz/docs/42">base act</a>');
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      return responseHtml(document);
    }) as typeof fetch,
    wait: async () => undefined,
  });

  assert.equal(result.sources[0]?.spans?.some((span) => span.article?.startsWith("14-modda")), true);
  assert.equal(result.sources[0]?.spans?.some((span) => span.article?.startsWith("4-modda")), false);
});

test("UZ charter-content wording with bo‘lishi still selects Article 14", async () => {
  const document = `<!doctype html><html><head><title>Masʼuliyati cheklangan jamiyatlar toʻgʻrisida</title></head><body><main class="page-document-content"><h1>Masʼuliyati cheklangan jamiyatlar toʻgʻrisida</h1><p>14-modda. Jamiyat ustavi</p><p>Jamiyat ustavida firma nomi, pochta manzili, organlar, ustav kapitali, huquqlar va majburiyatlar ko‘rsatilishi kerak. ${"Rasmiy huquqiy qoida. ".repeat(16)}</p></main></body></html>`;
  const result = await retrieveDirectLegalSources("MChJ ustavida nimalar bo‘lishi kerak?", "uz", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search/nat")) return responseHtml('<a href="/uz/docs/42">base act</a>');
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      return responseHtml(document);
    }) as typeof fetch,
    wait: async () => undefined,
  });

  assert.equal(result.sources[0]?.spans?.[0]?.article?.startsWith("14-modda"), true);
  assert.match(result.sources[0]?.spans?.[0]?.text ?? "", /firma nomi/iu);
});

test("UZ jamiyat ustavi wording uses the LLC act and selects the third-party rule", async () => {
  const document = `<!doctype html><html><head><title>Masʼuliyati cheklangan jamiyatlar toʻgʻrisida</title></head><body><main class="page-document-content"><h1>Masʼuliyati cheklangan jamiyatlar toʻgʻrisida</h1><p>14-modda. Jamiyat ustavi</p><p>Jamiyat ustavi va unga kiritilgan o‘zgartirishlar uchinchi shaxslar uchun davlat ro‘yxatidan o‘tkazilgan paytdan e’tiboran kuchga kiradi. ${"Rasmiy huquqiy qoida. ".repeat(16)}</p><p>19-modda. Ustav kapitalini uchinchi shaxslar hissalari hisobidan ko‘paytirish</p><p>Kapital ko‘payishiga doir o‘zgartirishlar uchinchi shaxslar uchun davlat ro‘yxatidan o‘tkazilgach kuchga kiradi. ${"Rasmiy huquqiy qoida. ".repeat(16)}</p></main></body></html>`;
  const result = await retrieveDirectLegalSourcesActual("Jamiyat ustavi uchinchi shaxslar uchun qachon kuchga kiradi?", "uz", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search/nat")) return responseHtml('<a href="/uz/docs/-8151376">asosiy qonun</a>');
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      if (url.endsWith("/-8151376")) return responseHtml(document);
      return new Response("offline", { status: 503 });
    }) as typeof fetch,
    wait: async () => undefined,
    searchQueries: ["jamiyat ustavi uchinchi shaxslar kuchga kirishi"],
  });

  assert.equal(result.sources[0]?.officialUrl, "https://lex.uz/uz/docs/-8151376");
  const charterSpan = result.sources[0]?.spans?.find((span) => span.article?.startsWith("14-modda"));
  assert.ok(charterSpan, JSON.stringify(result.sources[0]?.spans));
  assert.match(charterSpan.text, /uchinchi shaxslar/iu);
});

test("search-result ranking prefers a base code over newer amendment notices", async () => {
  const fetchedDocuments: string[] = [];
  const result = await retrieveDirectLegalSources("трудовой договор", "ru", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search/nat")) return responseHtml([
        '<a href="/ru/docs/91">О внесении изменений в Трудовой кодекс Республики Узбекистан</a>',
        '<a href="/ru/docs/92">О Законе Республики Узбекистан «О внесении дополнений в Трудовой кодекс»</a>',
        '<a href="/ru/docs/93">Проект изменений трудового законодательства</a>',
        '<a href="/ru/docs/42">Трудовой кодекс Республики Узбекистан</a>',
      ].join(""));
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      fetchedDocuments.push(url);
      const title = url.endsWith("/42")
        ? "Трудовой кодекс Республики Узбекистан"
        : "О внесении изменений в Трудовой кодекс Республики Узбекистан";
      return responseHtml(officialDocument(title, "Статья 12. Трудовой договор"));
    }) as typeof fetch,
    wait: async () => undefined,
  });
  assert.equal(fetchedDocuments[0], "https://lex.uz/ru/docs/42");
  assert.equal(result.sources[0]?.officialUrl, "https://lex.uz/ru/docs/42");
});

test("a request-scoped semantic act query is resolved and still live-fetched", async () => {
  const fetchedDocuments: string[] = [];
  const searchResults = '<a href="/ru/docs/6257291">Трудовой кодекс Республики Узбекистан</a>';
  const result = await retrieveDirectLegalSourcesActual("трудовые отношения", "ru", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search/nat")) return responseHtml(searchResults);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      fetchedDocuments.push(url);
      const title = url.endsWith("/6257291")
        ? "Трудовой кодекс Республики Узбекистан"
        : "О внесении изменений в Трудовой кодекс Республики Узбекистан";
      return responseHtml(officialDocument(title, "Статья 12. Трудовые отношения"));
    }) as typeof fetch,
    wait: async () => undefined,
    searchQueries: ["Трудовой кодекс Республики Узбекистан трудовые отношения"],
  });
  assert.equal(fetchedDocuments.includes("https://lex.uz/ru/docs/6257291"), true);
  assert.deepEqual(result.sources.map((source) => source.officialUrl), ["https://lex.uz/ru/docs/6257291"]);
  assert.equal(result.evidence[0]?.canonicalUrl, "https://lex.uz/ru/docs/6257291");
});

test("a request-scoped LLC act query is searched and live-validated", async () => {
  const calls: string[] = [];
  const result = await retrieveDirectLegalSourcesActual("как открыть ООО", "ru", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nAllow: /\n", {
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
      if (url.includes("/search/nat")) {
        return responseHtml('<a href="/ru/docs/8152146">Об обществах с ограниченной ответственностью</a>');
      }
      if (url === "https://lex.uz/ru/docs/8152146") {
        return responseHtml(officialDocument(
          "Об обществах с ограниченной и дополнительной ответственностью",
          "Статья 4. Общество с ограниченной ответственностью",
        ));
      }
      return new Response("offline", { status: 503 });
    }) as typeof fetch,
    now: () => new Date("2026-08-13T18:00:00.000Z"),
    wait: async () => undefined,
    searchQueries: ["общество с ограниченной ответственностью учреждение"],
  });

  assert.equal(calls.some((url) => url.includes("/search/nat")), true);
  assert.equal(calls.includes("https://lex.uz/ru/docs/8152146"), true);
  assert.deepEqual(result.sources.map((source) => source.officialUrl), [
    "https://lex.uz/ru/docs/8152146",
  ]);
  assert.equal(result.sourceValidationStatus, "validated");
});

test("web discovery contributes only canonical Lex URLs that are re-fetched and quality-checked", async () => {
  const calls: string[] = [];
  const result = await retrieveDirectLegalSources("трудовой договор", "ru", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/search/nat")) return responseHtml("");
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain; charset=utf-8" } });
      if (url.endsWith("/ru/docs/42")) return responseHtml(officialDocument("Трудовой договор", "Статья 12. Условия"));
      return new Response("offline", { status: 503, headers: { "content-type": "text/html" } });
    }) as typeof fetch,
    now: () => new Date("2026-08-13T12:00:00.000Z"),
    wait: async () => undefined,
    budgetMs: 5_000,
    discoverOfficialUrls: async () => [
      "https://evil.example/ru/docs/99",
      "https://lex.uz/ru/docs/42",
    ],
  });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0]?.officialUrl, "https://lex.uz/ru/docs/42");
  assert.equal(calls.includes("https://evil.example/ru/docs/99"), false);
  assert.equal(calls.includes("https://lex.uz/ru/docs/42"), true);
});

test("direct retrieval reports bounded source timeouts without writing a corpus", async () => {
  const result = await retrieveDirectLegalSources("договор", "ru", {
    fetchImpl: (async () => { throw new DOMException("aborted", "AbortError"); }) as typeof fetch,
    now: () => new Date("2026-08-06T12:00:00.000Z"),
  });
  assert.deepEqual(result.errors.map((error) => error.code), ["LEGAL_SOURCE_SEARCH_TIMEOUT"]);
});

test("caller cancellation aborts direct retrieval before it can reach the AI provider", async () => {
  const controller = new AbortController();
  let signalSeen: AbortSignal | undefined;
  let beginFetch: (() => void) | undefined;
  const fetchStarted = new Promise<void>((resolve) => { beginFetch = resolve; });
  const pending = retrieveDirectLegalSources("mehnat shartnomasi", "uz", {
    signal: controller.signal,
    fetchImpl: ((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      signalSeen = init?.signal ?? undefined;
      beginFetch?.();
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })) as typeof fetch,
  });

  await fetchStarted;
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  assert.equal(signalSeen?.aborted, true);
});
