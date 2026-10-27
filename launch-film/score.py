"""Original score and sound design for the Backline launch film.

120 BPM, 42 s, every hit placed on the same beat grid the picture uses (B(n) = n * 0.5 s).
Writes score.wav (music + SFX, 48 kHz stereo). Loudness is normalised later with ffmpeg.
"""
import numpy as np
from scipy.signal import butter, sosfilt

SR = 48000
BPM = 120
SPB = 60 / BPM
DUR = 42.0
N = int(SR * (DUR + 1.5))
rng = np.random.default_rng(7)

def B(n):
    return n * SPB

L = np.zeros(N)
R = np.zeros(N)
PL = np.zeros(N)
PR = np.zeros(N)
KICKS = []

def putpad(sig, t, gain=1.0):
    i = int(t * SR)
    sig = sig[: N - i] * gain
    PL[i:i+len(sig)] += sig; PR[i:i+len(sig)] += sig

def put(sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N:
        return
    sig = sig[: N - i] * gain
    l = np.cos((pan + 1) * np.pi / 4)
    r = np.sin((pan + 1) * np.pi / 4)
    L[i : i + len(sig)] += sig * l * 1.414
    R[i : i + len(sig)] += sig * r * 1.414

def lp(x, f, order=2):
    return sosfilt(butter(order, min(f, SR / 2 - 100) / (SR / 2), "low", output="sos"), x)

def hp(x, f, order=2):
    return sosfilt(butter(order, f / (SR / 2), "high", output="sos"), x)

def bp(x, a, b, order=2):
    return sosfilt(butter(order, [a / (SR / 2), b / (SR / 2)], "band", output="sos"), x)

def env(n, a=0.005, d=0.2, s=0.0, rel=0.05, hold=0.0):
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-6), 1.0)
    dec = np.exp(-(t - a) / max(d, 1e-6)) * (1 - s) + s
    e = np.where(t >= a, dec, e)
    if hold:
        e = np.where(t > hold, e * np.exp(-(t - hold) / rel), e)
    return e

def tt(sec):
    return np.arange(int(sec * SR)) / SR

def midi(m):
    return 440 * 2 ** ((m - 69) / 12)

def saw(f, sec, detune=(0,), phase_seed=0):
    t = tt(sec)
    out = np.zeros_like(t)
    for d in detune:
        ff = f * 2 ** (d / 1200)
        ph = rng.random()
        out += 2 * ((t * ff + ph) % 1) - 1
    return out / len(detune)

# ---------------- drums ----------------
def kick(g=1.0):
    t = tt(0.45)
    f = 48 + 110 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-t / 0.16)
    s += 0.25 * hp(rng.standard_normal(len(t)), 3000) * np.exp(-t / 0.004)
    return np.tanh(s * 1.6) * g * 0.5

def clap():
    t = tt(0.35)
    n = bp(rng.standard_normal(len(t)), 900, 5200)
    e = np.zeros_like(t)
    for o in (0, 0.011, 0.022):
        e += np.where(t >= o, np.exp(-(t - o) / 0.006), 0)
    e += np.where(t >= 0.03, np.exp(-(t - 0.03) / 0.09), 0) * 0.6
    return n * e * 0.55

def hat(open_=False):
    t = tt(0.3 if open_ else 0.06)
    n = hp(rng.standard_normal(len(t)), 7500, 4)
    return n * np.exp(-t / (0.09 if open_ else 0.014)) * 0.32

# ---------------- tonal ----------------
# Fmaj9 - G6 - Am9 - Em7 (bright, forward). Two bars each chord = 8 beats.
CHORDS = [
    [53, 57, 60, 64, 67],  # Fmaj9
    [55, 59, 62, 64, 71],  # G6/add9
    [57, 60, 64, 67, 71],  # Am9
    [52, 55, 59, 62, 66],  # Em7add9
]
ROOTS = [41, 43, 45, 40]

def pad(notes, sec, cutoff=1800, g=0.12):
    s = np.zeros(int(sec * SR))
    for m in notes:
        s += saw(midi(m), sec, detune=(-9, 0, 8))
    s = lp(s, cutoff, 2)
    e = np.minimum(1, tt(sec) / 0.25) * np.minimum(1, (sec - tt(sec)) / 0.3)
    return s * e * g / len(notes) * 3

def pluck(m, sec=0.32, g=0.16, cut=4200):
    t = tt(sec)
    s = saw(midi(m), sec, detune=(-6, 6))
    s = lp(s, cut, 2) * np.exp(-t / 0.11)
    return s * g

def bassnote(m, sec, g=0.42):
    t = tt(sec)
    s = np.sin(2 * np.pi * midi(m) * t) + 0.35 * lp(saw(midi(m + 12), sec), 900)
    e = np.minimum(1, t / 0.006) * np.exp(-t / 0.35) * np.minimum(1, (sec - t) / 0.02)
    return np.tanh(s * e * 1.4) * g

