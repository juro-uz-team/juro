import assert from "node:assert/strict";
import {after,before,test} from "node:test";
import {createServer} from "node:http";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {chromium} from "playwright";

let browser,server,origin;
const pending=new Map();
const completed=new Set();
let stallMetadata=true;
const result={responseKind:"clarification_required",summary:"The governing rule could not be established.",
  answer:"The governing rule could not be established.",language:"en",jurisdiction:"UZ",answerMode:"detailed",reasoningMode:"fast",
  clarificationQuestions:[],confirmedFindings:[],assumptions:[],risks:[],sources:[],requiredDocuments:[],actionPlan:[],deadlines:[],
  successOutlook:null,urgency:"normal",suggestedDocument:null,suggestLawyer:false,legalDatabaseAsOf:"unavailable"};
const saved={runId:"run",conversationId:"conversation",messageId:"message",question:"A complex question",facts:[],result};
const prior={...saved,conversationId:"prior",messageId:"old-message",requestMessageId:"old-request",branchId:"old-branch",
  facts:[{id:"fact",statement:"The agreement is signed.",status:"confirmed"}],
  result:{...result,summary:"Earlier saved response",answer:"Earlier saved response"},
  turns:[{branchId:"old-branch",requestMessageId:"old-request",responseMessageId:"old-message",question:"Earlier question",
    createdAt:"2026-01-01T00:00:00Z",result:{...result,summary:"Earlier saved response",answer:"Earlier saved response"}}]};
let delivery=saved;
const voiceId="6b5e2815-a16e-4b48-a182-764d771fae2a";
let voicePatch,chatReceived,sendDeeperProgress=true;

before(async()=>{
  const root=fileURLToPath(new URL("../../",import.meta.url));
  const bundle=await build({stdin:{contents:`import {createRoot} from 'react-dom/client';
    import {AiLawyerClient} from './app/_platform/AiLawyerClient';
    import {GuestAiClient} from './app/_guest/GuestAiClient';
    import {PlatformRouteProvider} from './app/_platform/PlatformRouteContext';
    createRoot(document.getElementById('root')).render(location.pathname==='/guest'
      ? <GuestAiClient locale="en"/>
      : <PlatformRouteProvider basePath="/en/individual" workspaceId="workspace"><AiLawyerClient locale="en"/></PlatformRouteProvider>);`,
    resolveDir:root,loader:"tsx"},bundle:true,write:false,jsx:"automatic",
    plugins:[{name:"next-adapters",setup(builder){
      builder.onResolve({filter:/^next\/(navigation|image|link)$/},args=>({path:args.path,namespace:"adapter"}));
      builder.onLoad({filter:/.*/,namespace:"adapter"},args=>({contents:args.path.endsWith("navigation")
        ? `import {useSyncExternalStore} from 'react';
           const subscribe=callback=>{addEventListener('popstate',callback);return()=>removeEventListener('popstate',callback)};
           export const usePathname=()=>location.pathname;
           export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(subscribe,()=>location.search));
           export const useRouter=()=>({replace:url=>{history.replaceState(null,'',url);dispatchEvent(new PopStateEvent('popstate'))},push:()=>{},prefetch:()=>{}});`
        : `import React from 'react'; export default function Adapter({children,...props}){return React.createElement('${args.path.endsWith("image")?"img":"a"}',props,children)}`,
        loader:"js",resolveDir:root}));
    }}]});
  server=createServer((request,response)=>{
    const url=new URL(request.url,"http://localhost");
    if(url.pathname.startsWith('/api/platform/voice/recordings')){
      if(request.method==='PATCH'&&voicePatch){voicePatch.resolve(response);return;}
      response.setHeader('content-type','application/json');
      response.end(JSON.stringify(url.pathname.endsWith('/transcribe')?{transcript:'A voice question'}
        :{recording:{id:voiceId,status:'transcribed'}}));return;
    }
    if(request.method==="POST"&&["/api/platform/ai","/api/guest/ai"].includes(url.pathname)){
      response.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-store"});
      response.write(`event: progress\ndata: {"stage":"${sendDeeperProgress?'deeper_research':'researching'}"}\n\n`);
      pending.set(url.pathname,response);chatReceived?.resolve();return;
    }
    if(url.pathname.startsWith("/api/")){
      if(stallMetadata&&completed.has(url.pathname))return;
      response.setHeader("content-type","application/json");
      const payload=url.pathname.endsWith("/feedback")?{feedback:[]}:url.pathname==="/api/guest/ai"
        ?{enabled:true,providerConfigured:true,siteKey:null,session:{state:completed.has(url.pathname)&&delivery.result.responseKind==="answer"?"consumed":"available",requestCount:0,answerCount:completed.has(url.pathname)&&delivery.result.responseKind==="answer"?1:0,expiresAt:"2099-01-01"},result:completed.has(url.pathname)?delivery.result:null}
        :url.searchParams.has("conversationId")?(completed.has(url.pathname)?delivery:prior)
        :{provider:{configured:true,provider:"openai",model:null,fallbackConfigured:false},usage:{used:0,limit:10,periodEnd:"2099-01-01"},conversations:[],cases:[],next:null};
      response.end(JSON.stringify(payload));return;
    }
    response.setHeader("content-type",url.pathname==="/bundle.js"?"text/javascript":"text/html");
    response.end(url.pathname==="/bundle.js"?bundle.outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:process.env.AUTH_BROWSER_CHANNEL||undefined,
    args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
});

for(const extended of [false,true])test(`voice transcript saving shares the submission deadline (extended: ${extended})`,async context=>{
  completed.clear();stallMetadata=false;sendDeeperProgress=extended;
  voicePatch=Promise.withResolvers();chatReceived=Promise.withResolvers();
  const browserContext=await browser.newContext({permissions:['microphone']});
  context.after(async()=>{sendDeeperProgress=true;voicePatch=undefined;chatReceived=undefined;
    pending.get('/api/platform/ai')?.end();pending.delete('/api/platform/ai');await browserContext.close();});
  const page=await browserContext.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{AbortSignal.timeout=milliseconds=>{
    const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('Timed out','TimeoutError')),milliseconds);return controller.signal;
  };});
  await page.clock.install();await page.goto(origin+'/signed');
  await page.getByRole('button',{name:'Voice',exact:true}).click();
  await page.locator('.ai-voice-controls[data-phase="idle"] button').click();
  await page.locator('.ai-voice-controls[data-phase="listening"]').waitFor();
  // The browser supplies a synthetic microphone; the real MediaRecorder and
  // transcript callback run before submission timing begins.
  await new Promise(resolve=>setTimeout(resolve,300));
  await page.getByRole('button',{name:'Finish',exact:true}).click();
  await page.locator('.ai-voice-controls[data-phase="ready"]').waitFor();
  assert.equal(await page.locator('#ai-question').inputValue(),'A voice question');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  const patch=await voicePatch.promise;
  assert.equal(pending.has('/api/platform/ai'),false,'The edited transcript must be confirmed first');
  await page.clock.fastForward(8_000);patch.setHeader('content-type','application/json');patch.end('{}');
  await chatReceived.promise;
  if(extended)await page.getByText('This question needs deeper research. It is taking a little more time…',{exact:true}).last().waitFor();
  await page.clock.fastForward(240_000-8_000-2_000);
  assert.equal(await page.getByRole('button',{name:'Retry safely',exact:true}).count(),0);
  await page.clock.fastForward(2_100);
  await page.getByRole('button',{name:'Retry safely',exact:true}).waitFor({timeout:3000});
  assert.deepEqual(errors,[]);
});
after(async()=>{await browser?.close();server?.closeAllConnections();await new Promise(resolve=>server?server.close(resolve):resolve());});

