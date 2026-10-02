/** Add only the Control Center route to the existing local Caddy configuration.
 * Existing application routes and TLS settings are preserved. */
export async function configureControlCenterProxy(settings){
 if(settings.DEPLOYMENT_ENVIRONMENT!=='production')return {state:'private_staging'};
 const origin='http://127.0.0.1:2019';const read=await fetch(origin+'/config/',{signal:AbortSignal.timeout(3000)});if(!read.ok)throw Error('Local Caddy configuration is unavailable');const config=await read.json();
 const host=`admin.${new URL(settings.PUBLIC_SITE_URL??'https://juro.uz').hostname}`;
 const servers=config.apps?.http?.servers??{};const entry=Object.entries(servers).find(([,s])=>s.listen?.some(v=>v===':443'||v.endsWith(':443')));
 if(!entry)throw Error('Existing public HTTPS listener not found');const [name,server]=entry;
 function contains(routes){return (routes??[]).some(r=>r.match?.some(m=>m.host?.includes(host))||r.handle?.some(h=>h.routes&&contains(h.routes)));}
 const port=Number(settings.ADMIN_PORT??3002);if(port!==3002)throw Error('Unexpected production admin port');
 const route={match:[{host:[host]}],handle:[{handler:'headers',response:{set:{'X-Robots-Tag':['noindex, nofollow, noarchive'],'Strict-Transport-Security':['max-age=31536000']}}},{handler:'reverse_proxy',upstreams:[{dial:'127.0.0.1:3002'}],headers:{request:{set:{Host:['localhost:3002'],'X-Real-IP':['{http.request.remote.host}']},delete:['X-Juro-Client-IP']}}}],terminal:true};
 const websiteHost=new URL(settings.PUBLIC_SITE_URL??'https://juro.uz').hostname;
 const policies=config.apps?.tls?.automation?.policies??[];
 const publicPolicy=policies.find(p=>(!p.subjects||p.subjects.includes(websiteHost))&&!p.issuers?.some(i=>i.module==='internal'))??{issuers:[{module:'acme'}]};
 // The former private listener used an internal certificate for this hostname.
 // Change only this hostname to the existing public ACME policy.
 const nextPolicies=policies.flatMap(p=>{if(!p.subjects?.includes(host))return [p];const subjects=p.subjects.filter(v=>v!==host);return subjects.length?[{...p,subjects}]:[];});
 nextPolicies.unshift({...publicPolicy,subjects:[host]});
 config.apps.tls??={};config.apps.tls.automation??={};config.apps.tls.automation.policies=nextPolicies;
 if(!contains(server.routes))server.routes=[route,...(server.routes??[])];
 const headers={'content-type':'application/json'};const etag=read.headers.get('etag');if(etag)headers['if-match']=etag;
 const result=await fetch(origin+'/load',{method:'POST',headers,body:JSON.stringify(config),signal:AbortSignal.timeout(10000)});if(!result.ok)throw Error('Caddy rejected the Control Center configuration');
 const verify=await fetch(origin+'/config/',{signal:AbortSignal.timeout(3000)});const after=await verify.json();if(!contains(after.apps?.http?.servers?.[name]?.routes))throw Error('Control Center proxy route not saved');return {state:'configured',host};
}
