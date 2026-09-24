import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  LegalSourceFetchError,
  classifyLegalSourceUrl,
  fetchLexArchiveRepresentation,
  fetchLexPdfRepresentation,
  fetchLegalSource,
} from "../lib/legal/source-fetch";

type FetchCall = {
  url: string;
  init: RequestInit | undefined;
};

function sequenceFetch(responses: Response[]): {
  calls: FetchCall[];
  fetchImpl: typeof fetch;
} {
  const calls: FetchCall[] = [];
  return {
    calls,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      const response = responses.shift();
      if (!response) throw new Error("Unexpected synthetic fetch.");
      return response;
    }) as typeof fetch,
  };
}

function robots(body = "User-agent: *\nAllow: /\n"): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function html(body = "<!doctype html><html><body>Official act</body></html>"):
  Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      etag: '"synthetic-etag"',
      "last-modified": "Tue, 28 Jul 2026 00:00:00 GMT",
    },
  });
}

function pdf(body = "%PDF-1.7\nsynthetic official Lex representation\n"):
  Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });
}

function zip(contentType = "application/zip"): Response {
  return new Response(zipSync({ "official.pdf": strToU8("%PDF-1.7 synthetic") }), {
    status: 200,
    headers: { "content-type": contentType },
  });
}

async function rejectsCode(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof LegalSourceFetchError);
    assert.equal(error.code, code);
    return true;
  });
}

test("legal source URL classifier accepts only exact HTTPS document routes", () => {
  assert.deepEqual(
    classifyLegalSourceUrl("https://www.lex.uz/ru/docs/-8354256/"),
    {
      sourceKind: "lex",
      locale: "ru",
      canonicalId: "-8354256",
      canonicalUrl: "https://lex.uz/ru/docs/-8354256",
      host: "lex.uz",
    },
  );
  assert.deepEqual(
    classifyLegalSourceUrl("https://lex.uz/ru/docs/8282675"),
    {
      sourceKind: "lex",
      locale: "ru",
      canonicalId: "8282675",
      canonicalUrl: "https://lex.uz/ru/docs/8282675",
      host: "lex.uz",
    },
  );
  assert.deepEqual(
    classifyLegalSourceUrl("https://lex.uz/docs/8383786"),
    {
      sourceKind: "lex",
      locale: "uzc",
      canonicalId: "8383786",
      canonicalUrl: "https://lex.uz/docs/8383786",
      host: "lex.uz",
    },
  );
  assert.deepEqual(
    classifyLegalSourceUrl("https://lex.uz/en/docs/8385445"),
    {
      sourceKind: "lex",
      locale: "en",
      canonicalId: "8385445",
      canonicalUrl: "https://lex.uz/en/docs/8385445",
      host: "lex.uz",
    },
  );
  assert.deepEqual(
    classifyLegalSourceUrl("https://lex.uz/ru/docs/145261?ONDATE=10.01.2018%2004"),
    {
      sourceKind: "lex",
      locale: "ru",
      canonicalId: "145261",
      canonicalUrl: "https://lex.uz/ru/docs/145261?ONDATE=10.01.2018%2004",
      host: "lex.uz",
      revisionDate: "2018-01-10",
    },
  );
  assert.deepEqual(
    classifyLegalSourceUrl("https://advice.uz/oz/documents/21/"),
    {
      sourceKind: "advice",
      locale: "uz",
      canonicalId: "21",
      canonicalUrl: "https://advice.uz/oz/documents/21",
      host: "advice.uz",
    },
  );
  assert.deepEqual(
    classifyLegalSourceUrl("https://www.advice.uz/ru/documents/1744"),
    {
      sourceKind: "advice",
      locale: "ru",
      canonicalId: "1744",
      canonicalUrl: "https://advice.uz/ru/documents/1744",
      host: "advice.uz",
    },
  );
  assert.deepEqual(
    classifyLegalSourceUrl("https://advice.uz/ru/document/2920?keyword=contract"),
    {
      sourceKind: "advice",
      locale: "ru",
      canonicalId: "2920",
      canonicalUrl: "https://advice.uz/ru/document/2920",
      host: "advice.uz",
    },
  );

  for (const value of [
    "http://lex.uz/ru/docs/-42",
    "https://lex.uz/",
    "https://lex.uz/ru/docs/-42?download=1",
    "https://lex.uz/ru/docs/-42?ONDATE=31.02.2024",
    "https://lex.uz/ru/docs/-42?ONDATE2=18.05.2022&action=compare",
    "https://lex.uz.evil.example/ru/docs/-42",
    "https://user:password@lex.uz/ru/docs/-42",
    "https://advice.uz/ru/page/how-it-works",
    "https://advice.uz/ru/documents/not-a-number",
    "https://advice.uz/ru/questions/21",
    "https://advice.uz/uz/documents/21",
    "https://advice.uz/oz/documents/21?print=1",
  ]) {
    assert.throws(
      () => classifyLegalSourceUrl(value),
      (error: unknown) =>
        error instanceof LegalSourceFetchError
        && error.code === "LEGAL_SOURCE_URL_REJECTED",
    );
  }
});

