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
  return new Response(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escaped(title)} · JURO</title><style>
    :root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#edf0f4;color:#102a43}*{box-sizing:border-box}body{margin:0}.shell{min-height:100vh;display:grid;grid-template-columns:15rem minmax(0,1fr)}aside{background:#062844;color:#fff;padding:1.5rem;display:flex;flex-direction:column;gap:1.5rem}main{max-width:92rem;width:100%;padding:2.25rem;margin:0 auto}.brand{font-weight:800;letter-spacing:.12em;color:#d8b36b}.role{font-size:.78rem;border:1px solid #7992a8;border-radius:999px;padding:.25rem .5rem;color:#e8edf2}.nav{display:grid;gap:.35rem}.nav a{color:#dbe7ef;text-decoration:none;padding:.55rem .65rem;border-radius:.45rem}.nav a:hover,.nav a:focus-visible{outline:2px solid #d8b36b;outline-offset:2px;background:#123e60}.panel{background:#fff;border:1px solid #ced7df;border-radius:.8rem;padding:1.25rem;margin:1rem 0;box-shadow:0 .2rem .9rem #0a264015}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:.8rem}.metric{padding:1rem;background:#f7f8fa;border:1px solid #dbe1e7;border-radius:.6rem}.metric strong{display:block;font-size:1.8rem}.notice{background:#fff5dc;color:#5b3a00;border-left:.25rem solid #be974f;padding:.8rem 1rem;border-radius:.4rem}.filters{display:flex;flex-wrap:wrap;gap:.45rem;margin:1rem 0}.filters a{border:1px solid #8596a5;border-radius:999px;color:#102a43;padding:.4rem .65rem;text-decoration:none}.filters a[aria-current=page]{background:#062844;border-color:#062844;color:#fff}.filters a:hover,.filters a:focus-visible{outline:3px solid #be974f;outline-offset:2px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.7rem;border-bottom:1px solid #dde4ea;vertical-align:top}button{font:inherit;background:#062844;color:#fff;border:0;border-radius:.5rem;padding:.6rem .85rem;cursor:pointer}button:hover,button:focus-visible{outline:3px solid #be974f;outline-offset:2px}input,textarea,select{font:inherit;width:100%;border:1px solid #8596a5;border-radius:.4rem;padding:.55rem}input[type=checkbox]{width:auto;margin-right:.35rem}label{display:grid;gap:.35rem;margin:.65rem 0}.actions{display:flex;gap:.5rem;flex-wrap:wrap}form.inline{display:inline}.danger{background:#812f2a}.review-body{max-width:34rem;white-space:pre-wrap;overflow-wrap:anywhere}.scroll{overflow:auto}.compact{min-width:68rem;font-size:.78rem}.code{font:600 .72rem ui-monospace,monospace;overflow-wrap:anywhere}.ok{color:#176c4c}.warn{color:#8a5a12}.flags{display:grid;grid-template-columns:repeat(auto-fit,minmax(19rem,1fr));gap:.5rem}.flags span{display:flex;justify-content:space-between;gap:.6rem;padding:.55rem;border:1px solid #dbe1e7;border-radius:.45rem}.flags code{font-size:.7rem;overflow-wrap:anywhere}.small{color:#52677a;font-size:.72rem}.corpus-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr));gap:.7rem}.corpus-actions form{padding:.75rem;border:1px solid #dbe1e7;border-radius:.55rem}.corpus-actions textarea{min-height:5rem}@media(max-width:48rem){.shell{display:block}aside{gap:.75rem}main{padding:1rem}.nav{grid-template-columns:repeat(2,minmax(0,1fr))}}</style></head><body><div class="shell"><aside><div><div class="brand">JURO ADMIN</div><p>Изолированная консоль ${environmentLabel}</p>${role}</div><nav class="nav"><a href="/">Обзор</a><a href="/lawyers">Профили юристов</a><a href="/reviews">Отзывы</a><a href="${escaped("/logout")}">Сеанс</a></nav><p>Отдельная cookie. Каждое действие журналируется.</p></aside><main><h1>${escaped(title)}</h1>${notice}${body}</main></div></body></html>`, { headers: securityHeaders() });
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
    "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; style-src 'unsafe-inline'; upgrade-insecure-requests",
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

async function consumeTicket(request: Request, env: Env): Promise<Response> {
  const ticket = new URL(request.url).searchParams.get("ticket");
  if (!ticket || !TOKEN_PATTERN.test(ticket)) return page(env.APP_ENV, "Вход недоступен", "<p>Одноразовая ссылка недействительна или уже использована.</p>");
  const result = await platform<{ token: string; csrfToken: string; expiresAt: string; roles: string[] }>(env, "/api/internal/admin/session/consume", {
    method: "POST",
    headers: { "content-type": "application/json", "x-juro-admin-origin": new URL(request.url).origin },
    body: JSON.stringify({ ticket }),
  });
  if (!result.response.ok || !result.body?.token || !result.body.csrfToken || !result.body.expiresAt) return page(env.APP_ENV, "Вход недоступен", `<p>Не удалось подтвердить отдельную admin-сессию. Обновите MFA в <a href="${escaped(env.PLATFORM_ORIGIN)}/ru/admin/console">JURO</a> и повторите переход.</p>`);
  const destination = result.body.roles?.includes("super_admin") ? "/" : "/lawyers";
  return redirect(destination, sessionCookies(result.body.token, result.body.csrfToken, result.body.expiresAt));
}

