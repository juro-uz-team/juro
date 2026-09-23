/** HTTP administration is restricted to the explicitly private local deployment. */
export function validAdminOrigin(url: URL, environment: unknown): boolean {
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return false;
  if (url.protocol === "https:") return true;
  return environment === "development" && process.env.PRIVATE_DEVELOPMENT === "true"
    && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)
    && Boolean(url.port);
}
