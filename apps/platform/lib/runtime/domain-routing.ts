import { lawyerHostTarget } from "../../worker/lawyer-host-router";

/** Derive domain identity only after native ingress has authenticated the host. */
export function routeNativeDomain(url: URL, method: string, config: {lawyerOrigin?: string; statusOrigin?: string}) {
  const lawyerHost = url.origin === config.lawyerOrigin;
  const statusHost = url.origin === config.statusOrigin;
  const result = {url, lawyerHost, statusHost, status: 0};
  if (statusHost) {
    const asset = url.pathname.startsWith("/_next/static/")
      || /^\/(?:favicon|icon|apple-touch-icon)\.(?:png|ico)$/.test(url.pathname);
    const page = /^\/(?:status|(?:ru|uz|en)(?:\/status)?)?$/.test(url.pathname);
    if (/%(?:2f|5c|00)/i.test(url.pathname) || (!asset && !page && url.pathname !== "/api/status")) return {...result, status: 404};
    if (method !== "GET" && method !== "HEAD") return {...result, status: 405};
    const target = new URL(url);
    if (/^\/(?:ru|uz|en)$/.test(target.pathname)) target.pathname += "/status";
    else if (target.pathname === "/") {
      target.pathname = "/status";
      if (!target.searchParams.has("lang")) target.searchParams.set("lang", "uz");
    }
    return {...result, url: target};
  }
  if (lawyerHost) {
    const passthrough = ["/_next/", "/api/", "/legal/"].some(prefix => url.pathname.startsWith(prefix))
      || /\.(?:avif|css|gif|ico|jpe?g|js|json|png|svg|webp|woff2?)$/.test(url.pathname)
      || ["/signin-with-chatgpt", "/signout-with-chatgpt", "/callback"].includes(url.pathname);
    if (!passthrough) {
      const target = lawyerHostTarget(url);
      return target ? {...result, url: target} : {...result, status: 404};
    }
  }
  return result;
}