def chord_at(beat):
    return int(beat // 8) % 4

# Arrangement (beats):
#  0-8    open: pad + pluck arp, gentle
#  8-20   fly: hats + soft kick from 12, arp, riser into 20
#  20-66  main groove: kick, clap, hats, bass, pad, arp
#  66-74  call: breakdown, kick out, bass sustained, pad low-pass
#  74-76  riser
#  76     hit, end chords ring out to 84 and tail
for bar in range(0, 21):
    b0 = bar * 4
    ci = chord_at(b0)
    # pad per 2 bars
    if bar % 2 == 0:
        sec = B(8)
        cut = 900 if b0 < 8 else 1500 if b0 < 20 else 2400
        if 66 <= b0 < 74:
            cut = 800
        if b0 >= 76:
            cut = 2600
        g = 0.26 if b0 < 20 else 0.24
        if b0 < 76 or b0 == 76:
            putpad(pad(CHORDS[ci], sec + 0.4, cut, g), B(b0))
    for q in range(4):
        beat = b0 + q
        if beat >= 84:
            continue
        # arp: 8ths
        notes = CHORDS[ci]
        for e8 in range(2):
            bb = beat + e8 * 0.5
            if bb < 76 or bb >= 76:
                idx = (int(bb * 2) * 3) % len(notes)
                m = notes[idx] + 12
                gg = 0.14 if bb < 8 else 0.15 if bb < 20 else 0.12
                if 66 <= bb < 74:
                    gg = 0.09
                if bb >= 76:
                    gg = 0.1
                put(pluck(m, cut=2400 if bb < 20 else 4200, g=gg), B(bb), pan=0.35 if int(bb * 2) % 2 else -0.35)
        # drums
        groove = 20 <= beat < 66 or 76 <= beat < 82
        if groove or (12 <= beat < 20) or (beat >= 74 and beat < 76 and False):
            put(kick(0.7 if beat < 20 else 1.0), B(beat)); KICKS.append(B(beat))
        if groove and q in (1, 3):
            put(clap(), B(beat), pan=0.05)
        if beat >= 8 and (beat < 66 or 76 <= beat < 82):
            put(hat(), B(beat + 0.5), 1.0, pan=0.25)
            if beat >= 20:
                put(hat(), B(beat + 0.25), 0.45, pan=-0.2)
                put(hat(), B(beat + 0.75), 0.45, pan=-0.2)
            if beat >= 20 and q == 3:
                put(hat(True), B(beat + 0.5), 0.6, pan=0.3)
        # bass: 8ths off the kick during groove; long notes in breakdown
        root = ROOTS[ci]
        if groove:
            put(bassnote(root, B(0.5) * 0.9, 0.34), B(beat + 0.5))
            if q == 2:
                put(bassnote(root + 12, B(0.25) * 0.9, 0.25), B(beat + 0.75))
        elif 66 <= beat < 74 and q == 0:
            put(bassnote(root, B(4) * 0.95, 0.3), B(beat))

# ---------------- risers / impacts ----------------
def sweep_noise(sec, f0, f1, k):
    """Noise whose band centre moves from f0 to f1 following k (0..1), via crossfaded bands."""
    n = rng.standard_normal(int(sec * SR))
    bands = 18
    fs = f0 * (f1 / f0) ** (np.arange(bands) / (bands - 1))
    pos = np.clip(k, 0, 1) * (bands - 1)
    out = np.zeros_like(n)
    for j, f in enumerate(fs):
        w = np.clip(1 - np.abs(pos - j), 0, 1)
        if w.max() == 0:
            continue
        out += bp(n, f * 0.7, min(f * 1.45, 22000)) * w
    return out

def riser(sec, f0=300, f1=6000, g=0.22):
    k = tt(sec) / sec
    return sweep_noise(sec, f0, f1, k) * (k ** 2) * g

def whoosh(sec=0.6, g=0.25, up=True):
    k = tt(sec) / sec
    return sweep_noise(sec, 400, 4800, k if up else 1 - k) * np.sin(np.pi * k) ** 2 * g

def impact(g=0.9):
    t = tt(2.6)
    f = 38 + 70 * np.exp(-t / 0.08)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.9)
    s += 0.5 * lp(rng.standard_normal(len(t)), 2500) * np.exp(-t / 0.25)
    return np.tanh(s * 1.3) * g

def reverse_cymbal(sec=1.0, g=0.2):
    t = tt(sec)
    n = hp(rng.standard_normal(len(t)), 5000)
    return n * (t / sec) ** 3 * g

put(riser(B(4), 200, 5000, 0.16), B(16))  # into the prompt drop
put(reverse_cymbal(B(2), 0.22), B(18))
put(impact(0.55), B(20))
put(riser(B(2), 300, 8000, 0.25), B(74))  # orb -> card
put(reverse_cymbal(B(2), 0.28), B(74))
put(impact(1.0), B(76))
put(impact(0.5), B(84) - 0.02)

# ---------------- UI sound design ----------------
def click(g=0.35):
    t = tt(0.05)
    s = bp(rng.standard_normal(len(t)), 1800, 7000) * np.exp(-t / 0.004)
    s += 0.6 * np.sin(2 * np.pi * 2200 * t) * np.exp(-t / 0.008)
    return s * g

