export const themeScript = `
try{const theme=localStorage.getItem('juro-control-theme');document.documentElement.dataset.theme=theme==='dark'?'dark':'light';}catch{}
document.addEventListener('DOMContentLoaded',()=>{
 const language=document.documentElement.lang||'ru';
 const copy={ru:{light:'Включить светлую тему',dark:'Включить тёмную тему',jump:'Перейти к разделу',sections:'разделов',table:'Таблица данных',date:'Дата окончания должна быть не раньше даты начала.',users:'Пользователи',lawyers:'Профессиональные аккаунты',documents:'Документы',content:'База знаний','site-content':'Контент сайта',support:'Обращения'},uz:{light:'Yorug‘ mavzuni yoqish',dark:'Qorong‘i mavzuni yoqish',jump:'Bo‘limga o‘tish',sections:'bo‘lim',table:'Ma’lumotlar jadvali',date:'Tugash sanasi boshlanish sanasidan oldin bo‘lmasligi kerak.',users:'Foydalanuvchilar',lawyers:'Professional hisoblar',documents:'Hujjatlar',content:'Bilimlar bazasi','site-content':'Sayt tarkibi',support:'Murojaatlar'},en:{light:'Switch to light theme',dark:'Switch to dark theme',jump:'Jump to section',sections:'sections',table:'Data table',date:'The end date must not be before the start date.',users:'Users',lawyers:'Professional accounts',documents:'Documents',content:'Knowledge base','site-content':'Website content',support:'Support tickets'}}[language];
 document.querySelectorAll('[data-language]').forEach(select=>select.addEventListener('change',()=>{document.cookie='juro_admin_locale='+select.value+'; Path=/; Max-Age=31536000; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');location.reload()}));
 const dialog=document.querySelector('.mobile-navigation');
 document.querySelector('[data-menu-open]')?.addEventListener('click',()=>dialog.showModal());
 document.querySelector('[data-menu-close]')?.addEventListener('click',()=>dialog.close());
 dialog?.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}});
 document.querySelectorAll('.nav a').forEach(a=>{const u=new URL(a.href);const match=u.pathname==='/lawyers'?location.pathname.startsWith('/lawyers')&&((new URLSearchParams(location.search).get('status')||'pending_review')==='pending_review')===(u.searchParams.get('status')==='pending_review'):u.pathname==='/'?location.pathname==='/':location.pathname===u.pathname||location.pathname.startsWith(u.pathname+'/');if(match)a.setAttribute('aria-current','page')});
 const themeButton=document.querySelector('[data-theme-toggle]');
 const syncTheme=()=>{if(!themeButton)return;const label=document.documentElement.dataset.theme==='dark'?copy.light:copy.dark;themeButton.setAttribute('aria-label',label);themeButton.title=label;};
 syncTheme();
 themeButton?.addEventListener('click',()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;try{localStorage.setItem('juro-control-theme',theme)}catch{}syncTheme()});
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();document.querySelector('.topbar input')?.focus()}});
 const search=document.querySelector('.topbar input');
 if(search){const fullPlaceholder=search.placeholder;const media=matchMedia('(max-width:760px)');const resizeSearch=()=>search.placeholder=media.matches?({ru:'Поиск',uz:'Qidiruv',en:'Search'})[language]:fullPlaceholder;resizeSearch();media.addEventListener('change',resizeSearch)}
 const main=document.querySelector('main');
 const parts=location.pathname.split('/').filter(Boolean);
 if(parts.length>1&&copy[parts[0]]&&main){const a=document.createElement('a');a.className='back-link';a.href='/'+parts[0];a.textContent='← '+copy[parts[0]];main.prepend(a)}
 const sections=main?[...main.querySelectorAll('section.panel')].filter(p=>p.querySelector(':scope > h2')):[];
 if(sections.length>4){
  const nav=document.createElement('nav');nav.className='section-nav';nav.setAttribute('aria-label',copy.jump);
  const label=document.createElement('label');label.textContent=copy.jump;
  const select=document.createElement('select');select.setAttribute('aria-label',copy.jump);
  sections.forEach((panel,i)=>{panel.id='section-'+i;const option=document.createElement('option');option.value=panel.id;option.textContent=panel.querySelector('h2').textContent;select.append(option)});
  select.addEventListener('change',()=>{const panel=document.getElementById(select.value);panel.scrollIntoView({block:'start',behavior:'instant'});const heading=panel.querySelector('h2');heading.tabIndex=-1;heading.focus({preventScroll:true});history.replaceState(null,'','#'+panel.id)});
  label.append(select);nav.append(label);const count=document.createElement('span');count.className='section-count';count.textContent=sections.length+' '+copy.sections;nav.append(count);main.querySelector('.page-heading').after(nav);
  let scheduled=false;const update=()=>{scheduled=false;const top=nav.getBoundingClientRect().bottom+28;let current=sections[0];for(const section of sections){if(section.getBoundingClientRect().top<=top)current=section;}if(window.scrollY+innerHeight>=document.documentElement.scrollHeight-2)current=sections.at(-1);if(document.activeElement!==select)select.value=current.id;};
  window.addEventListener('scroll',()=>{if(!scheduled){scheduled=true;requestAnimationFrame(update)}},{passive:true});update();
 }
 document.querySelectorAll('table').forEach(t=>{if(!t.parentElement.classList.contains('scroll')){const wrap=document.createElement('div');wrap.className='scroll';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label',copy.table);t.before(wrap);wrap.append(t)}});
 document.querySelectorAll('form').forEach(f=>{
  const since=f.querySelector('[name=since]'),until=f.querySelector('[name=until]');
  if(since&&until){const validate=()=>until.setCustomValidity(since.value&&until.value&&since.value>until.value?copy.date:'');since.addEventListener('input',validate);until.addEventListener('input',validate)}
  f.addEventListener('submit',()=>{if(!f.checkValidity())return;f.setAttribute('aria-busy','true');f.querySelectorAll('button[type=submit],button:not([type])').forEach(b=>setTimeout(()=>b.disabled=true,0))});
 });
});
window.addEventListener('pageshow',()=>{document.querySelectorAll('form[aria-busy]').forEach(f=>{f.removeAttribute('aria-busy');f.querySelectorAll('button').forEach(b=>b.disabled=false)})});
`;
