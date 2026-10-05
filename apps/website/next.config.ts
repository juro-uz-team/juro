import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use polling only in the local Docker stack, where host events can be lost.
  ...(process.env.LOCAL_WATCH_POLLING === "true" ? { watchOptions: { pollIntervalMs: 1000 } } : {}),
  // Keep SEO metadata in the initial <head>. The public site is consumed by
  // browsers, audit tools, and crawlers that do not all wait for React to move
  // streamed metadata out of the response body.
  htmlLimitedBots: /.*/,
};

export default nextConfig;
