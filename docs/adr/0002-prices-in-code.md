# 0002. Prices come from code and providers, never from the model

**Status:** Accepted, November 2026

## Context
Models write confident numbers. A flight "estimated from distance" showed $297 for Lagos to Rome; a model-written budget came to $10,681 on a $7,000 budget.

## Decision
The budget is rebuilt in code after the plan is written. Flights: a fare for these dates from Google Flights (SerpApi) or a bookable airline offer (Duffel); else a fare listed online; else a distance estimate calibrated on real fares. The last two carry an "est." tag on the slip and are replaced by the live fare when one is found (demo checkout, so the trip stays whole). Stays: the live rate, else the rate listed online, else an estimate for the price level, each labelled. Food: a fixed daily rate per price level. The model never writes a price.

## Consequences
Without a fare source the flight line is an estimate, always marked as one. Results are the same whichever model runs.
