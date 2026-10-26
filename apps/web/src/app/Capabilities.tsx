"use client";
import { BRAND } from "@/lib/brand";

import { useRef, useState } from "react";

const AREAS = [
  {
    id: "agent",
    label: "It does it",
    lead: "Say where and when. It books and pays.",
    items: [
      "Books your flights there and back, and pays for them",
      "Books the hotel and pays, only at the price shown and within your budget",
      "Reserves tables and venues by email or an AI phone call",
      "Runs end to end without asking, or checks with you first: your choice",
    ],
  },
  {
    id: "taste",
    label: "Your taste",
    lead: "Picks that feel like you, read through Qloo.",
    items: [
      "Tell it what you love, or plan it like your favourite star",
      "The vibe, scenes and dishes that go with your taste",
      "The part of town where your taste lives, on the map",
      "Every place scored for how well it fits you",
    ],
  },
  {
    id: "stay",
    label: "Stays",
    lead: "The right hotel, at the price it really costs.",
    items: [
      "Hotels within 5 km of where you need to be, plus the best-rated within 10 km",
      "Sorted into Premium, Closest, Best value and Lowest price",
      "Live, bookable rates for your dates",
      "Ratings, distances and a one-tap way to call",
    ],
  },
  {
    id: "routes",
    label: "Getting around",
    lead: "Every move of the trip, mapped.",
    items: [
      "Your flights, from home to the airport and back",
      "Each day's route on the map, with ride and walking times",
      "Bolt fare estimates between stops, and a daily ride total",
      "Directions for every day, ready on your phone",
    ],
  },
  {
    id: "events",
    label: "Events",
    lead: "Birthdays, launches, weddings, dinners, nights out.",
    items: [
      "Venues sized for your guest list and budget",
      "Restaurants for group dinners, reserved for you",
      "Things to do that match your taste, or a favourite star's",
      "An hour-by-hour plan with a budget",
    ],
  },
  {
    id: "share",
    label: "Take it with you",
    lead: "Your whole trip, wherever you need it.",
    items: [
      "Every booking in your Google, Apple or Outlook calendar",
      "Export it as a document, a PDF or a presentation",
      "Share it with whoever's coming along",
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
        Everything done for you, from one sentence
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
