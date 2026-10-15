import assert from 'node:assert/strict';
import test from 'node:test';
import {withLocale,ui,locale} from '../../admin/src/control-i18n.ts';
import {table,labels} from '../../admin/src/control-ui.ts';
const request=language=>new Request('http://admin.local/users',{headers:{cookie:'juro_admin_locale='+language}});
test('concurrent admin requests keep their own language and lazy field labels',async()=>{
 const results=await Promise.all(['en','uz','ru'].map(language=>withLocale(request(language),async()=>{await new Promise(r=>setTimeout(r,Math.random()*20));return [locale(),ui('Пользователи'),labels.last_name]})));
 assert.deepEqual(results,[['en','Users','Last name'],['uz','Foydalanuvchilar','Familiya'],['ru','Пользователи','Фамилия']]);assert.equal(locale(),'ru');
});
test('translation handles authored copy but preserves interpolation and customer table content',()=>{
 withLocale(request('en'),()=>{
  const name='Пользователи';assert.equal(ui`<h2>Имя</h2><p>${name}</p>`,'<h2>First name</h2><p>Пользователи</p>');
  const output=table([{id:'one',full_name:'open',body:'Пользователи',status:'open'}],['full_name','body','status'],{key:'full_name',path:'/users/'});
  assert.match(output,/>open<\/a>/);assert.match(output,/>Пользователи<\/td>/);assert.match(output,/>Open<\/span>/);
 });
});
test('invalid locale falls back to Russian',()=>withLocale(request('invalid'),()=>assert.equal(ui('Пользователи'),'Пользователи')));
