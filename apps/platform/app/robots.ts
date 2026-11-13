import type { MetadataRoute } from "next";
import { publicProfileMediaIndexing } from "../lib/platform/public-profile-media";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
      ...(publicProfileMediaIndexing() ? { allow: "/api/public/lawyers/*/photo" } : {}),
    },
    host: "https://app.juro.uz",
  };
}
