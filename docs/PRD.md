# Backline: product requirements

## Problem

Planning anything outside the home (a weekend away, a birthday dinner for twelve, a night out, a trip for a show) means hours across maps, booking sites, reviews and group chats. The tools that exist answer "what's near here" and "what's cheapest". None of them know the person: two people asking for "a hotel in Lagos" get the same list, even when one loves jazz bars and the other wants a quiet resort.

## Who it's for

| Person | Situation | What they need |
|---|---|---|
| Traveller | A trip to a city they don't know well, often for an event | Somewhere to stay that fits them and the plan, real prices, how to get around |
| Host | A birthday, a launch, a dinner for a group | A venue and a plan that suit the guests, with the bookings handled |
| Fan | Wants a weekend the way their favourite artist would do it | Places that artist's fans actually love |
| Local | A night out or a day off in their own city | Something new that still feels like them |

## What it does

One sentence in ("a weekend in Lagos, I love Wizkid and jazz"), a finished plan out:

1. **Reads their taste through Qloo** before searching anything: the vibe, the scenes and dishes that go with it, who shares it, what those fans also love and the part of town where it's strongest.
2. **Finds places** around a landmark or, without one, where their taste lives, and scores each for taste match, distance, rating and budget.
3. **Checks real prices**: hotel rates are shown only when they're listed for the dates, with the page linked.
4. **Sorts hotels into lanes**: premium, closest, best value and lowest price.
5. **Writes the plan** day by day, with the map, routes on real roads, ride fares between stops and the round trip home.
6. **Books and pays, after one approval**: a checkout shows every booking and the total in the traveller's currency; each is paid from the Backline Wallet and confirmed by a real AI call, one at a time, day by day, with a receipt for each and automatic refunds when a place can't take it. Hotels and flights book through their providers. Card details never pass through Backline.
7. **Hands it over**: calendar, PDF, Word, PowerPoint or slides to present.

Artist teams also get missions built on Qloo's audience data: fan profiles, brand matches with pitches, tour routing, growth and content ideas.

## Why Qloo

Taste is the difference. Qloo connects what someone loves in one domain (music, film, food) to what they'll love in another (hotels, restaurants, neighbourhoods), without personal data. Backline uses that link at every step: the taste profile, the heatmap that picks the neighbourhood, the place search itself, the match on every card and the reasons in the plan.

## Success measures

| Measure | Target |
|---|---|
| Sentence to finished plan | Under 2 minutes |
| Plans where every need is covered | 95% or more |
| Places and prices that are real (from a source) | 100%, enforced in code |
| Plans that show a taste profile when the user gave one | 100% |

## Risks

| Risk | Mitigation |
|---|---|
| Qloo has thin data for a city or a taste | The plan still works on distance, ratings and budget, and says so |
| The model invents places or prices | Only ids from searches can be picked; contacts and prices must appear in their source |
| A service is slow or down | Fixed time budgets, fallbacks for every provider, an autopilot when the model stalls |
| Booking on the user's behalf goes wrong | One sealed approval for the exact plan shown; prepayments held and captured in the database; refunds when a booking can't go ahead; calls fail closed to the person's own phone in the demo |