for(const outcome of ["non-answer","answer"])for(const mode of ["signed-in","guest","existing conversation"])test(`${mode} client delivers and reloads a synthetic ${outcome} after deeper research`,async context=>{
  const guest=mode==="guest",existing=mode==="existing conversation";
  const deliveredResult=outcome==="answer"?{...result,responseKind:"answer",summary:"Synthetic supported answer",answer:"Synthetic supported answer"}:result;
  stallMetadata=true;completed.clear();delivery={...saved,result:deliveredResult,...(existing?{conversationId:"prior",branchId:"new-branch"}:{})};
  const page=await browser.newPage();context.after(()=>page.close());
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  // Include AbortSignal.timeout in the browser's controlled clock, so an outer
  // fixed deadline cannot escape the regression by using a native timer.
  await page.addInitScript(()=>{AbortSignal.timeout=milliseconds=>{
    const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException("Timed out","TimeoutError")),milliseconds);return controller.signal;
  };});
  await page.clock.install();await page.goto(origin+(guest?"/guest":existing?"/signed?conversationId=prior&branchId=old-branch":"/signed"));
  const composer=page.locator(guest?"#guest-question":"#ai-question");await composer.fill("A complex question");
  await (guest?page.locator('button[type="submit"]'):page.getByRole('button',{name:'Send',exact:true})).click();
  await page.getByText("This question needs deeper research. It is taking a little more time…",{exact:true}).last().waitFor();
  assert.doesNotMatch(await page.locator("body").innerText(),/\b(?:30|60)\s*seconds\b/i);
  await page.clock.fastForward(95_000);
  await page.getByText('Still working. This is taking longer than usual.',{exact:true}).waitFor();
  assert.match(await page.locator('.answer-activity').innerText(), /Elapsed: 1:3[5-9]/);
  const path=guest?"/api/guest/ai":"/api/platform/ai",response=pending.get(path);
  assert(response&&!response.destroyed,"The extended stream must remain connected");
  completed.add(path);pending.delete(path);response.end(`event: result\ndata: ${JSON.stringify(delivery)}\n\n`);
  await page.getByText(deliveredResult.summary,{exact:true}).first().waitFor({timeout:3000});
  assert.deepEqual(errors,[]);
  if(existing){
    await page.getByText('Earlier saved response',{exact:true}).first().waitFor({timeout:3000});
    await page.getByText('The agreement is signed.',{exact:true}).first().waitFor({timeout:3000});
  }
  if(!guest){stallMetadata=false;await page.reload();await page.getByText(deliveredResult.summary,{exact:true}).first().waitFor();}
  else if(outcome==="answer"){
    stallMetadata=false;await page.reload();await page.getByText(deliveredResult.summary,{exact:true}).first().waitFor();
    assert.equal(await page.locator("#guest-question").count(),0,"A successful guest answer consumes its allowance");
  } else {
    await composer.fill('A follow-up question');await page.locator('button[type="submit"]').click();
    await page.getByText("This question needs deeper research. It is taking a little more time…",{exact:true}).waitFor({timeout:3000});
    pending.get(path)?.end(`event: result\ndata: ${JSON.stringify(saved)}\n\n`);pending.delete(path);
  }
});