test("Advice acquisition is disabled before any network request", async () => {
  const synthetic = sequenceFetch([]);
  await rejectsCode(
    () => fetchLegalSource("https://advice.uz/ru/documents/21", {
      adviceEnabled: false,
      fetchImpl: synthetic.fetchImpl,
    }),
    "LEGAL_SOURCE_POLICY_DISABLED",
  );
  assert.equal(synthetic.calls.length, 0);
});

test("obsolete Advice enable flag cannot re-enable network access", async () => {
  const synthetic = sequenceFetch([]);
  await rejectsCode(() => fetchLegalSource(
    "https://www.advice.uz/oz/documents/624/",
    { adviceEnabled: true, fetchImpl: synthetic.fetchImpl },
  ), "LEGAL_SOURCE_POLICY_DISABLED");
  assert.equal(synthetic.calls.length, 0);
});

test("bounded Lex fetch accepts only an exact official ONDATE revision", async () => {
  const synthetic = sequenceFetch([robots(), html()]);
  const result = await fetchLegalSource(
    "https://lex.uz/ru/docs/145261?ONDATE=18.05.2022",
    { adviceEnabled: false, fetchImpl: synthetic.fetchImpl },
  );
  assert.equal(result.revisionDate, "2022-05-18");
  assert.equal(result.canonicalUrl, "https://lex.uz/ru/docs/145261?ONDATE=18.05.2022");
  assert.deepEqual(synthetic.calls.map((call) => call.url), [
    "https://lex.uz/robots.txt",
    "https://lex.uz/ru/docs/145261?ONDATE=18.05.2022",
  ]);
});

test("bounded Lex fetch verifies robots, preserves evidence, and hashes bytes", async () => {
  const synthetic = sequenceFetch([robots(), html()]);
  const result = await fetchLegalSource("https://lex.uz/ru/docs/-42", {
    adviceEnabled: false,
    fetchImpl: synthetic.fetchImpl,
    now: () => new Date("2026-07-28T00:00:00.000Z"),
  });

  assert.equal(result.sourceKind, "lex");
  assert.equal(result.locale, "ru");
  assert.equal(result.canonicalId, "-42");
  assert.match(result.contentSha256, /^[0-9a-f]{64}$/);
  assert.equal(result.fetchedAt, "2026-07-28T00:00:00.000Z");
  assert.equal(result.etag, '"synthetic-etag"');
  assert.equal(result.bytes.byteLength > 0, true);
  assert.deepEqual(
    synthetic.calls.map((call) => call.url),
    [
      "https://lex.uz/robots.txt",
      "https://lex.uz/ru/docs/-42",
    ],
  );
  assert.equal(
    new Headers(synthetic.calls[0]?.init?.headers).get("accept"),
    "*/*",
  );
  for (const call of synthetic.calls) {
    assert.equal(call.init?.redirect, "manual");
    assert.equal(call.init?.cache, "no-store");
    assert.equal(call.init?.credentials, "omit");
    assert.match(
      new Headers(call.init?.headers).get("user-agent") ?? "",
      /^JURO-LegalSourceSync\//,
    );
  }
});

test("an absent robots file, including the publisher's same-origin 404 redirect, permits document access", async () => {
  for (const redirect of [false, true]) {
    const synthetic = sequenceFetch([
      ...(redirect ? [new Response(null, { status: 302, headers: { location: "/Pages/404.aspx" } })] : []),
      new Response("not found", { status: 404, headers: { "content-type": "text/html" } }), html(),
    ]);
    const result = await fetchLegalSource("https://lex.uz/ru/docs/-42", {
      adviceEnabled: false, fetchImpl: synthetic.fetchImpl,
    });
    assert.equal(result.canonicalId, "-42");
    assert.equal(synthetic.calls.at(-1)?.url, "https://lex.uz/ru/docs/-42");
  }
});

test("robots disallow and excessive crawl-delay policies fail closed", async () => {
  for (const [body, code] of [
    ["User-agent: *\nDisallow: /ru/docs/\n", "LEGAL_SOURCE_ROBOTS_DISALLOWED"],
    ["User-agent: *\nAllow: /\nCrawl-delay: 61\n", "LEGAL_SOURCE_ROBOTS_RATE_POLICY"],
  ] as const) {
    const synthetic = sequenceFetch([robots(body)]);
    await rejectsCode(
      () => fetchLegalSource("https://lex.uz/ru/docs/-42", {
        adviceEnabled: false,
        fetchImpl: synthetic.fetchImpl,
      }),
      code,
    );
    assert.equal(synthetic.calls.length, 1);
  }
});

