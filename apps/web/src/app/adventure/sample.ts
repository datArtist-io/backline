// A sample trip for the adventure map: a long weekend in Lisbon for someone who loves fado and jazz.
// Used by /adventure so the map can be seen (and recorded) without live data, and by the tests. Every
// place is real, with coordinates checked against OpenStreetMap; the taste scores, weather and exchange
// rate are illustrative, and the page says so.
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
  place("s1", "Memmo Alfama", "stay", 38.710276, -9.1304635, { match: 0.87, rating: 4.7, priceLevel: 4, address: "Travessa das Merceeiras, Alfama", why: ["In the heart of Alfama, where your taste is strongest (Qloo)", "Rooftop pool over the river"] }),
  place("s2", "Bairro Alto Hotel", "stay", 38.7102855, -9.1432825, { match: 0.8, rating: 4.7, priceLevel: 4, address: "Praça Luís de Camões", why: ["Between Chiado and Bairro Alto's bars"] }),
];
const dines = [
  place("d1", "Pastéis de Belém", "dine", 38.6974795, -9.2033202, { match: 0.84, rating: 4.6, priceLevel: 1, address: "Rua de Belém 84–92", why: ["The original pastel de nata, baked here since 1837", "Qloo: what fado fans reach for in Belém"] }),
  place("d2", "Cervejaria Ramiro", "dine", 38.7201981, -9.1357063, { match: 0.9, rating: 4.5, priceLevel: 3, address: "Avenida Almirante Reis 104", why: ["Seafood the way Lisbon does it: loud, late and generous", "Loved by people with your taste (Qloo)"] }),
  place("d3", "Time Out Market Lisboa", "dine", 38.7070934, -9.1458973, { match: 0.76, rating: 4.4, priceLevel: 2, address: "Praça Dom Luís I, Cais do Sodré", why: ["The city's best cooks under one roof"] }),
];
const venues = [
  place("v1", "Tasca do Chico", "venue", 38.7124799, -9.1265595, { match: 0.96, rating: 4.5, priceLevel: 2, address: "Rua de Santo Estêvão, Alfama", why: ["Fado vadio: anyone can sing, and the neighbours do (Qloo's strongest match)", "Small room, so arrive early"] }),
  place("v2", "Hot Clube de Portugal", "venue", 38.7181486, -9.1456468, { match: 0.88, rating: 4.6, priceLevel: 2, address: "Praça da Alegria 48", why: ["One of Europe's oldest jazz clubs", "Qloo links your taste to live jazz"] }),
];
const activities = [
  place("a1", "Castelo de São Jorge", "activity", 38.7139258, -9.133483, { match: 0.82, rating: 4.5, address: "Castelo", why: ["The whole city from its oldest walls"] }),
  place("a2", "Miradouro da Senhora do Monte", "activity", 38.7190781, -9.1329112, { match: 0.86, rating: 4.8, address: "Graça", why: ["The highest viewpoint in Lisbon, best at sunset"] }),
  place("a3", "Mosteiro dos Jerónimos", "activity", 38.6977531, -9.2055912, { match: 0.74, rating: 4.6, address: "Praça do Império, Belém", why: ["Manueline stonework that took a century to finish"] }),
  place("a4", "Torre de Belém", "activity", 38.691586, -9.2159288, { match: 0.7, rating: 4.5, address: "Avenida de Brasília, Belém", why: ["The river gate explorers sailed out from"] }),
  place("a5", "LX Factory", "activity", 38.7026001, -9.1786619, { match: 0.8, rating: 4.5, address: "Rua Rodrigues de Faria 103, Alcântara", why: ["Record shops, a bookshop in a print hall, and street art"] }),
  place("a6", "Museu Nacional do Azulejo", "activity", 38.7247242, -9.113914, { match: 0.78, rating: 4.6, address: "Rua da Madre de Deus 4", why: ["Five centuries of Portuguese tiles in a convent"] }),
];

