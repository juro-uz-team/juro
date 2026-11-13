import type { MetadataRoute } from "next";
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  if (process.env.DEPLOYMENT_ENVIRONMENT === "staging") return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/landing-test", "/lending-test"],
    },
    sitemap: "https://juro.uz/sitemap.xml",
    host: "https://juro.uz",
  };
}
