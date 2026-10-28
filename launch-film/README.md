# Backline launch film

A 42-second launch film for Backline, built entirely in code. There is no editing timeline: every
frame is a pure function of time, `seek(t)`, so any moment can be drawn from scratch and the
film renders the same way every time.

## What it shows (in order)

| Time | Beat | Scene |
| --- | --- | --- |
| 0–4 s | 0–8 | Logo bars spring in, the wordmark squeezes into a black pill: "Say where." |
| 4–10 s | 8–20 | 3D fly-over of the real landing page (captured from the live site), depth of field, lifted chips and cards |
| 10–14 s | 20–28 | The prompt: "4 days in Paris the way Pharrell would", Check with me / Just do it switch, send |
| 14–18 s | 28–36 | Taste panel from Qloo: affinity 89, top picks with scores, vibes, fans |
| 18–24 s | 36–48 | Dot-matrix globe: starts at the visitor's city (New York), flies to Paris, taste columns rise |
| 24–28 s | 48–56 | Day plan: stops, route, hotel with rooms available, "Chosen for your taste and budget" |
| 28–31 s | 56–62.5 | One payment slip for the whole trip, every line ticked, Approve & pay → Paid |
| 31–33 s | 62.5–66 | Wallet counts down $20,000.00 → $15,014.21, verified traveller |
| 33–37 s | 66–74 | Live phone call to the restaurant, transcript bubbles, "Confirmed"; then the concierge call |
| 37–42 s | 74–84 | Voice orb floods the frame, lands as the hero card: "One sentence in. A whole trip, booked." |

Every figure on screen comes from one real Backline run on 28 Oct 2026 (`data.js`). Money is in
US dollars and the balance is the demo wallet.

## How it is built

- `core.js`: beat grid (120 BPM, `B(n)`), closed-form springs (`springStep`, `track`), easing.
  No timers and no CSS transitions anywhere.
- `scenes.js`: one morphing shape carries the film from scene to scene, plus the camera,
  cursor and click paths.
- `film.html`: the 1920×1080 stage.
- `score.py`: an original score and sound design, synthesised with numpy and placed on the
  same beat grid as the picture. No licensed audio.
- `capture.mjs`: captures the landing page and the pieces that lift during the fly-over.

## Render

```bash
npm install                      # fonts used by the capture
npm run serve                    # in one terminal (serves this folder on :8800)
node still.mjs 10 20 30          # stills/s_T.png for checking
./segs.sh 0 & ./segs.sh 1      # 60 fps, 4 motion-blur subframes, six 7 s segments in two workers (resumable)
npm run score                    # score.wav
ffmpeg -i score.wav -af loudnorm=I=-14:TP=-1:LRA=11 score_norm.wav
./assemble.sh                    # join segments, mux the score, square cut, contact sheet
```

Playwright comes from `apps/web`. `node purity.mjs` checks that a sequential render and a direct
seek draw the same pixels; run it after changing `scenes.js`.
