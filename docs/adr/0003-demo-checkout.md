# 0003. Live prices, demo checkout

**Status:** Accepted, October 2026

## Context
The product must show real prices and real calls, but a demo must never buy a ticket or a room by accident.

## Decision
With live keys, Duffel and LiteAPI search and price for real; nothing is bought unless `BOOKING_LIVE=1`. "Booking" returns a `DEMO-` reference at the live price, paid from a demo wallet (a real ledger, no real money). Calls reach real businesses only with `CALLS_LIVE=1`; otherwise they ring the signed-in person's own phone, who plays the business.

## Consequences
The demo is end to end and honest about what's simulated. Turning on real bookings is one switch each, after identity checks and payment are in place.
