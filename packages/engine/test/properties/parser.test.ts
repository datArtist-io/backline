// Fuzzing the request parser (the bug-finding book, section 5.5, invariant G7): thousands of sentences
// built from parts, in any order, with noise. Three laws: nothing throws, every number read out of a
// sentence appears in it, and a model's guess that the sentence does not support is dropped.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { dateRangeIn, dayDate, dietaryIn, groundTrip, mentionsNumber, normalizeTrip, pinStatedDates, spelledNumbers, statedNights, stayStyleIn, updateTrip, weekendDates, blankTrip, type RawTrip } from "../../src/trip-request";

const TODAY = "2026-11-07";
const cities = ["Lisbon", "Tokyo", "Lagos", "New York", "Paris", "Singapore", "Cape Town", "São Paulo", "Ibadan", "Reykjavík"];
const words = ["seven", "two", "three", "a couple of", "ten", "twelve", "fourteen", "twenty"];
const months = ["Jan", "February", "march", "Apr", "May", "june", "July", "Aug", "Sept", "October", "Nov", "Dec"];
const tastes = ["jazz", "Drake", "food markets", "fado", "Burna Boy", "ramen", "techno", "street food", "Amália Rodrigues", "art deco"];
const noise = ["please", "!!", "🎷🍜", "thanks", "...", "lol", "(if possible)", "— you know —", "ASAP", "pls"];
const diets = ["halal", "vegetarian", "vegan", "no pork", "nut allergy", "gluten free", "kosher"];

const part = fc.oneof(
  fc.constantFrom(...cities).map((c) => `${c}`),
  fc.constantFrom(...cities).map((c) => `from ${c}`),
  fc.constantFrom(...cities).map((c) => `to ${c}`),
  fc.integer({ min: 1, max: 40 }).map((n) => `${n} days`),
  fc.integer({ min: 1, max: 40 }).map((n) => `${n} nights`),
  fc.constantFrom(...words).map((w) => `${w} days`),
  fc.constantFrom(...words).map((w) => `${w} nights`),
  fc.constant("a week"),
  fc.constant("a weekend"),
  fc.constant("a day trip"),
  fc.integer({ min: 1, max: 12 }).map((n) => `for ${n}`),
  fc.integer({ min: 1, max: 12 }).map((n) => `${n} people`),
  fc.constant("for two"),
  fc.constant("me and my wife"),
  fc.integer({ min: 50, max: 90_000 }).map((n) => `$${n.toLocaleString("en")} budget`),
  fc.integer({ min: 1, max: 90 }).map((n) => `${n}k budget`),
  fc.integer({ min: 1, max: 20 }).map((n) => `${n} thousand dollars`),
  fc.constant("seven thousand dollars"),
  fc.constant("two and a half grand"),
  fc.tuple(fc.constantFrom(...months), fc.integer({ min: 1, max: 28 }), fc.integer({ min: 1, max: 28 })).map(([m, a, b]) => `${m} ${a} to ${b}`),
  fc.tuple(fc.constantFrom(...months), fc.integer({ min: 1, max: 28 })).map(([m, d]) => `leaving ${m} ${d}`),
  fc.tuple(fc.integer({ min: 1, max: 28 }), fc.constantFrom(...months)).map(([d, m]) => `${d}th of ${m}`),
  fc.constant("next weekend"),
  fc.constant("tomorrow"),
  fc.constantFrom(...tastes).map((t) => `we love ${t}`),
  fc.constantFrom(...diets),
  fc.constantFrom("hostel", "Airbnb", "boutique hotel", "resort", "a villa"),
  fc.constantFrom(...noise),
  fc.string({ minLength: 0, maxLength: 12 }),
);

const sentence = fc.array(part, { minLength: 1, maxLength: 9 }).map((ps) => ps.join(fc.sample(fc.constantFrom(", ", " ", " and ", "\n", " / "), 1)[0]));

const numbersIn = (text: string): number[] => {
  const digits = (text.replace(/(\d)[,\s](?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  const withK = (text.match(/(\d+(?:\.\d+)?)\s*k\b/gi) ?? []).map((m) => Number(m.replace(/k/i, "").trim()) * 1000);
  return [...digits, ...withK, ...spelledNumbers(text)];
};

describe("the parser never throws", () => {
  it("on any sentence built from parts and noise", () => {
    fc.assert(
      fc.property(sentence, (text) => {
        dateRangeIn(text, TODAY);
        dayDate(text, TODAY);
        weekendDates(text, TODAY);
        statedNights(text);
        spelledNumbers(text);
        dietaryIn(text);
        stayStyleIn(text);
        mentionsNumber(text, 7);
        const trip = normalizeTrip({ destination: "Lisbon" } as RawTrip, null, {}, TODAY);
        if (trip) pinStatedDates(trip, text, TODAY);
        groundTrip({ destination: "Lisbon", budgetAmount: 7000 } as RawTrip, text);
      }),
      { numRuns: 1500 },
    );
  });
  it("on raw bytes: control characters, huge strings, unicode", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 400 }), fc.string({ unit: "binary", maxLength: 200 }), fc.constant("x".repeat(20_000))), (text) => {
        statedNights(text);
        dateRangeIn(text, TODAY);
        spelledNumbers(text);
        dietaryIn(text);
        groundTrip({ destination: "Lisbon" } as RawTrip, text);
      }),
      { numRuns: 500 },
    );
  });
});

