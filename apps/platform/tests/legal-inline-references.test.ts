import assert from "node:assert/strict";
import test from "node:test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {SafeMarkdown} from "../app/_platform/SafeMarkdown";
import {inlineReferences, answerReferenceContext, legalAnswerProse, legalAnswerPassages, referenceSourcesForPassage} from "../lib/ai/legal-inline-references";
const section={sourceId:"section",actTitle:"Трудовой кодекс Республики Узбекистан",article:"§ 1. Особенности",originalUrl:"https://lex.uz/ru/docs/6257288#section"};
const article={...section,sourceId:"409",article:"Статья 409. Гарантии",originalUrl:"https://lex.uz/ru/docs/6257288#409"};

test("article ranges resolve against their containing act despite another edition in the answer",()=>{
 const old={...section,sourceId:"old",article:"Статья 237. Гарантии",originalUrl:"https://lex.uz/docs/142859#237"};
 const pregnancy={...article,sourceId:"408",article:"Статья 408. Гарантии",originalUrl:"https://lex.uz/ru/docs/6257288#408"};
 const context=answerReferenceContext([old,pregnancy,article],"Гарантии статей 408–409 Трудового кодекса.");
 assert.equal(context.unresolved.length,0);
 assert.equal(context.sources.length,3);
 assert.ok(inlineReferences("статей 408–409 Трудового кодекса",[old,pregnancy,article])[0].href);
});

test("equivalent official document routes do not make a missing article ambiguous",()=>{
 const other={...article,originalUrl:"https://www.lex.uz/docs/6257288#409"};
 const context=answerReferenceContext([section,other],"По статье 162. Требования статьи 162.");
 assert.equal(context.unresolved.length,0);
 assert.equal(context.sources.filter(source=>source.navigationOnly).length,1);
});

test("paragraph bindings resolve omitted articles in the cited edition without borrowing another edition's article",()=>{
 const old={...section,sourceId:"old",article:"Статья 162. Другая редакция",originalUrl:"https://lex.uz/docs/142859#162"};
 const sources=[old,section,article];
 const passages=legalAnswerPassages({summary:"По статье 162.",summarySourceIds:["409"],
   confirmedFindings:[{explanation:"Требования статьи 162.",sourceIds:["409"]}]});
 const context=answerReferenceContext(sources,passages);
 assert.equal(context.unresolved.length,0);
 const navigation=context.sources.filter(source=>source.navigationOnly);
 assert.equal(navigation.length,1);
 assert.equal(navigation[0].originalUrl,"https://lex.uz/ru/docs/6257288");
 assert.equal(inlineReferences(passages[0].text,referenceSourcesForPassage(sources,passages[0].sourceIds))[0].href,navigation[0].originalUrl);
 assert.equal(inlineReferences("ст. 409 ГК",referenceSourcesForPassage(sources,["409"]))[0].href,undefined);
});

test("different dated editions remain distinct and inserted article numbers are not ranges",()=>{
 const dated={...article,sourceId:"dated",originalUrl:article.originalUrl.replace("#409","?ONDATE=01.01.2020#409")};
 assert.equal(inlineReferences("ст. 409",[article,dated])[0].href,undefined);
 const inserted={...article,article:"Статья 12-1. Правило",originalUrl:"https://lex.uz/ru/docs/6257288#12-1"};
 assert.equal(inlineReferences("ст. 12-1",[inserted])[0].href,inserted.originalUrl);
 assert.equal(answerReferenceContext([article,dated],"По статье 162. Требования статьи 162.").unresolved.length,1);
});

test("streamed citation bindings produce the same sidebar links as the saved answer",async()=>{
 const {writingResult}=await import("../app/_platform/AnswerWriting");
 const old={...section,sourceId:"old",article:"Статья 237. Гарантии",originalUrl:"https://lex.uz/docs/142859#237"};
 const sources=[old,section,article];
 const text="По статье 162 ТК.";
 const streamed=writingResult({blocks:[{key:"turn/content/summary",text}],citations:{"turn/content/summary":["409"]}});
 const saved={summary:text,summarySourceIds:["409"]};
 const context=answerReferenceContext(sources,legalAnswerPassages(streamed));
 assert.deepEqual(context,answerReferenceContext(sources,legalAnswerPassages(saved)));
 assert.equal(context.unresolved.length,0);
 assert.equal(context.sources.at(-1)!.originalUrl,"https://lex.uz/ru/docs/6257288");
 assert.deepEqual(referenceSourcesForPassage(sources,["missing-bound-source"]),[]);
});
test("grouped provisions use exact sources or a containing-act link and all enter context",()=>{
 const prose="[Статья 408 ТК]. пп. 1, 4 и 5 ч. 2 ст. 161 ТК. [Статьи 163, 409 ТК]";
 const refs=inlineReferences(prose,[section,article]);
 assert.deepEqual(refs.map(r=>r.articleNumber),["408","161","163","409"]);
 assert.deepEqual(refs.map(r=>r.href),[section.originalUrl.split("#")[0],section.originalUrl.split("#")[0],section.originalUrl.split("#")[0],article.originalUrl]);
 const context=answerReferenceContext([section,article],prose+prose);
 assert.equal(context.sources.length,5);assert.equal(context.unresolved.length,0);
 assert.deepEqual(context.sources.filter(s=>s.navigationOnly).map(s=>s.article),["Статья 408 ТК","ст. 161 ТК","Статьи 163"]);
});
test("unknown and ambiguous acts remain unresolved even when article numbers match",()=>{
 assert.equal(inlineReferences("ст. 409 ГК",[article])[0].href,undefined);
 const civil={...article,sourceId:"civil",actTitle:"Гражданский кодекс",originalUrl:"https://lex.uz/docs/111#409"};
 assert.equal(inlineReferences("ст. 409",[article,civil])[0].href,undefined);
 assert.equal(inlineReferences("ст. 409 ГК",[article,civil])[0].href,civil.originalUrl);
 assert.equal(answerReferenceContext([article],"ст. 409 ГК").unresolved.length,1);
});
test("Uzbek and English references resolve while hostile URLs never become links",()=>{
 assert.equal(inlineReferences("409-modda",[article])[0].href,article.originalUrl);
 assert.equal(inlineReferences("Article 409 of the Labour Code",[article])[0].href,article.originalUrl);
 for(const originalUrl of ["javascript:alert(1)","https://lex.uz.evil.test/docs/1","https://user@lex.uz/docs/1"])
   assert.equal(inlineReferences("ст. 409 ТК",[{...article,originalUrl}])[0].href,undefined);
 assert.equal(inlineReferences("2026 год, 1, 4 и 5",[article]).length,0);
});
test("Markdown preserves existing links, code and emphasis without nesting anchors",()=>{
 const html=renderToStaticMarkup(createElement(SafeMarkdown,{referenceSources:[article]},
   "**ст. 409 ТК**; `ст. 409 ТК`; [ст. 409 ТК](https://lex.uz/ru/docs/6257288#409)"));
 assert.equal((html.match(/<a /g)??[]).length,2);
 assert.match(html,/<strong><a [^>]+>ст. 409 ТК<\/a><\/strong>/);
 assert.match(html,/<code>ст. 409 ТК<\/code>/);
});
test("saved context reads prose but not source labels or duplicate legacy answer",()=>{
 assert.equal(legalAnswerProse({summary:"ст. 408",answer:"stale",confirmedFindings:[{explanation:"ст. 161",sourceIds:["internal"]}],sources:[article]}),"ст. 408\n\nст. 161");
});
