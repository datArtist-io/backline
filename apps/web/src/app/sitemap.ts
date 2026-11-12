import type { MetadataRoute } from "next";

// Public pages only. Trips, account, mission, receipts and the API stay out of search.
export default function sitemap(): MetadataRoute.Sitemap {
  // the public address, fixed: the site URL setting can point at a preview domain
  const base = "https://backline.travel";
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/security`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
