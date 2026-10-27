// The Backline launch film. One timeline; seek(t) draws any moment from scratch.
const $ = (id) => document.getElementById(id);
const D = window.DATA;
const W = 1920, H = 1080;
const EVENTS = []; // [time, kind] for the sound pass
const ev = (t, k) => EVENTS.push([t, k]);

// ---------- scene times (beats) ----------
const T = {
  open: 0, fly: 8, prompt: 20, taste: 28, globe: 36, plan: 48, slip: 56, wallet: 62.5, island: 66, call: 68, island2: 72.5, orb: 74, flood: 75, card: 76, end: 84,
};

// ---------- colour helpers ----------
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixc = (a, b, k) => { const x = hex(a), y = hex(b); return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], k))).join(",")})`; };

// ---------- shape states ----------
const SH = {
  prompt: { x: 960, y: 470, w: 1240, h: 120, r: 60, c: "#ffffff" },
  taste: { x: 960, y: 540, w: 1040, h: 820, r: 52, c: "#10132b" },
  globe: { x: 960, y: 540, w: 880, h: 880, r: 440, c: "#060a20" },
  plan: { x: 960, y: 540, w: 1320, h: 780, r: 48, c: "#ffffff" },
  slip: { x: 960, y: 540, w: 880, h: 1000, r: 48, c: "#fbfaf7" },
  wallet: { x: 960, y: 540, w: 940, h: 580, r: 48, c: "#0d0f22" },
  island: { x: 960, y: 140, w: 600, h: 104, r: 52, c: "#000000" },
  call: { x: 960, y: 560, w: 1000, h: 760, r: 64, c: "#000000" },
  island2: { x: 960, y: 140, w: 640, h: 104, r: 52, c: "#000000" },
  orb: { x: 960, y: 560, w: 280, h: 280, r: 140, c: "#7b5cff" },
  flood: { x: 960, y: 560, w: 2600, h: 2600, r: 1300, c: "#7b5cff" },
  card: { x: 960, y: 712, w: 1000, h: 625, r: 38, c: "#7b5cff" },
};
const SEQ = [["prompt", T.prompt], ["taste", T.taste], ["globe", T.globe], ["plan", T.plan], ["slip", T.slip], ["wallet", T.wallet], ["island", T.island], ["call", T.call], ["island2", T.island2], ["orb", T.orb], ["flood", T.flood], ["card", T.card]];

function shapeAt(t) {
  const keys = (p) => SEQ.map(([n, b], i) => [i === 0 ? -99 : B(b), SH[n][p], n === "flood" ? 22 : n === "card" ? 11 : 13]);
  const g = {};
  for (const p of ["x", "y", "w", "h", "r"]) g[p] = track(t, keys(p));
  // Colour: eased change over 0.3 s from each switch.
  let c = SH.prompt.c;
  for (let i = 1; i < SEQ.length; i++) {
    const [n, b] = SEQ[i];
    const k = eInOut(inv(B(b), B(b) + 0.3, t));
    if (k > 0) c = k >= 1 ? SH[n].c : mixc(SH[SEQ[i - 1][0]].c, SH[n].c, k);
  }
  g.c = c;
  g.r = Math.min(g.r, g.w / 2, g.h / 2);
  return g;
}

// ---------- build once ----------
const shape = $("shape");
const L = {};
function layer(name, w, h, html) {
  const el = document.createElement("div");
  el.className = "layer";
  el.style.inset = "auto";
  el.style.left = "50%";
  el.style.top = "50%";
  el.style.width = w + "px";
  el.style.height = h + "px";
  el.style.marginLeft = -w / 2 + "px";
  el.style.marginTop = -h / 2 + "px";
  el.innerHTML = html;
  shape.appendChild(el);
  L[name] = el;
  return el;
}

const mic = `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#10132b" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;
const arrow = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
const checkSvg = (c = "#fff", s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 12 12"><path d="M2.4 6.3l2.3 2.3 4.9-5" fill="none" stroke="${c}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function build() {
  // background gel blobs
  // open: logo bars + wordmark
  const word = $("word");
  word.innerHTML = "backline".split("").map((ch) => `<span>${ch}</span>`).join("");

  // fly-over
  for (const id of ["pgSharp", "pgBlur"]) $(id).style.backgroundImage = "url(capture/base.jpg)";
  const plane = $("plane");
  const pp = document.createElement("div");
  pp.id = "pp";
  pp.className = "abs";
  pp.style.overflow = "hidden";
  pp.innerHTML = `<div class="abs" style="inset:0;background:url(capture/${window.PIECES.find((x) => x.sel === ".prompt").img}) center/cover"></div><div id="ppw" class="abs" style="inset:0;background:#fff"></div>`;
  $("fly").after(pp);
  for (const p of window.PIECES) {
    const d = document.createElement("div");
    d.className = "piece";
    d.style.left = p.x + "px";
    d.style.top = p.y + "px";
    d.style.width = p.w + "px";
    d.style.height = p.h + "px";
    d.style.backgroundImage = `url(capture/${p.img})`;
    d.style.borderRadius = p.sel === ".voice-card" ? "30px" : p.sel === ".caps-panel" ? "34px" : "999px";
    plane.appendChild(d);
    p.el = d;
  }

  // prompt
  layer("prompt", 1240, 120, `
    <div class="ph" id="ph">Where are you going, and when?</div>
    <div class="typed" id="typed"></div>
    <div class="ibtn" id="micb" style="right:120px;background:rgba(16,19,43,.06)">${mic}</div>
    <div class="ibtn" id="send" style="right:14px;background:linear-gradient(135deg,#7b5cff,#ff4fa3)">${arrow}</div>`);

  // taste
  const rows = D.taste.rows.map((r, i) => `<div class="row" id="row${i}" style="top:${300 + i * 110}px"><span class="k">${r[0]}</span><span class="v">${r[1]}</span><span class="s" id="sc${i}">0.000</span></div>`).join("");
  layer("taste", 1040, 820, `
    <div class="abs" id="tEy" style="left:64px;top:62px;font-size:20px;font-weight:700;letter-spacing:.12em;color:#b9a8ff">YOUR TASTE, BY QLOO</div>
    <div class="abs" style="left:64px;top:104px;width:760px;font-family:UB;font-weight:400;font-size:44px;line-height:1.18;letter-spacing:-.035em;color:#fff" id="tTitle"></div>
    <div class="abs" id="ring" style="right:64px;top:64px;width:132px;height:132px">
      <svg width="132" height="132" viewBox="0 0 132 132"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b9a8ff"/><stop offset="1" stop-color="#ff4fa3"/></linearGradient></defs>
      <circle cx="66" cy="66" r="56" stroke="rgba(255,255,255,.1)" stroke-width="10" fill="none"/>
      <circle id="ringArc" cx="66" cy="66" r="56" stroke="url(#rg)" stroke-width="10" fill="none" stroke-linecap="round" transform="rotate(-90 66 66)" stroke-dasharray="351.9" stroke-dashoffset="351.9"/></svg>
      <div class="abs" id="ringNum" style="inset:0;display:grid;place-items:center;font-family:UB;font-size:40px;color:#fff">0</div>
      <div class="abs" style="top:142px;left:-20px;right:-20px;text-align:center;font-size:17px;color:#a9acc9;font-weight:600">Qloo affinity</div>
    </div>
    ${rows}
    <div class="abs" id="vibes" style="left:64px;top:640px;display:flex;gap:12px">${D.taste.vibes.map((v, i) => `<span id="vb${i}" style="height:52px;padding:0 24px;border-radius:26px;background:rgba(185,168,255,.16);color:#d9cfff;font-size:22px;font-weight:700;line-height:52px">${v}</span>`).join("")}</div>
    <div class="abs" id="fans" style="left:64px;top:730px;font-size:24px;color:#a9acc9">Your taste peaks around <b style="color:#ff8bc5">${D.taste.zone}</b> · fans like you love <b style="color:#fff">${D.taste.fans}</b></div>`);

  // globe
  layer("globe", 880, 880, `<canvas id="gc" width="880" height="880" style="position:absolute;inset:0"></canvas><div id="glabels" class="abs" style="inset:0"></div>`);

  // plan
  const stops = D.day.stops.map((s, i) => `<div class="stop" id="st${i}" style="top:${190 + i * 84}px"><span class="tm">${s[0]}</span><span class="dt" style="background:${s[3]};box-shadow:0 0 0 6px ${s[3]}22"></span><span>${s[1]}</span>${s[2] ? `<span class="rk">${s[2]}</span>` : ""}</div>`).join("");
  layer("plan", 1320, 780, `
    <div class="abs" style="left:60px;top:58px;font-size:20px;font-weight:700;letter-spacing:.12em;color:#7b5cff">${D.trip.city.toUpperCase()} · ${D.trip.dates.toUpperCase()}</div>
    <div class="abs" id="pTitle" style="left:60px;top:94px;font-family:UB;font-weight:400;font-size:42px;letter-spacing:-.035em">${D.day.label}</div>
    <div class="abs" id="wx" style="right:60px;top:66px;height:56px;padding:0 24px;border-radius:28px;background:#f1effa;display:flex;align-items:center;gap:12px;font-size:24px;font-weight:600">☁︎ ${D.day.weather}</div>
    <div class="abs" id="route" style="left:229px;top:226px;width:3px;border-radius:2px;background:linear-gradient(#7b5cff,#ff9a3d)"></div>
    ${stops}
    <div class="abs" id="hotel" style="right:56px;top:200px;width:420px;height:400px;border-radius:32px;background:#10132b;color:#fff;overflow:hidden">
      <div class="abs" style="inset:0;background:radial-gradient(circle at 30% 20%,#7b5cff 0,transparent 55%),radial-gradient(circle at 90% 90%,#ff4fa3 0,transparent 50%);opacity:.55"></div>
      <div class="abs" style="left:32px;top:30px;font-size:17px;font-weight:700;letter-spacing:.12em;color:#c9bdff">WHERE YOU’LL STAY</div>
      <div class="abs" style="left:32px;top:62px;font-family:UB;font-size:34px;line-height:1.15;letter-spacing:-.03em">${D.day.hotel}</div>
      <div class="abs" id="avail" style="left:32px;top:196px;height:48px;padding:0 18px;border-radius:24px;background:rgba(255,255,255,.12);display:flex;align-items:center;gap:10px;font-size:20px;font-weight:600"><span style="width:12px;height:12px;border-radius:50%;background:#3ddc84"></span>Rooms available · ${D.trip.dates}</div>
      <div class="abs" id="stamp" style="left:32px;top:268px;height:64px;padding:0 24px;border-radius:32px;background:#fff;color:#10132b;display:flex;align-items:center;gap:12px;font-size:22px;font-weight:700"><span style="width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(140deg,#7b5cff,#ff4fa3)">${checkSvg()}</span>Chosen for your taste and budget</div>
    </div>
    <div class="abs" id="rbook" style="right:56px;bottom:56px;height:76px;padding:0 40px;border-radius:38px;background:#10132b;color:#fff;font-size:26px;font-weight:700;display:flex;align-items:center">Review &amp; book</div>`);

  // slip
  let y = 138, sh = "";
  let li = 0;
  D.slip.groups.forEach((g, gi) => {
    sh += `<div class="grp" id="g${gi}" style="top:${y}px">${g[0]}</div>`;
    y += 30;
    g[1].forEach((l) => {
      sh += `<div class="line" id="ln${li}" style="top:${y}px"><span class="tick" id="tk${li}"></span><span class="t">${l[0]}</span><span class="a">${l[1] ? fmtUSD(l[1]) : ""}</span></div>`;
      y += 56;
      li++;
    });
    y += 12;
  });
  L.slipLines = li;
  layer("slip", 880, 1000, `
    <div class="abs" style="left:56px;top:40px;font-family:UB;font-weight:400;font-size:38px;letter-spacing:-.035em">One payment, the whole trip</div>
    <div class="abs" style="left:56px;top:92px;font-size:20px;color:#8b8f9e">Everything you’ll pay for, in US dollars</div>
    ${sh}
    <div class="abs" id="pay" style="left:56px;right:56px;bottom:52px;height:88px;border-radius:44px;background:#10132b;color:#fff;display:flex;align-items:center;justify-content:center;gap:14px;font-size:28px;font-weight:700"><span id="payTxt">Approve &amp; pay</span></div>`);

  // wallet
  layer("wallet", 940, 580, `
    <div class="abs" style="inset:0;background:radial-gradient(circle at 85% 10%,rgba(123,92,255,.55),transparent 50%),radial-gradient(circle at 10% 100%,rgba(255,79,163,.4),transparent 55%)"></div>
    <div class="abs" style="left:60px;top:56px;display:flex;align-items:center;gap:14px;color:#fff;font-size:24px;font-weight:700"><svg width="34" height="34" viewBox="0 0 64 64"><rect x="5" y="9" width="30" height="12" rx="6" fill="#fff"/><rect x="5" y="26" width="42" height="12" rx="6" fill="#fff"/><rect x="5" y="43" width="54" height="12" rx="6" fill="#fff"/></svg>Backline Wallet</div>
    <div class="abs" style="right:60px;top:60px;color:#c9bdff;font-size:20px;font-weight:600">Demo balance · USD</div>
    <div class="abs" style="left:60px;top:200px;color:#a9acc9;font-size:22px">Balance</div>
    <div class="abs" id="bal" style="left:56px;top:236px;color:#fff;font-family:UB;font-weight:400;font-size:96px;letter-spacing:-.04em;font-variant-numeric:tabular-nums"></div>
    <div class="abs" id="paid" style="left:60px;bottom:60px;height:56px;padding:0 22px;border-radius:28px;background:rgba(255,255,255,.1);color:#fff;display:flex;align-items:center;gap:12px;font-size:22px;font-weight:600"></div>
    <div class="abs" id="kyc" style="right:60px;bottom:60px;height:56px;padding:0 22px;border-radius:28px;background:#fff;color:#10132b;display:flex;align-items:center;gap:12px;font-size:22px;font-weight:700"><span style="width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(140deg,#7b5cff,#ff4fa3)">${checkSvg("#fff", 14)}</span>Verified traveller</div>`);

  // island + call
  const wave = Array.from({ length: 9 }, (_, i) => `<span class="wv" id="wv${i}" style="position:absolute;left:${i * 9}px;width:5px;border-radius:3px;background:#3ddc84"></span>`).join("");
  layer("island", 600, 104, `
    <div class="abs" style="left:24px;top:22px;width:60px;height:60px;border-radius:50%;background:linear-gradient(140deg,#ff9a3d,#ff4fa3);display:grid;place-items:center;color:#fff;font-family:UB;font-size:24px">M</div>
    <div class="abs" style="left:102px;top:22px;color:#fff;font-size:24px;font-weight:700;white-space:nowrap" id="isTitle">Calling Le Café Marly</div>
    <div class="abs" style="left:102px;top:56px;color:#8b8f9e;font-size:20px;white-space:nowrap" id="isSub">Backline AI agent · <span id="tmr">0:00</span></div>
    <div class="abs" style="right:34px;top:30px;width:80px;height:44px">${wave}</div>`);
  layer("call", 1000, 760, `
    <div class="abs" style="left:56px;top:50px;display:flex;align-items:center;gap:16px;color:#fff"><span style="width:64px;height:64px;border-radius:50%;background:linear-gradient(140deg,#ff9a3d,#ff4fa3);display:grid;place-items:center;font-family:UB;font-size:26px">M</span><span><b style="font-size:28px;display:block">Le Café Marly</b><span style="font-size:20px;color:#8b8f9e">Live AI call · <span id="tmr2"></span></span></span></div>
    <div class="abs" style="right:56px;top:66px;height:40px;padding:0 16px;border-radius:20px;background:rgba(61,220,132,.16);color:#3ddc84;font-size:18px;font-weight:700;line-height:40px">● LIVE</div>
    <div class="bub" id="bb0" style="left:56px;top:170px;background:#1c1f33;color:#fff">Hi, I’m Backline’s AI assistant, calling for Josiah. Could I book a table for two on Monday at 1:30 pm?</div>
    <div class="bub" id="bb1" style="right:56px;top:318px;background:#f2f0ea;color:#10132b">Yes, 1:30 for two works. Under Josiah?</div>
    <div class="bub" id="bb2" style="left:56px;top:430px;background:#1c1f33;color:#fff">Yes please. Thank you!</div>
    <div class="abs" id="conf" style="left:56px;right:56px;bottom:56px;height:96px;border-radius:30px;background:#fff;display:flex;align-items:center;gap:18px;padding:0 30px;box-sizing:border-box;font-size:26px;font-weight:700;color:#10132b"><span style="width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(140deg,#7b5cff,#ff4fa3)">${checkSvg("#fff", 20)}</span>Confirmed · Table for 2 · Mon 2 Nov, 1:30 pm</div>`);
  layer("island2", 640, 104, `
    <div class="abs" style="left:24px;top:22px;width:60px;height:60px;border-radius:50%;background:#fff;display:grid;place-items:center"><svg width="36" height="36" viewBox="0 0 64 64"><defs><linearGradient id="gl" x1="8" y1="6" x2="58" y2="60" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ff4fa3"/><stop offset=".5" stop-color="#7b5cff"/><stop offset="1" stop-color="#38d3ff"/></linearGradient></defs><rect x="5" y="9" width="30" height="12" rx="6" fill="url(#gl)"/><rect x="5" y="26" width="42" height="12" rx="6" fill="url(#gl)"/><rect x="5" y="43" width="54" height="12" rx="6" fill="url(#gl)"/></svg></div>
    <div class="abs" style="left:102px;top:22px;color:#fff;font-size:24px;font-weight:700;white-space:nowrap">Backline concierge</div>
    <div class="abs" style="left:102px;top:56px;color:#8b8f9e;font-size:20px;white-space:nowrap">Your trip briefing is calling…</div>
    <div class="abs" id="ans" style="right:22px;top:22px;width:60px;height:60px;border-radius:50%;background:#3ddc84;display:grid;place-items:center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg></div>`);
  layer("orb", 280, 280, `
    <div class="abs" style="inset:0;border-radius:50%;background:radial-gradient(circle at 34% 28%,#fff 0,#c9b8ff 18%,#7b5cff 52%,#ff4fa3 86%)"></div>
    <div class="abs" style="inset:0;display:grid;place-items:center;color:#fff;font-size:26px;font-weight:700;text-align:center;line-height:1.25">${mic.replace('stroke="#10132b"', 'stroke="#fff"')}<br/>Tap to talk</div>`);
  layer("card", 1000, 625, `<div class="abs" id="cardImg" style="inset:0;background:url(capture/hero.jpg) center/cover"></div>`);

  // end titles
  $("end").innerHTML = `
    <div class="abs" id="badge" style="left:50%;top:44px;height:56px;margin-left:-110px;width:220px;border-radius:28px;background:#fff;box-shadow:0 10px 30px -14px rgba(16,19,43,.35);display:flex;align-items:center;justify-content:center;gap:12px;font-family:UB;font-weight:500;font-size:24px;letter-spacing:-.03em"><svg width="30" height="30" viewBox="0 0 64 64"><use href="#gl"/><rect x="5" y="9" width="30" height="12" rx="6" fill="url(#gl)"/><rect x="5" y="26" width="42" height="12" rx="6" fill="url(#gl)"/><rect x="5" y="43" width="54" height="12" rx="6" fill="url(#gl)"/></svg>backline</div>
    <div class="ttl" id="l1" style="top:126px;font-family:UB;font-weight:400;font-size:74px;letter-spacing:-.045em"></div>
    <div class="ttl" id="l2" style="top:206px;font-family:IS;font-style:italic;font-size:86px;color:#8b8b92;letter-spacing:-.01em"></div>
    <div class="ttl" id="url" style="top:1018px;font-size:24px;font-weight:600;color:#5b5f7a"></div>`;
  $("l1").innerHTML = "One sentence in.".split(" ").map((w) => `<span class="w">${w}&nbsp;</span>`).join("");
  $("l2").innerHTML = "A whole trip, booked.".split(" ").map((w) => `<span class="w">${w}&nbsp;</span>`).join("");
  $("url").innerHTML = `backline-beta-one.vercel.app &nbsp;·&nbsp; Taste by Qloo`;

  // globe data
  const topo = window.LAND;
  const land = topojson.feature(topo, topo.objects.land);
  window.GLAND = land;
  const dots = [];
  for (let lat = -58; lat <= 78; lat += 1.7) {
    const step = 1.7 / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
    for (let lon = -180; lon < 180; lon += step) if (d3.geoContains(land, [lon, lat])) dots.push([lon, lat]);
  }
  window.GDOTS = dots;
}

// ---------- scenes ----------
const NYC = [-74.006, 40.7128], PARIS = [2.3522, 48.8566];
const PLACES = [
  ["Arc de Triomphe", [2.295, 48.8738], 0.909, "#38d3ff"],
  ["Le Café Marly", [2.3354, 48.8615], 0.84, "#ff9a3d"],
  ["Bistrot Vivienne", [2.3398, 48.8665], 0.908, "#ff9a3d"],
  ["Galerie Joseph", [2.3627, 48.8617], 0.863, "#ff4fa3"],
  ["Musée de l’Orangerie", [2.3226, 48.8638], 0.86, "#38d3ff"],
  ["Les Caves du Louvre", [2.3418, 48.8608], 0.84, "#ff4fa3"],
  ["Victoria Palace Hotel", [2.3279, 48.8459], 0.82, "#7b5cff"],
];

function bg(t) {
  const a = t * 0.12;
  css($("b1"), { left: 380 + Math.sin(a) * 120 + "px", top: -260 + Math.cos(a * 0.8) * 80 + "px" });
  css($("b2"), { left: 1180 + Math.cos(a * 0.9) * 140 + "px", top: 420 + Math.sin(a * 1.1) * 90 + "px" });
  css($("b3"), { left: -160 + Math.sin(a * 0.7) * 90 + "px", top: 560 + Math.cos(a) * 70 + "px" });
}

// OPEN: three bars spring in, the word rises beside them, everything squeezes into one black pill.
function open(t) {
  const on = t < B(T.fly + 1.2);
  $("open").style.display = on ? "" : "none";
  if (!on) return;
  const mx = 560, my = 540; // mark left edge + 140
  const sq = P(t, B(4.5), B(5.5), eInOut); // squeeze
  const lens = [150, 210, 270];
  for (let i = 0; i < 3; i++) {
    const g = springStep(t, B(i * 0.5) + 0.05, 15);
    const merge = sq; // bars merge into the bottom one
    const w = lens[i] * g;
    const y = my - 100 + i * 70;
    css($("bar" + i), {
      left: mx - 140 + "px",
      top: lerp(y, my + 40, merge) + "px",
      width: lerp(w, 270, merge) + "px",
      height: "56px",
      borderRadius: "28px",
      opacity: i < 2 && merge > 0.98 ? 0 : 1,
    });
  }
  // wordmark: letters rise out of a mask line, then squeeze into the bar (accordion)
  const word = $("word");
  css(word, { left: mx + 170 + "px", top: my - 80 + "px", clipPath: "inset(0 -40px 0 0)" });
  [...word.children].forEach((s, i) => {
    const r = springStep(t, B(1.5) + i * 0.045, 14);
    const k = sq;
    const dx = -(i * 92 + 180) * k; // move toward the mark
    css(s, { transform: `translate(${dx}px, ${(1 - r) * 170}px) scaleX(${1 - 0.9 * k})`, opacity: k > 0.92 ? 0 : 1 });
  });
  // the merged bar becomes the black pill, which grows and says "Say where."
  const pillK = springStep(t, B(5.5), 12);
  const pill = $("pill");
  const pw = lerp(270, 760, pillK), ph = lerp(56, 132, pillK);
  const pcx = lerp(mx - 140 + 135, 960, pillK), pcy = lerp(my + 68, 540, pillK);
  // hand-off to the page: the pill lands on the prompt in the fly-over and the page grows out of it
  const land = P(t, B(7.2), B(8), eInOut);
  const R = FLY0.prompt; // prompt rect on screen at fly start
  const fx = lerp(pcx, R.x + R.w / 2, land), fy = lerp(pcy, R.y + R.h / 2, land);
  const fw = lerp(pw, R.w, land), fh = lerp(ph, R.h, land);
  css(pill, {
    display: t > B(5.45) ? "grid" : "none",
    left: fx - fw / 2 + "px", top: fy - fh / 2 + "px", width: fw + "px", height: fh + "px", borderRadius: fh / 2 + "px",
    background: mixc("#0d0f22", "#ffffff", eInOut(inv(B(7.2), B(7.9), t))),
    opacity: t > B(8.05) ? 0 : 1,
  });
  const txt = $("pillText").firstChild;
  const rise = springStep(t, B(6.1), 14);
  const out = P(t, B(7.1), B(7.35), eIn);
  css(txt, { transform: `translateY(${(1 - rise) * 90 + out * -90}px)`, fontSize: lerp(46, 46, 0) + "px" });
  [0, 1, 2].forEach((i) => $("bar" + i).style.display = t > B(5.5) ? "none" : "");
}

// FLY-OVER: one continuous camera down the real landing page.
const PAGE = { w: 1440, h: 2280 };
const FLY0 = { prompt: { x: (380 * 1920) / 1440, y: 585 * (1920 / 1440) - 0 * 1, w: (680 * 1920) / 1440, h: (66 * 1920) / 1440 } };
function camera(t) {
  // page y under the frame centre, tilt and zoom (s = screen px per page px at the look-at point)
  const t0 = B(T.fly), t1 = B(T.prompt);
  const u = t - t0;
  // speed curve integrated: ease in, cruise, ease out
  const yStart = 405, yEnd = 2050;
  const glide = clamp((u - 0.25) / 3.7);
  const gk = glide < 0.18 ? 0.5 * (glide / 0.18) ** 2 * 0.36 : glide > 0.85 ? 1 - 0.5 * ((1 - glide) / 0.15) ** 2 * 0.3 : 0.18 * 0.5 * 0.36 / 0.18 + 0; // replaced below
  // use a smooth monotone ease for robustness
  const g = eInOut(glide);
  let y = lerp(yStart, yEnd, g);
  let tilt = 52 * P(t, t0 + 0.15, t0 + 1.0, eInOut);
  let s = 1920 / 1440;
  // rise: zoom out to the whole page, tilt flattens
  const rise = P(t, t0 + 4.0, t0 + 5.1, eInOut);
  tilt = lerp(tilt, 0, rise);
  y = lerp(y, PAGE.h / 2, rise);
  s = lerp(s, 1000 / PAGE.h, rise);
  // dive into the prompt bar so it becomes the big pill
  const dive = P(t, t0 + 5.25, t1, eInOut);
  const pr = { cx: 380 + 340, cy: 585 + 33, w: 680 };
  y = lerp(y, pr.cy, dive);
  const sDive = SH.prompt.w / pr.w;
  s = Math.exp(lerp(Math.log(s), Math.log(sDive), dive));
  // horizontal: keep the page centre except during the dive (prompt is centred anyway)
  const yScreen = lerp(540, SH.prompt.y, dive);
  return { y, tilt, s, yScreen, dive, rise };
}
// prompt's screen rect at fly start (flat, s = 1.333, y = 405 at 540)
(function () { const s = 1920 / 1440; FLY0.prompt = { x: 960 + (380 - 720) * s, y: 540 + (585 - 405) * s, w: 680 * s, h: 66 * s }; })();

function fly(t) {
  const on = t >= B(T.fly) - 0.001 && t < B(T.prompt) + 0.02;
  $("fly").style.display = on ? "" : "none";
  if (!on) { $("pp").style.display = "none"; return; }
  const c = camera(t);
  const plane = $("plane");
  // place the look-at point (720, c.y) at (960, yScreen); rotate about it.
  css(plane, {
    transformOrigin: `720px ${c.y}px`,
    transform: `translate(${960 - 720}px, ${c.yScreen - c.y}px) scale(${c.s}) rotateX(${c.tilt}deg)`,
  });
  $("fly").style.perspectiveOrigin = `960px ${c.yScreen - 120 * (c.tilt / 52)}px`;
  // the page grows out of the pill at the start
  const rev = P(t, B(T.fly) - 0.5, B(T.fly) + 0.35, eInOut);
  const R = FLY0.prompt;
  const ins = (a, b) => lerp(a, 0, rev);
  $("fly").style.clipPath = rev >= 1 ? "none" : `inset(${ins(R.y)}px ${ins(1920 - R.x - R.w)}px ${ins(1080 - R.y - R.h)}px ${ins(R.x)}px round ${lerp(R.h / 2, 0, rev)}px)`;
  // depth of field: blurred copy masked away around the focus line
  const f = c.y;
  const band = 120 + 900 * c.rise;
  const tiltK = c.tilt / 52;
  const m = `linear-gradient(180deg, #000 0, #000 ${f - band - 380}px, transparent ${f - band}px, transparent ${f + band * 0.6}px, #000 ${f + band * 0.6 + 260}px, #000 100%)`;
  css($("pgBlur"), { maskImage: m, webkitMaskImage: m, opacity: tiltK });
  // hand-off: the page falls away under the prompt bar, which stays pinned and turns into the pill
  const fall = P(t, B(T.prompt) - 0.42, B(T.prompt), eIn);
  if (fall > 0) plane.style.transform += ` translateY(${fall * 1600}px)`;
  const pp = $("pp");
  const pinned = t >= B(T.prompt) - 0.42;
  pp.style.display = pinned ? "" : "none";
  if (pinned) {
    const pw = 680 * c.s, ph = 66 * c.s;
    css(pp, { left: 960 - pw / 2 + "px", top: c.yScreen - ph / 2 + "px", width: pw + "px", height: ph + "px", borderRadius: ph / 2 + "px" });
    $("ppw").style.opacity = String(P(t, B(T.prompt) - 0.25, B(T.prompt), eInOut));
  }
  // lifted pieces
  for (const p of window.PIECES) {
    if (p.sel === ".prompt") p.el.style.visibility = pinned ? "hidden" : "visible";
    const cy = p.y + p.h / 2;
    const d = cy - c.y; // >0 below the focus (nearer the lens at the bottom of the frame)
    const near = clamp(1 - Math.abs(d) / 700);
    const kind = p.sel;
    const maxLift = kind === ".voice-card" ? 110 : kind === ".caps-panel" ? 70 : kind === ".try-chip" ? 80 : 40;
    const maxStand = kind === ".voice-card" ? 30 : kind === ".try-chip" ? 46 : kind === ".caps-panel" ? 20 : 10;
    const lift = maxLift * smooth(near) * tiltK;
    const stand = maxStand * smooth(near) * tiltK;
    const blur = Math.min(10, Math.abs(d) / 90) * tiltK;
    css(p.el, {
      transform: `translateZ(${lift}px) rotateX(${-stand}deg)`,
      filter: `blur(${blur.toFixed(2)}px) drop-shadow(0 ${8 + lift * 0.35}px ${10 + lift * 0.5}px rgba(26,33,51,${0.18 + 0.12 * near}))`,
    });
  }
}

// SHAPE + contents
function enterK(t, a) { return springStep(t, a, 15); }
function exitK(t, b) { return P(t, b - 0.22, b, eIn); }
function show(el, t, a, b, dy = 30) {
  const on = t >= a - 0.001 && t < b;
  el.style.display = on ? "" : "none";
  if (!on) return 0;
  const k = enterK(t, a), x = exitK(t, b);
  el.style.opacity = String(clamp(k * 1.4) * (1 - x));
  el.style.transform = `translateY(${(1 - k) * dy - x * 18}px) scale(${1 - x * 0.03})`;
  return k;
}

function drawShape(t) {
  const on = t >= B(T.prompt) && t < B(T.end);
  shape.style.display = on ? "" : "none";
  if (!on) return;
  const g = shapeAt(t);
  css(shape, {
    left: g.x - g.w / 2 + "px", top: g.y - g.h / 2 + "px", width: g.w + "px", height: g.h + "px", borderRadius: g.r + "px",
    background: g.c,
    boxShadow: t < B(T.taste) ? "inset 0 0 0 1.5px rgba(255,255,255,.9), 0 40px 80px -30px rgba(91,62,230,.5)" : "0 50px 110px -40px rgba(16,19,43,.55)",
  });
  // ---- prompt
  const kp = show(L.prompt, t, B(T.prompt), B(T.taste) - 0.05, 0);
  if (kp) {
    L.prompt.style.opacity = String(1 - exitK(t, B(T.taste) - 0.05));
    const s = "4 days in Paris the way Pharrell would";
    const tt = typed(t, B(21.4), s, 15);
    $("ph").style.display = tt ? "none" : "";
    const blink = Math.floor((t - B(21.4)) * 2.2) % 2 === 0 || tt.length < s.length;
    $("typed").innerHTML = tt + (t > B(21) && t < B(27.2) && blink ? '<span class="caret"></span>' : "");
    const press = 1 - 0.1 * Math.exp(-((t - B(27)) ** 2) / 0.004);
    $("send").style.transform = `translateY(-50%) scale(${press})`;
  }
  // ---- taste
  if (show(L.taste, t, B(T.taste) + 0.25, B(T.globe) - 0.05)) {
    const words = `Because you love ${D.taste.loves.join(", ")}`.split(" ");
    $("tTitle").innerHTML = words.map((w, i) => { const k = springStep(t, B(T.taste + 1) + i * 0.05, 15); return `<span class="w" style="transform:translateY(${(1 - k) * 40}px);opacity:${clamp(k * 1.5)}">${w}&nbsp;</span>`; }).join("");
    D.taste.rows.forEach((r, i) => {
      const a = B(T.taste + 2.5 + i * 0.5);
      const k = springStep(t, a, 15);
      css($("row" + i), { transform: `translateY(${(1 - k) * 60}px)`, opacity: clamp(k * 1.5) });
      $("sc" + i).textContent = count(t, a, a + 0.8, 0, r[2]).toFixed(3);
    });
    const rk = P(t, B(T.taste + 4.5), B(T.taste + 6), eOut);
    $("ringArc").setAttribute("stroke-dashoffset", String(351.9 * (1 - rk * D.taste.affinity / 100)));
    $("ringNum").textContent = String(Math.round(rk * D.taste.affinity));
    D.taste.vibes.forEach((v, i) => { const k = springStep(t, B(T.taste + 4.5) + i * 0.08, 18); css($("vb" + i), { display: "inline-block", transform: `scale(${k})`, opacity: clamp(k * 1.5) }); });
    const fk = springStep(t, B(T.taste + 6), 15);
    css($("fans"), { transform: `translateY(${(1 - fk) * 30}px)`, opacity: clamp(fk * 1.5) });
  }
  // ---- globe
  if (show(L.globe, t, B(T.globe) + 0.1, B(T.plan) - 0.05, 0)) drawGlobe(t);
  // ---- plan
  if (show(L.plan, t, B(T.plan) + 0.25, B(T.slip) - 0.05)) {
    D.day.stops.forEach((s, i) => {
      const k = springStep(t, B(T.plan + 1 + i * 0.5), 16);
      css($("st" + i), { transform: `translateX(${(1 - k) * -50}px)`, opacity: clamp(k * 1.6) });
    });
    const rl = P(t, B(T.plan + 1), B(T.plan + 4), eOut);
    css($("route"), { height: rl * (84 * (D.day.stops.length - 1)) + "px" });
    const hk = springStep(t, B(T.plan + 4.5), 13);
    css($("hotel"), { transform: `translateX(${(1 - hk) * 140}px) rotate(${(1 - hk) * 4}deg)`, opacity: clamp(hk * 1.5) });
    const ak = springStep(t, B(T.plan + 5), 16), sk = springStep(t, B(T.plan + 5.5), 18);
    css($("avail"), { transform: `scale(${0.6 + 0.4 * ak})`, opacity: clamp(ak * 1.5) });
    css($("stamp"), { transform: `scale(${lerp(1.6, 1, sk)}) rotate(${(1 - sk) * -8}deg)`, opacity: clamp(sk * 2) });
    const press = 1 - 0.08 * Math.exp(-((t - B(T.plan + 7)) ** 2) / 0.004);
    css($("rbook"), { transform: `scale(${press})` });
  }
  // ---- slip
  if (show(L.slip, t, B(T.slip) + 0.25, B(T.wallet) - 0.05)) {
    let li = 0, gi = 0;
    D.slip.groups.forEach((g) => {
      const ga = B(T.slip + 0.8 + gi * 0.55);
      const gk = springStep(t, ga, 16);
      css($("g" + gi), { opacity: clamp(gk * 1.5), transform: `translateY(${(1 - gk) * 16}px)` });
      g[1].forEach(() => {
        const a = ga + li * 0.0 + 0.08;
        const k = springStep(t, a, 16);
        css($("ln" + li), { opacity: clamp(k * 1.5), transform: `translateY(${(1 - k) * 24}px)` });
        const tk = springStep(t, a + 0.25, 18);
        const tick = $("tk" + li);
        tick.innerHTML = tk > 0.05 ? `<span style="position:absolute;inset:0;border-radius:50%;display:grid;place-items:center;background:linear-gradient(140deg,#7b5cff,#c04bd9 55%,#ff4fa3);transform:scale(${tk})">${checkSvg("#fff", 15)}</span>` : "";
        tick.style.boxShadow = "inset 0 0 0 2px rgba(16,19,43,.18)";
        li++;
      });
      gi++;
    });
    const pressT = B(T.slip + 5);
    const press = 1 - 0.07 * Math.exp(-((t - pressT) ** 2) / 0.004);
    const total = D.slip.total;
    const lbl = t < pressT ? `Approve &amp; pay ${total ? fmtUSD(count(t, B(T.slip + 1), B(T.slip + 4), 0, total)) : ""}` : t < pressT + 0.6 ? `<span style="width:30px;height:30px;border-radius:50%;border:3px solid rgba(255,255,255,.3);border-top-color:#fff;transform:rotate(${(t - pressT) * 900}deg)"></span>` : `${checkSvg("#3ddc84", 26)} Paid`;
    $("payTxt").innerHTML = lbl;
    $("payTxt").style.display = "flex";
    $("payTxt").style.alignItems = "center";
    $("payTxt").style.gap = "12px";
    css($("pay"), { transform: `scale(${press})` });
  }
  // ---- wallet
  if (show(L.wallet, t, B(T.wallet) + 0.25, B(T.island) - 0.05)) {
    const a = B(T.wallet + 1), b = B(T.wallet + 2.6);
    const v = count(t, a, b, D.slip.balance, D.slip.balance - D.slip.total);
    $("bal").textContent = fmtUSD(v);
    const pk = springStep(t, B(T.wallet + 2.2), 15);
    css($("paid"), { opacity: clamp(pk * 1.5), transform: `translateY(${(1 - pk) * 20}px)` });
    $("paid").textContent = `− ${fmtUSD(D.slip.total)} · ${countLines()} bookings paid`;
    const kk = springStep(t, B(T.wallet + 2.7), 15);
    css($("kyc"), { opacity: clamp(kk * 1.5), transform: `scale(${0.7 + 0.3 * kk})` });
  }
  // ---- island
  if (show(L.island, t, B(T.island) + 0.2, B(T.call) - 0.02, 0)) {
    $("tmr").textContent = "0:0" + Math.max(0, Math.floor((t - B(T.island)) * 1));
    waves(t);
  }
  // ---- call
  if (show(L.call, t, B(T.call) + 0.2, B(T.island2) - 0.05)) {
    $("tmr2").textContent = "0:" + String(Math.floor(2 + (t - B(T.call)))).padStart(2, "0");
    [0, 1, 2].forEach((i) => { const k = springStep(t, B(T.call + 0.6 + i * 1.1), 15); css($("bb" + i), { opacity: clamp(k * 1.5), transform: `translateY(${(1 - k) * 30}px) scale(${0.94 + 0.06 * k})`, transformOrigin: i === 1 ? "100% 0" : "0 0" }); });
    const ck = springStep(t, B(T.call + 3.6), 14);
    css($("conf"), { opacity: clamp(ck * 1.6), transform: `translateY(${(1 - ck) * 40}px)` });
  }
  // ---- island 2 (concierge briefing)
  if (show(L.island2, t, B(T.island2) + 0.2, B(T.orb) - 0.02, 0)) {
    const ring = Math.sin((t - B(T.island2)) * 14) * 6 * (1 - P(t, B(T.island2 + 1.2), B(T.island2 + 1.3)));
    css($("ans"), { transform: `rotate(${ring}deg) scale(${1 - 0.12 * Math.exp(-((t - B(T.island2 + 1.2)) ** 2) / 0.004)})` });
  }
  // ---- orb
  if (show(L.orb, t, B(T.orb) + 0.15, B(T.flood) + 0.05, 0)) {
    const br = 1 + 0.03 * Math.sin((t - B(T.orb)) * 6);
    L.orb.style.transform = `scale(${br})`;
  }
  // ---- card (the flood contracts into the landing hero)
  const ck = t >= B(T.card) - 0.05;
  L.card.style.display = ck ? "" : "none";
  if (ck) {
    const r = P(t, B(T.card) + 0.15, B(T.card) + 0.75, eInOut);
    L.card.style.clipPath = `circle(${r * 75}% at 50% 50%)`;
    L.card.style.opacity = "1";
  }
}
function countLines() { return D.slip.groups.reduce((a, g) => a + g[1].length, 0); }
function waves(t) { for (let i = 0; i < 9; i++) { const h = 10 + 26 * Math.abs(Math.sin(t * 7 + i * 0.9) * Math.cos(t * 3.1 + i)); css($("wv" + i), { height: h + "px", top: 22 - h / 2 + "px" }); } }

// The globe: dot-matrix Earth, the trip flying in from the traveller's own city, then down into Paris.
function drawGlobe(t) {
  const cv = $("gc"), x = cv.getContext("2d");
  const S0 = B(T.globe);
  x.clearRect(0, 0, 880, 880);
  // rotation: start over the Atlantic, the cursor drags it to New York, then it follows the flight to Paris.
  const drag = P(t, B(T.globe + 1), B(T.globe + 2.5), eInOut);
  const fl = P(t, B(T.globe + 3), B(T.globe + 7), eInOut);
  const zoom = P(t, B(T.globe + 7.4), B(T.globe + 10.4), eInOut);
  const startC = [-30, 30];
  let c = [lerp(startC[0], NYC[0], drag), lerp(startC[1], NYC[1], drag)];
  const gi = d3.geoInterpolate(NYC, PARIS);
  const mid = gi(lerp(0, 1, fl));
  c = [lerp(c[0], mid[0], fl * (fl < 1 ? 1 : 1)), lerp(c[1], mid[1], fl)];
  c = [lerp(c[0], PARIS[0], zoom), lerp(c[1], PARIS[1], zoom)];
  const grow = springStep(t, S0, 12);
  const base = 400 * (0.2 + 0.8 * grow);
  const scale = Math.exp(lerp(Math.log(base), Math.log(330000), zoom));
  const pr = d3.geoOrthographic().translate([440, 440]).scale(scale).rotate([-c[0], -c[1]]).clipAngle(90);
  const gp = d3.geoPath(pr, x);
  // atmosphere
  const at = x.createRadialGradient(440, 440, scale * 0.9, 440, 440, scale * 1.12);
  at.addColorStop(0, "rgba(123,92,255,0.0)");
  at.addColorStop(0.5, "rgba(123,92,255,0.35)");
  at.addColorStop(1, "rgba(123,92,255,0)");
  if (scale < 2000) { x.fillStyle = at; x.beginPath(); x.arc(440, 440, scale * 1.12, 0, Math.PI * 2); x.fill(); }
  // ocean
  x.fillStyle = "#0b1033"; x.beginPath(); gp({ type: "Sphere" }); x.fill();
  // land: soft fill (visible when close), dots (far)
  const lf = clamp((Math.log(scale) - Math.log(1500)) / (Math.log(12000) - Math.log(1500)));
  if (lf > 0) { x.fillStyle = `rgba(52,58,120,${0.9 * lf})`; x.beginPath(); gp(window.GLAND); x.fill(); }
  if (lf < 1) {
    x.save(); x.strokeStyle = `rgba(185,168,255,${0.10 * (1 - lf)})`; x.lineWidth = 1; x.beginPath(); gp(d3.geoGraticule10()); x.stroke(); x.restore();
    x.fillStyle = `rgba(222,214,255,${1 - lf})`;
    const r = Math.max(2.0, Math.min(3.6, scale / 200));
    for (const d of window.GDOTS) {
      const dd = d3.geoDistance(d, c);
      if (dd > 1.55) continue;
      const p = pr(d);
      if (!p) continue;
      x.globalAlpha = 0.25 + 0.75 * Math.pow(Math.cos(dd), 0.7);
      x.fillRect(p[0] - r / 2, p[1] - r / 2, r, r);
    }
    x.globalAlpha = 1;
  }
  // flight arc
  if (t > B(T.globe + 2.8)) {
    const k = fl;
    const pts = d3.range(0, k + 0.0001, 0.01).map((u) => gi(Math.min(u, k)));
    x.save();
    x.lineWidth = 4; x.strokeStyle = "rgba(255,255,255,.95)"; x.shadowColor = "rgba(185,168,255,.9)"; x.shadowBlur = 14;
    x.beginPath(); gp({ type: "LineString", coordinates: pts }); x.stroke();
    x.restore();
    // plane at the head
    if (k > 0.01 && k < 0.995) {
      const h = pr(gi(k)), h2 = pr(gi(Math.min(1, k + 0.01)));
      if (h && h2) {
        const ang = Math.atan2(h2[1] - h[1], h2[0] - h[0]);
        x.save(); x.translate(h[0], h[1]); x.rotate(ang + Math.PI / 2); x.fillStyle = "#fff";
        x.beginPath(); x.moveTo(0, -16); x.lineTo(5, 0); x.lineTo(16, 7); x.lineTo(16, 10); x.lineTo(4, 7); x.lineTo(3, 14); x.lineTo(7, 17); x.lineTo(7, 19); x.lineTo(0, 17); x.lineTo(-7, 19); x.lineTo(-7, 17); x.lineTo(-3, 14); x.lineTo(-4, 7); x.lineTo(-16, 10); x.lineTo(-16, 7); x.lineTo(-5, 0); x.closePath(); x.fill(); x.restore();
      }
    }
  }
  // taste columns over Paris
  const cols = P(t, B(T.globe + 8.6), B(T.globe + 10.6), eOut);
  let labels = "";
  if (zoom > 0.6) {
    // Qloo's taste heatmap: where this taste lives in the city
    const hp = pr([2.336, 48.8635]);
    if (hp) { const hk = cols; const hg = x.createRadialGradient(hp[0], hp[1], 0, hp[0], hp[1], 330 * hk + 1); hg.addColorStop(0, "rgba(255,79,163,.55)"); hg.addColorStop(0.45, "rgba(123,92,255,.35)"); hg.addColorStop(1, "rgba(123,92,255,0)"); x.fillStyle = hg; x.beginPath(); x.arc(hp[0], hp[1], 330 * hk + 1, 0, Math.PI * 2); x.fill(); }
    PLACES.forEach((pl, i) => {
      const p = pr(pl[1]);
      if (!p) return;
      const k = springStep(t, B(T.globe + 8.6) + i * 0.09, 14);
      const hgt = 70 + 220 * (pl[2] - 0.8) * 5 * k;
      const g = x.createLinearGradient(0, p[1] - hgt, 0, p[1]);
      g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, pl[3]);
      x.save(); x.shadowColor = pl[3]; x.shadowBlur = 24; x.fillStyle = g; x.fillRect(p[0] - 9, p[1] - hgt, 18, hgt); x.restore();
      x.fillStyle = "#fff"; x.beginPath(); x.arc(p[0], p[1], 9 * k, 0, Math.PI * 2); x.fill();
      if ([0, 2, 3].includes(i)) {
        const lk = springStep(t, B(T.globe + 9.4) + i * 0.12, 15);
        const side = 1;
        labels += `<div class="abs" style="left:${p[0] + side * 24}px;top:${p[1] - hgt - 30 + (i === 0 ? 40 : 0)}px;transform:translateX(${side < 0 ? -100 : 0}%) scale(${lk});transform-origin:${side < 0 ? "100%" : "0"} 50%;opacity:${clamp(lk * 1.5)};white-space:nowrap;padding:8px 16px;border-radius:20px;background:rgba(255,255,255,.92);color:#10132b;font-size:19px;font-weight:700">${pl[0]} <span style="color:#7b5cff;font-family:UB;font-weight:500">${pl[2].toFixed(3)}</span></div>`;
      }
    });
  }
  // city labels
  const lab = (pt, txt, a) => { const p = pr(pt); if (!p) return ""; const k = springStep(t, a, 15); return `<div class="abs" style="left:${p[0]}px;top:${p[1]}px;transform:translate(-50%,-150%) scale(${k});opacity:${clamp(k * 1.5)};white-space:nowrap;padding:10px 18px;border-radius:22px;background:#fff;color:#10132b;font-size:21px;font-weight:700;box-shadow:0 10px 24px -12px rgba(0,0,0,.6)">${txt}</div><div class="abs" style="left:${p[0] - 7}px;top:${p[1] - 7}px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 0 0 6px rgba(255,255,255,.25);transform:scale(${k})"></div>`; };
  let ls = "";
  if (zoom < 0.4) {
    ls += lab(NYC, `Your city · ${D.trip.from}`, B(T.globe + 2.6));
    if (t > B(T.globe + 6.6)) ls += lab(PARIS, "Paris", B(T.globe + 6.6));
  }
  $("glabels").innerHTML = ls + labels;
}

