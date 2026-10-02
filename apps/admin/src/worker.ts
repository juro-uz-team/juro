import { escape, css, navItems, themeScript, table, value, labels } from "./control-ui";
const ADMIN_SESSION_COOKIE = "juro_admin_session";
const ADMIN_CSRF_COOKIE = "juro_admin_csrf";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const LAWYER_MARKETPLACE_STATUSES = [
  "profile_incomplete",
  "pending_review",
  "changes_requested",
  "public_approved",
  "rejected",
  "suspended",
  "blocked",
  "archived",
] as const;
const RESTRICTED_LAWYER_MARKETPLACE_STATUSES = new Set<string>(["suspended", "blocked", "archived"]);
// A moderation form can carry both a 2,000-character redaction and a reason.
// Keep a bounded server-side limit while allowing both fields plus CSRF encoding.
const MAX_FORM_BYTES = 8_192;

type PlatformReply<T> = { response: Response; body: T | null };
type Dashboard = {
  roles: string[];
  expiresAt: string;
  counts: {
    pendingLawyerProfiles: number;
    approvedLawyerProfiles: number;
    activeLawyerRequests: number;
    adminAuditEvents: number;
  };
};
type Profile = {
  professionalType?:string;documentCount?:number;resubmitted?:boolean;
  id: string;
  displayName: string;
  status: string;
  marketplaceStatus: string;
  profileRevision: number;
  city: string | null;
  region: string | null;
  experienceYears: number | null;
  priceDescription: string | null;
  availabilityStatus: string;
  updatedAt: string;
};
type Review = {
  id: string;
  lawyerName: string;
  overallRating: number;
  speedRating: number;
  qualityRating: number;
  communicationRating: number;
  body: string | null;
  status: string;
  createdAt: string;
};
function cookie(request: Request, name: string): string | null {
  const source = request.headers.get("cookie");
  if (!source) return null;
  for (const item of source.split(";")) {
    const [candidate, ...parts] = item.trim().split("=");
    if (candidate !== name) continue;
    try {
      const value = decodeURIComponent(parts.join("="));
      return TOKEN_PATTERN.test(value) ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

function escaped(value: unknown): string {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] ?? character);
}

function lawyerMarketplaceStatus(value: string | null): (typeof LAWYER_MARKETPLACE_STATUSES)[number] {
  return LAWYER_MARKETPLACE_STATUSES.includes(value as (typeof LAWYER_MARKETPLACE_STATUSES)[number])
    ? value as (typeof LAWYER_MARKETPLACE_STATUSES)[number]
    : "pending_review";
}

function lawyerStatusLabel(status: string): string {
  return {
    profile_incomplete: "Профиль не завершён",
    pending_review: "На проверке",
    changes_requested: "Нужны исправления",
    public_approved: "Одобрен",
    rejected: "Отклонён",
    suspended: "Временно скрыт",
    blocked: "Заблокирован",
    archived: "Архивирован",
  }[status] ?? status;
}

function page(environment: Env["APP_ENV"], title: string, body: string, options: { notice?: string; role?: string } = {}): Response {
  const notice = options.notice ? `<p class="notice">${escaped(options.notice)}</p>` : "";
  const role = options.role ? `<span class="role">${escaped(options.role)}</span>` : "";
  const environmentLabel = environment === "production" ? "production" : environment === "staging" ? "staging" : "development";
  const navigation=navItems.map(([href,label])=>`<a href="${href}">${label}</a>`).join("");
  return new Response(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escaped(title)} · JURO Control Center</title><style>${css}</style><script src="/assets/control.js"></script></head><body><div class="shell"><aside><div><div class="brand"><img src="/assets/juro-logo.svg" alt="">JURO</div><p class="brand-caption">CONTROL CENTER</p></div><nav class="nav">${navigation}</nav><div class="aside-bottom">Asia/Tashkent<br>${environmentLabel}<br>Доступ администратора</div></aside><div class="main-wrap"><header class="topbar"><form action="/search"><input name="q" type="search" placeholder="Поиск по JURO" aria-label="Глобальный поиск" minlength="2"></form><a class="button" href="/notifications">Уведомления</a><button data-theme-toggle type="button" aria-label="Переключить тему">Тема</button><a href="/logout">Выйти</a></header><main><h1>${escaped(title)}</h1>${notice}${body}</main></div></div></body></html>`, { headers: securityHeaders() });
}

function securityHeaders(): Headers {
  return new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, no-store",
    pragma: "no-cache",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex, nofollow, noarchive",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), payment=(), geolocation=()",
    "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; font-src 'self'; style-src 'unsafe-inline'; script-src 'self';",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
  });
}

// Secrets are injected by the native server and validated before use.
function requiredSecret(env: Env, name: string): string {
  const value: unknown = Reflect.get(env, name);
  if (typeof value !== "string" || value.length < 32) {
    throw new Error("ADMIN_INTERNAL_SECRET_UNAVAILABLE");
  }
  return value;
}

function platformTokenSecretName(env: Env): "ADMIN_INTERNAL_TOKEN" | "ADMIN_CONSOLE_TOKEN" {
  return env.APP_ENV === "production" ? "ADMIN_CONSOLE_TOKEN" : "ADMIN_INTERNAL_TOKEN";
}

async function platform<T>(env: Env, path: string, init: RequestInit & { session?: string } = {}): Promise<PlatformReply<T>> {
  const headers = new Headers(init.headers);
  headers.set("x-juro-admin-internal-token", requiredSecret(env, platformTokenSecretName(env)));
  if (init.session) headers.set("x-juro-admin-session", init.session);
  const response = await env.PLATFORM_ADMIN_API.fetch(new Request(`https://admin-service.internal${path}`, {
    method: init.method ?? "GET", headers, body: init.body,
  }));
  let body: T | null = null;
  try { body = await response.json() as T; } catch { /* fixed error handling below */ }
  return { response, body };
}

async function constantTimeEqual(left: string | null, right: string | null): Promise<boolean> {
  if (!left || !right) return false;
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash); const b = new Uint8Array(rightHash); let delta = 0;
  for (let i = 0; i < a.length; i += 1) delta |= a[i]! ^ b[i]!;
  return delta === 0;
}

async function csrf(request: Request, maxBytes = MAX_FORM_BYTES): Promise<boolean> {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) return false;
  const form = await request.clone().formData();
  const field = form.get("_csrf");
  return typeof field === "string" && constantTimeEqual(field, cookie(request, ADMIN_CSRF_COOKIE));
}

function sessionCookies(token: string, csrfToken: string, expiresAt: string): string[] {
  const seconds = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1_000));
  return [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`,
    `${ADMIN_CSRF_COOKIE}=${encodeURIComponent(csrfToken)}; Path=/; Secure; SameSite=Strict; Max-Age=${seconds}`,
  ];
}

function clearCookies(): string[] {
  return [
    `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
    `${ADMIN_CSRF_COOKIE}=; Path=/; Secure; SameSite=Strict; Max-Age=0`,
  ];
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = securityHeaders(); headers.set("location", location); for (const item of cookies) headers.append("set-cookie", item);
  return new Response(null, { status: 303, headers });
}