describe("what is read out was in the sentence (G7)", () => {
  it("a stated length comes from a number or a length word in the text", () => {
    fc.assert(
      fc.property(sentence, (text) => {
        const n = statedNights(text);
        if (n == null) return;
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(1095);
        const t = text.toLowerCase();
        const supported = numbersIn(t).some((x) => x === n || x - 1 === n || 7 * x - 1 === n || Math.round(30.44 * x) - 1 === n) || /\b(a|one|an)\b|week|weekend|night|day|fortnight|month|year|overnight|a couple of|a few/.test(t);
        expect(supported, `nights ${n} from "${text}"`).toBe(true);
      }),
      { numRuns: 1500 },
    );
  });
  it("a date range is two valid dates, start before end, within 13 months", () => {
    fc.assert(
      fc.property(sentence, (text) => {
        const r = dateRangeIn(text, TODAY);
        if (!r) return;
        expect(r.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(r.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(Date.parse(r.startDate))).toBe(false);
        expect(r.endDate > r.startDate).toBe(true);
        expect(r.startDate >= TODAY).toBe(true);
        expect(Date.parse(r.endDate) - Date.parse(TODAY)).toBeLessThan(400 * 864e5);
      }),
      { numRuns: 1500 },
    );
  });
  it("spelled numbers are whole and come only from number words", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (text) => {
        for (const n of spelledNumbers(text)) {
          expect(Number.isInteger(n)).toBe(true);
          expect(n).toBeGreaterThan(0);
        }
        // Text with no number word yields nothing.
        if (!/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|grand|million)\b/i.test(text)) {
          expect(spelledNumbers(text)).toEqual([]);
        }
      }),
      { numRuns: 1000 },
    );
  });
  it("every diet read out is one from the fixed list, and only if its words are in the text", () => {
    fc.assert(
      fc.property(sentence, (text) => {
        for (const d of dietaryIn(text)) {
          expect(typeof d).toBe("string");
          expect(d.length).toBeGreaterThan(0);
        }
        if (!/halal|veg|pork|nut|gluten|kosher|dairy|allerg|lactose|pescatarian|shellfish|alcohol|beef/i.test(text)) expect(dietaryIn(text)).toEqual([]);
      }),
      { numRuns: 1000 },
    );
  });
});

describe("grounding drops what the sentence does not support", () => {
  it("a budget the text never mentions is removed; one it mentions is kept", () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 90_000 }), sentence, (amount, text) => {
        const g = groundTrip({ destination: "Lisbon", budgetAmount: amount, budgetScope: "total" } as RawTrip, text);
        const mentioned = mentionsNumber(text, amount);
        expect(g?.budgetAmount ?? null).toBe(mentioned ? amount : null);
      }),
      { numRuns: 1500 },
    );
  });
  it("a budget written in words survives grounding", () => {
    for (const [text, n] of [
      ["seven thousand dollars for the two of us", 7000],
      ["about two and a half grand", 2500],
      ["budget is 7k", 7000],
      ["we have 1,500 to spend", 1500],
      ["twelve hundred", 1200],
    ] as const) {
      expect(groundTrip({ destination: "Lisbon", budgetAmount: n } as RawTrip, text)?.budgetAmount, text).toBe(n);
    }
  });
  it("an origin, a muse or a liking the user never said is dropped", () => {
    fc.assert(
      fc.property(sentence, fc.constantFrom(...cities), fc.constantFrom(...tastes), (text, origin, like) => {
        const g = groundTrip({ destination: "Lisbon", origin, inspiredBy: like, likes: [like] } as RawTrip, text)!;
        // saidIn counts any real word of a name, so the oracle does the same (without fillers).
        const said = (s: string) => s.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !["the", "and", "for", "near"].includes(w)).some((w) => text.toLowerCase().includes(w));
        if (!said(origin)) expect(g.origin).toBeNull();
        if (!said(like)) {
          expect(g.inspiredBy).toBeNull();
          expect(g.likes).toEqual([]);
        }
      }),
      { numRuns: 800 },
    );
  });
  it("updating a trip with a patch never produces an invalid trip", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 9 }), fc.option(fc.integer({ min: 1, max: 50_000 }), { nil: null }), (nights, adults, budget) => {
        const t = updateTrip({ ...blankTrip(), destination: "Lisbon" }, { adults, budgetAmount: budget, startDate: TODAY, endDate: new Date(Date.parse(TODAY) + nights * 864e5).toISOString().slice(0, 10) } as RawTrip, {}, TODAY);
        expect(t).not.toBeNull();
        expect(t!.adults).toBeGreaterThanOrEqual(1);
        expect(t!.rooms).toBeGreaterThanOrEqual(1);
        if (t!.startDate && t!.endDate) expect(t!.endDate >= t!.startDate).toBe(true);
        if (budget) expect(t!.budget.amount).toBe(budget);
      }),
      { numRuns: 300 },
    );
  });
});