// CURSOR
const CUR = [
  [B(20.2), 1500, 900], [B(20.9), 700, 478], [B(23.5), 760, 600], [B(24.8), 1065, 602], [B(26.2), 1300, 520], [B(26.9), 1522, 470],
  [B(28.5), 1500, 880], [B(36.8), 1620, 760], [B(37), 1180, 560], [B(38.5), 820, 560], [B(40), 1500, 900],
  [B(54), 1500, 860], [B(54.9), 1440, 869], [B(57), 1500, 980], [B(60.6), 1000, 988], [B(61.2), 980, 990],
  [B(64), 1500, 900], [B(72.2), 1500, 400], [B(73.1), 1228, 140], [B(73.8), 1300, 420], [B(74.5), 990, 580], [B(75), 990, 580],
];
const CLICKS = [B(21), B(25), B(27), B(37), B(55), B(61), B(73.2), B(74.6)];
function cursor(t) {
  const on = t > B(20.1) && t < B(75.3);
  $("cursor").style.display = on ? "" : "none";
  $("ripple").style.display = "none";
  if (!on) return;
  // drag on the globe: held between 37 and 38.5
  const [cx, cy] = path(t, CUR);
  let press = 1;
  for (const c of CLICKS) press -= 0.16 * Math.exp(-((t - c) ** 2) / 0.006);
  if (t > B(37) && t < B(38.5)) press = 0.86;
  css($("cursor"), { transform: `translate(${cx - 6}px, ${cy - 4}px) scale(${press})` });
  for (const c of CLICKS) {
    const k = inv(c, c + 0.45, t);
    if (k > 0 && k < 1) {
      const r = 18 + 60 * eOut(k);
      css($("ripple"), { display: "", left: cx - r + "px", top: cy - r + "px", width: 2 * r + "px", height: 2 * r + "px", opacity: 1 - k });
    }
  }
}

