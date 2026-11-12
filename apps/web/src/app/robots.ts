import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

export default function robots(): MetadataRoute.Robots {
  const base = BRAND.url.replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/account", "/adventure", "/mission", "/ops", "/receipt", "/auth", "/signin"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