async function lawyerList(request: Request, env: Env, session: string, notice?: string): Promise<Response> {
  const selectedStatus = lawyerMarketplaceStatus(new URL(request.url).searchParams.get("status"));
  const result = await platform<{ profiles: Profile[];page:number }>(env, `/api/internal/admin/lawyers?status=${encodeURIComponent(selectedStatus)}&page=${new URL(request.url).searchParams.get("page")??1}`, { session });
  if (!result.response.ok || !result.body) return redirect("/login", clearCookies());
  const csrfToken = cookie(request, ADMIN_CSRF_COOKIE) ?? "";
  const filters = LAWYER_MARKETPLACE_STATUSES.map((status) => `<a href="/lawyers?status=${encodeURIComponent(status)}"${status === selectedStatus ? " aria-current=\"page\"" : ""}>${escaped(lawyerStatusLabel(status))}</a>`).join("");
  const lifecycleForm = (profile: Profile): string => {
    const currentStatus = lawyerMarketplaceStatus(profile.marketplaceStatus);
    if (RESTRICTED_LAWYER_MARKETPLACE_STATUSES.has(currentStatus)) {
      return `<form method="post" action="/lawyers/${encodeURIComponent(profile.id)}/lifecycle?status=${encodeURIComponent(selectedStatus)}"><input type="hidden" name="_csrf" value="${escaped(csrfToken)}"><label>Причина восстановления<textarea name="reason" required maxlength="2000" minlength="1"></textarea></label><button name="action" value="restore">Снять ограничение</button></form>`;
    }
    return `<form method="post" action="/lawyers/${encodeURIComponent(profile.id)}/lifecycle?status=${encodeURIComponent(selectedStatus)}"><input type="hidden" name="_csrf" value="${escaped(csrfToken)}"><label>Причина lifecycle-действия<textarea name="reason" required maxlength="2000" minlength="1"></textarea></label><div class="actions"><button name="action" value="suspend">Временно скрыть</button><button class="danger" name="action" value="block">Заблокировать</button><button name="action" value="archive">Архивировать</button></div></form>`;
  };
  const rows = result.body.profiles.map((profile) => {
    const moderation = profile.marketplaceStatus === "pending_review"
      ? `<form method="post" action="/lawyers/${encodeURIComponent(profile.id)}/moderate"><input type="hidden" name="next" value="1"><input type="hidden" name="_csrf" value="${escaped(csrfToken)}"><label>Причина<textarea name="reason" required maxlength="2000" minlength="1"></textarea></label><div class="actions"><button name="decision" value="changes_requested">Запросить информацию</button><button name="decision" value="approved">Одобрить</button><button class="danger" name="decision" value="rejected">Отклонить</button></div></form>`
      : "";
    return `<tr><td><a href="/lawyers/${encodeURIComponent(profile.id)}">${escaped(profile.displayName)}</a><br><small>${escaped(lawyerStatusLabel(profile.marketplaceStatus))} · ${escape(profile.professionalType)} · Документов: ${escape(profile.documentCount)}${profile.resubmitted?" · Повторная подача":""}</small></td><td>${escaped(profile.city ?? "—")}</td><td>${escaped(profile.experienceYears ?? "—")}</td><td>${escaped(profile.updatedAt)}</td><td>${moderation}${lifecycleForm(profile)}</td></tr>`;
  }).join("");
  return page(env.APP_ENV, "Профессиональные аккаунты", `<section class="panel"><p>Откройте карточку для контактов, профессиональных сведений и истории решений. Проверка профиля JURO не является гарантией качества услуг.</p><nav class="filters" aria-label="Статус профиля">${filters}</nav><table><thead><tr><th>Профиль</th><th>Город</th><th>Стаж</th><th>Изменён</th><th>Модерация и lifecycle</th></tr></thead><tbody>${rows || `<tr><td colspan="5">Нет профилей со статусом «${escaped(lawyerStatusLabel(selectedStatus))}».</td></tr>`}</tbody></table>${paginate(new URL(request.url),result.body.page,result.body.profiles.length===25)}</section>`, { notice, role: "lawyer moderation" });
}

async function moderate(request: Request, env: Env, session: string, profileId: string): Promise<Response> {
  if (!await csrf(request)) return page(env.APP_ENV, "Запрос отклонён", "<p>Проверка происхождения или CSRF не пройдена.</p>");
  const form = await request.formData();
  const decision = form.get("decision"); const reason = form.get("reason");
  if ((decision !== "approved" && decision !== "changes_requested" && decision !== "rejected") || typeof reason !== "string" || reason.trim().length < 1 || reason.trim().length > 2_000) return lawyerList(request, env, session, "Проверьте решение и причину.");
  const result = await platform<{ ok: boolean }>(env, `/api/internal/admin/lawyers/${encodeURIComponent(profileId)}/moderate`, {
    method: "POST", session, headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, reason: reason.trim() }),
  });
  if(result.response.ok && result.body?.ok && form.get("next")==="1") {
    const next=await platform<{profiles:Profile[]}>(env,"/api/internal/admin/lawyers?status=pending_review",{session});
    return redirect(next.body?.profiles[0]?`/lawyers/${next.body.profiles[0].id}`:"/lawyers?status=pending_review");
  }
  return lawyerList(request, env, session, result.response.ok && result.body?.ok ? "Решение сохранено. Уведомление поставлено в очередь доставки." : "Профиль изменился или решение нельзя применить.");
}

async function transitionLifecycle(request: Request, env: Env, session: string, profileId: string): Promise<Response> {
  if (!await csrf(request)) return page(env.APP_ENV, "Запрос отклонён", "<p>Проверка происхождения или CSRF не пройдена.</p>");
  const form = await request.formData();
  const action = form.get("action"); const reason = form.get("reason");
  if ((action !== "suspend" && action !== "block" && action !== "archive" && action !== "restore") || typeof reason !== "string" || reason.trim().length < 1 || reason.trim().length > 2_000) {
    return lawyerList(request, env, session, "Проверьте lifecycle-действие и причину.");
  }
  const result = await platform<{ ok?: boolean; code?: string }>(env, `/api/internal/admin/lawyers/${encodeURIComponent(profileId)}/lifecycle`, {
    method: "POST", session, headers: { "content-type": "application/json" }, body: JSON.stringify({ action, reason: reason.trim() }),
  });
  if (result.response.ok && result.body?.ok) return lawyerList(request, env, session, "Lifecycle-действие сохранено и записано в audit.");
  if (result.response.status === 403) return lawyerList(request, env, session, "Административная сессия недействительна. Войдите заново и повторите действие.");
  if (result.body?.code === "PROFILE_STATE_CONFLICT") return lawyerList(request, env, session, "Профиль уже изменился. Обновите список и проверьте текущий статус.");
  return lawyerList(request, env, session, "Lifecycle-действие сейчас недоступно.");
}

async function reviewList(request: Request, env: Env, session: string, notice?: string): Promise<Response> {
  const result = await platform<{ reviews: Review[] }>(env, "/api/internal/admin/reviews?status=pending&limit=50", { session });
  if (!result.response.ok || !result.body) return redirect("/login", clearCookies());
  const csrfToken = cookie(request, ADMIN_CSRF_COOKIE) ?? "";
  const rows = result.body.reviews.map((review) => `<tr><td>${escaped(review.lawyerName)}<br><small>${escaped(review.createdAt)}</small></td><td>${escaped(`${review.overallRating}/5`)}<br><small>Скорость ${escaped(review.speedRating)}, качество ${escaped(review.qualityRating)}, коммуникация ${escaped(review.communicationRating)}</small></td><td class="review-body">${escaped(review.body ?? "Без текста")}</td><td><form method="post" action="/reviews/${encodeURIComponent(review.id)}/moderate"><input type="hidden" name="_csrf" value="${escaped(csrfToken)}"><label>Редакция без персональных данных<textarea name="moderatedBody" maxlength="2000"></textarea></label><label>Причина<textarea name="reason" required maxlength="2000" minlength="1"></textarea></label><div class="actions"><button name="decision" value="approved">Одобрить</button><button class="danger" name="decision" value="rejected">Отклонить</button></div></form></td></tr>`).join("");
  return page(env.APP_ENV, "Модерация отзывов", `<section class="panel"><p>Отзыв публикуется только после проверки. При обнаружении контактов одобрение отклоняется, пока текст не будет отредактирован.</p><table><thead><tr><th>Юрист</th><th>Оценка</th><th>Отзыв</th><th>Решение</th></tr></thead><tbody>${rows || "<tr><td colspan=\"4\">Нет отзывов на проверке.</td></tr>"}</tbody></table></section>`, { notice, role: "lawyer moderation" });
}

