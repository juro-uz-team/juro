const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-140 0 1221 1672" role="img" aria-label="Jurobek — animated JURO assistant" style="display:block;width:100%;height:100%;overflow:visible">
<defs>
 <linearGradient id="j-headFade" x2="0" y2="1"><stop offset="0" stop-color="white"/><stop offset=".94" stop-color="white"/><stop offset="1" stop-color="black"/></linearGradient>
 <linearGradient id="j-bodyFade" x2="0" y2="1"><stop offset="0" stop-color="black"/><stop offset=".05" stop-color="white"/><stop offset="1" stop-color="white"/></linearGradient>
 <radialGradient id="j-soft"><stop offset=".7" stop-color="white"/><stop offset="1" stop-color="black"/></radialGradient>
 <mask id="j-headMask"><rect width="941" height="810" fill="url(#j-headFade)"/></mask>
 <mask id="j-bodyMask"><rect y="740" width="941" height="932" fill="white"/></mask>
 <path id="j-armPath" d="M40 1160 L265 1150 L290 1220 L620 1080 L700 1000 L941 900 L941 1230 L710 1240 L260 1500 L80 1450Z"/>
 <clipPath id="j-repairClip"><path d="M265 1220L620 1080L680 1200L300 1440Z"/></clipPath><clipPath id="j-armClip"><use href="#j-armPath"/></clipPath>
 <mask id="j-withoutArm"><rect width="941" height="1672" fill="white"/><use href="#j-armPath" fill="black"/></mask>
 <clipPath id="j-waveHandClip"><path d="M0 575H225L305 710L292 820L218 933L86 933L0 820Z"/></clipPath>
 <mask id="j-waveBody"><rect y="740" width="941" height="932" fill="white"/><path d="M0 575H225L305 710L292 820L218 933L86 933L0 820Z" fill="white"/></mask>
 <mask id="j-waveWithoutHand"><rect width="941" height="1672" fill="white"/><path d="M0 575H225L305 710L292 820L218 920L86 920L0 820Z" fill="black"/></mask>
 <mask id="j-eyesMask"><ellipse cx="313" cy="523" rx="75" ry="62" fill="url(#j-soft)"/><ellipse cx="476" cy="510" rx="73" ry="62" fill="url(#j-soft)"/></mask>
 <mask id="j-mouthMask"><ellipse cx="404" cy="657" rx="126" ry="62" fill="url(#j-soft)"/></mask>
 <clipPath id="j-browClip"><path d="M228 437Q299 397 368 421L364 459Q282 451 233 490Z M404 416Q485 395 544 447L542 472Q487 439 403 447Z"/></clipPath>
</defs>
<g data-layer="body">
 <g data-pose="idle" opacity="0"><image data-file="idle.webp" width="941" height="1672" transform="translate(-40 40)" mask="url(#j-bodyMask)"/></g>
 <g data-pose="point">
  <g mask="url(#j-bodyMask)"><image data-file="reference.webp" width="941" height="1672"/>
   <g data-layer="point-arm"><image data-file="reference.webp" width="941" height="1672" clip-path="url(#j-armClip)"/></g>
  </g>
 </g>
 <g data-pose="wave" opacity="0" transform="translate(-90 0)"><g mask="url(#j-waveBody)"><image data-file="wave.webp" width="941" height="1672" mask="url(#j-waveWithoutHand)"/><g data-layer="wave-hand"><image data-file="wave.webp" width="941" height="1672" clip-path="url(#j-waveHandClip)"/></g></g></g>
 <g data-layer="head">
  <image data-file="reference.webp" width="941" height="1672" mask="url(#j-headMask)"/>
  <g data-layer="brows"><image data-file="reference.webp" width="941" height="1672" clip-path="url(#j-browClip)"/></g>
  <g data-layer="smile" opacity="0"><image data-file="smile.webp" width="941" height="1672" mask="url(#j-mouthMask)"/></g>
  <g data-layer="eyelids" opacity="0"><image data-file="blink.webp" width="941" height="1672" mask="url(#j-eyesMask)"/></g>
 </g>
