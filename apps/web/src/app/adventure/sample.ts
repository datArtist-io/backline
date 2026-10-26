// A sample trip for the adventure map: a Lagos weekend for an Afrobeats fan. Used by /adventure so the
// map can be seen (and recorded) without live data, and by the tests. Places are real landmarks with
// approximate coordinates; the taste scores, weather and rate are illustrative, and the page says so.
import type { Place, TasteOutput, TripAgentOutput, TripIntelOutput, TripPlanOutput } from "@backline/engine";
import type { AdventureSource } from "./model";

const place = (id: string, name: string, kind: NonNullable<Place["kind"]>, lat: number, lon: number, o: Partial<Place> = {}): Place => ({
  id,
  name,
  address: null,
  phone: null,
  email: null,
  website: null,
  priceLevel: null,
  rating: null,
  affinity: null,
  match: null,
  image: null,
  lat,
  lon,
  tags: [],
  fit: 0.7,
  why: [],
  priceNote: null,
  extra: null,
  sources: [],
  kind,
  source: "qloo+osm",
  ...o,
});

const stays = [
  place("s1", "Eko Hotels & Suites", "stay", 6.4254, 3.429, { match: 0.86, rating: 4.4, priceLevel: 4, address: "Victoria Island", why: ["Taste match: lively, music-minded crowd", "Close to where your taste is strongest"] }),
  place("s2", "The Wheatbaker", "stay", 6.4513, 3.4357, { match: 0.78, rating: 4.6, priceLevel: 4, address: "Ikoyi", why: ["Quiet base for a loud city"] }),
];
const dines = [
  place("d1", "Terra Kulture", "dine", 6.4281, 3.4219, { match: 0.91, rating: 4.5, priceLevel: 2, address: "Tiamiyu Savage St, Victoria Island", why: ["Nigerian dishes, books and live arts in one room", "Loved by Afrobeats fans (Qloo)"] }),
  place("d2", "Obalende suya stands", "dine", 6.4488, 3.4036, { match: 0.88, rating: 4.3, priceLevel: 1, address: "Obalende", why: ["Suya is what your taste reaches for (Qloo)", "Go after dark"] }),
  place("d3", "Yellow Chilli", "dine", 6.4286, 3.424, { match: 0.79, rating: 4.2, priceLevel: 3, address: "Victoria Island", why: ["Jollof and pepper soup done properly"] }),
];
const venues = [
  place("v1", "New Afrika Shrine", "venue", 6.5992, 3.3449, { match: 0.95, rating: 4.5, priceLevel: 2, address: "Ikeja", why: ["The home of Afrobeat: the strongest taste match in the city (Qloo)", "Live music into the early hours"] }),
];
const activities = [
  place("a1", "Freedom Park", "activity", 6.4527, 3.394, { match: 0.84, rating: 4.4, address: "Lagos Island", why: ["Open-air arts and music in a former prison"] }),
  place("a2", "Balogun Market", "activity", 6.4538, 3.39, { match: 0.68, rating: 4.0, address: "Lagos Island", why: ["Fabric, fashion and noise: Lagos at full volume"] }),
  place("a3", "Nike Art Gallery", "activity", 6.4416, 3.4732, { match: 0.89, rating: 4.6, address: "Lekki", why: ["Five floors of Nigerian art (Qloo: art-minded fans)"] }),
  place("a4", "Landmark Beach", "activity", 6.4224, 3.4443, { match: 0.73, rating: 4.1, address: "Oniru", why: ["Sun, sound systems and a sea breeze"] }),
  place("a5", "Lekki Conservation Centre", "activity", 6.4372, 3.5338, { match: 0.62, rating: 4.3, address: "Lekki", why: ["A canopy walkway over the lagoon forest"] }),
];