async function moderateReview(request: Request, env: Env, session: string, reviewId: string): Promise<Response> {
  if (!await csrf(request)) return page(env.APP_ENV, "Запрос отклонён", "<p>Проверка происхождения или CSRF не пройдена.</p>");
  const form = await request.formData();
  const decision = form.get("decision"); const reason = form.get("reason"); const rawModeratedBody = form.get("moderatedBody");
  const moderatedBody = typeof rawModeratedBody === "string" && rawModeratedBody.trim() ? rawModeratedBody.trim() : undefined;
  if ((decision !== "approved" && decision !== "changes_requested" && decision !== "rejected") || typeof reason !== "string" || reason.trim().length < 1 || reason.trim().length > 2_000 || (moderatedBody !== undefined && moderatedBody.length > 2_000)) return reviewList(request, env, session, "Проверьте решение, текст и причину.");
  const result = await platform<{ ok?: boolean; code?: string }>(env, `/api/internal/admin/reviews/${encodeURIComponent(reviewId)}/moderate`, {
    method: "POST", session, headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, reason: reason.trim(), ...(moderatedBody ? { moderatedBody } : {}) }),
  });
  if (result.response.ok && result.body?.ok) return reviewList(request, env, session, "Решение сохранено и записано в audit.");
  if (result.body?.code === "LIKELY_PERSONAL_DATA") return reviewList(request, env, session, "Удалите контакты или другие персональные данные перед одобрением.");
  return reviewList(request, env, session, "Отзыв изменился или решение нельзя применить.");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") return Response.json({ status: "ok", environment: env.APP_ENV }, { headers: { "cache-control": "no-store" } });
      if (request.method === "GET" && url.pathname === "/assets/control.js") return new Response(themeScript,{headers:{"content-type":"text/javascript","cache-control":"no-store"}});
      if (url.pathname === "/login") return login(request,env);
      if (url.pathname.startsWith("/api/")) {
        const session=cookie(request,ADMIN_SESSION_COOKIE);
        if (!session) return Response.json({code:"ACCESS_DENIED"},{status:403});
        if(request.method!=="GET") return Response.json({code:"METHOD_NOT_ALLOWED"},{status:405});
        const headers=new Headers({"x-juro-admin-internal-token":requiredSecret(env,platformTokenSecretName(env)),"x-juro-admin-session":session});
        return env.PLATFORM_ADMIN_API.fetch(new Request(`https://admin-service.internal/api/internal/admin/control/${url.pathname.slice(5)}${url.search}`,{headers}));
      }
      if (request.method === "GET" && url.pathname === "/logout") return page(env.APP_ENV, "Выход", `<form method="post" action="/logout"><input type="hidden" name="_csrf" value="${escaped(cookie(request, ADMIN_CSRF_COOKIE) ?? "")}"><button>Завершить admin-сеанс</button></form>`);
      if (request.method === "POST" && url.pathname === "/logout") {
        if (!await csrf(request)) return page(env.APP_ENV, "Запрос отклонён", "<p>CSRF не пройдена.</p>");
        const session = cookie(request, ADMIN_SESSION_COOKIE);
        if (session) {
          await platform<{ ok: boolean }>(env, "/api/internal/admin/session/logout", { method: "POST", session });
        }
        return redirect("/login", clearCookies());
      }
      const session = cookie(request, ADMIN_SESSION_COOKIE);
      if (!session) return redirect("/login", clearCookies());
      const sessionCheck=await platform<unknown>(env,"/api/internal/admin/control/session",{session});
      if(!sessionCheck.response.ok) return redirect("/login",clearCookies());
      if (request.method === "GET" && url.pathname === "/") return controlPage(request,env,session,"overview");
      if (["users","finance","analytics","ai","documents","content","site-content","support","system","search","notifications"].includes(url.pathname.split("/")[1]??"")) return controlPage(request,env,session,url.pathname.slice(1));
      const profileMatch=/^\/lawyers\/([0-9a-f-]{36})$/.exec(url.pathname);
      if(request.method === "GET" && profileMatch) return professionalDetail(request,env,session,profileMatch[1]!);
      if (request.method === "GET" && url.pathname === "/lawyers") return lawyerList(request, env, session);
      if (request.method === "GET" && url.pathname === "/reviews") return reviewList(request, env, session);
      const match = /^\/lawyers\/([0-9a-f-]{36})\/moderate$/.exec(url.pathname);
      if (request.method === "POST" && match && profileIdValid(match[1])) return moderate(request, env, session, match[1]);
      const lifecycleMatch = /^\/lawyers\/([0-9a-f-]{36})\/lifecycle$/.exec(url.pathname);
      if (request.method === "POST" && lifecycleMatch && profileIdValid(lifecycleMatch[1])) return transitionLifecycle(request, env, session, lifecycleMatch[1]);
      const reviewMatch = /^\/reviews\/([0-9a-f-]{36})\/moderate$/.exec(url.pathname);
      if (request.method === "POST" && reviewMatch && profileIdValid(reviewMatch[1])) return moderateReview(request, env, session, reviewMatch[1]);
      return page(env.APP_ENV, "Не найдено", "<p>Этот административный маршрут отсутствует.</p>");
    } catch (error) {
      console.error(JSON.stringify({ event: "admin.request_failed", path: url.pathname }));
      return page(env.APP_ENV, "Временно недоступно", "<p>Защищённая операция не выполнена. Повторите позже. Если ошибка сохраняется, проверьте подключение сервера и миграции.</p>");
    }
  },
} satisfies { fetch(request: Request, env: Env): Promise<Response> };

function profileIdValid(value: string | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}

