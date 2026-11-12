import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  // the public address, fixed: the site URL setting can point at a preview domain
  const base = "https://backline.travel";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/account", "/adventure", "/mission", "/ops", "/receipt", "/auth", "/signin"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