const agent = {
  trip: { destination: "Lagos, Nigeria", startDate: "2026-11-13", endDate: "2026-11-15", adults: 2, rooms: 1, budget: { amount: null, currency: "NGN", scope: null }, priceTier: 3, purpose: null, event: null, needs: ["stay", "dine", "activities"], near: null, travelMode: "flight", selfArranged: [], assumptions: [], inspiredBy: "Burna Boy", likes: ["Afrobeats"] },
  where: { city: { name: "Lagos", display: "Lagos, Nigeria", lat: 6.4541, lon: 3.3947, country: "Nigeria", countryCode: "NG", source: "sample" }, landmark: null, zone: null },
  summary: "Three days of Lagos built around Afrobeats: art by day, suya by night and a Saturday at the Shrine.",
  stays,
  dines,
  venues,
  activities,
  picks: { stays: ["s1"], dines: ["d1", "d2", "d3"], venues: ["v1"], activities: ["a1", "a2", "a3", "a4", "a5"] },
  stops: [{ id: "p1", name: "Murtala Muhammed Airport", lat: 6.5774, lon: 3.3212, label: "Arrival and departure", kind: "aerodrome" }],
  facts: [],
  questions: [],
  log: [],
  method: "agent",
  stats: { turns: 0, calls: 0, ms: 0, stop: "sample", decisions: [] },
} as unknown as TripAgentOutput;

const plan: TripPlanOutput = {
  summary: "Three days of Lagos built around Afrobeats: art by day, suya by night and a Saturday at the Shrine.",
  stayId: "s1",
  venueId: "v1",
  days: [
    {
      date: "2026-11-13",
      label: "Land and tune in",
      items: [
        { time: "14:00", title: "Land at Murtala Muhammed", placeId: "p1", note: "Ride to Victoria Island: allow 90 minutes in traffic." },
        { time: "16:30", title: "Check in at Eko Hotels", placeId: "s1", note: null },
        { time: "19:30", title: "Dinner at Terra Kulture", placeId: "d1", note: "Ask what's on the stage tonight." },
        { time: "22:00", title: "Suya in Obalende", placeId: "d2", note: "Cash helps." },
      ],
    },
    {
      date: "2026-11-14",
      label: "Roots and rhythm",
      items: [
        { time: "09:30", title: "Freedom Park", placeId: "a1", note: "Go early, before the heat." },
        { time: "12:30", title: "Balogun Market", placeId: "a2", note: "Keep your phone zipped away." },
        { time: "15:30", title: "Nike Art Gallery", placeId: "a3", note: null },
        { time: "21:00", title: "Night at the New Afrika Shrine", placeId: "v1", note: "The main event. Music starts late." },
      ],
    },
    {
      date: "2026-11-15",
      label: "Sea air and goodbye",
      items: [
        { time: "10:30", title: "Landmark Beach", placeId: "a4", note: null },
        { time: "13:30", title: "Lunch at Yellow Chilli", placeId: "d3", note: null },
        { time: "15:30", title: "Lekki Conservation Centre", placeId: "a5", note: "Canopy walk closes at 17:00." },
        { time: "18:00", title: "Back to the airport", placeId: "p1", note: "Leave 4 hours before an evening flight." },
      ],
    },
  ],
  budget: [],
  tips: [],
  method: "model",
};

const heat: [number, number, number][] = [];
// Victoria Island, Ikoyi and Lekki glow strongest; the mainland fades out.
for (let i = 0; i < 6; i++)
  for (let j = 0; j < 8; j++) {
    const lat = 6.405 + i * 0.0145;
    const lon = 3.37 + j * 0.0165;
    const d = Math.hypot((lat - 6.432) / 0.03, (lon - 3.43) / 0.045);
    const w = Math.max(0, 1 - d / 2.2) * (0.75 + 0.25 * Math.sin(i * 1.7 + j * 2.1));
    if (w > 0.12) heat.push([lat, lon, Math.round(w * 100) / 100]);
  }
heat.sort((a, b) => b[2] - a[2]);

const taste: TasteOutput = {
  signals: [
    { id: "q1", name: "Burna Boy", type: "urn:entity:artist", from: "star" },
    { id: "q2", name: "Afrobeats", type: "urn:entity:genre", from: "request" },
  ],
  tags: [],
  vibes: ["energetic", "soulful", "unapologetic"],
  scenes: ["live music venue", "art gallery", "rooftop bar"],
  dishes: ["suya", "jollof rice", "pepper soup"],
  priceLean: 3,
  audience: "25–34",
  alsoLoved: [
    { id: "q3", name: "Wizkid", type: "urn:entity:artist", image: null },
    { id: "q4", name: "Tems", type: "urn:entity:artist", image: null },
  ],
  zone: { name: "Victoria Island", lat: 6.4286, lon: 3.4225, radiusKm: 2.6, points: heat.length },
  heat,
};