test("supported robots crawl-delay is awaited before source fetch", async () => {
  const synthetic = sequenceFetch([
    robots("User-agent: *\nAllow: /\nCrawl-delay: 20\n"),
    html(),
  ]);
  const waits: number[] = [];
  const result = await fetchLegalSource("https://lex.uz/ru/docs/8282675", {
    adviceEnabled: false,
    fetchImpl: synthetic.fetchImpl,
    wait: async (delayMs) => {
      assert.equal(synthetic.calls.length, 1);
      waits.push(delayMs);
    },
  });

  assert.equal(result.canonicalId, "8282675");
  assert.deepEqual(waits, [20_000]);
  assert.equal(synthetic.calls.length, 2);
});

test("Lex PDF representation is fetched only from the canonical official endpoint", async () => {
  const synthetic = sequenceFetch([
    robots("User-agent: *\nAllow: /\nCrawl-delay: 20\n"),
    pdf(),
  ]);
  const waits: number[] = [];
  const result = await fetchLexPdfRepresentation("https://lex.uz/uz/docs/-42", {
    fetchImpl: synthetic.fetchImpl,
    wait: async (delayMs) => {
      waits.push(delayMs);
    },
    now: () => new Date("2026-08-06T00:00:00.000Z"),
  });

  assert.equal(result.sourceKind, "lex");
  assert.equal(result.locale, "uz");
  assert.equal(result.canonicalId, "-42");
  assert.equal(result.representationUrl, "https://lex.uz/pdffile/42");
  assert.equal(result.fetchedAt, "2026-08-06T00:00:00.000Z");
  assert.match(result.contentSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(waits, [20_000]);
  assert.deepEqual(
    synthetic.calls.map((call) => call.url),
    ["https://lex.uz/robots.txt", "https://lex.uz/pdffile/42"],
  );
});

test("PDF fetching applies the canonical absent-robots policy without accepting other redirects",async()=>{
  for(const redirect of [false,true]){
    const synthetic=sequenceFetch([
      ...(redirect?[new Response(null,{status:302,headers:{location:"/Pages/404.aspx"}})]:[]),
      new Response("not found",{status:404,headers:{"content-type":"text/html"}}),pdf(),
    ]);
    assert.equal((await fetchLexPdfRepresentation("https://lex.uz/uz/docs/42",{fetchImpl:synthetic.fetchImpl})).canonicalId,"42");
  }
  for(const location of ["https://example.com/Pages/404.aspx","/Pages/login.aspx"]){
    const synthetic=sequenceFetch([new Response(null,{status:302,headers:{location}})]);
    await assert.rejects(fetchLexPdfRepresentation("https://lex.uz/uz/docs/42",{fetchImpl:synthetic.fetchImpl}),/LEGAL_SOURCE_REDIRECT_REJECTED/);
  }
});

test("Lex archive representation is same-origin, robots-paced and magic-validated", async () => {
  const synthetic = sequenceFetch([
    robots("User-agent: *\nAllow: /\nCrawl-delay: 20\n"),
    zip("application/octet-stream"),
  ]);
  const waits: number[] = [];
  const result = await fetchLexArchiveRepresentation(
    "https://lex.uz/docs/6783170",
    "https://lex.uz/files/6783200.zip",
    {
      fetchImpl: synthetic.fetchImpl,
      wait: async (delayMs) => {
        waits.push(delayMs);
      },
      now: () => new Date("2026-08-16T08:30:00.000Z"),
    },
  );
  assert.equal(result.representationUrl, "https://lex.uz/files/6783200.zip");
  assert.equal(result.fetchedAt, "2026-08-16T08:30:00.000Z");
  assert.match(result.contentSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(waits, [20_000]);
  assert.deepEqual(synthetic.calls.map((call) => call.url), [
    "https://lex.uz/robots.txt",
    "https://lex.uz/files/6783200.zip",
  ]);

  const rejected = sequenceFetch([]);
  await rejectsCode(
    () => fetchLexArchiveRepresentation(
      "https://lex.uz/docs/6783170",
      "https://evil.example/files/6783200.zip",
      { fetchImpl: rejected.fetchImpl },
    ),
    "LEGAL_SOURCE_URL_REJECTED",
  );
  assert.equal(rejected.calls.length, 0);

  const invalidMagic = sequenceFetch([
    robots(),
    new Response("not-a-zip", { headers: { "content-type": "application/zip" } }),
  ]);
  await rejectsCode(
    () => fetchLexArchiveRepresentation(
      "https://lex.uz/docs/6783170",
      "https://lex.uz/files/6783200.zip",
      { fetchImpl: invalidMagic.fetchImpl },
    ),
    "LEGAL_SOURCE_CONTENT_TYPE_REJECTED",
  );
});

test("crawl-delay requires a durable caller window and never sleeps by default", async () => {
  const synthetic = sequenceFetch([
    robots("User-agent: *\nAllow: /\nCrawl-delay: 20\n"),
  ]);

  await rejectsCode(
    () => fetchLegalSource("https://lex.uz/ru/docs/8282675", {
      adviceEnabled: false,
      fetchImpl: synthetic.fetchImpl,
    }),
    "LEGAL_SOURCE_CRAWL_WINDOW_REQUIRED",
  );
  assert.equal(synthetic.calls.length, 1);
});

test("a more specific robots Allow overrides a broader Disallow", async () => {
  const synthetic = sequenceFetch([
    robots([
      "User-agent: *",
      "Disallow: /ru/docs/",
      "Allow: /ru/docs/-42$",
      "",
    ].join("\n")),
    html(),
  ]);
  const result = await fetchLegalSource("https://lex.uz/ru/docs/-42", {
    adviceEnabled: false,
    fetchImpl: synthetic.fetchImpl,
  });
  assert.equal(result.canonicalId, "-42");
});

test("redirects may change www host but never scheme, source, or document", async () => {
  const accepted = sequenceFetch([
    new Response(null, {
      status: 301,
      headers: { location: "https://www.lex.uz/robots.txt" },
    }),
    robots(),
    new Response(null, {
      status: 302,
      headers: { location: "https://www.lex.uz/ru/docs/-42/" },
    }),
    html(),
  ]);
  const result = await fetchLegalSource("https://lex.uz/ru/docs/-42", {
    adviceEnabled: false,
    fetchImpl: accepted.fetchImpl,
  });
  assert.equal(result.canonicalUrl, "https://lex.uz/ru/docs/-42");

  for (const location of [
    "http://lex.uz/ru/docs/-42",
    "https://evil.example/ru/docs/-42",
    "https://lex.uz/ru/docs/-43",
  ]) {
    const rejected = sequenceFetch([
      robots(),
      new Response(null, { status: 302, headers: { location } }),
    ]);
    await rejectsCode(
      () => fetchLegalSource("https://lex.uz/ru/docs/-42", {
        adviceEnabled: false,
        fetchImpl: rejected.fetchImpl,
      }),
      "LEGAL_SOURCE_REDIRECT_REJECTED",
    );
  }
});

test("content type, encoding, and byte limits are enforced before persistence", async () => {
  const wrongType = sequenceFetch([
    robots(),
    new Response("binary", {
      headers: { "content-type": "application/octet-stream" },
    }),
  ]);
  await rejectsCode(
    () => fetchLegalSource("https://lex.uz/ru/docs/-42", {
      adviceEnabled: false,
      fetchImpl: wrongType.fetchImpl,
    }),
    "LEGAL_SOURCE_CONTENT_TYPE_REJECTED",
  );

  const emptyContent = sequenceFetch([
    robots(),
    new Response(null, {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  ]);
  await rejectsCode(
    () => fetchLegalSource("https://lex.uz/ru/docs/-42", {
      adviceEnabled: false,
      fetchImpl: emptyContent.fetchImpl,
    }),
    "LEGAL_SOURCE_EMPTY_CONTENT",
  );

  const tooLarge = sequenceFetch([
    robots(),
    new Response("123456", {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-length": "6",
      },
    }),
  ]);
  await rejectsCode(
    () => fetchLegalSource("https://lex.uz/ru/docs/-42", {
      adviceEnabled: false,
      fetchImpl: tooLarge.fetchImpl,
      maxBytes: 5,
    }),
    "LEGAL_SOURCE_TOO_LARGE",
  );

  const invalidUtf8 = sequenceFetch([
    robots(),
    new Response(new Uint8Array([0xc3, 0x28]), {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  ]);
  await rejectsCode(
    () => fetchLegalSource("https://lex.uz/ru/docs/-42", {
      adviceEnabled: false,
      fetchImpl: invalidUtf8.fetchImpl,
    }),
    "LEGAL_SOURCE_ENCODING_REJECTED",
  );

  const stalledBody = sequenceFetch([
    robots(),
    new Response(new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
      cancel() {},
    }), {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  ]);
  await rejectsCode(
    () => fetchLegalSource("https://lex.uz/ru/docs/-42", {
      adviceEnabled: false,
      fetchImpl: stalledBody.fetchImpl,
      timeoutMs: 10,
    }),
    "LEGAL_SOURCE_TIMEOUT",
  );
});
