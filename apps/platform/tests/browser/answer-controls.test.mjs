import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';

test('answer tools select historical evidence and speech, remain compact and accessible',async()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const artifacts=fileURLToPath(new URL('../../../../.scratch/chat-message-actions/',import.meta.url));await mkdir(artifacts,{recursive:true});
 const source=(id,title)=>({sourceId:id,actTitle:title,actIdentifier:null,article:'1',originalUrl:'https://lex.uz/docs/'+(id==='old'?111:222),status:'current',effectiveDate:null,verifiedAt:'2026-11-04T00:00:00Z',sourceClass:'OFFICIAL_LEGISLATION',sourceOrigin:'indexed'});
 const result=(id,title)=>({responseKind:'answer',summary:id==='old'?'Покупка недвижимости: что устанавливает постановление.':'Рабочая неделя: как применяется общее правило.',answer:'Объяснение нормы.',clarificationQuestions:['Покупка планируется у застройщика или у прежнего собственника, и будет ли договор заключён во время строительства?'],confirmedFindings:[{title:'Что устанавливает закон',explanation:'Проверьте условия и применимые положения официального документа.',sourceIds:[id]}],assumptions:[],risks:[],sources:[source(id,title)],requiredDocuments:[],actionPlan:[{title:'Check documents',description:'Review the official rule.'}],deadlines:[],urgency:'normal',suggestedDocument:null,suggestLawyer:false,legalDatabaseAsOf:'2026-11-04',validationMethod:'programmatic',coverageStatus:'good_coverage',sourceAccessMode:'direct'});
 const old=result('old','Постановление о приобретении недвижимости'),latest=result('new','Трудовой кодекс');
 const delivery={conversationId:'conversation',messageId:'latest-message',requestMessageId:'latest-request',branchId:'latest-branch',question:'Какая продолжительность рабочей недели?',facts:[],result:latest,turns:[{branchId:'old-branch',requestMessageId:'old-request',responseMessageId:'old-message',question:'О чём это постановление?',createdAt:'2026-11-04',result:old}]};
 const bundle=await build({stdin:{contents:`import {createRoot} from 'react-dom/client';import {AiLawyerClient} from './app/_platform/AiLawyerClient';import {VoicePreferences} from './app/_platform/VoicePreferences';import {PlatformRouteProvider} from './app/_platform/PlatformRouteContext';createRoot(document.getElementById('root')).render(<PlatformRouteProvider basePath="/ru/individual" workspaceId="workspace">{location.pathname==='/settings-test'?<div className="account-content"><VoicePreferences locale="ru"/></div>:<AiLawyerClient locale="ru"/>}</PlatformRouteProvider>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,jsx:'automatic',plugins:[{name:'navigation',setup(b){b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({replace:()=>{},push:()=>{},prefetch:()=>{}});`,loader:'js'}));}}]});
 const css=(await Promise.all(['globals.css','_components/select.css','_platform/legal-answer.css','_platform/ai-lawyer-phase4.css','_platform/ai-document-prefill.css','_platform/ai-evidence.css','_platform/ai-lawyer.css','_platform/profile-settings.css','_platform/account-area.css'].map(p=>readFile(root+'app/'+p,'utf8')))).join('\n').replace('@import "tailwindcss";','');
 const feedbackWrites=[];let preferredVoice="cedar";const speech=[];const detailRequests=[];let speechFails=true;
 const wav=Buffer.alloc(44+160000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(160000,40);
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(url.pathname==='/style.css'){res.setHeader('content-type','text/css');res.end(css);return;}
  if(url.pathname==='/api/platform/voice/preferences'){res.setHeader('content-type','application/json');if(req.method==='PUT'){let body='';for await(const chunk of req)body+=chunk;preferredVoice=JSON.parse(body).voice;}res.end(JSON.stringify({voice:preferredVoice}));return;}
  if(url.pathname==='/api/platform/ai/feedback'&&req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;feedbackWrites.push(JSON.parse(body));res.setHeader('content-type','application/json');res.end('{}');return;}
  if(url.pathname==='/api/platform/voice/speech'){let body='';for await(const chunk of req)body+=chunk;speech.push(JSON.parse(body));await new Promise(r=>setTimeout(r,200));res.writeHead(speechFails?503:200,{'content-type':'audio/wav'});res.end(speechFails?undefined:wav);return;}
  if(url.pathname.startsWith('/api/')){
   res.setHeader('content-type','application/json');
   if(url.pathname.includes('/citations/')){detailRequests.push(url.pathname+url.search);res.end(JSON.stringify({documentTitle:old.sources[0].actTitle,fullArticle:true,officialUrl:old.sources[0].originalUrl,text:'Сохранённый текст официальной нормы.',availableLanguages:[],versionHistory:[]}));return;}
   res.end(JSON.stringify(url.pathname.endsWith('/feedback')?{feedback:[]}:url.searchParams.has('conversationId')?delivery:{provider:{configured:true},usage:{used:0,limit:100,periodEnd:'2099-01-01'},conversations:[],cases:[],next:null}));return;
  }
  res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="ru" data-theme="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{font-family:Arial,sans-serif}</style><div id="root"></div><script src="/bundle.js"></script></html>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:process.env.AUTH_BROWSER_CHANNEL||'chrome'});
 try{
  const page=await browser.newPage({permissions:['clipboard-read','clipboard-write'],viewport:{width:1600,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/ru/individual/ai-chat?conversationId=conversation`);
  const tools=page.locator('.ai-answer-toolbar');await tools.first().waitFor();assert.equal(await tools.count(),2);
  assert.equal(await page.getByText('Правовая интерпретация не проверялась независимо.',{exact:false}).count(),0);
  assert.equal(await page.getByRole('button',{name:/Повторить поиск источников|Повторить ответ|Получить новый ответ/}).count(),0);
  assert.equal(await page.locator('.ai-workspace').evaluate(el=>el.classList.contains('ai-evidence-collapsed')),true);
  await tools.first().getByRole('button',{name:'Источники 1',exact:true}).click();
  await page.locator('.ai-source-card').filter({hasText:old.sources[0].actTitle}).waitFor();
  assert.equal(await page.locator('.ai-source-card').filter({hasText:latest.sources[0].actTitle}).count(),0);
  await page.locator('.ai-source-card').getByRole('button',{name:'Текст статьи'}).click();
  await page.getByText('Сохранённый текст официальной нормы.',{exact:true}).waitFor();
  assert(detailRequests[0].includes('/citations/old-message?'));assert(detailRequests[0].includes('sourceId=old'));await page.keyboard.press('Escape');
  await tools.last().getByRole('button',{name:'Источники 1',exact:true}).click();
  await page.locator('.ai-source-card').filter({hasText:latest.sources[0].actTitle}).waitFor();
  const actions=page.locator('.ai-message-actions');assert.equal(await actions.count(),2);
  await actions.first().getByRole('button',{name:'Полезно',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.ai-message-actions button[aria-pressed="true"]'));
  assert.equal(feedbackWrites[0].assistantMessageId,'old-message');
  await actions.last().getByRole('button',{name:'Не полезно',exact:true}).click();
  const popup=page.locator('.ai-rating-popover');await popup.waitFor();
  await popup.getByRole('button',{name:'Неверная норма',exact:true}).click();
  await popup.locator('textarea').fill('Please verify the source.');
  await popup.screenshot({path:artifacts+'feedback.png'});
  await popup.getByRole('button',{name:'Отправить отзыв',exact:true}).click();await popup.waitFor({state:'hidden'});
  assert.deepEqual(feedbackWrites[1],{assistantMessageId:'latest-message',feedbackType:'wrong_norm',comment:'Please verify the source.'});
  await actions.first().getByRole('button',{name:'Озвучить ответ',exact:true}).click();
  await actions.first().getByRole('alert').waitFor();assert.equal(speech[0].assistantMessageId,'old-message');assert.equal(speech[0].voice,'cedar');
  speechFails=false;await actions.last().getByRole('button',{name:'Озвучить ответ',exact:true}).click();
  await actions.last().locator('button[aria-busy="true"]').waitFor();
  assert.equal(await actions.last().locator('audio').count(),0);
  await actions.last().getByRole('button',{name:'Остановить',exact:true}).click();await page.waitForTimeout(250);assert.equal(await actions.last().locator('audio').count(),0);
  await actions.last().getByRole('button',{name:'Озвучить ответ',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('audio')?.readyState>=2);
  assert.equal(await actions.last().locator('audio').getAttribute('controls'),null);
  await actions.last().getByRole('button',{name:'Остановить',exact:true}).click();assert.equal(await actions.last().locator('audio').count(),0);
  const question=page.locator('.ai-human-turn').first();await question.hover();
  await question.getByRole('button',{name:'Копировать',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'О чём это постановление?');
  await question.screenshot({path:artifacts+'question-hover.png'});
  await question.getByRole('button',{name:'Редактировать вопрос',exact:true}).click();assert.equal(await page.locator('#ai-question').inputValue(),'О чём это постановление?');
  assert.equal(await page.locator('.ai-edit-notice').count(),0);
  await page.getByRole('button',{name:'Отменить редактирование',exact:true}).click();
  const openWidth=await page.locator('.ai-dialog').evaluate(el=>el.clientWidth);
  await page.getByRole('button',{name:'Свернуть контекст ответа',exact:true}).click();
  await page.waitForTimeout(250);assert(await page.locator('.ai-dialog').evaluate(el=>el.clientWidth)>openWidth);
  await page.getByRole('button',{name:'Открыть контекст ответа',exact:true}).click();
  // Reload clears simulated audio errors before reviewing the ordinary layout.
  await page.reload();await tools.first().waitFor();
  for(const width of [1600,390]){
   await page.setViewportSize({width,height:1100});await tools.first().scrollIntoViewIfNeeded();
   await page.screenshot({path:artifacts+`answer-${width}-dark.png`,fullPage:true});
   const metrics=await tools.first().evaluate(el=>({width:el.getBoundingClientRect().width,controls:[...el.querySelectorAll('button')].map(b=>({height:b.getBoundingClientRect().height,width:b.getBoundingClientRect().width}))}));
   assert(await tools.first().evaluate(el=>Math.abs(el.getBoundingClientRect().right-el.querySelector('.ai-answer-sources').getBoundingClientRect().right)<2),'Sources align right');
   assert(metrics.controls.every(c=>c.height>=40),'Touch targets stay usable');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
   assert.equal(await page.locator('.legal-answer__questions').first().evaluate(el=>getComputedStyle(el).paddingBottom),'24px');
   await tools.first().getByRole('button',{name:'Источники 1',exact:true}).click();
   await page.locator('.ai-source-card').filter({hasText:old.sources[0].actTitle}).waitFor({state:'visible'});
   const sticky=await page.locator('.ai-context').evaluate(el=>{
    const spacer=document.createElement('div');spacer.style.height='1800px';el.append(spacer);
    const header=el.querySelector('header');el.scrollTop=0;const before=header.getBoundingClientRect().top;
    el.scrollTop=300;const after=header.getBoundingClientRect().top;const scrolled=el.scrollTop;
    spacer.remove();el.scrollTop=0;return {before,after,scrolled};
   });
   assert(sticky.scrolled>0);assert(Math.abs(sticky.before-sticky.after)<2,'Context title remains stationary');
   if(width===390){assert.equal(await page.locator('#ai-context-panel').getAttribute('role'),'dialog');await page.keyboard.press('Escape');await tools.first().getByRole('button',{name:'Источники 1',exact:true}).waitFor({state:'visible'});}
   if(width===390){await actions.first().getByRole('button',{name:'Не полезно',exact:true}).click();await popup.waitFor();const box=await popup.boundingBox();assert(box.x>=0&&box.x+box.width<=390);await popup.screenshot({path:artifacts+'feedback-mobile.png'});await page.keyboard.press('Escape');}
   await page.evaluate(()=>document.documentElement.dataset.theme='light');await tools.first().scrollIntoViewIfNeeded();await page.screenshot({path:artifacts+`answer-${width}-light.png`,fullPage:true});await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  }
  await page.setViewportSize({width:1600,height:1100});await page.locator('.ai-message-actions').last().scrollIntoViewIfNeeded();await page.screenshot({path:artifacts+'answer-footer.png'});
  const settings=await browser.newPage({viewport:{width:800,height:700}});await settings.goto(`http://127.0.0.1:${server.address().port}/settings-test`);
  const voice=settings.getByRole('combobox');await voice.waitFor();await settings.waitForFunction(()=>!document.querySelector('[role="combobox"]').disabled);
  assert.match(await voice.innerText(),/Cedar/);await voice.click();await settings.getByRole('option',{name:'Marin',exact:true}).click();await settings.getByText('Голос сохранён.',{exact:true}).waitFor();assert.equal(preferredVoice,'marin');
  await settings.reload();await settings.waitForFunction(()=>!document.querySelector('[role="combobox"]').disabled);assert.match(await settings.getByRole('combobox').innerText(),/Marin/);await settings.screenshot({path:artifacts+'voice-preference.png'});await settings.close();
  assert.deepEqual(errors,[]);console.log('Checked historical/latest citations, answer-specific speech and voice selection, error state, desktop/mobile, themes, spacing, hit areas and dialog Escape.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