const intel: TripIntelOutput = {
  place: { city: "Lagos", country: "Nigeria", countryCode: "NG", lat: 6.4541, lon: 3.3947 },
  time: { zone: "Africa/Lagos", utcOffsetHours: 1 },
  weather: {
    basis: "history",
    days: [
      { date: "2026-11-13", tmax: 31, tmin: 25, rainChance: 33, rainMm: 2.1, code: 3, label: "Cloudy", sunrise: "06:28", sunset: "18:10" },
      { date: "2026-11-14", tmax: 31, tmin: 25, rainChance: 33, rainMm: 1.4, code: 1, label: "Mostly sunny", sunrise: "06:28", sunset: "18:10" },
      { date: "2026-11-15", tmax: 30, tmin: 24, rainChance: 67, rainMm: 5.8, code: 61, label: "Rain", sunrise: "06:29", sunset: "18:10" },
    ],
    summary: "Usually highs of 30–31°C and lows of 24–25°C; rain likely on 1 of 3 days.",
    packing: ["A light rain jacket or a compact umbrella", "Light, breathable clothes, sunscreen and a hat", "Comfortable walking shoes"],
  },
  money: { local: "NGN", home: "USD", rate: 1500, asOf: null, examples: [{ home: 10, local: 15000 }, { home: 50, local: 75000 }, { home: 100, local: 150000 }] },
  holidays: [],
  sections: [
    {
      id: "entry",
      title: "Getting in",
      items: [
        { text: "Most visitors need a visa or e-visa before arriving. Rules depend on your passport, so confirm on the official government site.", url: null, site: null, verified: false },
        { text: "Carry your passport, hotel booking and onward ticket for immigration.", url: null, site: null, verified: false },
      ],
    },
    {
      id: "safety",
      title: "Staying safe",
      items: [
        { text: "Use ride apps rather than street taxis after dark, and keep phones out of sight in crowded markets.", url: null, site: null, verified: false },
        { text: "Traffic is heavy: leave far earlier than you think, especially for the airport.", url: null, site: null, verified: false },
      ],
    },
    { id: "health", title: "Health", items: [{ text: "Drink bottled or filtered water, and ask your doctor about malaria prevention before you go.", url: null, site: null, verified: false }] },
    { id: "culture", title: "Customs and etiquette", items: [{ text: "Greet people before asking for anything. A handshake and a warm hello go a long way.", url: null, site: null, verified: false }] },
    { id: "connect", title: "Phone, power and internet", items: [{ text: "Power is 230 V with UK-style (type D and G) plugs. Local SIMs are cheap; an eSIM works for most phones.", url: null, site: null, verified: false }] },
  ],
  emergency: { police: "112 or 199", ambulance: "112", fire: "112", general: "112", verified: false },
  phrases: [
    { say: "E kaabo", means: "Welcome (Yoruba)" },
    { say: "E se", means: "Thank you (Yoruba)" },
    { say: "How far?", means: "Hey, how are you? (Pidgin)" },
    { say: "Abeg, how much?", means: "Please, how much is it? (Pidgin)" },
    { say: "No wahala", means: "No problem (Pidgin)" },
  ],
  guides: [
    { name: "Afrobeat and Fela history walk", kind: "walking tour", why: "Fits your Afrobeats taste: the roots of the sound you came for.", url: "https://www.google.com/search?q=lagos+afrobeat+history+walking+tour", site: "Search" },
    { name: "Lagos street-food tour", kind: "food tour", why: "Qloo ties your taste to suya and jollof: let a local show you the best stands.", url: "https://www.google.com/search?q=lagos+street+food+tour+suya", site: "Search" },
  ],
  tasteTips: [
    { because: "Qloo's heatmap for Burna Boy", tip: "Spend your evenings around Victoria Island. It's where your taste is strongest in the city." },
    { because: "Qloo links Burna Boy to this", tip: "Order suya. It's what people with your taste reach for." },
    { because: "Qloo links Burna Boy to this", tip: "Look for live music venue spots. They're where your kind of crowd goes." },
    { because: "People who love Burna Boy also love", tip: "Wizkid: worth a detour if you pass it." },
  ],
  gaps: [],
};

export const SAMPLE_TITLE = "Plan a weekend in Lagos like Burna Boy would";
export const sampleSource = (): AdventureSource => ({ title: SAMPLE_TITLE, agent, plan, routes: null, taste, intel, sample: true });