async function dashboard(request: Request, env: Env, session: string): Promise<Response> {
  const result = await platform<Dashboard>(env, "/api/internal/admin/dashboard", { session });
  if (!result.response.ok || !result.body) return redirect(`${env.PLATFORM_ORIGIN}/ru/admin/console?reason=admin-session`);
  const data = result.body;
  return page(env.APP_ENV, "Операционный обзор", `<p>Роль: ${escaped(data.roles.join(", "))}. Сеанс действует до ${escaped(data.expiresAt)}.</p><section class="metrics"><div class="metric"><span>Профили на проверке</span><strong>${data.counts.pendingLawyerProfiles}</strong></div><div class="metric"><span>Одобренные профили</span><strong>${data.counts.approvedLawyerProfiles}</strong></div><div class="metric"><span>Активные заявки</span><strong>${data.counts.activeLawyerRequests}</strong></div><div class="metric"><span>Audit events</span><strong>${data.counts.adminAuditEvents}</strong></div></section><section class="panel"><h2>Граница доступа</h2><p>Консоль использует отдельную host-only cookie и обращается к платформе только через service binding. Текущая сессия требует активный TOTP и свежую MFA исходного JURO-сеанса.</p></section>`, { role: data.roles.join(" · ") });
}

async function lawyerList(request: Request, env: Env, session: string, notice?: string): Promise<Response> {
  const selectedStatus = lawyerMarketplaceStatus(new URL(request.url).searchParams.get("status"));
  const result = await platform<{ profiles: Profile[] }>(env, `/api/internal/admin/lawyers?status=${encodeURIComponent(selectedStatus)}`, { session });
  if (!result.response.ok || !result.body) return redirect(`${env.PLATFORM_ORIGIN}/ru/admin/console?reason=admin-session`);
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
      ? `<form method="post" action="/lawyers/${encodeURIComponent(profile.id)}/moderate"><input type="hidden" name="_csrf" value="${escaped(csrfToken)}"><label>Причина<textarea name="reason" required maxlength="2000" minlength="1"></textarea></label><div class="actions"><button name="decision" value="approved">Одобрить</button><button name="decision" value="changes_requested">Запросить исправления</button><button class="danger" name="decision" value="rejected">Отклонить</button></div></form>`
      : "";
    return `<tr><td>${escaped(profile.displayName)}<br><small>${escaped(lawyerStatusLabel(profile.marketplaceStatus))}</small></td><td>${escaped(profile.city ?? "—")}</td><td>${escaped(profile.experienceYears ?? "—")}</td><td>${escaped(profile.updatedAt)}</td><td>${moderation}${lifecycleForm(profile)}</td></tr>`;
  }).join("");
  return page(env.APP_ENV, "Профили юристов", `<section class="panel"><p>Телефон и личный email не выдаются этой поверхности. Lifecycle-действия требуют отдельной причины; сервер повторно проверяет роль и свежую MFA.</p><nav class="filters" aria-label="Статус профиля">${filters}</nav><table><thead><tr><th>Профиль</th><th>Город</th><th>Стаж</th><th>Изменён</th><th>Модерация и lifecycle</th></tr></thead><tbody>${rows || `<tr><td colspan="5">Нет профилей со статусом «${escaped(lawyerStatusLabel(selectedStatus))}».</td></tr>`}</tbody></table></section>`, { notice, role: "lawyer moderation" });
}

async function moderate(request: Request, env: Env, session: string, profileId: string): Promise<Response> {
  if (!await csrf(request)) return page(env.APP_ENV, "Запрос отклонён", "<p>Проверка происхождения или CSRF не пройдена.</p>");
  const form = await request.formData();
  const decision = form.get("decision"); const reason = form.get("reason");
  if ((decision !== "approved" && decision !== "changes_requested" && decision !== "rejected") || typeof reason !== "string" || reason.trim().length < 1 || reason.trim().length > 2_000) return lawyerList(request, env, session, "Проверьте решение и причину.");
  const result = await platform<{ ok: boolean }>(env, `/api/internal/admin/lawyers/${encodeURIComponent(profileId)}/moderate`, {
    method: "POST", session, headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, reason: reason.trim() }),
  });
  return lawyerList(request, env, session, result.response.ok && result.body?.ok ? "Решение сохранено и записано в audit." : "Профиль изменился или решение нельзя применить.");
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
  if (result.response.status === 403) return lawyerList(request, env, session, "Недостаточно роли или MFA устарела. Обновите MFA и повторите действие.");
  if (result.body?.code === "PROFILE_STATE_CONFLICT") return lawyerList(request, env, session, "Профиль уже изменился. Обновите список и проверьте текущий статус.");
  return lawyerList(request, env, session, "Lifecycle-действие сейчас недоступно.");
}

