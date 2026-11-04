# 0005. Google's photoreal 3D tiles for the city, satellite as fallback

**Status:** Accepted, November 2026

## Context
Painted 3D buildings looked fake. The trip should be seen on the real city.

## Decision
With `NEXT_PUBLIC_GOOGLE_MAPS_KEY`, the city is Google's Photorealistic 3D Tiles drawn with three.js inside MapLibre. Routes are ribbons laid on the measured street height and depth-tested against buildings. The trip's views load quietly in the background before Fly the trip, and loaded tiles stay cached.

## Consequences
Costs per tile load (billing must be on; the key is restricted to the site). Heavy on low-end devices, so caches are sized by device. Without the key, satellite imagery with terrain and extruded buildings is used.