for(const guest of [true,false])test(`visible activity and cancellation remain available during long source review (guest: ${guest})`,async context=>{
  completed.clear();stallMetadata=false;sendDeeperProgress=false;
  const page=await browser.newPage({viewport:{width:390,height:844}});
  context.after(async()=>{sendDeeperProgress=true;pending.get(guest?'/api/guest/ai':'/api/platform/ai')?.end();await page.close();});
  await page.clock.install();await page.goto(origin+(guest?'/guest':'/signed'));
  await page.locator(guest?'#guest-question':'#ai-question').fill('A complex question');
  await (guest?page.locator('button[type="submit"]'):page.getByRole('button',{name:'Send',exact:true})).click();
  const path=guest?'/api/guest/ai':'/api/platform/ai';
  await page.locator('.answer-activity').waitFor();
  await page.clock.fastForward(10_000);
  assert.match(await page.locator('.answer-activity').innerText(),/Elapsed: 0:1[0-9]/);
  pending.get(path).write('event: progress\ndata: {"stage":"reviewing"}\n\n');
  await page.getByText('Reviewing sources and preparing the answer…',{exact:true}).last().waitFor();
  await page.clock.fastForward(60_000);
  await page.getByText('Still working. This is taking longer than usual.',{exact:true}).waitFor();
  await page.getByRole('button',{name:guest?'Stop':'Stop generation',exact:true}).click();
  await page.getByText('Request stopped. Retry to check for a saved result.',{exact:true}).waitFor({timeout:3000})
    .catch(async error=>{throw new Error(`${error.message}\n${await page.locator('body').innerText()}`);});
  assert.equal(await page.locator('.answer-activity').count(),0);
});

for (const guest of [true, false]) test(`draft grows before completion and clears when stopped (guest: ${guest})`, async context => {
  completed.clear(); stallMetadata = false; sendDeeperProgress = false;
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const path = guest ? '/api/guest/ai' : '/api/platform/ai';
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  context.after(async () => { sendDeeperProgress = true; pending.get(path)?.end(); pending.delete(path); await page.close(); });
  await page.goto(origin + (guest ? '/guest' : '/signed'));
  if (!guest) {
    await page.locator('.ai-composer-options summary').click();
    const simple = page.getByRole('button', {name:'Simple',exact:true});
    assert.equal(await simple.getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', {name:'Deep',exact:true}).click();
    await simple.click();
    assert.equal(await page.getByRole('button', {name:'Fast',exact:true}).count(), 0);
  }
  await page.locator(guest ? '#guest-question' : '#ai-question').fill('A complex question');
  await (guest ? page.locator('button[type="submit"]') : page.getByRole('button',{name:'Send',exact:true})).click();
  await page.locator('.answer-activity').waitFor();
  const response = pending.get(path); assert(response && !response.destroyed);
  const write = text => response.write(`event: writing\ndata: ${JSON.stringify({blocks:[{key:'turn/content/summary',text}],revision:0})}\n\n`);
  write('A supported');
  await page.locator('[data-answer-writing]').getByText('A supported',{exact:true}).waitFor();
  assert.equal(completed.has(path), false);
  write(' rule.');
  await page.locator('[data-answer-writing]').getByText('A supported rule.',{exact:true}).waitFor();
  await page.getByRole('button',{name:guest?'Stop':'Stop generation',exact:true}).click();
  await page.locator('[data-answer-writing]').waitFor({state:'detached'});
  assert.equal(completed.has(path), false);
  assert.deepEqual(errors, []);
});
