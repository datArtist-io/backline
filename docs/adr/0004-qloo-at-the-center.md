# 0004. Qloo's taste ranks every pick

**Status:** Accepted, October 2026

## Context
Maps and search find places; they don't know the person. Backline's promise is a trip that fits who you are.

## Decision
Before the agent searches, Qloo turns what the person loves into a taste profile (entities, tags, a heatmap zone in the city). Every search is centred on that zone and ranked by Qloo's affinity; stays, restaurants, activities and events show their Qloo score and why they fit. Calls to Qloo are limited to five at a time so bursts don't time out.

## Consequences
Picks are explainable ("Because you love …"). When Qloo is slow, map results still arrive and say they aren't taste-matched.
