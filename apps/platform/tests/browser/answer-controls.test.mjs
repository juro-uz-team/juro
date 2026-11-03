import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';

test('answer tools select historical evidence and speech, remain compact and accessible',async()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const artifacts=fileURLToPath(new URL('../../../../.scratch/chat-version-controls/',import.meta.url));await mkdir(artifacts,{recursive:true});
 const source=(id,title)=>({sourceId:id,actTitle:title,actIdentifier:null,article:'1',originalUrl:'https://lex.uz/docs/'+(id==='old'?111:222),status:'current',effectiveDate:null,verifiedAt:'2026-11-04T00:00:00Z',sourceClass:'OFFICIAL_LEGISLATION',sourceOrigin:'indexed'});
 const result=(id,title)=>({responseKind:'answer',summary:id==='old'?'Покупка недвижимости: что устанавливает постановление.':'Рабочая неделя: как применяется общее правило.',answer:'Объяснение нормы.',clarificationQuestions:['Покупка планируется у застройщика или у прежнего собственника, и будет ли договор заключён во время строительства?'],confirmedFindings:[{title:'Что устанавливает закон',explanation:'Проверьте условия и применимые положения официального документа.',sourceIds:[id]}],assumptions:[],risks:[],sources:[source(id,title)],requiredDocuments:[],actionPlan:[{title:'Check documents',description:'Review the official rule.'}],deadlines:[],urgency:'normal',suggestedDocument:null,suggestLawyer:false,legalDatabaseAsOf:'2026-11-04',validationMethod:'programmatic',coverageStatus:'good_coverage',sourceAccessMode:'direct'});
 const old=result('old','Постановление о приобретении недвижимости'),latest=result('new','Трудовой кодекс');
 const delivery={conversationId:'conversation',messageId:'latest-message',requestMessageId:'latest-request',branchId:'latest-branch',question:'Какая продолжительность рабочей недели?',facts:[],result:latest,turns:[{branchId:'old-branch',requestMessageId:'old-request',responseMessageId:'old-message',question:'О чём это постановление?',createdAt:'2026-11-04',result:old}]};
 const savedTurns=[...delivery.turns,{branchId:delivery.branchId,requestMessageId:delivery.requestMessageId,responseMessageId:delivery.messageId,question:delivery.question,result:latest,createdAt:'2026-11-04'}].map((turn,index)=>({...turn,parentBranchId:index?'old-branch':null,operation:index?'follow_up':'new',versionNumber:1,rootRequestId:turn.requestMessageId}));
 const requests=[];
 const savedDelivery=branchId=>{
  const selected=savedTurns.find(turn=>turn.branchId===branchId)||savedTurns.at(-1);
  const turns=[];let next=selected;
  while(next){turns.unshift({...next,versions:savedTurns.filter(turn=>turn.rootRequestId===next.rootRequestId).map(({branchId,requestMessageId,responseMessageId,operation,forkedFromMessageId,versionNumber,question,createdAt,parentBranchId})=>({branchId,requestMessageId,responseMessageId,operation,forkedFromMessageId,versionNumber,question,createdAt,parentBranchId}))});next=savedTurns.find(turn=>turn.branchId===next.parentBranchId);}
  return {...delivery,branchId:selected.branchId,requestMessageId:selected.requestMessageId,messageId:selected.responseMessageId,question:selected.question,result:selected.result,turns};
 };
 const bundle=await build({stdin:{contents:`import {createRoot} from 'react-dom/client';import {AiLawyerClient} from './app/_platform/AiLawyerClient';import {VoicePreferences} from './app/_platform/VoicePreferences';import {PlatformRouteProvider} from './app/_platform/PlatformRouteContext';createRoot(document.getElementById('root')).render(<PlatformRouteProvider basePath="/ru/individual" workspaceId="workspace">{location.pathname==='/settings-test'?<div className="account-content"><VoicePreferences locale="ru"/></div>:<AiLawyerClient locale="ru"/>}</PlatformRouteProvider>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,jsx:'automatic',plugins:[{name:'navigation',setup(b){b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`import {useSyncExternalStore} from 'react';const subscribe=fn=>{addEventListener('popstate',fn);return()=>removeEventListener('popstate',fn)};const navigate=url=>{history.replaceState(null,'',url);dispatchEvent(new PopStateEvent('popstate'))};const router={replace:navigate,push:navigate,prefetch:()=>{}};export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(subscribe,()=>location.search));export const useRouter=()=>router;`,loader:'js',resolveDir:root}));}}]});
 const css=(await Promise.all(['globals.css','_components/select.css','_platform/legal-answer.css','_platform/ai-lawyer-phase4.css','_platform/ai-document-prefill.css','_platform/ai-evidence.css','_platform/ai-lawyer.css','_platform/profile-settings.css','_platform/account-area.css'].map(p=>readFile(root+'app/'+p,'utf8')))).join('\n').replace('@import "tailwindcss";','');
 const feedbackWrites=[];const feedbackDeletes=[];let audioFinished=false;let preferredVoice="cedar";const speech=[];const detailRequests=[];let speechFails=true;
 const mp3=await readFile(new URL('./fixtures/speech-silence.mp3',import.meta.url));

 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(url.pathname==='/style.css'){res.setHeader('content-type','text/css');res.end(css);return;}
  if(url.pathname==='/api/platform/voice/preferences'){res.setHeader('content-type','application/json');if(req.method==='PUT'){let body='';for await(const chunk of req)body+=chunk;preferredVoice=JSON.parse(body).voice;}res.end(JSON.stringify({voice:preferredVoice}));return;}
  if(url.pathname==='/api/platform/ai/feedback'&&req.method==='DELETE'){let body='';for await(const chunk of req)body+=chunk;feedbackDeletes.push(JSON.parse(body));res.setHeader('content-type','application/json');res.end('{}');return;}
  if(url.pathname==='/api/platform/ai/feedback'&&req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;feedbackWrites.push(JSON.parse(body));res.setHeader('content-type','application/json');res.end('{}');return;}
  if(url.pathname==='/api/platform/voice/speech'){let body='';for await(const chunk of req)body+=chunk;speech.push(JSON.parse(body));await new Promise(r=>setTimeout(r,200));res.writeHead(speechFails?503:200,{'content-type':'audio/mpeg'});if(speechFails){res.end();return;}audioFinished=false;res.write(mp3);await new Promise(r=>setTimeout(r,1800));audioFinished=true;res.end(mp3);return;}
  if(url.pathname==='/api/platform/ai'&&req.method==='POST'){
   let body='';for await(const chunk of req)body+=chunk;const payload=JSON.parse(body);requests.push(payload);
   const source=savedTurns.find(turn=>payload.operation==='edit'?turn.requestMessageId===payload.sourceMessageId:turn.responseMessageId===payload.sourceMessageId);
   assert(source);const id='variant-'+requests.length;
   const generated={...latest,summary:'Ответ '+id,confirmedFindings:[],sources:[],actionPlan:[],language:'ru',jurisdiction:'UZ',answerMode:'detailed',reasoningMode:'fast',successOutlook:null};
   const next={branchId:id,requestMessageId:id+'-request',responseMessageId:id+'-message',question:payload.question,result:generated,createdAt:'2026-11-04',operation:payload.operation,parentBranchId:payload.operation==='follow_up'?source.branchId:source.parentBranchId,forkedFromMessageId:source.requestMessageId,rootRequestId:payload.operation==='follow_up'?id+'-request':source.rootRequestId,versionNumber:requests.length+1};savedTurns.push(next);
   res.writeHead(200,{'content-type':'text/event-stream'});res.write('event: progress\ndata: {"stage":"writing"}\n\n');await new Promise(resolve=>setTimeout(resolve,350));
   res.end('event: result\ndata: '+JSON.stringify({runId:id,conversationId:'conversation',messageId:next.responseMessageId,requestMessageId:next.requestMessageId,branchId:id,result:generated})+'\n\n');return;
  }
  if(url.pathname.startsWith('/api/')){
   res.setHeader('content-type','application/json');
   if(url.pathname.includes('/citations/')){detailRequests.push(url.pathname+url.search);res.end(JSON.stringify({documentTitle:old.sources[0].actTitle,fullArticle:true,officialUrl:old.sources[0].originalUrl,text:'Сохранённый текст официальной нормы.',availableLanguages:[],versionHistory:[]}));return;}
   res.end(JSON.stringify(url.pathname.endsWith('/feedback')?{feedback:[]}:url.searchParams.has('conversationId')?savedDelivery(url.searchParams.get('branchId')):{provider:{configured:true},usage:{used:0,limit:100,periodEnd:'2099-01-01'},conversations:[],cases:[],next:null}));return;
  }
  res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="ru" data-theme="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{font-family:Arial,sans-serif}</style><div id="root"></div><script src="/bundle.js"></script></html>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:process.env.AUTH_BROWSER_CHANNEL||'chrome'});
 try{
  const page=await browser.newPage({permissions:['clipboard-read','clipboard-write'],viewport:{width:1600,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/ru/individual/ai-chat?conversationId=conversation`);
  assert.equal(await page.locator('.ai-composer-hint').count(),0);
  const tools=page.locator('.ai-message-actions');await tools.first().waitFor();assert.equal(await tools.count(),2);
  assert.equal(await page.getByText('Правовая интерпретация не проверялась независимо.',{exact:false}).count(),0);
  assert.equal(await page.getByRole('button',{name:/Повторить поиск источников|Повторить ответ|Получить новый ответ/}).count(),0);
  assert.equal(await page.locator('.ai-workspace').evaluate(el=>el.classList.contains('ai-evidence-collapsed')),true);
  await tools.first().getByRole('button',{name:'Источники',exact:true}).click();
  await page.locator('.ai-source-card').filter({hasText:old.sources[0].actTitle}).waitFor();
  assert.equal(await page.locator('.ai-source-card').filter({hasText:latest.sources[0].actTitle}).count(),0);
  await page.locator('.ai-source-card').getByRole('button',{name:'Текст статьи'}).click();
  await page.getByText('Сохранённый текст официальной нормы.',{exact:true}).waitFor();
  assert(detailRequests[0].includes('/citations/old-message?'));assert(detailRequests[0].includes('sourceId=old'));await page.keyboard.press('Escape');
  await tools.last().getByRole('button',{name:'Источники',exact:true}).click();
  await page.locator('.ai-source-card').filter({hasText:latest.sources[0].actTitle}).waitFor();
  const actions=page.locator('.ai-message-actions');assert.equal(await actions.count(),2);
  await actions.first().getByRole('button',{name:'Полезно',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.ai-message-actions button[aria-pressed="true"]'));
  assert.equal(feedbackWrites[0].assistantMessageId,'old-message');
  await page.locator('.ai-chat-notification').waitFor();await actions.first().getByRole('button',{name:'Полезно',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.ai-message-actions button[aria-label="Полезно"]').getAttribute('aria-pressed')==='false');assert.equal(feedbackDeletes[0].assistantMessageId,'old-message');
  await actions.last().getByRole('button',{name:'Не полезно',exact:true}).click();
  const popup=page.locator('.ai-rating-popover');await popup.waitFor();
  await popup.getByRole('button',{name:'Неверная норма',exact:true}).click();
  await popup.locator('textarea').fill('Please verify the source.');
  await popup.screenshot({path:artifacts+'feedback.png'});
  await popup.getByRole('button',{name:'Отправить отзыв',exact:true}).click();await popup.waitFor({state:'hidden'});
  await page.locator('.ai-chat-notification').screenshot({path:artifacts+'feedback-toast.png'});await page.locator('.ai-chat-notification').waitFor({state:'hidden',timeout:5000});
  assert.deepEqual(feedbackWrites[1],{assistantMessageId:'latest-message',feedbackType:'wrong_norm',comment:'Please verify the source.'});
  await actions.first().getByRole('button',{name:'Озвучить ответ',exact:true}).click();
  await actions.first().getByRole('alert').waitFor();assert.equal(speech[0].assistantMessageId,'old-message');assert.equal(speech[0].voice,'cedar');
  speechFails=false;await actions.last().getByRole('button',{name:'Озвучить ответ',exact:true}).click();
  await actions.last().locator('button[aria-busy="true"]').waitFor();
  assert.equal(await actions.last().locator('audio').count(),0);
  assert.equal(await actions.last().locator('.spin').evaluate(el=>getComputedStyle(el).animationName),'ai-audio-spin');
  await actions.last().getByRole('button',{name:'Остановить',exact:true}).click();await page.waitForTimeout(250);assert.equal(await actions.last().locator('audio').count(),0);
  await actions.last().getByRole('button',{name:'Озвучить ответ',exact:true}).click();
  await page.waitForFunction(()=>{const audio=document.querySelector('audio');return audio&&audio.currentTime>0&&!audio.paused;});assert.equal(audioFinished,false,'Playback starts before download ends');await page.waitForFunction(()=>document.querySelector('audio')?.duration>10&&document.querySelector('audio')?.duration<15);
  assert.equal(await actions.last().locator('audio').getAttribute('controls'),null);
  await actions.last().getByRole('button',{name:'Остановить',exact:true}).click();assert.equal(await actions.last().locator('audio').count(),0);
  const question=page.locator('.ai-human-turn').first();await question.hover();
  await question.getByRole('button',{name:'Копировать',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'О чём это постановление?');
  await question.screenshot({path:artifacts+'question-hover.png'});
  await question.getByRole('button',{name:'Редактировать вопрос',exact:true}).click();assert.equal(await question.locator('textarea').inputValue(),'О чём это постановление?');assert.equal(await page.locator('#ai-question').inputValue(),'');
  assert.equal(await page.locator('.ai-edit-notice').count(),0);
  await question.getByRole('button',{name:'Отмена',exact:true}).click();
  const openWidth=await page.locator('.ai-dialog').evaluate(el=>el.clientWidth);
  await page.getByRole('button',{name:'Контекст ответа',exact:true}).click();
  await page.waitForTimeout(250);assert(await page.locator('.ai-dialog').evaluate(el=>el.clientWidth)>openWidth);
  await page.getByRole('button',{name:'Контекст ответа',exact:true}).click();
  await tools.first().getByRole('button',{name:'Источники',exact:true}).click();
  const sourceButton=tools.first().getByRole('button',{name:'Источники',exact:true});await sourceButton.click();assert.equal(await sourceButton.getAttribute('aria-pressed'),'false');await sourceButton.click();assert.equal(await sourceButton.getAttribute('aria-pressed'),'true');
  assert.equal(await page.getByRole('button',{name:'Поделиться ответом',exact:true}).count(),0);
  // Reload clears simulated audio errors before reviewing the ordinary layout.
  await page.reload();await tools.first().waitFor();
  for(const width of [1600,390]){
   await page.setViewportSize({width,height:1100});await tools.first().scrollIntoViewIfNeeded();
   await page.screenshot({path:artifacts+`answer-${width}-dark.png`,fullPage:true});
   const metrics=await tools.first().evaluate(el=>({width:el.getBoundingClientRect().width,controls:[...el.querySelectorAll('button')].map(b=>({height:b.getBoundingClientRect().height,width:b.getBoundingClientRect().width}))}));
   assert.equal(await page.locator('.legal-answer__section--main .safe-markdown p').first().evaluate(el=>getComputedStyle(el).maxWidth),'none');
   assert(metrics.controls.every(c=>c.height>=40),'Touch targets stay usable');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
   assert.equal(await page.locator('.legal-answer__questions').first().evaluate(el=>getComputedStyle(el).paddingBottom),'24px');
   await tools.first().getByRole('button',{name:'Источники',exact:true}).click();
   await page.locator('.ai-source-card').filter({hasText:old.sources[0].actTitle}).waitFor({state:'visible'});
   const sticky=await page.locator('.ai-context').evaluate(el=>{
    const spacer=document.createElement('div');spacer.style.height='1800px';el.append(spacer);
    const header=el.querySelector('header');el.scrollTop=0;const before=header.getBoundingClientRect().top;
    el.scrollTop=300;const after=header.getBoundingClientRect().top;const scrolled=el.scrollTop;
    spacer.remove();el.scrollTop=0;return {before,after,scrolled};
   });
   assert(sticky.scrolled>0);assert(Math.abs(sticky.before-sticky.after)<2,'Context title remains stationary');
   if(width===390){assert.equal(await page.locator('#ai-context-panel').getAttribute('role'),'dialog');await page.keyboard.press('Escape');await tools.first().getByRole('button',{name:'Источники',exact:true}).waitFor({state:'visible'});}
   if(width===390){await actions.first().getByRole('button',{name:'Не полезно',exact:true}).click();await popup.waitFor();const box=await popup.boundingBox();assert(box.x>=0&&box.x+box.width<=390);await popup.screenshot({path:artifacts+'feedback-mobile.png'});await page.keyboard.press('Escape');}
   await page.evaluate(()=>document.documentElement.dataset.theme='light');await tools.first().scrollIntoViewIfNeeded();await page.screenshot({path:artifacts+`answer-${width}-light.png`,fullPage:true});await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  }
  await page.setViewportSize({width:1600,height:1100});await page.locator('.ai-message-actions').last().scrollIntoViewIfNeeded();await page.screenshot({path:artifacts+'answer-footer.png'});
  // Editing a historical turn replaces its suffix; answer regenerations remain within that prompt edition.
  await page.goto(`http://127.0.0.1:${server.address().port}/ru/individual/ai-chat?conversationId=conversation&branchId=latest-branch`);
  await page.locator('.ai-human-turn').first().hover();await page.locator('.ai-human-turn').first().getByRole('button',{name:'Редактировать вопрос',exact:true}).click();
  await page.locator('.ai-prompt-editor textarea').fill('Исправленный вопрос');await page.locator('#ai-question').fill('Unsent follow-up');
  await page.locator('.ai-prompt-editor').screenshot({path:artifacts+'inline-edit.png'});
  await page.getByRole('button',{name:'Сохранить и отправить'}).click();
  await page.locator('.ai-conversation-turn-pending').waitFor();assert.equal(await page.locator('.ai-human-message').count(),1);
  await page.waitForURL(/branchId=variant-1/);await page.getByRole('navigation',{name:'Версии вопроса'}).waitFor();
  assert.equal(await page.locator('.ai-human-message').count(),1);assert.match(await page.getByRole('navigation',{name:'Версии вопроса'}).innerText(),/2\s*\/\s*2/);
  assert.equal(requests[0].sourceMessageId,'old-request');assert.equal(requests[0].operation,'edit');
  await page.getByRole('button',{name:'Создать ответ заново'}).click();await page.waitForURL(/branchId=variant-2/);
  const answerVersions=page.getByRole('navigation',{name:'Версии ответа'});await answerVersions.waitFor();assert.match(await answerVersions.innerText(),/2\s*\/\s*2/);assert.equal(await page.locator('.ai-human-message').count(),1);
  assert.equal(requests[1].sourceMessageId,'variant-1-message');assert.equal(requests[1].operation,'regenerate');
  await answerVersions.getByRole('button',{name:'Предыдущая версия'}).click();await page.waitForURL(/branchId=variant-1/);await page.locator('.ai-transcript [data-message-id="variant-1-message"]').waitFor();
  await page.locator('#ai-question').fill('Follow-up on selected version');await page.getByRole('button',{name:'Отправить',exact:true}).click();await page.waitForURL(/branchId=variant-3/);await page.locator('.ai-transcript [data-message-id="variant-3-message"]').waitFor();
  assert.equal(requests[2].sourceMessageId,'variant-1-message');assert.equal(requests[2].operation,'follow_up');assert.equal(await page.locator('.ai-transcript [data-message-id="variant-2-message"]').count(),0);assert.equal(await page.locator('.ai-human-message').count(),2);
  await page.getByRole('navigation',{name:'Версии вопроса'}).getByRole('button',{name:'Предыдущая версия'}).click();await page.waitForURL(/branchId=old-branch/);await page.locator('.ai-transcript [data-message-id="old-message"]').waitFor();assert.equal(await page.locator('.ai-human-message').count(),1);
  await page.getByRole('navigation',{name:'Версии вопроса'}).getByRole('button',{name:'Следующая версия'}).click();await page.waitForURL(/branchId=variant-2/);await page.locator('.ai-transcript [data-message-id="variant-2-message"]').waitFor();await page.screenshot({path:artifacts+'versions.png'});
  const settings=await browser.newPage({viewport:{width:800,height:700}});await settings.goto(`http://127.0.0.1:${server.address().port}/settings-test`);
  const voice=settings.getByRole('combobox');await voice.waitFor();await settings.waitForFunction(()=>!document.querySelector('[role="combobox"]').disabled);
  assert.match(await voice.innerText(),/Cedar/);await voice.click();await settings.getByRole('option',{name:'Marin',exact:true}).click();await settings.getByText('Голос сохранён.',{exact:true}).waitFor();assert.equal(preferredVoice,'marin');
  await settings.reload();await settings.waitForFunction(()=>!document.querySelector('[role="combobox"]').disabled);assert.match(await settings.getByRole('combobox').innerText(),/Marin/);await settings.screenshot({path:artifacts+'voice-preference.png'});await settings.close();
  assert.deepEqual(errors,[]);console.log('Checked historical/latest citations, answer-specific speech and voice selection, error state, desktop/mobile, themes, spacing, hit areas and dialog Escape.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
