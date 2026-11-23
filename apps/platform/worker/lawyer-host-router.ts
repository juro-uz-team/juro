const lawyerPageMap: Record<string, { module: string; view?: string }> = {
  dashboard: { module: "dashboard" },
  requests: { module: "consultations", view: "requests" },
  consultations: { module: "consultations", view: "schedule" },
  clients: { module: "consultations", view: "clients" },
  matters: { module: "consultations", view: "matters" },
  calendar: { module: "calendar" },
  messages: { module: "consultations", view: "messages" },
  documents: { module: "consultations", view: "documents" },
  tasks: { module: "consultations", view: "tasks" },
  application: { module: "profile" },
  status: { module: "profile" },
  profile: { module: "profile" },
  settings: { module: "settings" },
};

export function lawyerHostTarget(url: URL): URL | null {
  const target = new URL(url);
  if (url.pathname === "/") {
    target.pathname = "/ru/auth/login";
    target.searchParams.set("accountType", "lawyer");
    return target;
  }
  const auth = url.pathname.match(/^\/(?:(ru|uz|en)\/)?(login|register|verify)\/?$/u);
  if (auth) {
    const locale = auth[1] || "ru";
    const action = auth[2] === "verify" ? "login" : auth[2];
    target.pathname = `/${locale}/auth/${action}`;
    target.searchParams.set("accountType", "lawyer");
    return target;
  }
  if (/^\/(?:ru|uz|en)\/auth\/(?:login|register)\/?$/u.test(url.pathname)) {
    target.searchParams.set("accountType", "lawyer");
    return target;
  }
  const staleIndividualDashboard = url.pathname.match(
    /^\/(ru|uz|en)\/individual\/dashboard\/?$/u,
  );
  if (staleIndividualDashboard) {
    target.pathname = `/${staleIndividualDashboard[1]}/lawyer/dashboard`;
    return target;
  }
  const onboarding = url.pathname.match(/^\/(?:(ru|uz|en)\/)?onboarding\/?$/u);
  if (onboarding) {
    target.pathname = `/${onboarding[1] || "ru"}/onboarding`;
    return target;
  }
  const clean = url.pathname.match(/^\/(ru|uz|en)(?:\/([^/]+))?\/?$/u);
  if (clean) {
    const locale = clean[1];
    const page = clean[2] || "dashboard";
    const mapped = lawyerPageMap[page];
    if (!mapped) return null;
    target.pathname = `/${locale}/lawyer/${mapped.module}`;
    if (mapped.view) target.searchParams.set("view", mapped.view);
    return target;
  }
  const unprefixed = url.pathname.match(/^\/([^/]+)\/?$/u);
  if (unprefixed) {
    const mapped = lawyerPageMap[unprefixed[1]];
    if (!mapped) return null;
    target.pathname = `/ru/lawyer/${mapped.module}`;
    if (mapped.view) target.searchParams.set("view", mapped.view);
    return target;
  }
  if (/^\/(?:ru|uz|en)\/(?:lawyer(?:\/|$)|workspace\/[a-z-]+$)/u.test(url.pathname)) return target;
  return null;
}