def key(g=0.12):
    t = tt(0.04)
    f = 2400 + rng.random() * 1400
    return (bp(rng.standard_normal(len(t)), f * 0.6, f * 1.5) * np.exp(-t / 0.005)) * g

def pop(m=84, g=0.18):
    t = tt(0.18)
    f = midi(m) * (1 + 0.6 * np.exp(-t / 0.01))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.05) * g

def chime(ms=(84, 88, 91, 96), g=0.16, gap=0.07):
    out = np.zeros(int(SR * 1.6))
    for i, m in enumerate(ms):
        t = tt(1.6 - i * gap)
        s = (np.sin(2 * np.pi * midi(m) * t) + 0.3 * np.sin(2 * np.pi * midi(m) * 2.01 * t)) * np.exp(-t / 0.45)
        j = int(i * gap * SR)
        out[j : j + len(s)] += s
    return out * g

def ring(sec=1.6, g=0.12):
    t = tt(sec)
    s = (np.sin(2 * np.pi * 440 * t) + np.sin(2 * np.pi * 480 * t)) * 0.5
    gate = ((t % 0.5) < 0.38).astype(float)
    gate = lp(gate, 60)
    return s * gate * np.minimum(1, (sec - t) / 0.05) * g

def whoop(g=0.2):
    # soft "sent" swish
    return whoosh(0.35, g, up=True)

# morph whooshes on every shape change
for beat in (20, 28, 36, 48, 56, 62.5, 66, 68, 72.5, 74, 75):
    put(whoosh(0.5, 0.16, up=True), B(beat) - 0.3, pan=0)
# fly-over camera air
put(whoosh(B(10), 0.07, up=False), B(8.5))

# logo bars: three pops (B(i*0.5)+0.05)
for i in range(3):
    put(pop(79 + i * 5, 0.16), B(i * 0.5) + 0.05, pan=(i - 1) * 0.3)
# wordmark squeeze and pill land
put(whoosh(0.4, 0.14), B(5.5) - 0.2)
put(pop(72, 0.18), B(5.5))

# clicks
for c in (B(21), B(25), B(27), B(37), B(55), B(61), B(73.2), B(74.6)):
    put(click(), c)
# switch flip
put(pop(76, 0.12), B(25) + 0.04)
# typing
s = "4 days in Paris the way Pharrell would"
for i, ch in enumerate(s):
    if ch != " ":
        put(key(), B(21.4) + i / 15 + rng.random() * 0.006, pan=rng.uniform(-0.15, 0.15))
# send
put(whoop(0.18), B(27) + 0.02)
# taste: score counters / vibes pops
for i in range(3):
    put(pop(86 + i * 3, 0.1), B(T_taste := 28) + 1.6 + i * 0.25)
for i in range(3):
    put(pop(84 + i * 2, 0.12), B(28 + 4.5) + i * 0.08)
# globe: plane departs, lands
put(whoosh(1.4, 0.12), B(40))
put(pop(79, 0.12), B(36 + 8.6))
# plan stops
for i in range(5):
    put(pop(79 + [0, 2, 4, 7, 9][i], 0.1), B(48 + 1 + i * 0.5))
put(pop(91, 0.13), B(48 + 5.5))  # stamp
# slip ticks
lines = [2, 1, 1, 5]
for gi, nlines in enumerate(lines):
    a = B(56 + 0.8 + gi * 0.55) + 0.08 + 0.25
    for k in range(nlines):
        put(pop(88 + gi * 2, 0.12), a + k * 0.012, pan=0.1)
# paid
put(chime((84, 88, 91, 96), 0.15), B(61) + 0.6)
# wallet count: soft ticker
for k in range(14):
    put(key(0.06), B(63.5) + k * (B(65.1) - B(63.5)) / 14)
put(chime((91, 96), 0.1), B(65.2))  # verified
# phone call
put(ring(1.0, 0.1), B(66) + 0.15)
for i in range(3):
    put(pop(81 + i * 2, 0.08), B(68 + 0.6 + i * 1.1))
put(chime((86, 89, 93), 0.13), B(71.6))
put(ring(0.6, 0.08), B(72.5) + 0.15)
# end titles words
for i in range(3):
    put(pop(96, 0.05), B(76) + 0.7 + i * 0.06)

# ---------------- master ----------------
duck = np.ones(N)
tk = np.arange(int(0.42 * SR)) / SR
shape = 1 - 0.55 * np.exp(-tk / 0.12)
for k in KICKS:
    i = int(k * SR); duck[i:i+len(shape)] = np.minimum(duck[i:i+len(shape)], shape[: N - i])
L += PL * duck; R += PR * duck
mix = np.stack([L, R], 1)
# gentle bus glue: soft clip
mix = np.tanh(mix * 0.9) / 0.9
fade = np.ones(N)
fend = int((DUR + 1.2) * SR)
fade[int((DUR - 0.6) * SR) : fend] = np.linspace(1, 0, fend - int((DUR - 0.6) * SR))
fade[fend:] = 0
mix *= fade[:, None]
mix = mix[: int(DUR * SR)]
mix /= np.abs(mix).max() / 0.89

import wave
with wave.open("score.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print("wrote score.wav", mix.shape[0] / SR, "s")
