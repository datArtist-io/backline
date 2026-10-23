"use client";
import { BRAND } from "@/lib/brand";

import { useRef, useState } from "react";

const AREAS = [
  {
    id: "stay",
    label: "Stays",
    lead: "The right hotel, at the price it really costs.",
    items: [
      "Hotels within 5 km of where you need to be, plus the best-rated within 10 km",
      "Sorted into Premium, Closest, Best value and Lowest price",
      "Nightly rates as listed online for your dates, with the page they're on",
      "Ratings, distances and a one-tap way to check dates or call",
    ],
  },
  {
    id: "routes",
    label: "Getting around",
    lead: "Every move of the trip, mapped.",
    items: [
      "Your journey there and back, from home to the station or airport",
      "Each day's route on the map, with ride and walking times",
      "Bolt fare estimates between stops, and a daily ride total",
      "Directions for every day, ready on your phone",
    ],
  },
  {
    id: "plan",
    label: "The plan",
    lead: "An hour-by-hour plan you can actually follow.",
    items: [
      "Check-in, the event, meals and free time, in the right order",
      "Places to eat near where you are, not across town",
      "A budget with hotel, rides and the rest",
      "Local tips for the city you're heading to",
    ],
  },
  {
    id: "events",
    label: "Events",
    lead: "Birthdays, launches, weddings, dinners, nights out.",
    items: [
      "Venues sized for your guest list and budget",
      "Restaurants for group dinners, with booking contacts",
      "Things to do that match your taste, or a favourite star's",
      "Enquiry emails and call scripts written for you",
    ],
  },
  {
    id: "share",
    label: "Take it with you",
    lead: "Your trip, wherever you need it.",
    items: [
      "Add the whole plan to Google, Apple or Outlook calendar",
      "Export it as a document, a PDF or a presentation",
      "Share it with whoever's coming along",
    ],
  },
  {
    id: "agent",
    label: "The agent",
    lead: "Say where and when. It does the rest.",
    items: [
      "Plans in any language, typed or spoken: \u201cA birthday dinner for 12 in Lekki on Saturday\u201d",
      "Reads your tickets, invites and itineraries from a file or photo",
      "Checks facts and prices on the web instead of guessing",
      "Asks before booking anything, or runs end to end",
    ],
  },
];

export default function Capabilities() {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const area = AREAS[active];

  const move = (to: number) => {
    const next = (to + AREAS.length) % AREAS.length;
    setActive(next);
    tabs.current[next]?.focus();
  };

  return (
    <section className="caps" aria-labelledby="caps-title">
      <h2 id="caps-title" className="caps-title">
        Everything you plan, from one sentence
      </h2>

      <div className="lg caps-panel">
        <div className="caps-tabs" role="tablist" aria-label={`What ${BRAND.name} does`}>
          {AREAS.map((a, i) => (
            <button
              key={a.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              role="tab"
              id={`tab-${a.id}`}
              aria-selected={i === active}
              aria-controls={`panel-${a.id}`}
              tabIndex={i === active ? 0 : -1}
              className="caps-tab"
              onClick={() => setActive(i)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") move(i + 1);
                if (e.key === "ArrowLeft") move(i - 1);
                if (e.key === "Home") move(0);
                if (e.key === "End") move(AREAS.length - 1);
              }}
            >
              {a.label}
            </button>
          ))}
        </div>

        <div className="caps-body" role="tabpanel" id={`panel-${area.id}`} aria-labelledby={`tab-${area.id}`} key={area.id}>
          <p className="caps-lead">{area.lead}</p>
          <ul className="caps-list">
            {area.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
