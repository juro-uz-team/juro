export function nativeAdminOrigin(environment) {
  const privateMode = environment.PRIVATE_DEVELOPMENT === "true";
  const staging = environment.DEPLOYMENT_ENVIRONMENT === "staging";
  const website = new URL(environment.PUBLIC_SITE_URL ?? (staging ? "https://staging.juro.uz" : "https://juro.uz"));
  const adminHost = `admin.${website.hostname}`;
  const fallback = privateMode ? `http://localhost:${environment.ADMIN_PORT ?? 3002}`
    : `https://${adminHost}:${staging ? 3444 : 3443}`;
  const url = new URL(environment.ADMIN_CONSOLE_ORIGIN ?? fallback);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.hostname.endsWith(".localhost");
  if ((privateMode ? !local : url.hostname !== adminHost || website.protocol !== "https:")
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || (!privateMode && url.protocol !== "https:") || !["http:", "https:"].includes(url.protocol)) {
    throw Error("Native admin requires a same-site HTTPS admin hostname (loopback HTTP is private development only)");
  }
  return url.origin;
}

export function nativeAdminRequestUrl(origin, path) {
  if (!path?.startsWith("/") || path.startsWith("//")) throw Error("Invalid admin request path");
  const url = new URL(path, origin);
  if (url.origin !== origin) throw Error("Admin request escaped its configured origin");
  return url;
}
