// Single source of truth for the product name and copy used across the site.
// Renaming the product starts here.
export const BRAND = {
  name: "Backline",
  wordmark: "backline",
  tagline: "Say where. It books and pays for everything.",
  description: "An agent that does your trip for you: from one sentence it reads your taste, books and pays for the flights and the hotel, reserves the tables, maps every ride and puts the whole trip in your calendar.",
  url: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
} as const;