// SWITCH under the prompt: Check with me → Just do it, the thumb's edges on different springs
function switcher(t) {
  const on = t > B(T.prompt + 1) && t < B(T.taste) + 0.2;
  const sw = $("switch");
  sw.style.display = on ? "" : "none";
  if (!on) return;
  const k = springStep(t, B(T.prompt + 1.2), 14);
  const x = exitK(t, B(T.taste) + 0.2);
  css(sw, { left: 960 - 210 + "px", top: 566 + (1 - k) * 40 + "px", opacity: clamp(k * 1.5) * (1 - x) });
  const lead = springStep(t, B(25), 24, 0.75), trail = springStep(t, B(25) + 0.06, 13, 0.85);
  const l = lerp(6, 210, trail), r = lerp(204, 414, lead);
  css($("thumb"), { left: l + "px", width: r - l + "px" });
}

// END: titles on the landed card
function end(t) {
  const on = t >= B(T.card) + 0.4;
  $("end").style.display = on ? "" : "none";
  if (!on) return;
  const bk = springStep(t, B(T.card) + 0.5, 15);
  css($("badge"), { opacity: clamp(bk * 1.5), transform: `translateY(${(1 - bk) * -20}px)` });
  [...$("l1").children].forEach((w, i) => { const k = springStep(t, B(T.card) + 0.7 + i * 0.06, 14); css(w, { transform: `translateY(${(1 - k) * 16}px)`, filter: `blur(${(1 - clamp(k)) * 12}px)`, opacity: clamp(k * 1.4) }); });
  [...$("l2").children].forEach((w, i) => { const k = springStep(t, B(T.card) + 1.0 + i * 0.05, 14); css(w, { transform: `translateY(${(1 - k) * 16}px)`, filter: `blur(${(1 - clamp(k)) * 12}px)`, opacity: clamp(k * 1.4) }); });
  const uk = springStep(t, B(T.card) + 1.8, 14);
  css($("url"), { opacity: clamp(uk * 1.4), transform: `translateY(${(1 - uk) * 12}px)` });
  // the card creeps closer
  const creep = 1 + 0.02 * P(t, B(T.card) + 0.8, B(T.end), (k) => k);
  shape.style.transform = `scale(${creep})`;
}

// ---------- seek ----------
let READY = false;
window.seek = function (t) {
  bg(t);
  open(t);
  fly(t);
  switcher(t);
  drawShape(t);
  if (!(t >= B(T.card) + 0.4)) shape.style.transform = "";
  end(t);
  cursor(t);
};
window.DURATION = B(T.end);
window.EVENTS_AT = () => EVENTS;
window.init = async function () {
  window.LAND = await fetch("land-110m.json").then((r) => r.json());
  window.PIECES = await fetch("capture/pieces.json").then((r) => r.json());
  build();
  await document.fonts.ready;
  READY = true;
  return true;
};
