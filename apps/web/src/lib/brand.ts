// Single source of truth for the product name and copy used across the site.
// Renaming the product starts here.
export const BRAND = {
  name: "Backline",
  wordmark: "backline",
  tagline: "Plan anything outside your home, from one sentence.",
  description: "An agent that plans anything outside your home: trips, events, dinners and nights out. It finds the right places at real prices, maps every route and ride, writes the plan hour by hour and puts it in your calendar.",
  url: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
} as const;
