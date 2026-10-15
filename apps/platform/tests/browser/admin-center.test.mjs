import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import admin from '../../../admin/src/worker.ts';
let browser,server,origin;
const id='12345678-1234-1234-1234-123456789012',writes=[];
const env={APP_ENV:'development',PLATFORM_ORIGIN:'http://localhost:3000',ADMIN_INTERNAL_TOKEN:'synthetic-internal-token-at-least-32-characters',ADMIN_CONSOLE_TOKEN:'synthetic-console-token-at-least-32-characters',PLATFORM_ADMIN_API:{fetch:async request=>{
 const path=new URL(request.url).pathname;
 if(request.method==='POST'){writes.push({path,body:await request.json()});return Response.json({ok:true})}
 if(path.endsWith('/session'))return Response.json({ok:true});
 if(path.includes('/professionals/'))return Response.json({profile:{id,display_name:'Test Lawyer',marketplace_status:'approved',professional_type:'lawyer'},decisions:[],details:null,documents:[]});
 if(path.endsWith('/lawyers'))return Response.json({profiles:[{id,displayName:'Test Lawyer',marketplaceStatus:'approved',professionalType:'lawyer',city:'Tashkent',experienceYears:5,documentCount:2,updatedAt:'2026-10-15T00:00:00Z'}],page:1});
 if(path.endsWith('/users'))return Response.json({users:[{id,full_name:'Test User',email:'user@example.com',account_type:'individual',blocked:false}],total:1,page:1});
 if(path.endsWith('/finance'))return Response.json({integration:{state:'connected'},payments:[],subscriptions:[],totals:[],metrics:[],subscribers:[],transitions:[],ledger:[],ai:{},mrr:[],definitions:{},page:1});
 return Response.json({notifications:[]});
}}};
before(async()=>{
 server=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const response=await admin.fetch(new Request(origin+req.url,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})}),env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))}catch(e){res.writeHead(500);res.end(String(e))}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({channel:process.env.WORKSPACE_BROWSER_CHANNEL||undefined});
});
after(async()=>{await browser?.close();await new Promise(r=>server.close(r))});
async function context(viewport={width:1440,height:900}){const c=await browser.newContext({viewport});await c.addCookies([{name:'juro_admin_session',value:'s'.repeat(43),url:origin},{name:'juro_admin_csrf',value:'c'.repeat(43),url:origin}]);return c}
test('mobile navigation dismisses with Escape and theme persists',async()=>{
 const c=await context({width:390,height:844});try{const p=await c.newPage();await p.goto(origin+'/users');assert.equal(await p.evaluate(()=>document.body.scrollWidth>innerWidth),false);await p.getByRole('button',{name:'Открыть меню'}).click();assert.equal(await p.locator('dialog').evaluate(e=>e.open),true);await p.keyboard.press('Escape');assert.equal(await p.locator('dialog').evaluate(e=>e.open),false);await p.locator('[data-theme-toggle]').click();await p.goto(origin+'/notifications');assert.equal(await p.locator('html').getAttribute('data-theme'),'dark');}finally{await c.close()}
});
test('filters preserve values, dates reject reversed range, keyboard shortcut focuses search',async()=>{
 const c=await context();try{const p=await c.newPage();await p.goto(origin+'/users');await p.locator('main [name=q]').fill('Test');await p.locator('[name=status]').selectOption('individual');await p.locator('[name=sort]').selectOption('oldest');await p.getByRole('button',{name:'Применить'}).click();await p.waitForURL('**/users?**');const u=new URL(p.url());assert.equal(u.searchParams.get('q'),'Test');assert.equal(u.searchParams.get('status'),'individual');assert.equal(u.searchParams.get('sort'),'oldest');await p.keyboard.press('Control+k');assert.equal(await p.locator('.topbar input').evaluate(e=>e===document.activeElement),true);await p.goto(origin+'/finance');await p.locator('[name=since]').fill('2026-10-15');await p.locator('[name=until]').fill('2026-10-01');assert.equal(await p.locator('[name=until]').evaluate(e=>e.checkValidity()),false);await p.locator('[name=until]').fill('2026-10-20');assert.equal(await p.locator('[name=until]').evaluate(e=>e.checkValidity()),true);}finally{await c.close()}
});
test('list opens profile and lifecycle form retains action and CSRF',async()=>{
 const c=await context();try{const p=await c.newPage();await p.goto(origin+'/lawyers?status=approved');assert.equal(await p.locator('main textarea').count(),0);assert.equal(await p.locator('.sidebar a[aria-current=page]').count(),1);await p.getByRole('link',{name:'Test Lawyer'}).click();await p.getByText('Ограничения профиля',{exact:true}).click();await p.locator('textarea[name=reason]').fill('Document review required');await p.getByRole('button',{name:'Временно скрыть',exact:true}).click();await p.waitForFunction(()=>!document.querySelector('main textarea'));assert.deepEqual(writes.at(-1),{path:`/api/internal/admin/lawyers/${id}/lifecycle`,body:{action:'suspend',reason:'Document review required'}});}finally{await c.close()}
});

test('language selection persists, updates labels and keeps submitted enum values stable',async()=>{
 const c=await context();try{const p=await c.newPage();await p.goto(origin+'/users');
 for(const [language,title,apply] of [['uz','Foydalanuvchilar','Qo‘llash'],['en','Users','Apply'],['ru','Пользователи','Применить']]){
  await p.locator('[data-language]').selectOption(language);await p.waitForFunction(lang=>document.documentElement.lang===lang,language);
  assert.equal(await p.locator('h1').innerText(),title);assert.equal(await p.getByRole('button',{name:apply,exact:true}).count(),1);
  assert.equal(await p.locator('[name=status] option[value=individual]').getAttribute('value'),'individual');
  await p.reload();assert.equal(await p.locator('html').getAttribute('lang'),language);
 }
 }finally{await c.close()}
});
test('theme action and visible icon change together, section navigation fits mobile and moves focus',async()=>{
 const c=await context({width:390,height:844});try{const p=await c.newPage();await p.goto(origin+'/finance');
 const toggle=p.locator('[data-theme-toggle]');assert.equal(await toggle.getAttribute('aria-label'),'Включить тёмную тему');assert.equal(await p.locator('.theme-moon').isVisible(),true);await toggle.click();assert.equal(await toggle.getAttribute('aria-label'),'Включить светлую тему');assert.equal(await p.locator('.theme-sun').isVisible(),true);assert.equal(await p.locator('.theme-moon').isVisible(),false);
 const nav=p.locator('.section-nav');assert.equal(await nav.evaluate(e=>e.scrollWidth>e.clientWidth),false);
 const select=nav.locator('select');const last=await select.locator('option').last().getAttribute('value');await select.selectOption(last);assert.equal(await p.locator('#'+last+' h2').evaluate(e=>e===document.activeElement),true);assert.equal(new URL(p.url()).hash,'#'+last);
 assert.equal(await p.evaluate(()=>document.body.scrollWidth>innerWidth),false);
 }finally{await c.close()}
});