</g></svg>`;
export const STATES=Object.freeze(['idle','wave','point','guide','smile']);
/** Standalone layered SVG puppet. No canvas, WebGL, framework or external runtime. */
export function createJurobek(host,{assetBase='./',state='point',autoplay=false,onState=()=>{}}={}){
 const prefix='j'+Math.random().toString(36).slice(2)+'-';
 host.innerHTML=svg.replaceAll('j-',prefix);const root=host.querySelector('svg');
 root.querySelectorAll('[data-file]').forEach(image=>image.setAttribute('href',new URL(image.dataset.file,new URL(assetBase,location.href)).href));
 const layer=name=>root.querySelector(`[data-layer="${name}"]`),poses=[...root.querySelectorAll('[data-pose]')];
 let current=state,paused=false,visible=false,frame=0,time=0,last=0,phase=0,blinkAt=3.2,blinkStart=-10,destroyed=false,pointerX=0,pointerY=0;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)'),coarse=matchMedia('(pointer:coarse)');
 const active=()=>visible&&!document.hidden&&!paused&&!reduced.matches;
 const opacity=(name,value)=>layer(name).setAttribute('opacity',String(value));
 function render(){const wavePhase=phase%10;const waveEnvelope=autoplay?(wavePhase<3.2?Math.sin(Math.PI*wavePhase/3.2)**2:0):Math.min(phase*2,1);const small=coarse.matches ? .4 : 1;const t=time,p=phase,gesture=current==='guide'?Math.sin(p*1.6)*1.25:current==='point'?Math.sin(Math.min(p/1.3,1)*Math.PI)*-1.5:0;
  layer('body').setAttribute('transform',`translate(0 ${Math.sin(t*1.25)*2.1*small}) rotate(${gesture*.3*small} 395 1500)`);
  layer('head').setAttribute('transform',`rotate(${(Math.sin(t*.65)*.35+pointerX*.35+(current==='guide'?Math.sin(p*1.7)*.45:0))*small} 395 780) translate(0 ${pointerY*.8*small})`);
  layer('point-arm').setAttribute('transform',`rotate(0 170 1240)`);
  layer('wave-hand').setAttribute('transform',`rotate(${Math.sin(p*5.1)*5.5*waveEnvelope*small} 150 915)`);
  layer('brows').setAttribute('transform',`translate(0 ${current==='guide'?-Math.max(0,Math.sin(p*.9))*.8:0})`);
  opacity('smile',current==='smile'?Math.min(p/1.2,1):current==='wave'?.5:current==='guide'?Math.max(0,Math.sin(p*.55))*.45:0);
  const elapsed=t-blinkStart;opacity('eyelids',elapsed>=0&&elapsed<.24?Math.sin(elapsed/.24*Math.PI):0);
 }
 function tick(now){frame=0;if(!active()||destroyed)return;const dt=Math.min((now-last)/1000,.05);last=now;time+=dt;phase+=dt;
  if(time>=blinkAt){blinkStart=time;blinkAt=time+3.6+Math.random()*2.6;}render();frame=requestAnimationFrame(tick);
 }
 function sync(){cancelAnimationFrame(frame);frame=0;root.dataset.running=String(active());if(active()){last=performance.now();frame=requestAnimationFrame(tick);}else{opacity('eyelids',0);}}
 function setState(next){if(!STATES.includes(next))throw Error('Unknown Jurobek animation: '+next);current=next;phase=0;const pose=next==='wave'?'wave':next==='idle'?'idle':'point';poses.forEach(el=>{el.style.transition=reduced.matches?'none':'opacity 180ms ease';el.setAttribute('opacity',el.dataset.pose===pose?'1':'0');});root.dataset.state=next;onState(next);render();if(reduced.matches){opacity('eyelids',0);opacity('smile',next==='smile'?1:0);}sync();}
 const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;sync();},{threshold:.08});observer.observe(host);
 const move=e=>{if(coarse.matches||!active())return;const r=host.getBoundingClientRect();pointerX=(e.clientX-r.left)/r.width-.5;pointerY=(e.clientY-r.top)/r.height-.5;};
 const leave=()=>{pointerX=0;pointerY=0;};host.addEventListener('pointermove',move,{passive:true});host.addEventListener('pointerleave',leave);document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);setState(state);
 return{setState,setPaused(value){paused=value;sync();},getState:()=>current,destroy(){destroyed=true;cancelAnimationFrame(frame);observer.disconnect();host.removeEventListener('pointermove',move);host.removeEventListener('pointerleave',leave);document.removeEventListener('visibilitychange',sync);reduced.removeEventListener('change',sync);host.replaceChildren();}};
}
