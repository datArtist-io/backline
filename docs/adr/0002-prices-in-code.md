# 0002. Prices come from code and providers, never from the model

**Status:** Accepted, November 2026

## Context
Models write confident numbers. A flight "estimated from distance" showed $297 for Lagos to Rome; a model-written budget came to $10,681 on a $7,000 budget.

## Decision
The budget is rebuilt in code after the plan is written. Flights: a fare for these dates from Google Flights (SerpApi) or a bookable airline offer (Duffel); otherwise nothing is charged and the slip links to live fares. Stays: the live rate, else the rate listed online, else an estimate for the price level, each labelled. Food: a fixed daily rate per price level. Only real fares and rates are payable.

## Consequences
Without a fare source a trip has no flight line on the slip, which is honest but less complete. Results are the same whichever model runs.