const agent = {
  trip: { destination: "Lisbon, Portugal", startDate: "2026-11-13", endDate: "2026-11-15", adults: 2, rooms: 1, budget: { amount: null, currency: "EUR", scope: null }, priceTier: 3, purpose: null, event: null, needs: ["stay", "dine", "activities"], near: null, travelMode: "flight", selfArranged: [], assumptions: [], inspiredBy: "Amália Rodrigues", likes: ["fado", "jazz"] },
  where: { city: { name: "Lisbon", display: "Lisbon, Portugal", lat: 38.7077507, lon: -9.1365919, country: "Portugal", countryCode: "PT", source: "sample" }, landmark: null, zone: null },
  summary: "Three days of Lisbon built around fado and jazz: castle walls and sunset viewpoints, Belém by the river, and a night in Alfama's smallest fado room.",
  stays,
  dines,
  venues,
  activities,
  picks: { stays: ["s1"], dines: ["d1", "d2", "d3"], venues: ["v1", "v2"], activities: ["a1", "a2", "a3", "a4", "a5", "a6"] },
  stops: [{ id: "p1", name: "Lisbon Airport", lat: 38.7809981, lon: -9.1318608, label: "Arrival and departure", kind: "aerodrome" }],
  facts: [],
  questions: [],
  log: [],
  method: "agent",
  stats: { turns: 0, calls: 0, ms: 0, stop: "sample", decisions: [] },
} as unknown as TripAgentOutput;

const plan: TripPlanOutput = {
  summary: "Three days of Lisbon built around fado and jazz: castle walls and sunset viewpoints, Belém by the river, and a night in Alfama's smallest fado room.",
  stayId: "s1",
  venueId: "v1",
  days: [
    {
      date: "2026-11-13",
      label: "Alfama and the castle",
      items: [
        { time: "13:00", title: "Land at Lisbon Airport", placeId: "p1", note: "The metro's red line or a 20-minute ride to Alfama." },
        { time: "14:30", title: "Check in at Memmo Alfama", placeId: "s1", note: null },
        { time: "15:15", title: "Castelo de São Jorge", placeId: "a1", note: "Closes at 18:00 in winter." },
        { time: "16:45", title: "Sunset at Senhora do Monte", placeId: "a2", note: "The sun sets around 17:20 in mid-November." },
        { time: "20:30", title: "Fado at Tasca do Chico", placeId: "v1", note: "The main event. No booking: arrive early." },
      ],
    },
    {
      date: "2026-11-14",
      label: "Belém and the river",
      items: [
        { time: "09:30", title: "Mosteiro dos Jerónimos", placeId: "a3", note: "Go at opening to beat the queue." },
        { time: "11:30", title: "Pastéis de Belém", placeId: "d1", note: "Eat them warm with cinnamon." },
        { time: "12:15", title: "Torre de Belém", placeId: "a4", note: null },
        { time: "14:30", title: "LX Factory", placeId: "a5", note: null },
        { time: "20:00", title: "Dinner at Cervejaria Ramiro", placeId: "d2", note: "Expect a line; it moves." },
        { time: "22:30", title: "Jazz at Hot Clube de Portugal", placeId: "v2", note: null },
      ],
    },
    {
      date: "2026-11-15",
      label: "Tiles and goodbye",
      items: [
        { time: "10:00", title: "Museu Nacional do Azulejo", placeId: "a6", note: null },
        { time: "13:00", title: "Lunch at Time Out Market", placeId: "d3", note: null },
        { time: "16:00", title: "Back to the airport", placeId: "p1", note: "Allow 2 hours before a European flight." },
      ],
    },
  ],
  budget: [],
  tips: [],
  method: "model",
};

const heat: [number, number, number][] = [];
// Alfama, Graça and Bairro Alto glow strongest; Belém and the outskirts fade out.
for (let i = 0; i < 7; i++)
  for (let j = 0; j < 10; j++) {
    const lat = 38.697 + i * 0.0045;
    const lon = -9.17 + j * 0.0062;
    const d = Math.hypot((lat - 38.7135) / 0.008, (lon + 9.133) / 0.016);
    const w = Math.max(0, 1 - d / 2.2) * (0.75 + 0.25 * Math.sin(i * 1.7 + j * 2.1));
    if (w > 0.12) heat.push([Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4, Math.round(w * 100) / 100]);
  }
heat.sort((a, b) => b[2] - a[2]);

