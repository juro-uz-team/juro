import assert from "node:assert/strict";
import test from "node:test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {SafeMarkdown} from "../app/_platform/SafeMarkdown";
import {inlineReferences, answerReferenceContext, legalAnswerProse} from "../lib/ai/legal-inline-references";
const section={sourceId:"section",actTitle:"Трудовой кодекс Республики Узбекистан",article:"§ 1. Особенности",originalUrl:"https://lex.uz/ru/docs/6257288#section"};
const article={...section,sourceId:"409",article:"Статья 409. Гарантии",originalUrl:"https://lex.uz/ru/docs/6257288#409"};
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
