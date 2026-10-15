import { AsyncLocalStorage } from 'node:async_hooks';
import { messages } from './control-messages';

export type AdminLocale = 'ru' | 'uz' | 'en';
const context = new AsyncLocalStorage<AdminLocale>();
export const locale = (): AdminLocale => context.getStore() ?? 'ru';
export const formatLocale = () => ({ru:'ru-RU',uz:'uz-Latn-UZ',en:'en-GB'})[locale()];
export function withLocale<T>(request: Request, render: () => T): T {
 const match=request.headers.get('cookie')?.match(/(?:^|;\s*)juro_admin_locale=(ru|uz|en)(?:;|$)/);
 return context.run((match?.[1] as AdminLocale)??'ru',render);
}
const keys=Object.keys(messages).sort((a,b)=>b.length-a.length);
const pattern=new RegExp(keys.map(key=>key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g');
function literal(source:string):string {
 const language=locale();
 if(language==='ru')return source;
 return source.replace(pattern,key=>messages[key][language==='en'?0:1]);
}
/** Localizes authored interface literals only. Interpolated content is never translated. */
export function ui(source:string):string;
export function ui(source:TemplateStringsArray,...values:unknown[]):string;
export function ui(source:string|TemplateStringsArray,...values:unknown[]):string {
 if(typeof source==='string')return literal(source);
 return source.reduce((result,part,index)=>result+literal(part)+(index<values.length?String(values[index]):''),'');
}
/** Static label maps resolve inside the current request, never in shared mutable locale state. */
export function localizedLabels(source:Record<string,string>):Record<string,string> {
 return new Proxy(source,{get(target,key){const value=Reflect.get(target,key);return typeof value==='string'?ui(value):value}});
}
export function languageControl():string {
 return `<label class="language-control"><span class="sr-only">${ui('Язык')}</span><select data-language aria-label="${ui('Язык')}">${[['ru','RU'],['uz','UZ'],['en','EN']].map(([key,label])=>`<option value="${key}"${locale()===key?' selected':''}>${label}</option>`).join('')}</select></label>`;
}