const taste: TasteOutput = {
  signals: [
    { id: "q1", name: "Amália Rodrigues", type: "urn:entity:artist", from: "star" },
    { id: "q2", name: "fado", type: "urn:entity:genre", from: "request" },
    { id: "q5", name: "jazz", type: "urn:entity:genre", from: "request" },
  ],
  tags: [],
  vibes: ["soulful", "intimate", "nostalgic"],
  scenes: ["fado house", "jazz club", "viewpoint"],
  dishes: ["pastel de nata", "grilled sardines", "bacalhau"],
  priceLean: 3,
  audience: "25–44",
  alsoLoved: [
    { id: "q3", name: "Mariza", type: "urn:entity:artist", image: null },
    { id: "q4", name: "Cesária Évora", type: "urn:entity:artist", image: null },
  ],
  zone: { name: "Alfama", lat: 38.7117704, lon: -9.12838, radiusKm: 1.2, points: heat.length },
  heat,
};

const intel: TripIntelOutput = {
  place: { city: "Lisbon", country: "Portugal", countryCode: "PT", lat: 38.7077507, lon: -9.1365919 },
  time: { zone: "Europe/Lisbon", utcOffsetHours: 0 },
  weather: {
    basis: "history",
    days: [
      { date: "2026-11-13", tmax: 18, tmin: 11, rainChance: 40, rainMm: 2.6, code: 3, label: "Cloudy", sunrise: "07:23", sunset: "17:20" },
      { date: "2026-11-14", tmax: 18, tmin: 12, rainChance: 33, rainMm: 1.2, code: 1, label: "Mostly clear", sunrise: "07:24", sunset: "17:19" },
      { date: "2026-11-15", tmax: 17, tmin: 11, rainChance: 50, rainMm: 4.1, code: 61, label: "Rain", sunrise: "07:25", sunset: "17:18" },
    ],
    summary: "Usually highs of 17–18°C and lows of 11–12°C in mid-November; expect a wet day.",
    packing: ["A light rain jacket", "Layers for cool evenings", "Shoes with grip: the cobbles are steep and slippery"],
  },
  money: { local: "EUR", home: "USD", rate: 0.92, asOf: null, examples: [{ home: 10, local: 9.2 }, { home: 50, local: 46 }, { home: 100, local: 92 }] },
  holidays: [],
  sections: [
    {
      id: "entry",
      title: "Getting in",
      items: [
        { text: "Portugal is in the Schengen area. Many passports can visit for up to 90 days without a visa; check the rules for yours on the official government site.", url: null, site: null, verified: false },
        { text: "Carry your passport and proof of your return trip.", url: null, site: null, verified: false },
      ],
    },
    {
      id: "safety",
      title: "Staying safe",
      items: [{ text: "Pickpockets work the 28 tram and busy viewpoints. Keep bags zipped and in front.", url: null, site: null, verified: false }],
    },
    { id: "culture", title: "Customs and etiquette", items: [{ text: "During fado, stay silent while the singer performs. Talk between songs.", url: null, site: null, verified: false }] },
    { id: "connect", title: "Phone, power and internet", items: [{ text: "Power is 230 V with two-pin European plugs (types C and F). EU roaming rules apply to EU SIMs.", url: null, site: null, verified: false }] },
  ],
  emergency: { police: "112", ambulance: "112", fire: "112", general: "112", verified: false },
  phrases: [
    { say: "Olá", means: "Hello" },
    { say: "Obrigado / Obrigada", means: "Thank you (said by a man / a woman)" },
    { say: "Por favor", means: "Please" },
    { say: "Quanto custa?", means: "How much is it?" },
    { say: "A conta, por favor", means: "The bill, please" },
  ],
  guides: [
    { name: "Alfama fado walking tour", kind: "walking tour", why: "Fits your love of fado: the streets the songs come from.", url: "https://www.google.com/search?q=alfama+fado+walking+tour", site: "Search" },
    { name: "Lisbon food tour", kind: "food tour", why: "Qloo ties your taste to sardines and pastel de nata: let a local show you the best counters.", url: "https://www.google.com/search?q=lisbon+food+tour", site: "Search" },
  ],
  tasteTips: [
    { because: "Qloo's heatmap for your taste", tip: "Spend your evenings in Alfama. It's where your taste is strongest in the city." },
    { because: "Qloo links Amália Rodrigues to this", tip: "Order grilled sardines. They're what people with your taste reach for." },
    { because: "People who love Amália Rodrigues also love", tip: "Mariza: look for a show while you're in town." },
  ],
  gaps: [],
};

export const SAMPLE_TITLE = "Plan a long weekend in Lisbon around fado and jazz";
export const sampleSource = (): AdventureSource => ({ title: SAMPLE_TITLE, agent, plan, routes: null, taste, intel, sample: true });