function freshCsrf():string{const b=new Uint8Array(32);crypto.getRandomValues(b);return btoa(String.fromCharCode(...b)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");}
async function login(request:Request,env:Env):Promise<Response>{
 const csrfToken=cookie(request,ADMIN_CSRF_COOKIE)??freshCsrf();let challengeId="",notice="";
 if(request.method==="POST"){
  if(!await csrf(request))return new Response("Запрос отклонён",{status:403,headers:securityHeaders()});
  const f=await request.formData(),ip=request.headers.get("x-juro-client-ip")??"unknown";
  if(f.get("action")==="request"){
   const r=await platform<{challengeId:string}>(env,"/api/internal/admin/auth/request",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:String(f.get("email")??""),ip})});
   challengeId=r.body?.challengeId??"";notice=r.response.ok?"Если адресу разрешён доступ, на него отправлен код. Повторная отправка доступна через 60 секунд.":"Не удалось запросить код. Проверьте настройки доставки.";
  }else{
   challengeId=String(f.get("challengeId")??"");
   const r=await platform<{token:string;csrfToken:string;expiresAt:string}>(env,"/api/internal/admin/auth/verify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({challengeId,code:String(f.get("code")??""),ip})});
   if(r.response.ok&&r.body?.token)return redirect("/",sessionCookies(r.body.token,r.body.csrfToken,r.body.expiresAt));
   notice="Код неверен, истёк или число попыток исчерпано.";
  }
 }
 const headers=securityHeaders();headers.append("set-cookie",`${ADMIN_CSRF_COOKIE}=${csrfToken}; Path=/; Secure; SameSite=Strict; Max-Age=900`);
 const h=`<input type="hidden" name="_csrf" value="${escape(csrfToken)}">`;
 const body=challengeId?`<form method="post">${h}<input type="hidden" name="action" value="verify"><input type="hidden" name="challengeId" value="${escape(challengeId)}"><label>Код из письма<input class="otp" name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autofocus></label><button>Войти</button></form><p class="small">Срок действия указан в письме · не более 5 попыток</p><a href="/login">Запросить новый код</a>`:`<form method="post">${h}<input type="hidden" name="action" value="request"><label>E-mail<input name="email" type="email" autocomplete="email" required autofocus maxlength="254"></label><button>Получить код</button></form><p class="small">Только для разрешённого администратора.</p>`;
 return new Response(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Вход · JURO Control Center</title><style>${css}</style><script src="/assets/control.js"></script></head><body><main class="login"><div class="brand"><img src="/assets/juro-logo.svg" alt="">JURO</div><h1>Control Center</h1><p class="muted">Управление экосистемой JURO</p>${notice?`<p class="notice" role="status">${escape(notice)}</p>`:""}${body}</main></body></html>`,{headers});
}
type Row=Record<string,unknown>;
const titles:Record<string,string>={notifications:"Уведомления","site-content":"Контент сайта",overview:"Обзор JURO",users:"Пользователи",finance:"Финансы",analytics:"Аналитика",ai:"Управление AI",documents:"Шаблоны документов",content:"Контент",support:"Обращения",system:"Система и журнал действий",search:"Поиск по JURO"};
const panel=(title:string,body:string)=>`<section class="panel"><h2>${escape(title)}</h2>${body}</section>`;
function paginate(url:URL,n:number,next:boolean){const link=(p:number)=>{const u=new URL(url);u.searchParams.set("page",String(p));return escape(u.pathname+u.search);};return `<div class="pagination">${n>1?`<a href="${link(n-1)}">← Предыдущая</a>`:"<span></span>"}<span>Страница ${n}</span>${next?`<a href="${link(n+1)}">Следующая →</a>`:"<span></span>"}</div>`;}
function periods(url:URL){return `<form class="filters"><label>Период<select name="period">${[["today","Сегодня"],["7","7 дней"],["30","30 дней"],["90","90 дней"],["year","Год"]].map(([v,l])=>`<option value="${v}"${(url.searchParams.get("period")??"30")===v?" selected":""}>${l}</option>`).join("")}</select></label><label>С<input type="date" name="since" value="${escape(url.searchParams.get("since"))}"></label><label>По<input type="date" name="until" value="${escape(url.searchParams.get("until"))}"></label><button>Применить</button><span class="small">Asia/Tashkent</span></form>`;}
function filter(url:URL,options:string[]=[],sortable=false){return `<form class="filters"><input name="q" type="search" style="max-width:330px" placeholder="Поиск" value="${escape(url.searchParams.get("q"))}" aria-label="Поиск в реестре"><select name="status" style="max-width:200px"><option value="">Все</option>${options.map(o=>`<option value="${o}"${url.searchParams.get("status")===o?" selected":""}>${value(o)}</option>`).join("")}</select>${sortable?`<select name="sort" aria-label="Сортировка">${[["newest","Сначала новые"],["oldest","Сначала старые"],["name","По имени"]].map(([v,l])=>`<option value="${v}"${(url.searchParams.get("sort")??"newest")===v?" selected":""}>${l}</option>`).join("")}</select>`:""}<button>Найти</button></form>`;}
async function controlPage(request:Request,env:Env,session:string,section:string):Promise<Response>{
 const url=new URL(request.url),root=section.split("/")[0]!;
 const h=`<input type="hidden" name="_csrf" value="${escape(cookie(request,ADMIN_CSRF_COOKIE)??"")}">`;
 let notice="";
 if(request.method==="POST"){
  if(!await csrf(request,1048576))return new Response("Запрос отклонён",{status:403,headers:securityHeaders()});
  const f=await request.formData();let data:unknown,endpoint=section;
  if(root==="users"){
   const action=String(f.get("action")),fields:Record<string,string>={};for(const [k,v]of f)if(k.startsWith("field:")&&typeof v==="string")fields[k.slice(6)]=v;
   data={action,reason:String(f.get("reason")??""),...(action==="delete"?{confirmation:String(f.get("confirmation")??"")} : {}),...(action==="edit"?{fields}:{})};
  }else if(root==="support")data={action:String(f.get("action")),body:String(f.get("body")??"")};
  else if(root==="site-content"){
   endpoint="site-content";const action=String(f.get("action"));
   data=action==="save_draft"?{action,...(f.get("id")?{id:String(f.get("id"))}:{}),kind:String(f.get("kind")),slug:String(f.get("slug")),locale:String(f.get("locale")),position:Number(f.get("position")),title:String(f.get("title")),description:String(f.get("description")),body:String(f.get("body")),image:f.get("image")?String(f.get("image")):null,seoTitle:String(f.get("seoTitle")),seoDescription:String(f.get("seoDescription"))}:{action,id:String(f.get("id")),...(f.get("versionId")?{versionId:String(f.get("versionId"))}:{})};
  }
  else if(root==="content"){
   endpoint="content";const action=String(f.get("action")),articleId=String(f.get("articleId")??"");
   if(action==="save_draft"){
    const content=JSON.parse(String(f.get("content")));for(const key of ["slug","category","titleRu","titleUz","summaryRu","summaryUz"])content[key]=String(f.get(key));
    for(const key of ["titleEn","summaryEn"])content[key]=String(f.get(key)??"").trim()||null;
    for(const language of ["Ru","Uz","En"]){const blocks=content["body"+language];if(blocks)for(let i=0;i<blocks.length;i++){blocks[i].heading=String(f.get(`body:${language}:${i}:heading`)??blocks[i].heading);blocks[i].paragraphs=String(f.get(`body:${language}:${i}:paragraphs`)??blocks[i].paragraphs.join("\n\n")).split(/\n\s*\n/).map((v:string)=>v.trim()).filter(Boolean);}}
    data={action,...(articleId?{articleId}:{}),content};
   }else data={action,articleId,...(action==="publish"?{versionId:String(f.get("versionId"))}:{status:"archived"})};
  }
  else if(root==="documents"){
   if(f.get("categoryAction")){endpoint="document-categories";data={slug:String(f.get("slug")),titleRu:String(f.get("titleRu")),titleUz:String(f.get("titleUz")),position:Number(f.get("position")),active:f.get("active")==="on"};}else{
   if(section==='documents/new')endpoint=`documents/${url.searchParams.get("code")}`;
   const action=String(f.get("action"));
   try{
    if(action==="save_draft"){
     const definition=JSON.parse(String(f.get("definition")));
     definition.allowedPlans=String(f.get("allowedPlans")??"").split(",").map(v=>v.trim()).filter(Boolean);
     for(const k of ["titleRu","titleUz","descriptionRu","descriptionUz","categorySlug","status"])definition[k]=String(f.get(k)??definition[k]);
     for(let si=0;si<definition.questionnaire.length;si++)for(let fi=0;fi<definition.questionnaire[si].fields.length;fi++){
      const field=definition.questionnaire[si].fields[fi],prefix=`question:${si}:${fi}:`;
      if(f.has(prefix+"ru")){field.label.ru=String(f.get(prefix+"ru"));field.label.uz=String(f.get(prefix+"uz"));field.required=f.get(prefix+"required")==="on";const dependency=String(f.get(prefix+"condition")??"").trim();if(dependency)field.condition={field:dependency,operator:String(f.get(prefix+"operator")),value:String(f.get(prefix+"value")??"")};else delete field.condition;}
     }
     if(String(f.get("newParagraphRu")??"").trim())definition.generationSchema.paragraphs.push({id:`paragraph-${crypto.randomUUID()}`,kind:"body",text:{ru:String(f.get("newParagraphRu")),uz:String(f.get("newParagraphUz")??"")}});
     for(let i=0;i<definition.generationSchema.paragraphs.length;i++){const p=definition.generationSchema.paragraphs[i];if(f.has(`paragraph:${i}:ru`)){p.text.ru=String(f.get(`paragraph:${i}:ru`));p.text.uz=String(f.get(`paragraph:${i}:uz`));}}
     if(f.get("newFieldId")){if(!definition.questionnaire.length)definition.questionnaire.push({id:"main",title:{ru:"Сведения",uz:"Ma’lumotlar"},fields:[]});definition.questionnaire[Number(f.get("stepIndex")??0)].fields.push({id:String(f.get("newFieldId")),type:String(f.get("newFieldType")),label:{ru:String(f.get("newFieldRu")),uz:String(f.get("newFieldUz"))},required:f.get("newFieldRequired")==="on"});}
     data={action,definition};
    }else if(action==="preview"){
     const answers:Record<string,string>={};for(const[k,v]of f)if(k.startsWith("test:")&&typeof v==="string")answers[k.slice(5)]=v;
     data={action,versionId:String(f.get("versionId")),answers};
    }else data={action,versionId:String(f.get("versionId"))};
   }catch{return page(env.APP_ENV,"Шаблон","<p>Не удалось проверить поля шаблона. Изменения не сохранены.</p>");}
  }
  }
  else if(root==="system"){endpoint=f.get("key")?"system/settings":"system/retry-email";data=f.get("key")?{key:String(f.get("key")),value:String(f.get("key")).startsWith("feature.")?f.get("value")==="true":Number(f.get("value"))}:{id:String(f.get("id"))};}
  else if(root==="ai"){
   endpoint=String(f.get("endpoint"));const provider=String(f.get("provider"));
   if(endpoint==="ai/settings"){
    const settings:Record<string,unknown>={expectedVersion:Number(f.get("expectedVersion")),reason:String(f.get("reason")),responseTone:String(f.get("responseTone"))};for(const k of ["openaiChatModel","openaiDeepModel","anthropicChatFallbackModel","anthropicDocumentModel","openaiDocumentFallbackModel"])settings[k]=String(f.get(k));
    data={settings,systemInstructions:String(f.get("systemInstructions")??""),apply:f.get("apply")!=="false"};
   }else data=endpoint==="ai/circuit"?{provider,state:String(f.get("state"))}:{provider,dailyCostLimitMicrousd:Math.round(Number(f.get("budget"))*1e6),rollingFailureLimit:Number(f.get("failures")),rollingWindowMinutes:Number(f.get("window")),enabled:true,effectiveFrom:new Date().toISOString()};
  }else return new Response("Нет такого действия",{status:405});
  const r=await platform<{code?:string;articleId?:string;id?:string;preview?:{plainText:string}}>(env,`/api/internal/admin/control/${endpoint}`,{session,method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)});
  if(r.response.ok && r.body?.preview)notice="PREVIEW:"+r.body.preview.plainText;
  else if(r.response.ok && root==="site-content" && r.body?.id)return redirect(`/site-content/${r.body.id}?saved=1`);
  else if(r.response.ok)return redirect(root==="content"&&r.body?.articleId?`/content/${encodeURIComponent(r.body.articleId)}`:url.pathname+"?saved=1");
  if(!r.response.ok)notice=r.body?.code==="ADMIN_JURO_PROFILE_REQUIRED"?"Для этого действия требуется существующий профиль JURO с разрешённым e-mail администратора.":"Изменение не сохранено. Проверьте поля и состояние объекта.";
 }
 const r=await platform<any>(env,`/api/internal/admin/control/${section}${url.search}`,{session});
 if(r.response.status===403)return redirect("/login",clearCookies());
 if(!r.response.ok||!r.body)return page(env.APP_ENV,titles[root]??"Карточка",'<p class="notice">Не удалось загрузить данные. Проверьте подключение сервера и миграции.</p>');
 const d=r.body;let body="";const tbl=(rows:Row[],cols:string[],link?:{key:string;path:string})=>table(rows??[],cols,link);
 if(root==="overview"){
  const a=d.audience,pending=d.professionals.filter((p:Row)=>p.marketplace_status==="pending_review").reduce((s:number,p:Row)=>s+Number(p.count),0);
  const change=Number(a.previous_registrations)>0?`${Math.round((a.registrations/a.previous_registrations-1)*100)}% к предыдущему периоду`:"Нет базы сравнения";
  const m=(l:string,n:unknown,href:string,c:string)=>`<a class="metric" href="${href}"><span>${l}</span><strong>${n===null?"—":value(n)}</strong><span>${c}</span></a>`;
  body=periods(url)+`<p class="muted">Что происходит, что изменилось и что требует решения</p><div class="metrics">${m("Пользователи",a.total,"/users","Завершившие регистрацию")}${m("Новые регистрации",a.registrations,"/analytics",change)}${m("Активные пользователи",a.active,"/analytics","Активность сессий за период")}${m("На рассмотрении",pending,"/lawyers?status=pending_review","Профессиональные профили")}${m("Запросы AI",d.ai.requests,"/ai","За выбранный период")}${m("Ошибки AI",d.ai.errors,"/ai","Технические ошибки")}</div>`;
  const max=Math.max(1,...d.trend.map((v:Row)=>Number(v.registrations)));
  body+=`<div class="grid">${panel("Регистрации по дням",d.trend.length?`<div class="chart" role="img" aria-label="Регистрации по дням">${d.trend.map((v:Row)=>`<div class="bar" style="height:${Math.max(2,Number(v.registrations)/max*160)}px" title="${escape(v.day)}: ${escape(v.registrations)}"></div>`).join("")}</div><details><summary>Данные графика</summary>${tbl(d.trend,["day","registrations"])}</details>`:'<p class="muted">Нет регистраций за период.</p>')}${panel("Требует внимания",`<p><a href="/lawyers?status=pending_review">Профессиональные заявки: ${pending}</a></p><p><a href="/support?status=open">Обращения: ${value(d.attention.tickets)}</a></p><p><a href="/system">Ошибки доставки: ${value(d.attention.failed_deliveries)}</a></p>`)}</div>`+panel("Посещения",`<p class="small">${escape(d.traffic.message)}</p>`+tbl(d.traffic.totals,["application","visitors","sessions","page_views"]))+panel("Финансы по валютам",`<a href="/finance">Открыть финансовый раздел</a>`+tbl(d.financial.metrics,["currency","gross_received_minor","mrr_minor","paying_workspaces"]));
 }else if(root==="users"&&section==="users")body=filter(url,["individual","entrepreneur","business","lawyer"],true)+`<p class="muted">Найдено: ${value(d.total)}</p><a class="button" href="/api/users/export${escape(url.search)}">Экспорт CSV (до 10 000 записей)</a>`+panel("Реестр",tbl(d.users,["full_name","email","phone","account_type","created_at","blocked","last_activity","subscription"],{key:"full_name",path:"/users/"})+paginate(url,d.page,d.page*25<d.total));
 else if(root==="users"){
  const u=d.user;body=`<p class="muted">${escape(u.id)} · ${value(u.lifecycle_status)} · ${u.blocked?"Заблокирован":"Доступ разрешён"}</p>`+panel("Профиль",`<form method="post">${h}<input name="action" type="hidden" value="edit"><div class="details">${["full_name","first_name","last_name","middle_name","email","phone","birth_date","locale","account_type","theme_preference","company_name","organization_role","primary_goal","timezone","registered_address","id_document_type","id_document_number","id_issued_by","id_issue_date","pinfl"].map(k=>`<label>${escape(labels[k])}<input name="field:${k}" value="${escape(u[k])}"${k==="email"?' type="email" required':""} maxlength="2000"></label>`).join("")}</div><p class="small">Смена контакта сбрасывает его подтверждение. Административные права здесь не назначаются.</p><button>Сохранить профиль</button></form>`);
  body+=`<div class="grid">${panel("Доступ",`<form method="post">${h}<input name="action" type="hidden" value="${u.blocked?"unblock":"block"}"><label>Причина<textarea name="reason" required maxlength="4000"></textarea></label><button class="${u.blocked?"":"danger"}">${u.blocked?"Разблокировать":"Заблокировать и прекратить сеансы"}</button></form>`)}${panel("Служебная заметка",`<form method="post">${h}<input name="action" type="hidden" value="note"><label>Только для администратора<textarea name="reason" required maxlength="4000"></textarea></label><button>Добавить</button></form>${tbl(d.notes,["body","created_at"])}`)}</div>`+panel("Профессиональные профили",tbl(d.profiles,["display_name","status","marketplace_status"]))+panel("Подписки",tbl(d.subscriptions,["plan_code","status","current_period_ends_at"]))+panel("Платежи",tbl(d.payments,["amount_minor","currency","status","created_at"]))+panel("Обращения",tbl(d.tickets,["subject","status","created_at"],{key:"subject",path:"/support/"}));
  body+=panel("Удаление аккаунта",`<p>JURO удалит или обезличит персональные данные и частные файлы через существующий механизм удаления. Финансовые записи и минимальный журнал сохраняются. При зависимостях, требующих передачи рабочего пространства, удаление будет остановлено с указанием причины.</p><form method="post">${h}<input type="hidden" name="action" value="delete"><label>Причина<textarea name="reason" required maxlength="4000"></textarea></label><label>Подтвердите удаление: введите ID пользователя<input name="confirmation" required pattern="${escape(u.id)}" autocomplete="off"></label><button class="danger">Удалить и обезличить данные</button></form>`);
 }else if(root==="finance")body=periods(url)+(d.integration.state!=="connected"?`<p class="notice">${escape(d.integration.message)}</p>`:"")+panel("Платежи",tbl(d.payments,["id","workspace_id","subscription_id","amount_minor","currency","status","provider_payment_id","created_at"])+paginate(url,d.page,d.payments.length===25))+panel("Подписки",tbl(d.subscriptions,["id","plan_code","status","provider","billing_period","current_period_ends_at","cancel_at_period_end"]))+panel("Платежи по валюте и статусу",tbl(d.totals,["currency","status","amount_minor","count"]))+panel("Финансовые показатели",tbl(d.metrics,["currency","gross_received_minor","refunded_minor","net_after_recorded_refunds_minor","mrr_minor","arr_minor","arpu_minor","arppu_minor","paying_workspaces","paying_users","payment_conversion","subscriber_churn","revenue_churn","recognized_revenue_minor","provider_fees_minor"]))+panel("Состояния и переходы подписок",tbl(d.subscribers,["status","plan_code","count","expiring"])+`<p class="small">История состояний: ${escape(d.historyStartedAt??"нет данных")}</p>`+tbl(d.transitions,["subscription_id","status","plan_code","recorded_at"]))+panel("Проведённые финансовые записи",tbl(d.ledger,["currency","code","debit_net_minor","entries"]))+panel("Расходы AI",`<p>Оценка, микро USD: ${value(d.ai.estimated_cost_microusd)}</p><p class="small">Расходы остальных направлений не учтены.</p>`)+panel("Регулярная выручка",tbl(d.mrr,["currency","mrr_minor"])+Object.values(d.definitions).map(v=>`<p class="small">${escape(v)}</p>`).join(""));
 else if(root==="analytics")body=periods(url)+panel("Завершённые регистрации",'<p class="small">Сохранённые профили без незавершённой регистрации. Запрос кода не учитывается.</p>'+tbl(d.registrations,["day","account_type","count"]))+panel("Использование AI-функций",tbl(d.features,["feature","status","runs","users"]))+panel("Посещаемость и воронки",`<p class="notice">Посещаемость собирается после согласия посетителя. История до подключения недоступна.</p><p class="muted">Событийные воронки и окно расчёта приведены ниже.</p>`);
 else if(root==="ai"){
  body=periods(url)+panel("Использование",'<p class="small">Стоимость — оценка из журнала запросов, микро USD (1 USD = 1 000 000); это не счёт провайдера.</p>'+tbl(d.summary,["provider","model","status","requests","users","input_tokens","output_tokens","estimated_cost_microusd","average_latency_ms"]))+panel("Технический журнал",tbl(d.runs,["id","provider","model","status","latency_ms","error_code","created_at"])+paginate(url,d.page,d.runs.length===25));
  body+=`<div class="grid">${panel("Бюджет провайдера",`<form method="post">${h}<input name="endpoint" type="hidden" value="ai/budget"><label>Провайдер<select name="provider"><option>openai</option><option>anthropic</option></select></label><label>Дневной бюджет, USD<input name="budget" type="number" min="0.01" step="0.01" required></label><label>Порог ошибок<input name="failures" type="number" min="2" max="100000" value="10" required></label><label>Окно, минуты<input name="window" type="number" min="1" max="1440" value="15" required></label><button>Применить к backend</button></form>`)}${panel("Доступность провайдера",`<form method="post">${h}<input name="endpoint" type="hidden" value="ai/circuit"><label>Провайдер<select name="provider"><option>openai</option><option>anthropic</option></select></label><label>Режим<select name="state"><option value="open">Остановить запросы</option><option value="closed">Возобновить запросы</option></select></label><button>Применить</button></form><p class="small">Действует через существующую серверную защиту провайдеров.</p>`)}</div>`+panel("Текущая маршрутизация",`<dl>${Object.entries(d.settings.current).filter(([k])=>/Model|Tone|version|source/.test(k)).map(([k,v])=>`<dt>${escape(k)}</dt><dd>${value(v)}</dd>`).join("")}</dl>`);
  const settingForm=(settings:Record<string,unknown>,instructions:string,caption:string)=>`<form method="post">${h}<input name="endpoint" type="hidden" value="ai/settings"><input name="expectedVersion" type="hidden" value="${escape(d.history[0]?.version??0)}"><div class="details">${[["openaiChatModel","Чат OpenAI","openai"],["openaiDeepModel","Глубокий анализ OpenAI","openai"],["anthropicChatFallbackModel","Резервный чат Anthropic","anthropic"],["anthropicDocumentModel","Документы Anthropic","anthropic"],["openaiDocumentFallbackModel","Резервные документы OpenAI","openai"]].map(([k,label,provider])=>`<label>${label}<select name="${k}">${d.settings.allowlist[provider!].map((model:string)=>`<option${settings[k!]===model?" selected":""}>${escape(model)}</option>`).join("")}</select></label>`).join("")}<label>Стиль ответа<select name="responseTone">${["clear","formal","concise"].map(t=>`<option${settings.responseTone===t?" selected":""}>${t}</option>`).join("")}</select></label></div><label>Дополнительные системные инструкции<textarea name="systemInstructions" maxlength="16000">${escape(instructions)}</textarea></label><label>Причина изменения<input name="reason" minlength="10" maxlength="500" required></label><div class="actions"><button name="apply" value="false">Сохранить черновик</button><button name="apply" value="true">${caption}</button></div></form>`;
  body+=panel("Маршрутизация и системные инструкции",settingForm(d.settings.current,d.settings.current.systemInstructions??"","Применить к backend"));
  body+=panel("Версии и возврат",d.history.map((ver:Row)=>`<details><summary>Версия ${escape(ver.version)} · ${value(ver.created_at)} · ${ver.applied_at?"Применена":"Черновик"}</summary>${settingForm(ver.settings as Row,String(ver.system_instructions),"Применить эту версию")}</details>`).join("")||'<p class="muted">Административных версий пока нет.</p>');
 }else if(root==="documents"&&section==="documents")body=filter(url)+panel("Конструктор документов",tbl(d.registry,["key","category","active","version"],{key:"key",path:"/documents/"})+paginate(url,d.page,d.page*25<d.registryTotal))+panel("Статистика библиотеки",'<p class="small">Частные документы пользователей здесь не отображаются.</p>'+tbl(d.templates,["key","category","active","documents","generated","updated_at"])+paginate(url,d.page,d.templates.length===25))+panel("Новый шаблон",'<form action="/documents/new" method="get"><label>Семизначный код<input name="code" pattern="[0-9]{7}" required></label><button>Создать</button></form>')+panel("Категории",`<form method="post">${h}<input name="categoryAction" value="save" type="hidden"><label>Адрес категории<input name="slug" pattern="[a-z0-9-]+" required></label><label>Русский<input name="titleRu" required></label><label>Узбекский<input name="titleUz" required></label><label>Порядок<input name="position" type="number" value="0" min="0"></label><label><input name="active" type="checkbox" checked> Активна</label><button>Сохранить категорию</button></form>`);
 else if(root==="documents"){
  const def=d.definition;
  body=panel("Версии",d.versions.map((v:Row)=>`<div class="actions"><span>${escape(v.version)} · ${value(v.created_at)} · ${v.published_at?"Опубликовано":"Черновик"}</span><form method="post">${h}<input type="hidden" name="versionId" value="${escape(v.id)}"><button name="action" value="publish">Опубликовать / вернуть эту версию</button></form></div>`).join("")||'<p class="muted">Административных версий пока нет.</p>');
  body+=panel("Описание, вопросы и текст",`<form method="post">${h}<input name="action" value="save_draft" type="hidden"><input type="hidden" name="definition" value="${escape(JSON.stringify(def))}"><div class="details"><label>Название на русском<input name="titleRu" value="${escape(def.titleRu)}" required maxlength="300"></label><label>Название на узбекском<input name="titleUz" value="${escape(def.titleUz)}" required maxlength="300"></label><label>Категория<input name="categorySlug" value="${escape(def.categorySlug)}" required></label><label>Доступность<select name="status">${[["draft","Черновик"],["published","Опубликован"],["archived","Архив"]].map(([key,label])=>`<option value="${key}"${def.status===key?" selected":""}>${label}</option>`).join("")}</select></label></div><label>Тарифы через запятую (пусто — все)<input name="allowedPlans" value="${escape((def.allowedPlans??[]).join(","))}"></label><label>Описание на русском<textarea name="descriptionRu">${escape(def.descriptionRu)}</textarea></label><label>Описание на узбекском<textarea name="descriptionUz">${escape(def.descriptionUz)}</textarea></label><h3>Вопросы конструктора</h3>${def.questionnaire.map((step:any,si:number)=>`<details><summary>${escape(step.title.ru)}</summary>${step.fields.map((field:any,fi:number)=>`<fieldset style="border:1px solid var(--line);padding:16px;margin:12px 0"><legend>${escape(field.id)} · ${escape(field.type)}</legend><div class="details"><label>Вопрос на русском<input name="question:${si}:${fi}:ru" value="${escape(field.label.ru)}" required></label><label>Вопрос на узбекском<input name="question:${si}:${fi}:uz" value="${escape(field.label.uz)}" required></label></div><label><span><input type="checkbox" name="question:${si}:${fi}:required"${field.required?" checked":""}> Обязательно заполнить</span></label><div class="details"><label>Показывать при условии: ID поля<input name="question:${si}:${fi}:condition" value="${escape(field.condition?.field)}"></label><label>Условие<select name="question:${si}:${fi}:operator">${["equals","not-equals","includes","truthy","falsy","filled","empty"].map(o=>`<option${field.condition?.operator===o?" selected":""}>${o}</option>`).join("")}</select></label><label>Значение<input name="question:${si}:${fi}:value" value="${escape(field.condition?.value)}"></label></div></fieldset>`).join("")}</details>`).join("")}<details><summary>Добавить вопрос</summary><div class="details"><label>ID нового поля<input name="newFieldId" pattern="[-a-zA-Z0-9_.]+"></label><label>Тип<select name="newFieldType">${["short-text","long-text","date","number","money","email","phone"].map(v=>`<option>${v}</option>`).join("")}</select></label><label>Шаг<select name="stepIndex">${def.questionnaire.length?def.questionnaire.map((st:any,i:number)=>`<option value="${i}">${escape(st.title.ru)}</option>`).join(""):'<option value="0">Первый шаг</option>'}</select></label><label>На русском<input name="newFieldRu"></label><label>На узбекском<input name="newFieldUz"></label><label><span><input name="newFieldRequired" type="checkbox"> Обязательный</span></label></div></details><details><summary>Юридический текст шаблона</summary><p class="small">Существующее содержание изменяется только явно введёнными вами значениями.</p><label>Новый абзац на русском<textarea name="newParagraphRu"></textarea></label><label>Новый абзац на узбекском<textarea name="newParagraphUz"></textarea></label>${def.generationSchema.paragraphs.map((p:any,i:number)=>`<label>${escape(p.id)} · Русский<textarea name="paragraph:${i}:ru">${escape(p.text.ru)}</textarea></label><label>Узбекский<textarea name="paragraph:${i}:uz">${escape(p.text.uz)}</textarea></label>`).join("")}</details><button>Сохранить новую версию</button></form>`);
  body+=panel("Тестовое заполнение",d.versions.length?`<form method="post">${h}<label>Сохранённая версия<select name="versionId">${d.versions.map((v:Row)=>`<option value="${escape(v.id)}">${escape(v.version)}</option>`).join("")}</select></label><div class="details">${def.questionnaire.flatMap((st:any)=>st.fields).map((f:any)=>`<label>${escape(f.label.ru)}<input name="test:${escape(f.id)}"></label>`).join("")}</div><button name="action" value="preview">Предпросмотр сформированного текста</button></form>${notice.startsWith("PREVIEW:")?`<pre>${escape(notice.slice(8))}</pre>`:""}`:'<p class="muted">Сначала сохраните версию.</p>');
 }
 else if(root==="support"&&section==="support")body=filter(url,["open","in_progress","resolved","closed"])+panel("Обращения",tbl(d.tickets,["subject","category","severity","status","full_name","created_at"],{key:"subject",path:"/support/"})+paginate(url,d.page,d.tickets.length===25));
 else if(root==="support"){
  if(!d.ticket)return page(env.APP_ENV,"Обращение не найдено","<p>Запись недоступна.</p>");
  body=`<p>${escape(d.ticket.subject)} · ${value(d.ticket.status)}</p>`+panel("Переписка",tbl(d.messages,["author_type","body","created_at"]));
  body+=`<div class="grid">${panel("Ответ пользователю",`<form method="post">${h}<input name="action" type="hidden" value="reply"><label>Публичный ответ<textarea name="body" required maxlength="4000"></textarea></label><button>Отправить внутри JURO</button></form>`)}${panel("Внутренняя заметка",`<form method="post">${h}<input name="action" type="hidden" value="note"><label>Не видна пользователю<textarea name="body" required maxlength="4000"></textarea></label><button>Сохранить</button></form>${tbl(d.notes,["body","created_at"])}`)}</div>`+panel("Статус",`<form method="post">${h}<input name="action" type="hidden" value="status"><label>Обработка<select name="body">${["open","in_progress","resolved","closed"].map(s=>`<option value="${s}"${s===d.ticket.status?" selected":""}>${value(s)}</option>`).join("")}</select></label><button>Изменить статус</button></form>`);
 }else if(root==="system")body=panel("Интеграции",`<dl>${Object.entries(d.integrations).map(([k,v])=>`<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join("")}</dl>`)+panel("Доставка уведомлений",tbl(d.delivery,["subject","status","attempts","last_error","created_at"])+d.delivery.filter((v:Row)=>v.status==="failed").map((v:Row)=>`<form method="post">${h}<input name="id" type="hidden" value="${escape(v.id)}"><button>Повторить: ${escape(v.subject)}</button></form>`).join(""))+panel("Журнал действий",tbl(d.audit,["created_at","actor_email","action","entity_type","entity_id"])+paginate(url,d.page,d.audit.length===25));
 else if(root==="notifications")body=panel("Требует внимания",d.notifications.length?d.notifications.map((v:Row)=>`<p><span class="badge">${escape(v.type)}</span> <a href="${v.type==='professional'?'/lawyers/'+encodeURIComponent(String(v.id)):v.type==='support'?'/support/'+encodeURIComponent(String(v.id)):'/system'}">${escape(v.title)}</a> · ${value(v.created_at)}</p>`).join(''):'<p class="muted">Новых задач нет.</p>');
 else if(root==="search")body=filter(url)+panel("Результаты",d.results.length?d.results.map((v:Row)=>`<p><span class="badge">${escape(v.type)}</span> <a href="${v.type==="user"?"/users/"+encodeURIComponent(String(v.id)):v.type==="support"?"/support/"+encodeURIComponent(String(v.id)):v.type==="professional"?"/lawyers/"+encodeURIComponent(String(v.id)):"/documents"}">${escape(v.title)}</a></p>`).join(""):'<p class="muted">Введите не менее двух символов. Совпадений пока нет.</p>');
 else if(root==="site-content"){
  if(section==="site-content")body=`<a class="button" href="/site-content/new">Создать материал</a>`+panel("Материалы сайта",table(d.items,["title","kind","locale","slug","position","published_version_id"],{key:"title",path:"/site-content/"}));
  else{
   const v=d.versions[0]??{},item={...(d.item??{}),...(v.slug?{slug:v.slug,locale:v.locale,kind:v.kind,position:v.position}:{})};
   body=panel("Редактор материала",`<form method="post">${h}<input name="action" value="save_draft" type="hidden"><input name="id" value="${escape(item.id)}" type="hidden"><div class="details"><label>Тип<select name="kind">${[["faq","FAQ"],["news","Новость"],["page","Страница"]].map(([k,l])=>`<option value="${k}"${item.kind===k?" selected":""}>${l}</option>`).join("")}</select></label><label>Язык<select name="locale">${["ru","uz","en"].map(l=>`<option${item.locale===l?" selected":""}>${l}</option>`).join("")}</select></label><label>Адрес (slug)<input name="slug" pattern="[a-z0-9-]+" required maxlength="120" value="${escape(item.slug)}"></label><label>Порядок<input name="position" type="number" min="0" max="10000" value="${escape(item.position??0)}" required></label></div><label>Заголовок / вопрос<input name="title" value="${escape(v.title)}" required maxlength="300"></label><label>Описание<textarea name="description" maxlength="500">${escape(v.description)}</textarea></label><label>Текст / ответ<textarea name="body" maxlength="20000" style="min-height:240px">${escape(v.body)}</textarea></label><label>Изображение (путь к существующему файлу)<input name="image" value="${escape(v.image)}" pattern="/[-a-zA-Z0-9/_.]+"></label><label>SEO-заголовок<input name="seoTitle" value="${escape(v.seo_title)}" maxlength="300"></label><label>SEO-описание<textarea name="seoDescription" maxlength="500">${escape(v.seo_description)}</textarea></label><button>Сохранить новую версию</button></form>`);
   body+=panel("Предпросмотр",`<h3>${escape(v.title)}</h3><p>${escape(v.description)}</p><div class="review-body">${escape(v.body)}</div>`);
   body+=panel("История и публикация",d.versions.map((ver:Row)=>`<div class="actions"><span>${value(ver.created_at)} · ${escape(ver.title)} ${item.published_version_id===ver.id?"· Опубликовано":""}</span><form method="post">${h}<input name="action" value="publish" type="hidden"><input name="id" value="${escape(item.id)}" type="hidden"><input name="versionId" value="${escape(ver.id)}" type="hidden"><button>Опубликовать эту версию</button></form></div>`).join("")+(item.id?`<form method="post">${h}<input name="action" value="unpublish" type="hidden"><input name="id" value="${escape(item.id)}" type="hidden"><button>Снять с публикации</button></form>`:""));
  }
 }
 else if(root==="content"){
  body='<div class="actions"><a class="button" href="/site-content">FAQ, новости и страницы сайта</a></div>'+(Array.isArray(d)?panel("База знаний JURO",tbl(d,["titleRu","slug","category","status"],{key:"titleRu",path:"/content/"})):panel("Версии материала",tbl(d.versions??[],["versionId","versionNumber","titleRu","publishedAt"])));
  const version=d.versions?.[0];const content={slug:d.slug??"",category:d.category??"general",titleRu:version?.titleRu??"",titleUz:version?.titleUz??"",titleEn:version?.titleEn??null,summaryRu:version?.summaryRu??"",summaryUz:version?.summaryUz??"",summaryEn:version?.summaryEn??null,bodyRu:version?.bodyRu??[{heading:"Материал",paragraphs:[""]}],bodyUz:version?.bodyUz??[{heading:"Material",paragraphs:[""]}],bodyEn:version?.bodyEn??null,relatedSlugs:version?.relatedSlugs??[]};
  body+=panel("Редактор материала",`<form method="post">${h}<input name="action" value="save_draft" type="hidden"><input name="articleId" value="${escape(d.articleId??"")}" type="hidden"><input name="content" value="${escape(JSON.stringify(content))}" type="hidden">${[["slug","Адрес материала"],["category","Категория"],["titleRu","Название на русском"],["titleUz","Название на узбекском"],["titleEn","Название на английском"],["summaryRu","Описание на русском"],["summaryUz","Описание на узбекском"],["summaryEn","Описание на английском"]].map(([key,label])=>`<label>${label}<input name="${key}" value="${escape((content as any)[key])}"${key.endsWith("En")?"":" required"}></label>`).join("")}${["Ru","Uz","En"].map(language=>((content as any)["body"+language]??[]).map((block:any,i:number)=>`<label>Заголовок блока · ${language}<input name="body:${language}:${i}:heading" value="${escape(block.heading)}"></label><label>Абзацы · ${language}<textarea name="body:${language}:${i}:paragraphs">${escape(block.paragraphs.join("\n\n"))}</textarea></label>`).join("")).join("")}<p class="small">Разделяйте абзацы пустой строкой. Сохранение создаёт черновик.</p><button>Сохранить версию</button></form>`);
  if(d.articleId)body+=panel("Публикация",(d.versions??[]).map((v:any)=>`<form method="post" class="actions">${h}<input name="articleId" value="${escape(d.articleId)}" type="hidden"><input name="versionId" value="${escape(v.versionId)}" type="hidden"><input name="action" value="publish" type="hidden"><span>Версия ${escape(v.versionNumber)} · ${escape(v.titleRu)}</span><button>Опубликовать</button></form>`).join("")+`<form method="post">${h}<input name="articleId" value="${escape(d.articleId)}" type="hidden"><input name="action" value="set_status" type="hidden"><button class="danger">Снять с публикации</button></form>`);
 }
 if(root==="system"){
  const settings=new Map(d.settings.map((row:Row)=>[row.key,row.value]));
  body+=panel("Доступность функций",Object.entries(d.features).map(([key,label])=>`<form method="post" class="actions">${h}<input name="key" type="hidden" value="feature.${escape(key)}"><label>${escape(label)}<select name="value"><option value="true"${settings.get('feature.'+key)!==false?" selected":""}>Доступна</option><option value="false"${settings.get('feature.'+key)===false?" selected":""}>Остановлена</option></select></label><button>Применить</button></form>`).join(""));
  body+=panel("Лимит AI",`<p class="small">Глобальный защитный потолок запросов на пользователя за месяц. Он ограничивает существующий лимит тарифа, коммерческие условия не изменяются.</p><form method="post">${h}<input type="hidden" name="key" value="ai.max_monthly_cycles"><label>Потолок запросов<input name="value" type="number" min="1" max="100000" required value="${escape(settings.get('ai.max_monthly_cycles')??'')}"></label><button>Применить</button></form>`);
 }
 if(root==="analytics") {
  body+=panel("Сегменты и окно конверсии",`<form class="filters">${["period","since","until"].map(k=>`<input type="hidden" name="${k}" value="${escape(url.searchParams.get(k))}">`).join("")}<label>Приложение<select name="application"><option value="">Все отдельно</option>${["website","app","lawyer"].map(k=>`<option${url.searchParams.get("application")===k?" selected":""}>${k}</option>`).join("")}</select></label>${[["source","Источник"],["account_type","Тип аккаунта"],["device","Устройство"],["plan_code","Тариф"]].map(([k,l])=>`<label>${l}<input name="${k}" value="${escape(url.searchParams.get(k))}"></label>`).join("")}<label>Окно, дней<input name="window" type="number" min="1" max="90" value="${escape(url.searchParams.get("window")??30)}"></label><button>Применить</button></form>`);
  const funnels=await platform<any>(env,`/api/internal/admin/control/funnels${url.search}`,{session});
  if(funnels.response.ok&&funnels.body){const f=funnels.body;body+=panel("Последовательные воронки",Object.values(f.definitions).map(v=>`<p class="small">${escape(v)}</p>`).join("")+`<p>Начало событий: ${escape(f.collectionStartedAt??"событий пока нет")}</p>`+tbl(f.funnel,["application","visits","registration_started","registered","first_use","repeated","paid","immature"]))+panel("Удержание по когортам",tbl(f.cohorts,["cohort","registrations","mature_week_two","retained_week_two","mature_week_five","retained_week_five","retention_week_two","retention_week_five"]))+panel("Подача → рассмотрение → подтверждение → публикация → обращение",tbl(f.professionals,["submitted","reviewed","approved","published","first_consultation"]));}
  const product=await platform<any>(env,`/api/internal/admin/control/product${url.search}`,{session});
  if(product.response.ok&&product.body)body+=panel("Использование продукта",tbl(product.body.features,["feature","status","runs","users"]))+panel("Когорты и удержание AI",`<p class="small">${escape(product.body.definition)}</p>`+tbl(product.body.cohorts,["cohort","registrations","week_two_ai_users"]));
  const traffic=await platform<any>(env,`/api/internal/admin/control/traffic${url.search}`,{session});
  if(traffic.response.ok&&traffic.body){const t=traffic.body;body+=panel("Посещаемость по приложениям",`<p class="small">${escape(t.definition)}</p><p class="small">Начало сбора: ${value(t.collectionStartedAt)}</p>`+tbl(t.totals,["application","page_views","visitors","sessions"]))+panel("Популярные страницы",tbl(t.pages,["application","page","views"]))+panel("Источники и UTM",tbl(t.sources,["application","source","medium","campaign","views"]))+panel("Устройства",tbl(t.devices,["application","device","views"]));}
 }
 return page(env.APP_ENV,titles[root]??"Карточка",body,{notice:notice||(url.searchParams.has("saved")?"Изменение сохранено.":undefined)});
}

async function professionalDetail(request:Request,env:Env,session:string,id:string){
 const r=await platform<{profile:Row;decisions:Row[];details:Row;documents:Row[]}>(env,`/api/internal/admin/control/professionals/${encodeURIComponent(id)}`,{session});
 if(!r.response.ok||!r.body?.profile)return page(env.APP_ENV,"Профиль недоступен","<p>Не удалось загрузить карточку.</p>");
 const p=r.body.profile,h=`<input type="hidden" name="_csrf" value="${escape(cookie(request,ADMIN_CSRF_COOKIE)??"")}">`;
 const type=p.firm_name?"Юридическая организация / представитель":p.advocate_status!=="not_declared"?"Адвокат":"Юрист";
 const fields=["full_name","email","phone","account_type","firm_name","bio","city","region","education","experience_years","specialties_json","languages_json","profile_revision"];
 const body=`<p class="muted">${type} · ${escape(lawyerStatusLabel(String(p.marketplace_status)))}</p>`+panel("Профессиональные сведения",`<dl>${fields.map(k=>`<dt>${escape(labels[k]??({firm_name:"Организация",bio:"О себе",city:"Город",region:"Регион",education:"Образование",experience_years:"Стаж",specialties_json:"Специализации",languages_json:"Языки",profile_revision:"Редакция"} as Record<string,string>)[k]??k)}</dt><dd>${value(p[k])}</dd>`).join("")}</dl><p class="small">Проверка профиля JURO не является гарантией качества услуг.</p>`)+panel("Тип и организация",r.body.details?table([r.body.details],["professional_type","organization_name","registration_number","license_number","representatives"]):"<p>Дополнительные сведения ещё не поданы.</p>")+panel("Закрытые подтверждающие документы",r.body.documents.length?`<ul>${r.body.documents.map(v=>`<li><a href="/api/professional-files/${encodeURIComponent(String(v.id))}">${escape(v.file_name)}</a> · ${escape(v.kind)} · Редакция ${escape(v.revision)}</li>`).join("")}</ul>`:"<p>Документы ещё не приложены.</p>")+panel("История решений",table(r.body.decisions,["decision","reason","created_at"]))+(p.marketplace_status==="pending_review"?panel("Решение",`<form method="post" action="/lawyers/${encodeURIComponent(id)}/moderate">${h}<input type="hidden" name="next" value="1"><label>Причина или требуемые сведения<textarea name="reason" required maxlength="2000"></textarea></label><div class="actions"><button name="decision" value="approved">Подтвердить и перейти к следующему</button><button name="decision" value="changes_requested">Запросить информацию и перейти к следующему</button><button name="decision" value="rejected" class="danger">Отклонить и перейти к следующему</button></div></form>`):"");
 return page(env.APP_ENV,String(p.display_name),body);
}
