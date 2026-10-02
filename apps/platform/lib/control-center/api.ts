import {analyticsFunnels} from "./analytics";
import {financialMetrics} from "./finance";
import {resolvedCategories} from "./template-access";
import {professionalDetails,professionalDocument} from "./professionals";
import {controlFeatures} from "./features";
import {applyControlAiSettings} from "./ai-settings";
import { siteContentMutation } from "./site-content";
import { resolvedDocument, validateTemplate } from "../document-builder/registry/published";
import { DOCUMENT_REGISTRY, DOCUMENT_CATEGORIES } from "../document-builder/registry";
import { renderConfiguredDocument } from "../document-builder/registry/engine";
import { deliverDecisionEmail } from "./delivery";
import { accountDeletionSubjectHash, createAccountDeletionLifecycleRecord, accountDeletionLifecycleStatement } from "../auth/account-deletion-lifecycle";
import { executeAccountDeletionPurge } from "../auth/account-deletion-purge";
import { z } from "zod";
import { database } from "../storage/connection";
import { adminEmail, controlPrincipal, controlAudit } from "../auth/control-admin-auth";
import { createIdentityProtectionContext, prepareUserIdentityWrite, userIdentityWriteBindings, userIdentityById, resolveUserIdentity } from "../auth/identity-protection";
import { getSelfHostedRuntime } from "../runtime/self-hosted";
import { listAiRuntimeSettingsHistory } from "../ai/runtime-settings";
import { createCostGuardPolicyVersion, setProviderCircuitState, costGuardPolicyMutationSchema, providerCircuitMutationSchema, readProviderCostControlDashboard } from "../ai/provider-cost-control";
import { knowledgeBaseAdminMutationSchema, saveKnowledgeBaseDraft, publishKnowledgeBaseDraft, setKnowledgeBaseArticleStatus, listKnowledgeBaseAdminArticles, getKnowledgeBaseAdminArticle } from "../platform/knowledge-base-admin";
const reply = (data: unknown, status=200) => Response.json(data,{status,headers:{"cache-control":"private, no-store"}});
const q = async (sql:string,values:unknown[]=[]) => (await database().pool.query(sql,values)).rows;
const identity = () => createIdentityProtectionContext(process.env.IDENTITY_PROTECTION_MODE,process.env.IDENTITY_KEYRING);
const idSchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9._:-]+$/);
export function controlPeriod(url: URL) {
 const until = url.searchParams.get("until"); const since = url.searchParams.get("since");
 const end = until && /^\d{4}-\d{2}-\d{2}$/.test(until) ? new Date(`${until}T00:00:00+05:00`).getTime()+86400000 : Date.now();
 const days = ({today:1,"7":7,"30":30,"90":90,year:365} as Record<string,number>)[url.searchParams.get("period") ?? "30"] ?? 30;
 const start = since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? new Date(`${since}T00:00:00+05:00`).getTime() : url.searchParams.get("period")==="today" ? new Date(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tashkent",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())+"T00:00:00+05:00").getTime() : end-days*86400000;
 if (!Number.isFinite(start) || !Number.isFinite(end) || start>=end || end-start>366*86400000) throw Error("INVALID_PERIOD");
 return {start:new Date(start).toISOString(),end:new Date(end).toISOString(),previous:new Date(url.searchParams.get("period")==="today"&&!since?start-86400000:start-(end-start)).toISOString(),previousEnd:new Date(url.searchParams.get("period")==="today"&&!since?end-86400000:start).toISOString(),timezone:"Asia/Tashkent"};
}
export async function handleControlCenter(request: Request): Promise<Response|null> {
 const url = new URL(request.url);
 if (!url.pathname.startsWith("/api/internal/admin/control/")) return null;
 const principal = await controlPrincipal(request.headers.get("x-juro-admin-session"));
 if (!principal) return reply({code:"ACCESS_DENIED"},403);
 const section = url.pathname.slice("/api/internal/admin/control/".length);
 const period = controlPeriod(url); const args = [period.start,period.end];
 const page = Math.max(1,Math.min(100000,Math.floor(Number(url.searchParams.get("page"))||1)));
 const offset = (page-1)*25;
 const search = (url.searchParams.get("q")??"").slice(0,200);
 const status = (url.searchParams.get("status")??"").slice(0,60);
 try {
 if (request.method === "GET") {
 if (section === "session") return reply({email:principal.email,expiresAt:principal.expiresAt});
 if (section === "overview") {
  const [audience,professionals,attention,trend,ai] = await Promise.all([
   q(`SELECT count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM auth_pending_registrations r WHERE r.user_id=u.id)) AS total,
   count(*) FILTER(WHERE created_at >= $1 AND created_at < $2 AND NOT EXISTS(SELECT 1 FROM auth_pending_registrations r WHERE r.user_id=u.id)) AS registrations,
   count(*) FILTER(WHERE created_at >= $3 AND created_at < $5 AND NOT EXISTS(SELECT 1 FROM auth_pending_registrations r WHERE r.user_id=u.id)) AS previous_registrations,
   (SELECT count(DISTINCT s.user_id) FROM auth_sessions s WHERE s.last_seen_at >= $1 AND s.last_seen_at < $2 AND s.user_id<>coalesce($4,'')) AS active
   FROM user_profiles u WHERE lifecycle_status='active' AND id<>coalesce($4,'')`,[...args,period.previous,principal.userId,period.previousEnd]),
   q("SELECT marketplace_status,status,count(*) AS count FROM lawyer_profiles GROUP BY marketplace_status,status"),
   q("SELECT (SELECT count(*) FROM support_tickets WHERE status NOT IN ('closed','resolved')) AS tickets,(SELECT count(*) FROM control_delivery_jobs WHERE status='failed') AS failed_deliveries"),
   q(`SELECT to_char(created_at::timestamptz AT TIME ZONE 'Asia/Tashkent','YYYY-MM-DD') AS day,count(*) AS registrations FROM user_profiles u WHERE created_at>=$1 AND created_at<$2 AND lifecycle_status='active' AND NOT EXISTS(SELECT 1 FROM auth_pending_registrations r WHERE r.user_id=u.id) AND id<>coalesce($3,'') GROUP BY 1 ORDER BY 1`,[...args,principal.userId]),
   q("SELECT count(*) AS requests,count(*) FILTER(WHERE error_code IS NOT NULL) AS errors,sum(estimated_cost_microusd) AS estimated_cost_microusd FROM ai_runs WHERE created_at >= $1 AND created_at < $2 AND user_id<>coalesce($3,'')",[...args,principal.userId])]);
  const traffic=await q("SELECT application,count(*) AS page_views,count(DISTINCT visitor_id) AS visitors,count(DISTINCT session_id) AS sessions FROM control_product_events WHERE event='page_view' AND created_at >= $1::timestamptz AND created_at < $2::timestamptz GROUP BY application",args);
  const financial=await financialMetrics(period.start,period.end);
  return reply({period,audience:audience[0],professionals,attention:attention[0],trend,ai:ai[0],financial,traffic:{totals:traffic,state:"collecting",message:"Посещения собираются после согласия. Уникальные посетители разных приложений не суммируются."}});
 }
 if (section === "users") {
  const filter = "($1='' OR full_name ILIKE '%'||$1||'%' OR email ILIKE '%'||$1||'%' OR id=$1 OR phone ILIKE '%'||$1||'%') AND ($2='' OR account_type=$2)";
  const sort = ({name:"full_name ASC NULLS LAST,id",oldest:"created_at ASC,id",newest:"created_at DESC,id"} as Record<string,string>)[url.searchParams.get("sort")??"newest"]??"created_at DESC,id";
  const users = await q(`SELECT u.id,u.full_name,u.email,u.phone,u.account_type,u.lifecycle_status,u.created_at,
   EXISTS(SELECT 1 FROM control_account_blocks b WHERE b.user_id=u.id) AS blocked,
   (SELECT max(last_seen_at) FROM auth_sessions s WHERE s.user_id=u.id) AS last_activity,
   (SELECT plan_code FROM subscriptions s WHERE s.workspace_id=u.default_workspace_id) AS subscription
   FROM user_profiles u WHERE ${filter} ORDER BY ${sort} LIMIT 25 OFFSET $3`,[search,status,offset]);
  const total = await q(`SELECT count(*) AS total FROM user_profiles WHERE ${filter}`,[search,status]);
  return reply({users,total:total[0].total,page});
 }
 if (section === "users/export") {
  const rows = await q(`SELECT id,full_name,email,phone,account_type,lifecycle_status,created_at FROM user_profiles WHERE ($1='' OR full_name ILIKE '%'||$1||'%' OR email ILIKE '%'||$1||'%' OR id=$1) AND ($2='' OR account_type=$2) ORDER BY created_at DESC LIMIT 10000`,[search,status]);
  await controlAudit(principal.email,"users_exported","users",undefined,{count:rows.length});
  const cols = ["id","full_name","email","phone","account_type","lifecycle_status","created_at"];
  const cell = (v:unknown) => '"'+String(v??"").replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
  return new Response('\uFEFF'+[cols,...rows.map(r=>cols.map(c=>r[c]))].map(r=>r.map(cell).join(",")).join("\r\n"),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":"attachment; filename=juro-users.csv","cache-control":"no-store"}});
 }
 if (section.startsWith("users/")) {
  const id = idSchema.parse(section.slice(6));
  const users = await q(`SELECT id,full_name,first_name,last_name,middle_name,birth_date,phone,email,locale,account_type,theme_preference,company_name,organization_role,primary_goal,timezone,registered_address,id_document_type,id_document_number,id_issued_by,id_issue_date,pinfl,lifecycle_status,email_verified_at,phone_verified_at,created_at,updated_at, EXISTS(SELECT 1 FROM control_account_blocks b WHERE b.user_id=u.id) AS blocked FROM user_profiles u WHERE id=$1`,[id]);
  if (!users.length) return reply({code:"NOT_FOUND"},404);
  const [profiles,tickets,subscriptions,notes,payments] = await Promise.all([
   q("SELECT id,display_name,status,marketplace_status FROM lawyer_profiles WHERE user_id=$1",[id]),
   q("SELECT id,subject,status,created_at FROM support_tickets WHERE requester_user_id=$1 ORDER BY created_at DESC LIMIT 25",[id]),
   q("SELECT s.id,s.status,s.plan_code,s.current_period_ends_at FROM subscriptions s JOIN user_profiles u ON u.default_workspace_id=s.workspace_id WHERE u.id=$1",[id]),
   q("SELECT body,actor_email,created_at FROM control_admin_notes WHERE entity_type='user' AND entity_id=$1 ORDER BY created_at DESC LIMIT 50",[id]),
   q("SELECT p.id,p.amount_minor,p.currency,p.status,p.created_at FROM payments p JOIN user_profiles u ON u.default_workspace_id=p.workspace_id WHERE u.id=$1 ORDER BY p.created_at DESC LIMIT 25",[id])]);
  return reply({user:users[0],profiles,tickets,subscriptions,notes,payments});
 }
 if(section.startsWith("professional-files/"))return professionalDocument(idSchema.parse(section.slice(19)));
 if(section.startsWith("professionals/")) {
  const id=idSchema.parse(section.slice(14));
  const rows=await q("SELECT p.id,p.user_id,p.display_name,p.status,p.marketplace_status,p.advocate_status,p.firm_name,p.bio,p.city,p.region,p.education,p.experience_years,p.specialties_json,p.languages_json,p.profile_revision,p.created_at,p.updated_at,u.full_name,u.email,u.phone,u.account_type FROM lawyer_profiles p JOIN user_profiles u ON u.id=p.user_id WHERE p.id=$1",[id]);
  if(rows[0]?.marketplace_status==="pending_review")await q("INSERT INTO control_professional_flow_events(id,profile_id,revision,event) VALUES($1,$2,$3,'reviewed') ON CONFLICT DO NOTHING",[crypto.randomUUID(),id,rows[0].profile_revision]);
  const decisions=await q("SELECT decision,reason,created_at FROM lawyer_profile_moderation WHERE lawyer_profile_id=$1 ORDER BY created_at DESC LIMIT 25",[id]);
  return reply({profile:rows[0],decisions,...await professionalDetails(id)});
 }
 if (section === "finance") {
  const [payments,subscriptions,totals,mrr] = await Promise.all([
   q("SELECT id,workspace_id,subscription_id,provider_payment_id,amount_minor,currency,status,created_at FROM payments p WHERE NOT EXISTS(SELECT 1 FROM payment_attempts a WHERE a.payment_id=p.id AND a.provider IN ('sandbox','demo')) AND created_at >= $1 AND created_at < $2 AND ($3='' OR status=$3) ORDER BY created_at DESC LIMIT 25 OFFSET $4",[...args,status,offset]),
   q("SELECT id,workspace_id,provider,plan_code,status,billing_period,current_period_ends_at,cancel_at_period_end FROM subscriptions WHERE provider NOT IN ('sandbox','demo') ORDER BY created_at DESC LIMIT 25 OFFSET $1",[offset]),
   q("SELECT currency,status,sum(amount_minor) AS amount_minor,count(*) AS count FROM payments p WHERE NOT EXISTS(SELECT 1 FROM payment_attempts a WHERE a.payment_id=p.id AND a.provider IN ('sandbox','demo')) AND created_at >= $1 AND created_at < $2 GROUP BY currency,status",args),
   q(`SELECT v.currency,sum(CASE WHEN v.billing_period IN ('year','yearly','annual') THEN v.price_minor/12.0 WHEN v.billing_period IN ('month','monthly') THEN v.price_minor ELSE NULL END) AS mrr_minor FROM subscriptions s JOIN subscription_plan_versions v ON v.id=s.plan_version_id WHERE s.status='active' AND s.provider NOT IN ('sandbox','demo') AND s.provider_subscription_id IS NOT NULL GROUP BY v.currency`)]);
  const calculated=await financialMetrics(period.start,period.end);return reply({payments,subscriptions,totals,mrr,page,...calculated,integration:{state:getSelfHostedRuntime().PAYMENT_PRODUCTION_APPROVED==="true"?"connected":"not_connected",message:"Платёжная интеграция не подключена"},definitions:{...calculated.definitions,mrr:"MRR: сумма месячной стоимости активных регулярных подписок; годовая стоимость / 12. Разовые платежи исключены.",arr:"ARR = MRR × 12. Валюты не суммируются.",revenue:"Поступления: только подтверждённые сервером успешные операции. Возвраты и комиссии показываются отдельно; это не чистая прибыль."}});
 }
 if (section === "ai") {
  const [runs,summary,settings] = await Promise.all([
   q("SELECT id,user_id,provider,model,status,input_tokens,output_tokens,estimated_cost_microusd,latency_ms,error_code,created_at FROM ai_runs WHERE created_at >= $1 AND created_at < $2 AND user_id<>coalesce($3,'') ORDER BY created_at DESC LIMIT 25 OFFSET $4",[...args,principal.userId,offset]),
   q("SELECT provider,model,status,count(*) AS requests,count(DISTINCT user_id) AS users,sum(input_tokens) AS input_tokens,sum(output_tokens) AS output_tokens,sum(estimated_cost_microusd) AS estimated_cost_microusd,avg(latency_ms) AS average_latency_ms FROM ai_runs WHERE created_at >= $1 AND created_at < $2 AND user_id<>coalesce($3,'') GROUP BY provider,model,status",[...args,principal.userId]),
   listAiRuntimeSettingsHistory({db:getSelfHostedRuntime().DB!,env:getSelfHostedRuntime()})]);
  const costs = await readProviderCostControlDashboard({db:getSelfHostedRuntime().DB!,environment:(getSelfHostedRuntime().APP_ENV??"development") as "development"|"staging"|"production"});
  return reply({runs,summary,settings:{current:settings.current,allowlist:settings.allowlist},history:await q("SELECT version,settings,system_instructions,reason,created_at,applied_at FROM control_ai_versions ORDER BY version DESC LIMIT 25"),costs,page});
 }
 if (section === "documents") {
  const templates = await q(`SELECT t.id,t.key,t.category,t.active,t.updated_at,
  (SELECT count(*) FROM documents d WHERE d.template_id=t.id) AS documents,
  (SELECT count(*) FROM documents d WHERE d.template_id=t.id AND d.generated_at IS NOT NULL) AS generated
  FROM document_templates t WHERE $1='' OR t.key ILIKE '%'||$1||'%' OR t.category ILIKE '%'||$1||'%' ORDER BY t.updated_at DESC LIMIT 25 OFFSET $2`,[search,offset]);
  const custom=await q("SELECT DISTINCT ON(code) code,definition FROM control_template_versions ORDER BY code,created_at DESC");
  const registry=new Map(DOCUMENT_REGISTRY.map(d=>[d.code,d]));for(const row of custom)registry.set(row.code,row.definition);
  const selected=[...registry.values()].filter(d=>!search||d.titleRu.toLowerCase().includes(search.toLowerCase())||d.code.includes(search));
  return reply({templates,page,registryTotal:selected.length,registry:selected.slice(offset,offset+25).map(d=>({id:d.code,key:d.titleRu,category:d.categorySlug,active:d.status==='published',version:d.version})),categories:await resolvedCategories()});
 }
 if(section==="document-categories")return reply({categories:await resolvedCategories()});
 if(section.startsWith("documents/")) {
  const code=z.string().regex(/^\d{7}$/).parse(section.slice(10)==="new"?url.searchParams.get("code"):section.slice(10));
  const definition=await resolvedDocument(code)??{id:`custom-${code}`,code,categoryCode:code.slice(0,2),subcategoryCode:code.slice(2,4),documentCode:code.slice(4),slug:`custom-${code}`,categorySlug:DOCUMENT_CATEGORIES[0].slug,titleRu:"Новый шаблон",titleUz:"Yangi shablon",descriptionRu:"",descriptionUz:"",version:"draft",status:"draft",editorialStatus:"Draft",questionnaire:[],generationSchema:{fileName:{ru:"Документ",uz:"Hujjat"},paragraphs:[]},updatedAt:new Date().toISOString()};
  const versions=await q("SELECT id,version,definition,published_at,created_at FROM control_template_versions WHERE code=$1 ORDER BY created_at DESC",[code]);
  return reply({definition:versions[0]?.definition??definition,versions});
 }
 if (section === "support") {
  const tickets = await q("SELECT t.id,t.subject,t.category,t.severity,t.status,t.requester_user_id,u.full_name,t.created_at,t.updated_at FROM support_tickets t JOIN user_profiles u ON u.id=t.requester_user_id WHERE ($1='' OR t.subject ILIKE '%'||$1||'%' OR t.id=$1) AND ($2='' OR t.status=$2) ORDER BY t.updated_at DESC LIMIT 25 OFFSET $3",[search,status,offset]);
  return reply({tickets,page});
 }
 if (section.startsWith("support/")) {
  const id=idSchema.parse(section.slice(8));
  const tickets=await q("SELECT id,subject,category,severity,status,requester_user_id,created_at FROM support_tickets WHERE id=$1",[id]);
  const messages=await q("SELECT id,author_type,body,created_at FROM support_messages WHERE ticket_id=$1 ORDER BY created_at",[id]);
  const notes=await q("SELECT body,actor_email,created_at FROM control_admin_notes WHERE entity_type='support' AND entity_id=$1 ORDER BY created_at",[id]);
  return reply({ticket:tickets[0],messages,notes});
 }
 if(section==="site-content")return reply({items:await q("SELECT c.id,c.kind,c.slug,c.locale,c.position,c.published_version_id,v.title FROM control_site_content c LEFT JOIN LATERAL(SELECT title FROM control_site_content_versions WHERE content_id=c.id ORDER BY created_at DESC LIMIT 1) v ON true ORDER BY c.kind,c.position")});
 if(section.startsWith("site-content/")){
  const id=section.slice(13);if(id==="new")return reply({item:null,versions:[]});
  const rows=await q("SELECT * FROM control_site_content WHERE id=$1",[idSchema.parse(id)]);
  return reply({item:rows[0],versions:await q("SELECT id,title,description,body,image,seo_title,seo_description,slug,locale,kind,position,created_at FROM control_site_content_versions WHERE content_id=$1 ORDER BY created_at DESC",[id])});
 }
 if (section === "content") return reply(await listKnowledgeBaseAdminArticles({db:getSelfHostedRuntime().DB!}));
 if (section.startsWith("content/")) return reply(await getKnowledgeBaseAdminArticle({db:getSelfHostedRuntime().DB!,articleId:idSchema.parse(section.slice(8))}));
 if (section === "system") return reply({features:controlFeatures,settings:await q("SELECT key,value FROM control_settings WHERE key LIKE 'feature.%' OR key='ai.max_monthly_cycles'"),audit:await q("SELECT action,entity_type,entity_id,actor_email,created_at FROM control_admin_audit ORDER BY created_at DESC LIMIT 25 OFFSET $1",[offset]),delivery:await q("SELECT id,subject,status,attempts,last_error,created_at FROM control_delivery_jobs WHERE status<>'sent' ORDER BY created_at LIMIT 25"),integrations:{email:process.env.EMAIL_DELIVERY_MODE??"configuration_required",payments:"not_connected",analytics:"not_connected",database:"connected"},page});
 if(section==="notifications")return reply({notifications:await q(`SELECT 'professional' AS type,id,display_name AS title,updated_at AS created_at FROM lawyer_profiles WHERE marketplace_status='pending_review'
 UNION ALL SELECT 'support',id,subject,created_at FROM support_tickets WHERE status='open'
 UNION ALL SELECT 'delivery',id,subject,created_at::text FROM control_delivery_jobs WHERE status='failed' ORDER BY created_at DESC LIMIT 50`)});
 if (section === "search") {
  if(search.length<2) return reply({results:[]});
  const results=await q(`SELECT 'user' AS type,id,coalesce(full_name,email) AS title FROM user_profiles WHERE full_name ILIKE '%'||$1||'%' OR email ILIKE '%'||$1||'%' OR id=$1
  UNION ALL SELECT 'professional',id,display_name FROM lawyer_profiles WHERE display_name ILIKE '%'||$1||'%' OR id=$1
  UNION ALL SELECT 'support',id,subject FROM support_tickets WHERE subject ILIKE '%'||$1||'%' OR id=$1
  UNION ALL SELECT 'template',code,definition->>'titleRu' FROM (SELECT DISTINCT ON(code) code,definition FROM control_template_versions ORDER BY code,created_at DESC) t WHERE code=$1 OR definition->>'titleRu' ILIKE '%'||$1||'%'
  UNION ALL SELECT 'site-content',c.id,v.title FROM control_site_content c JOIN control_site_content_versions v ON v.id=c.published_version_id WHERE c.slug ILIKE '%'||$1||'%' OR v.title ILIKE '%'||$1||'%' LIMIT 50`,[search]);
  for(const t of DOCUMENT_REGISTRY.filter(t=>t.code===search||t.titleRu.toLowerCase().includes(search.toLowerCase()))){if(results.length<50&&!results.some(r=>r.type==='template'&&r.id===t.code))results.push({type:'template',id:t.code,title:t.titleRu});}
  return reply({results});
 }
 if(section==="funnels")return reply(await analyticsFunnels(period.start,period.end,url));
 if(section==="product") {
  const features=await q(`SELECT feature,status,count(*) AS runs,count(DISTINCT user_id) AS users FROM (
   SELECT 'legal_chat' AS feature,status,user_id,created_at FROM ai_runs
   UNION ALL SELECT 'document_builder',status,owner_user_id,created_at FROM documents
   UNION ALL SELECT 'document_analysis',status,owner_user_id,created_at FROM document_analyses
   UNION ALL SELECT 'document_comparison',status,owner_user_id,created_at FROM document_comparisons
   UNION ALL SELECT 'consultation',status,requester_user_id,created_at FROM lawyer_requests
   ) usage WHERE created_at >= $1 AND created_at < $2 AND user_id<>coalesce($3,'') GROUP BY feature,status`,[...args,principal.userId]);
  const cohorts=await q(`SELECT to_char(u.created_at::timestamptz AT TIME ZONE 'Asia/Tashkent','YYYY-MM') AS cohort,count(*) AS registrations,
   count(*) FILTER(WHERE EXISTS(SELECT 1 FROM ai_runs r WHERE r.user_id=u.id AND r.created_at::timestamptz >= u.created_at::timestamptz+interval '7 days' AND r.created_at::timestamptz < u.created_at::timestamptz+interval '14 days')) AS week_two_ai_users
   FROM user_profiles u WHERE u.created_at >= $1 AND u.created_at < $2 AND u.id<>coalesce($3,'') AND NOT EXISTS(SELECT 1 FROM auth_pending_registrations p WHERE p.user_id=u.id) GROUP BY 1 ORDER BY 1`,[...args,principal.userId]);
  return reply({features,cohorts,definition:"Когорта — месяц регистрации; удержание AI на второй неделе — хотя бы один сохранённый AI-запрос на 7–13-й день. Недавние когорты ещё не созрели. Наблюдение ограничено сохранёнными запросами."});
 }
 if(section === "traffic") {
  const [totals,pages,sources,devices,apps,first]=await Promise.all([
   q("SELECT application,count(*) AS page_views,count(DISTINCT visitor_id) AS visitors,count(DISTINCT session_id) AS sessions FROM control_product_events WHERE event='page_view' AND created_at >= $1::timestamptz AND created_at < $2::timestamptz GROUP BY application",args),
   q("SELECT application,page,count(*) AS views FROM control_product_events WHERE event='page_view' AND created_at >= $1::timestamptz AND created_at < $2::timestamptz GROUP BY application,page ORDER BY views DESC LIMIT 30",args),
   q("SELECT application,source,medium,campaign,count(*) AS views FROM control_product_events WHERE event='page_view' AND created_at >= $1::timestamptz AND created_at < $2::timestamptz GROUP BY application,source,medium,campaign ORDER BY views DESC LIMIT 30",args),
   q("SELECT application,device,count(*) AS views FROM control_product_events WHERE event='page_view' AND created_at >= $1::timestamptz AND created_at < $2::timestamptz GROUP BY application,device",args),
   q("SELECT application,count(DISTINCT visitor_id) AS new_visitors FROM control_product_events e WHERE event='page_view' AND created_at >= $1::timestamptz AND created_at < $2::timestamptz AND NOT EXISTS(SELECT 1 FROM control_product_events older WHERE older.application=e.application AND older.visitor_id=e.visitor_id AND older.created_at < $1::timestamptz) GROUP BY application",args),
   q("SELECT min(created_at) AS collection_started_at FROM control_product_events")]);
  return reply({period,totals,pages,sources,devices,newVisitors:apps,collectionStartedAt:first[0]?.collection_started_at??null,identityScope:"application",definition:"Уникальный посетитель — анонимный идентификатор браузера при согласии. Сессия заканчивается после 30 минут бездействия. Уникальные посетители разных приложений не суммируются."});
 }
 if(section === "analytics") return reply({period,registrations:await q("SELECT account_type,to_char(created_at::timestamptz AT TIME ZONE 'Asia/Tashkent','YYYY-MM-DD') AS day,count(*) AS count FROM user_profiles u WHERE created_at >= $1 AND created_at < $2 AND NOT EXISTS(SELECT 1 FROM auth_pending_registrations r WHERE r.user_id=u.id) AND id<>coalesce($3,'') GROUP BY 1,2 ORDER BY 2",[...args,principal.userId]),features:await q("SELECT feature,status,count(*) AS runs,count(DISTINCT user_id) AS users FROM ai_usage_ledger WHERE created_at >= $1 AND created_at < $2 AND user_id<>coalesce($3,'') GROUP BY feature,status",[...args,principal.userId]),traffic:{state:"collecting"},funnel:{state:"collecting",message:"Согласованные события собираются с момента подключения. Исторические события не восстанавливаются."}});
 }
 if(request.method === "POST") {
  const raw=await request.text(); if(Buffer.byteLength(raw)>524288) return reply({code:"TOO_LARGE"},413);
  const data:unknown=JSON.parse(raw);
  if(section.startsWith("users/")) {
   const id=idSchema.parse(section.slice(6));
   const input=z.object({action:z.enum(["edit","block","unblock","note","delete"]),reason:z.string().trim().max(4000).optional(),confirmation:z.string().optional(),fields:z.record(z.string(),z.string().max(2000)).optional()}).strict().parse(data);
   const current=await userIdentityById(getSelfHostedRuntime().DB!,identity(),id); if(!current)return reply({code:"NOT_FOUND"},404);
   const resolved=current;
   if((id===principal.userId || resolved.email.toLowerCase()===adminEmail()) && ["block","unblock","delete"].includes(input.action)) return reply({code:"ADMIN_ACCOUNT_PROTECTED"},409);
   if(input.action==="delete") {
    if(input.confirmation!==id || !input.reason) return reply({code:"CONFIRMATION_REQUIRED"},400);
    const now=new Date().toISOString(),requestId=crypto.randomUUID();
    const subject=await accountDeletionSubjectHash(process.env.IDENTITY_KEYRING,id);
    const lifecycleInput={requestId,subjectHash:subject.hash,subjectKeyVersion:subject.keyVersion,eventType:"scheduled" as const,deletionMode:"immediate" as const,summary:{verificationMethod:"admin_control"},createdAt:now};
    const lifecycle=await createAccountDeletionLifecycleRecord(getSelfHostedRuntime().DB!,lifecycleInput);
    await getSelfHostedRuntime().DB!.batch([
     getSelfHostedRuntime().DB!.prepare("INSERT INTO account_deletion_requests(id,user_id,status,deletion_mode,subject_hash,subject_key_version,reason,verification_method,verified_at,requested_at,scheduled_purge_at) VALUES (?,?,'scheduled','immediate',?,?,?,'admin_control',?,?,?)").bind(requestId,id,subject.hash,subject.keyVersion,input.reason,now,now,now),
     accountDeletionLifecycleStatement(getSelfHostedRuntime().DB!,lifecycleInput,lifecycle),
     getSelfHostedRuntime().DB!.prepare("UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(now,id),
    ]);
    await controlAudit(principal.email,"user_deletion_requested","user",id,{requestId});
    try {const result=await executeAccountDeletionPurge(getSelfHostedRuntime() as Parameters<typeof executeAccountDeletionPurge>[0],requestId);return reply({ok:true,deletion:result.status});}
    catch(error){return reply({code:error instanceof Error?error.message:"DELETION_PENDING",requestId},409);}
   }
   const client=await database().pool.connect();
   try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM user_profiles WHERE id=$1 FOR UPDATE",[id]);
    if(input.action==="block") {
     if(!input.reason)throw Error("REASON_REQUIRED");
     await client.query("INSERT INTO control_account_blocks(user_id,reason,actor_email) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET reason=excluded.reason,actor_email=excluded.actor_email",[id,input.reason,principal.email]);
     await client.query("UPDATE auth_sessions SET revoked_at=$2 WHERE user_id=$1 AND revoked_at IS NULL",[id,new Date().toISOString()]);
    } else if(input.action==="unblock") await client.query("DELETE FROM control_account_blocks WHERE user_id=$1",[id]);
    else if(input.action==="note") {
     if(!input.reason)throw Error("NOTE_REQUIRED");
     await client.query("INSERT INTO control_admin_notes(id,entity_type,entity_id,body,actor_email) VALUES($1,'user',$2,$3,$4)",[crypto.randomUUID(),id,input.reason,principal.email]);
    } else {
     const allowed=["full_name","first_name","last_name","middle_name","birth_date","locale","account_type","theme_preference","company_name","organization_role","primary_goal","timezone","registered_address","id_document_type","id_document_number","id_issued_by","id_issue_date","pinfl"];
     const fields=input.fields??{}; if(fields.account_type)z.enum(["individual","entrepreneur","lawyer","business"]).parse(fields.account_type);if(fields.locale)z.enum(["ru","uz","en"]).parse(fields.locale);if(fields.theme_preference)z.enum(["light","dark","system"]).parse(fields.theme_preference); if(Object.keys(fields).some(k=>![...allowed,"email","phone"].includes(k)))throw Error("INVALID_FIELD");
     const sets:string[]=[];const values:unknown[]=[id];
     for(const key of allowed)if(fields[key]!==undefined){values.push(fields[key]||null);sets.push(`${key}=$${values.length}`);}
     if(fields.email!==undefined || fields.phone!==undefined) {
      const email=z.string().email().parse(fields.email??resolved.email); const phone=fields.phone??resolved.phone;
      if(id===principal.userId && email.toLowerCase()!==adminEmail())throw Error("ADMIN_ACCOUNT_PROTECTED");
      const protectedWrite=await prepareUserIdentityWrite(identity(),{userId:id,email,phone});
      const keys=["email","email_ciphertext","email_iv","email_key_version","email_lookup_hash","email_lookup_key_version","phone","phone_ciphertext","phone_iv","phone_key_version","phone_lookup_hash","phone_lookup_key_version"];
      const bindings=userIdentityWriteBindings(protectedWrite);
      keys.forEach((key,i)=>{values.push(bindings[i]);sets.push(`${key}=$${values.length}`);});
      if(email!==resolved.email)sets.push("email_verified_at=NULL");
      if(phone!==resolved.phone)sets.push("phone_verified=0","phone_verified_at=NULL");
     }
     if(!sets.length)throw Error("NO_CHANGES");
     values.push(new Date().toISOString());sets.push(`updated_at=$${values.length}`);
     await client.query(`UPDATE user_profiles SET ${sets.join(",")} WHERE id=$1`,values);
    }
    await client.query("INSERT INTO control_admin_audit(id,actor_email,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,'user',$4,$5)",[crypto.randomUUID(),principal.email,`user_${input.action}`,id,JSON.stringify({fields:Object.keys(input.fields??{})})]);
    await client.query("COMMIT");
   }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
   return reply({ok:true});
  }
  if(section.startsWith("support/")) {
   const id=idSchema.parse(section.slice(8));
   const input=z.object({action:z.enum(["reply","note","status"]),body:z.string().trim().min(1).max(4000)}).strict().parse(data);
   const client=await database().pool.connect();
   try{
    await client.query("BEGIN");
    const ticket=(await client.query("SELECT * FROM support_tickets WHERE id=$1 FOR UPDATE",[id])).rows[0];if(!ticket)throw Error("NOT_FOUND");
    const now=new Date().toISOString();
    if(input.action==="reply") {
     await client.query("INSERT INTO support_messages(id,ticket_id,author_user_id,author_type,body,created_at,admin_session_id) VALUES($1,$2,$3,'staff',$4,$5,$6)",[crypto.randomUUID(),id,principal.userId,input.body,now,principal.sessionId]);
     await client.query("INSERT INTO notifications(id,workspace_id,user_id,type,title,body,created_at) VALUES($1,$2,$3,'support_reply',$4,$5,$6)",[crypto.randomUUID(),ticket.workspace_id,ticket.requester_user_id,ticket.subject,input.body,now]);
    } else if(input.action==="note")await client.query("INSERT INTO control_admin_notes(id,entity_type,entity_id,body,actor_email) VALUES($1,'support',$2,$3,$4)",[crypto.randomUUID(),id,input.body,principal.email]);
    else {
     const state=z.enum(["open","in_progress","resolved","closed"]).parse(input.body);
     await client.query("UPDATE support_tickets SET status=$2,updated_at=$3,closed_at=$4 WHERE id=$1",[id,state,now,["resolved","closed"].includes(state)?now:null]);
    }
    await client.query("INSERT INTO control_admin_audit(id,actor_email,action,entity_type,entity_id) VALUES($1,$2,$3,'support',$4)",[crypto.randomUUID(),principal.email,`support_${input.action}`,id]);
    await client.query("COMMIT");
   }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
   return reply({ok:true});
  }
  if(section==="system/settings"){
   const input=z.object({key:z.enum(["feature.legal_chat","feature.document_analysis","feature.document_comparison","feature.document_builder","feature.consultations","ai.max_monthly_cycles"]),value:z.union([z.boolean(),z.number().int().min(1).max(100000)])}).strict().parse(data);
   if(input.key.startsWith("feature.")&&typeof input.value!=="boolean")throw Error("INVALID_SETTING");
   if(input.key==="ai.max_monthly_cycles"&&typeof input.value!=="number")throw Error("INVALID_SETTING");
   const client=await database().pool.connect();try{await client.query("BEGIN");await client.query("INSERT INTO control_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()",[input.key,JSON.stringify(input.value)]);await client.query("INSERT INTO control_admin_audit(id,actor_email,action,entity_type,entity_id) VALUES($1,$2,'setting_changed','setting',$3)",[crypto.randomUUID(),principal.email,input.key]);await client.query("COMMIT");}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
   return reply({ok:true});
  }
  if(section==="ai/settings")return reply({ok:true,...await applyControlAiSettings(data,principal.email)});
  if(section==="site-content") {
   const input=siteContentMutation.parse(data),client=await database().pool.connect();let id=input.id??crypto.randomUUID(),versionId:string|undefined;
   try{
    await client.query("BEGIN");
    if(input.action==="save_draft"){
     const existing=(await client.query("SELECT id FROM control_site_content WHERE id=$1 FOR UPDATE",[id])).rows[0];
     if(!existing)await client.query("INSERT INTO control_site_content(id,kind,slug,locale,position) VALUES($1,$2,$3,$4,$5)",[id,input.kind,input.slug,input.locale,input.position]);

     versionId=crypto.randomUUID();await client.query("INSERT INTO control_site_content_versions(id,content_id,title,description,body,image,seo_title,seo_description,actor_email,slug,locale,kind,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",[versionId,id,input.title,input.description,input.body,input.image,input.seoTitle,input.seoDescription,principal.email,input.slug,input.locale,input.kind,input.position]);
    }else if(input.action==="publish"){
     const v=await client.query("SELECT id FROM control_site_content_versions WHERE id=$1 AND content_id=$2",[input.versionId,id]);if(!v.rowCount)throw Error("VERSION_NOT_FOUND");
     await client.query("UPDATE control_site_content c SET published_version_id=v.id,slug=v.slug,locale=v.locale,kind=v.kind,position=v.position FROM control_site_content_versions v WHERE c.id=$1 AND v.id=$2 AND v.content_id=c.id",[id,input.versionId]);
    }else await client.query("UPDATE control_site_content SET published_version_id=NULL WHERE id=$1",[id]);
    await client.query("INSERT INTO control_admin_audit(id,actor_email,action,entity_type,entity_id) VALUES($1,$2,$3,'site_content',$4)",[crypto.randomUUID(),principal.email,`site_content_${input.action}`,id]);
    await client.query("COMMIT");return reply({ok:true,id,versionId});
   }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  }
  if(section==="document-categories"){
   const input=z.object({slug:z.string().regex(/^[a-z0-9-]{1,80}$/),titleRu:z.string().min(1).max(200),titleUz:z.string().min(1).max(200),position:z.number().int().min(0).max(10000),active:z.boolean()}).strict().parse(data);
   await q("INSERT INTO control_template_categories(slug,title_ru,title_uz,position,active) VALUES($1,$2,$3,$4,$5) ON CONFLICT(slug) DO UPDATE SET title_ru=excluded.title_ru,title_uz=excluded.title_uz,position=excluded.position,active=excluded.active",[input.slug,input.titleRu,input.titleUz,input.position,input.active]);await controlAudit(principal.email,"template_category_changed","template_category",input.slug);return reply({ok:true});
  }
  if(section.startsWith("documents/")) {
   const code=z.string().regex(/^\d{7}$/).parse(section.slice(10));
   const input=z.object({action:z.enum(["save_draft","publish","preview"]),definition:z.unknown().optional(),versionId:idSchema.optional(),answers:z.record(z.string(),z.unknown()).optional()}).strict().parse(data);
   if(input.action==="save_draft"){
    const definition=validateTemplate(input.definition);if(!(await resolvedCategories()).some(c=>c.slug===definition.categorySlug))throw Error("CATEGORY_UNAVAILABLE");if(definition.code!==code)throw Error("CODE_MISMATCH");
    const versionId=crypto.randomUUID();definition.version=`control-${versionId}`;
    await q("INSERT INTO control_template_versions(id,code,version,definition,actor_email) VALUES($1,$2,$3,$4,$5)",[versionId,code,definition.version,JSON.stringify(definition),principal.email]);
    await controlAudit(principal.email,"template_draft_saved","template",code);return reply({ok:true,versionId});
   }
   const rows=await q("SELECT definition FROM control_template_versions WHERE id=$1 AND code=$2",[input.versionId??"",code]);
   if(!rows[0])throw Error("VERSION_NOT_FOUND");const definition=validateTemplate(rows[0].definition);
   if(input.action==="preview")return reply({ok:true,preview:renderConfiguredDocument(definition,(input.answers??{}) as Parameters<typeof renderConfiguredDocument>[1],"ru")});
   await q(`UPDATE control_template_versions SET published_at=now(),definition=CASE WHEN definition->>'status' IN ('draft','review') THEN jsonb_set(jsonb_set(definition,'{status}','"published"'),'{editorialStatus}','"Published"') ELSE definition END WHERE id=$1 AND published_at IS NULL`,[input.versionId]);
   await controlAudit(principal.email,"template_published","template",code,{versionId:input.versionId});return reply({ok:true});
  }
  if(section==="system/retry-email") {
   const input=z.object({id:idSchema}).strict().parse(data);
   await deliverDecisionEmail(input.id);await controlAudit(principal.email,"email_retried","delivery",input.id);return reply({ok:true});
  }
  if(section==="content") {
   const input=knowledgeBaseAdminMutationSchema.parse(data);
   const base={db:getSelfHostedRuntime().DB!,actorUserId:principal.userId};
   const result=input.action==="save_draft"?await saveKnowledgeBaseDraft({...base,...input}):input.action==="publish"?await publishKnowledgeBaseDraft({...base,...input}):await setKnowledgeBaseArticleStatus({...base,...input});
   await controlAudit(principal.email,`content_${input.action}`,"article",input.articleId);return reply({ok:true,...result});
  }
  if(section==="ai/budget" || section==="ai/circuit") {
   const base={db:getSelfHostedRuntime().DB!,environment:(getSelfHostedRuntime().APP_ENV??"development") as "development"|"staging"|"production",actorUserId:principal.userId};
   const result=section.endsWith("budget")?await createCostGuardPolicyVersion({...base,value:costGuardPolicyMutationSchema.parse(data)}):await setProviderCircuitState({...base,...providerCircuitMutationSchema.parse(data)});
   await controlAudit(principal.email,section,"ai");return reply({ok:true,result});
  }
 }
 return reply({code:"NOT_FOUND"},404);
 } catch(error) {
  if(error instanceof z.ZodError)return reply({code:"INVALID_INPUT",issues:error.issues.map(i=>({path:i.path,message:i.message}))},400);
  console.error("control.operation_failed",error instanceof Error?error.name:"UnknownError");
  return reply({code:"OPERATION_FAILED"},409);
 }
}