async function reviewList(request: Request, env: Env, session: string, notice?: string): Promise<Response> {
  const result = await platform<{ reviews: Review[] }>(env, "/api/internal/admin/reviews?status=pending&limit=50", { session });
  if (!result.response.ok || !result.body) return redirect(`${env.PLATFORM_ORIGIN}/ru/admin/console?reason=admin-session`);
  const csrfToken = cookie(request, ADMIN_CSRF_COOKIE) ?? "";
  const rows = result.body.reviews.map((review) => `<tr><td>${escaped(review.lawyerName)}<br><small>${escaped(review.createdAt)}</small></td><td>${escaped(`${review.overallRating}/5`)}<br><small>Скорость ${escaped(review.speedRating)}, качество ${escaped(review.qualityRating)}, коммуникация ${escaped(review.communicationRating)}</small></td><td class="review-body">${escaped(review.body ?? "Без текста")}</td><td><form method="post" action="/reviews/${encodeURIComponent(review.id)}/moderate"><input type="hidden" name="_csrf" value="${escaped(csrfToken)}"><label>Редакция без персональных данных<textarea name="moderatedBody" maxlength="2000"></textarea></label><label>Причина<textarea name="reason" required maxlength="2000" minlength="1"></textarea></label><div class="actions"><button name="decision" value="approved">Одобрить</button><button class="danger" name="decision" value="rejected">Отклонить</button></div></form></td></tr>`).join("");
  return page(env.APP_ENV, "Модерация отзывов", `<section class="panel"><p>Отзыв публикуется только после проверки. При обнаружении контактов одобрение отклоняется, пока текст не будет отредактирован.</p><table><thead><tr><th>Юрист</th><th>Оценка</th><th>Отзыв</th><th>Решение</th></tr></thead><tbody>${rows || "<tr><td colspan=\"4\">Нет отзывов на проверке.</td></tr>"}</tbody></table></section>`, { notice, role: "lawyer moderation" });
}

async function moderateReview(request: Request, env: Env, session: string, reviewId: string): Promise<Response> {
  if (!await csrf(request)) return page(env.APP_ENV, "Запрос отклонён", "<p>Проверка происхождения или CSRF не пройдена.</p>");
  const form = await request.formData();
  const decision = form.get("decision"); const reason = form.get("reason"); const rawModeratedBody = form.get("moderatedBody");
  const moderatedBody = typeof rawModeratedBody === "string" && rawModeratedBody.trim() ? rawModeratedBody.trim() : undefined;
  if ((decision !== "approved" && decision !== "rejected") || typeof reason !== "string" || reason.trim().length < 1 || reason.trim().length > 2_000 || (moderatedBody !== undefined && moderatedBody.length > 2_000)) return reviewList(request, env, session, "Проверьте решение, текст и причину.");
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
      if (request.method === "GET" && url.pathname === "/auth/handoff") return consumeTicket(request, env);
      if (request.method === "GET" && url.pathname === "/logout") return page(env.APP_ENV, "Выход", `<form method="post" action="/logout"><input type="hidden" name="_csrf" value="${escaped(cookie(request, ADMIN_CSRF_COOKIE) ?? "")}"><button>Завершить admin-сеанс</button></form>`);
      if (request.method === "POST" && url.pathname === "/logout") {
        if (!await csrf(request)) return page(env.APP_ENV, "Запрос отклонён", "<p>CSRF не пройдена.</p>");
        const session = cookie(request, ADMIN_SESSION_COOKIE);
        if (session) {
          await platform<{ ok: boolean }>(env, "/api/internal/admin/session/logout", { method: "POST", session });
        }
        return redirect(`${env.PLATFORM_ORIGIN}/ru/admin/console`, clearCookies());
      }
      const session = cookie(request, ADMIN_SESSION_COOKIE);
      if (!session) return redirect(`${env.PLATFORM_ORIGIN}/ru/admin/console?reason=admin-session`);
      if (request.method === "GET" && url.pathname === "/") return dashboard(request, env, session);
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
      console.error(JSON.stringify({ event: "admin.request_failed", path: url.pathname, message: error instanceof Error ? error.message : "unknown" }));
      return page(env.APP_ENV, "Временно недоступно", "<p>Защищённая операция не выполнена. Повторите позже или обновите MFA.</p>");
    }
  },
} satisfies { fetch(request: Request, env: Env): Promise<Response> };

function profileIdValid(value: string | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}
