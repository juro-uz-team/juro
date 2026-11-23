const LOCAL_ORIGIN = "https://app.juro.uz";

export function safeAuthReturnPath(value?: string): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 2048 || value.startsWith("//")) return null;
  try {
    const url = new URL(value, LOCAL_ORIGIN);
    if (url.origin !== LOCAL_ORIGIN || /%(?:2f|5c|00)/iu.test(url.pathname)) return null;
    const pathname = decodeURIComponent(url.pathname);
    if (/^\/(?:\/|api(?:\/|$))/iu.test(pathname)) return null;
    if (/^\/(?:signin-with-chatgpt|signout-with-chatgpt|callback)\/?$/iu.test(pathname)) return null;
    if (/^\/(?:(?:ru|uz|en)\/(?:auth\/)?)?(?:login|register)\/?$/iu.test(pathname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function authReturnDestination(defaultDestination: string, returnTo?: string): string {
  const path = safeAuthReturnPath(returnTo);
  if (!path) return defaultDestination;
  if (defaultDestination.startsWith("/")) return path;

  // Workspace entries resolve permissions on either application host after handoff.
  if (!/^\/(?:ru|uz|en)\/workspace\/[a-z-]+$/u.test(path)) return defaultDestination;
  return new URL(path, defaultDestination).href;
}
