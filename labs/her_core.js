/* her_core.js — H.E.R AI Resonance Lens core (extension)
   ES module. Imports noise locally. No server.
*/

// ====== CONFIG DEFAULTS (no sliders yet) ======
const CFG = {
  memoryInfluence: 0.35,
  geoDensity: 0.55,
  t1: 0.38,
  t2: 0.68,
  hys: 0.06,
  scanSpeed: 0.22,
  introRateRun: 0.09,
  introRateIdle: 0.05,
};

const SCALE_MIN = 0.92;
const SCALE_MAX = 1.08;
const MODE = "PROD";

// ====== INTERNAL STATE ======
let canvas, ctx, W, H;
let hud = { stateTag: null, hsTag: null, turnTag: null, memTag: null };

// --- Field throttling (reduces getImageData cost) ---
let fieldCanvas, fieldCtx;
let lastFieldTs = 0;
const FIELD_FPS = 15; // try 12–18

let mode = "IDLE";
let t = 0;
let lastTs = performance.now();

let intro = 0;
let breath = 0;
let lastTurnIndex = -1;

let parsed = { turns: [], features: [], ht: [], st: [] };
let graph = { nodes: [], edges: [] };

// memory seed
const MEM_KEY = "her_crystal_seed_v0";
const mem = loadMemorySeed();

// state machine
let smState = "IDLE";

// ====== FIELD BUFFER (performance) ======
let _fieldScale = 0.35;        // 0.25–0.5 (lower = faster)
let _fieldCanvas = null;
let _fieldCtx = null;
let _fieldImg = null;
let _fieldW = 0, _fieldH = 0;
let _fieldFrame = 0;

function ensureFieldBuffer() {
  const w = Math.max(80, Math.floor(W * _fieldScale));
  const h = Math.max(80, Math.floor(H * _fieldScale));

  if (_fieldCanvas && w === _fieldW && h === _fieldH) return;

  _fieldW = w; _fieldH = h;
  _fieldCanvas = document.createElement("canvas");
  _fieldCanvas.width = w;
  _fieldCanvas.height = h;

  _fieldCtx = _fieldCanvas.getContext("2d", { willReadFrequently: true });
  _fieldImg = _fieldCtx.createImageData(w, h);
}

// Lock flag set by panel.js (visual-only; no storage/no network)
let HER_LOCKED = false;

// panel can toggle this without rebuilding turns
export function setHERLocked(on) {
  HER_LOCKED = !!on;
}

let _dbgLast = 0;

export function getStateRaw() {
  if (smState === "ICE") return 0;
  if (smState === "WATER") return 1;
  if (smState === "AURORA") return 2;
  return -1;
}

// ====== PUBLIC API ======
export function initHER(opts) {
  canvas = opts.canvas;
  ctx = canvas.getContext("2d", {
  alpha: false,
  willReadFrequently: true
});
  W = canvas.width;
  H = canvas.height;
  // offscreen field buffer
  fieldCanvas = document.createElement("canvas");
  fieldCanvas.width = W;
  fieldCanvas.height = H;
  fieldCtx = fieldCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  hud = { ...hud, ...(opts.hud || {}) };
  requestAnimationFrame(loop);
}

export function updateHERFromTurns(turns, opts = {}) {
  const reset = !!opts.reset;

  const transcript = turnsToTranscript(turns);

  parsed = parseTranscript(transcript);
  parsed.features = parsed.turns.map(t => featuresForTurn(t.text));
  parsed.ht = computeHTCurve(parsed.features, mem, CFG.memoryInfluence);
  parsed.st = computeSTCurve(parsed.turns);
  graph = buildKeywordGraph(parsed.turns, CFG.geoDensity);

  mode = "RUN";
  intro = 0;
  breath = 0;
  lastTurnIndex = -1;

  if (reset) smState = "ICE";

  if (hud.turnTag) hud.turnTag.textContent = `TURNS: ${parsed.turns.length}`;
}

export function getGraphCounts() {
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
  };
}

// ====== LOOP ======
function loop(now) {
  if (MODE === "DEV" && (now|0) % 2000 < 16) console.debug("HER_LOOP", (now|0));
  const dt = Math.min(0.05, (now - lastTs) / 1000);
  lastTs = now;
  t += dt;

  if (MODE === "DEV" && now - _dbgLast > 2000) {
  _dbgLast = now;
  console.debug("HER_FRAME", Math.round(now));
  }

  const hasTurns = parsed.turns.length > 0;
  if (hasTurns) intro = clamp01(intro + dt * CFG.introRateRun);
  else intro = clamp01(intro + dt * CFG.introRateIdle);

  breath *= 0.92;

  if (!hasTurns) renderIdle(t);
  else renderRun(t);

  requestAnimationFrame(loop);


}

// ====== RENDER ======
function renderIdle(time) {
  const pulse = 0.5 + 0.5 * Math.sin(time * 1.0);
  const h = clamp01((0.42 + (mem.bias || 0) * 0.05) + (pulse - 0.5) * 0.05);
  const s = clamp01(0.42 + (pulse - 0.5) * 0.03);

  const idleBreath = 0.85 + 0.15 * Math.sin(time * 1.1);
  drawCrystal(time, h, s, "ICE", null);

  setHud("IDLE", h, s, false);
}

function renderRun(time) {
  const turns = parsed.turns.length;
  if (!turns) return;

  const x = (time * CFG.scanSpeed) % 1;
  const idxFloat = x * (turns - 1);

  const i0 = Math.floor(idxFloat);
  const i1 = Math.min(turns - 1, i0 + 1);
  const frac = idxFloat - i0;

  if (i0 !== lastTurnIndex) {
    breath = 1.0;
    lastTurnIndex = i0;
  }

  const h0 = parsed.ht[i0] ?? 0.5;
  const h1 = parsed.ht[i1] ?? h0;
  const h = h0 + (h1 - h0) * frac;

  const s0 = parsed.st[i0] ?? 0.45;
  const s1 = parsed.st[i1] ?? s0;
  const s = s0 + (s1 - s0) * frac;

  const state = updateStateMachine(h, CFG.t1, CFG.t2, CFG.hys);
  drawCrystal(time, h, s, state, idxFloat);

  setHud(state, h, s);
}

function setHud(state, h, s, showT = true) {
  if (hud.stateTag) hud.stateTag.textContent = state;
  if (hud.hsTag) {
  hud.hsTag.textContent = showT
    ? `Hₛ(t): ${h.toFixed(2)} · Sₛ(t): ${s.toFixed(2)}`
    : `Hₛ: ${h.toFixed(2)} · Sₛ: ${s.toFixed(2)}`;
  }
  if (hud.memTag) hud.memTag.textContent = memString(mem);
}

function drawCrystal(time, h, s, state, idxFloat) {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);

  const pal = paletteFor(state, h);

  const fieldStrength = Math.max(
    0.12,
    intro * (0.10 + 0.55 * h) * (0.85 + 0.25 * breath)
  );

  const geoStrength = Math.max(
    0.10,
    intro * (0.18 + 0.78 * s)
  );

  const FIELD_MUTE = 0.75;
  const GEO_BOOST  = 1.20;

  const fieldK = fieldStrength * FIELD_MUTE;
  const geoK   = Math.min(1.0, geoStrength * GEO_BOOST);

    // Silent "paused" feel when locked: desaturate field + soften geometry slightly
  let fieldKM = fieldK;
  let geoKM = geoK;

  if (HER_LOCKED) {
    fieldKM = fieldK * 0.55;          // background more muted
    geoKM = Math.min(1.0, geoK * 0.85); // geometry slightly softened, still alive
  }

  const ht = clamp01(h);
  const hSmooth = ht * ht * (3 - 2 * ht);
  const sMod = 1 + ((clamp01(s) - 0.5) * 0.02);
  const geoScale = (SCALE_MIN + (SCALE_MAX - SCALE_MIN) * hSmooth) * sMod;

  drawAuroraFieldThrottled(time, pal, state, h, fieldKM);

  // Darken IDLE ICE only
  if (!parsed.turns.length && state === "ICE") {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(0,0,0,0.41)";
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  if (graph.nodes.length) {
    const stability = clamp01(0.15 + 0.85 * s) * (0.75 + 0.25 * intro);
    stepGraph(graph, stability, time);
  }

  // --- ALWAYS-VISIBLE idle heartbeat ---
  if (!parsed.turns.length) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 1.6);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = `rgba(255,255,255,${0.02 + pulse * 0.03})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  if (graph.nodes.length) {
    ctx.save();
    ctx.translate(W * 0.5, H * 0.55);
    ctx.scale(geoScale, geoScale);
    ctx.translate(-W * 0.5, -H * 0.55);
    drawGraph(graph, pal, state, h, s, geoKM);
    ctx.restore();
  }
  drawCenterMark(time, pal, state, geoKM);
  if (idxFloat != null) {
    const p = idxFloat / Math.max(1, parsed.turns.length - 1);
    drawTimelineMarker(p, pal, fieldKM);
  }
}

function getCenterLabel() { return "H.E.R"; }

function updateStateMachine(h, t1, t2, hys) {
  const s = smState;
  if (s === "ICE") {
    if (h > t1 + hys) smState = (h >= t2 ? "AURORA" : "WATER");
  } else if (s === "WATER") {
    if (h < t1 - hys) smState = "ICE";
    else if (h > t2 + hys) smState = "AURORA";
  } else if (s === "AURORA") {
    if (h < t2 - hys) smState = (h <= t1 ? "ICE" : "WATER");
  } else {
    smState = (h < t1 ? "ICE" : (h < t2 ? "WATER" : "AURORA"));
  }
  return smState;
}

// ====== PORTED HELPERS (same as your labs.js core) ======
function turnsToTranscript(turns) {
  let alt = "user";
  const out = [];
  for (const t of turns) {
    const role = (t.role === "user" || t.role === "assistant") ? t.role : alt;
    alt = (alt === "user") ? "assistant" : "user";
    out.push(`${role === "user" ? "User" : "Assistant"}: ${t.text || ""}`);
  }
  return out.join("\n\n");
}

function parseTranscript(text) {
  const lines = text.split(/\r?\n/);
  const turns = [];
  let cur = null;

  const push = () => {
    if (cur && cur.text.trim().length > 0) turns.push(cur);
    cur = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const m = line.match(/^(User|Assistant)\s*:\s*(.*)$/i);
    if (m) {
      push();
      cur = { role: m[1].toLowerCase(), text: m[2] || "" };
    } else {
      if (!cur) cur = { role: "user", text: "" };
      cur.text += (cur.text.length ? "\n" : "") + line;
    }
  }
  push();
  return { turns: turns.filter(t => t.text.trim().length > 0) };
}

function featuresForTurn(text) {
  const clean = text.toLowerCase();
  const words = clean.match(/[a-z0-9']+/g) || [];
  const len = words.length;

  const bigrams = [];
  for (let i = 0; i < words.length - 1; i++) bigrams.push(words[i] + "_" + words[i+1]);
  const rep = repetitionScore(bigrams);

  const ex = (clean.match(/!/g) || []).length;
  const q = (clean.match(/\?/g) || []).length;
  const neg = (clean.match(/\b(no|not|never|can't|cannot|won't|doesn't|isn't)\b/g) || []).length;

  const avgWord = len ? (words.reduce((a,w)=>a+w.length,0) / len) : 0;

  const upper = (text.match(/[A-Z]/g) || []).length;
  const alpha = (text.match(/[A-Za-z]/g) || []).length;
  const upperRatio = alpha ? upper / alpha : 0;

  return { len, rep, ex, q, neg, avgWord, upperRatio };
}

function repetitionScore(items) {
  if (items.length < 6) return 0;
  const m = new Map();
  for (const it of items) m.set(it, (m.get(it) || 0) + 1);
  let repeats = 0;
  for (const v of m.values()) if (v > 1) repeats += (v - 1);
  return Math.min(1, repeats / Math.max(1, items.length));
}

function computeHTCurve(features, memorySeed, memoryInfluence) {
  const ht = [];
  const memBias = clamp01(0.5 + (memorySeed.bias || 0) * 0.15);

  let prev = null;
  let hPrev = memBias;

  for (let i = 0; i < features.length; i++) {
    const f = features[i];

    const lenNorm = clamp01(f.len / 120);
    const lenStab = 1 - Math.abs(lenNorm - 0.55) * 1.2;

    const repPenalty = f.rep;
    const volPenalty = clamp01((f.ex * 0.07) + (f.q * 0.05) + (f.neg * 0.03));

    const density = clamp01((f.avgWord - 3.5) / 4.0);
    const upper = clamp01(f.upperRatio * 3.5);

    let h = 0.55 * clamp01(lenStab) + 0.20 * density + 0.10 * (1 - upper) + 0.15 * (1 - repPenalty);
    h -= 0.35 * volPenalty;

    if (prev) {
      const dLen = Math.abs(f.len - prev.len) / 120;
      const drift = clamp01(dLen + Math.abs(f.rep - prev.rep));
      h -= 0.18 * drift;
    }

    h = (1 - memoryInfluence) * h + memoryInfluence * (0.65 * hPrev + 0.35 * memBias);
    h = 0.75 * hPrev + 0.25 * h;

    ht.push(clamp01(h));
    hPrev = h;
    prev = f;
  }

  const avg = ht.length ? ht.reduce((a,x)=>a+x,0) / ht.length : memBias;
  const vol = ht.length > 1 ? avgAbsDiff(ht) : 0.05;

  memorySeed.bias = clamp(-1, 1, (memorySeed.bias || 0) * 0.85 + (avg - 0.5) * 0.5);
  memorySeed.vol = clamp01((memorySeed.vol || 0.10) * 0.8 + vol * 0.6);
  memorySeed.last = Date.now();
  saveMemorySeed(memorySeed);

  return ht;
}

function avgAbsDiff(arr) {
  let s = 0;
  for (let i=1;i<arr.length;i++) s += Math.abs(arr[i]-arr[i-1]);
  return s / (arr.length - 1);
}

function computeSTCurve(turns) {
  const st = new Array(turns.length).fill(0.45);

  const stop = new Set(["the","and","a","to","of","in","is","it","that","for","on","with","as","i","you","we","are","be","or","was","were","this","at","by","from","an","not"]);
  let prevSet = new Set();
  let seen = new Set();
  let sPrev = 0.45;

  for (let i = 0; i < turns.length; i++) {
    const trn = turns[i];
    if (trn.role !== "assistant") {
      st[i] = sPrev;
      continue;
    }

    const f = featuresForTurn(trn.text);
    const words = (trn.text.toLowerCase().match(/[a-z0-9']+/g) || [])
      .filter(w => w.length >= 4 && !stop.has(w));
    const curSet = new Set(words);

    const depth = clamp01((f.len - 40) / 220);
    const clarity = clamp01((1 - f.rep) - 0.25 * clamp01((f.ex + f.q) / 20));
    const overlap = setOverlap(curSet, prevSet);
    const interconnection = clamp01(overlap * 1.35);

    let newCount = 0;
    for (const w of curSet) if (!seen.has(w)) newCount++;
    const noveltyRaw = curSet.size ? (newCount / curSet.size) : 0;
    const novelty = clamp01(1 - Math.abs(noveltyRaw - 0.45) * 1.6);

    let s = 0.35 * depth + 0.30 * interconnection + 0.20 * clarity + 0.15 * novelty;

    s = 0.80 * sPrev + 0.20 * s;
    s = clamp01(s);

    st[i] = s;
    sPrev = s;
    prevSet = curSet;
    for (const w of curSet) seen.add(w);
  }

  return st;
}

function setOverlap(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / Math.max(1, Math.min(a.size, b.size));
}

function buildKeywordGraph(turns, density) {
  const stop = new Set(["the","and","a","to","of","in","is","it","that","for","on","with","as","i","you","we","are","be","or","was","were","this","at","by","from","an","not"]);
  const freq = new Map();

  for (const t of turns) {
    const words = (t.text.toLowerCase().match(/[a-z0-9']+/g) || [])
      .filter(w => w.length >= 4 && !stop.has(w));
    for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  }

  const all = [...freq.entries()].sort((a,b)=>b[1]-a[1]);
  const targetN = Math.floor(10 + density * 20);
  const words = all.slice(0, targetN).map(([w])=>w);

  const nodes = words.map((w)=>({
    id: w,
    x: W*0.5 + (Math.random()-0.5)*W*0.25,
    y: H*0.5 + (Math.random()-0.5)*H*0.25,
    vx: 0, vy: 0,
    w: 1 + (freq.get(w)||1)*0.25
  }));

  const idx = new Map(nodes.map((n,i)=>[n.id,i]));
  const edges = new Map();

  for (const t of turns) {
    const set = new Set((t.text.toLowerCase().match(/[a-z0-9']+/g) || [])
      .filter(w => idx.has(w)));
    const arr = [...set];
    for (let i=0;i<arr.length;i++) {
      for (let j=i+1;j<arr.length;j++) {
        const a = arr[i], b = arr[j];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        edges.set(key, (edges.get(key) || 0) + 1);
      }
    }
  }

  const edgeList = [...edges.entries()]
    .sort((a,b)=>b[1]-a[1])
    .slice(0, Math.floor(12 + density*28))
    .map(([k,val]) => {
      const [a,b] = k.split("|");
      return { a: idx.get(a), b: idx.get(b), w: val };
    });

  return { nodes, edges: edgeList };
}
// ====== VISUALS ======
function drawAuroraFieldThrottled(time, pal, state, h, strength) {
  if (!fieldCanvas || !fieldCtx) {
    drawAuroraField(time, pal, state, h, strength, ctx);
    return;
  }

  const now = performance.now();
  const frameMs = 1000 / FIELD_FPS;
  if (!lastFieldTs || (now - lastFieldTs) >= frameMs) {
    lastFieldTs = now;
    drawAuroraField(time, pal, state, h, strength, fieldCtx);
  }

  ctx.drawImage(fieldCanvas, 0, 0);
}

function drawAuroraField(time, pal, state, h, strength, targetCtx = ctx) {
  const img = targetCtx.getImageData(0, 0, W, H);
  const data = img.data;

  const isIdle  = (!parsed.turns.length);
  const isIce   = (state === "ICE");
  const isWater = (state === "WATER");
  const isAurora= (state === "AURORA");

  // ---------- Base parameters ----------
  let speed = isIce ? 0.06 : (isWater ? 0.12 : 0.18);
  let scale = isIce ? 0.020 : (isWater ? 0.016 : 0.013);
  let bands = isAurora ? 1.35 : (isWater ? 1.05 : 0.85);
  let sharp = isIce ? 1.8  : (isWater ? 1.1  : 0.8);

  // ---------- IDLE override (static shimmer, not flow) ----------
  // Keep it "frozen" but alive.
  if (isIdle && isIce) {
    speed = 0.02;   // almost no drift
    scale = 0.03;  // finer grain
    sharp = 1.85;   // harder edges = “frozen glass”
  }

  const seed = 2000 + Math.floor((mem.last || 0) % 10000);

  // Smooth shimmer drivers (uniform cadence, no stepped ticking)
  // 0..1
  const shimmer  = (isIdle && isIce) ? (0.5 + 0.5 * Math.sin(time * 6.0)) : 0;
  const shimmer2 = (isIdle && isIce) ? (0.5 + 0.5 * Math.sin(time * 9.0 + 1.7)) : 0;

  // A very small high-frequency “spark” modulation to keep it crystalline
  // 0..1
  const spark = (isIdle && isIce) ? (0.5 + 0.5 * Math.sin(time * 18.0 + 0.4)) : 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = x * scale;
      const ny = y * scale;

      // Base layered noise (flow-field)
      const n1 = fbm2D(nx + time * speed, ny, seed, 5);
      const n2 = fbm2D(nx, ny + time * speed * 0.9, seed + 77, 4);
      let v = (0.55 * n1 + 0.45 * n2);

      // IDLE shimmer injection (continuous, uniform)
      if (isIdle && isIce) {
        // tiny fine-grain “static” (doesn’t drift across the screen)
        const grain = fbm2D(nx * 4.5, ny * 4.5, seed + 9000, 2);

        // combine smooth oscillators + grain (kept subtle to avoid “water” feel)
        const osc = ((shimmer - 0.5) * 0.10) + ((shimmer2 - 0.5) * 0.05);
        const micro = (grain - 0.5) * (0.12 + 0.06 * spark);

        v = clamp01(v + osc + micro);
      }

      v = Math.pow(clamp01(v), sharp);

      // Banding
      const band = Math.sin((ny * 22.0) + v * 6.5 + time * speed * 3.0) * 0.5 + 0.5;
      const lum = clamp01((v * 0.85 + band * 0.55) * bands);
      const b = clamp01(lum * (0.20 + h * 0.95) * strength);

      // ICE edge sparkle
      let edge = 0;
      if (isIce) {
        const edgeSpeed = (isIdle ? 0.0 : 0.10);

        // keep idle edges alive via smooth phase (no ticks)
        const edgePhase = (isIdle ? ((shimmer - 0.5) * 0.8 + (shimmer2 - 0.5) * 0.35) : 0);

        const g = Math.abs(
          fbm2D(
            nx * 1.8 + time * edgeSpeed + edgePhase,
            ny * 1.8 - time * edgeSpeed * 0.7 - edgePhase * 0.8,
            seed + 999,
            3
          ) - 0.5
        );

        edge = clamp01((0.24 - g) * 4.0) * strength;
      }

      const r = clamp01(pal.r * b + pal.iceR * edge);
      const gcol = clamp01(pal.g * b + pal.iceG * edge);
      const bcol = clamp01(pal.b * b + pal.iceB * edge);

      const i = (y * W + x) * 4;
      data[i]     = (r * 255) | 0;
      data[i + 1] = (gcol * 255) | 0;
      data[i + 2] = (bcol * 255) | 0;
      data[i + 3] = 255;
    }
  }

  targetCtx.putImageData(img, 0, 0);

  // Vignette
  const grd = targetCtx.createRadialGradient(
    W * 0.5, H * 0.5, H * 0.15,
    W * 0.5, H * 0.5, H * 0.75
  );
  grd.addColorStop(0, "rgba(0,0,0,0)");
  grd.addColorStop(1, "rgba(0,0,0,0.55)");
  targetCtx.fillStyle = grd;
  targetCtx.fillRect(0, 0, W, H);
}

function stepGraph(g, stability, time) {
  const centerX = W*0.5, centerY = H*0.55;

  for (let i=0;i<g.nodes.length;i++){
    const a = g.nodes[i];

    a.vx += (centerX - a.x) * 0.00035 * stability;
    a.vy += (centerY - a.y) * 0.00030 * stability;

    a.vx += Math.sin(time*0.6 + i) * 0.002 * (1 - stability);
    a.vy += Math.cos(time*0.7 + i) * 0.002 * (1 - stability);

    for (let j=i+1;j<g.nodes.length;j++){
      const b = g.nodes[j];
      const dx = a.x - b.x, dy = a.y - b.y;
      const d2 = dx*dx + dy*dy + 1;
      const rep = (18 / d2) * (0.6 + 0.9*(1 - stability));
      a.vx += dx * rep;
      a.vy += dy * rep;
      b.vx -= dx * rep;
      b.vy -= dy * rep;
    }
  }

  for (const e of g.edges) {
    const a = g.nodes[e.a], b = g.nodes[e.b];
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx*dx + dy*dy) + 0.0001;
    const target = 85 + (1/Math.max(1,e.w))*40;
    const k = 0.0026 * stability;
    const f = (dist - target) * k;
    const fx = (dx / dist) * f;
    const fy = (dy / dist) * f;
    a.vx += fx; a.vy += fy;
    b.vx -= fx; b.vy -= fy;
  }

  for (const n of g.nodes) {
    n.vx *= 0.86;
    n.vy *= 0.86;
    n.x += n.vx;
    n.y += n.vy;

    n.x = clamp(40, W-40, n.x);
    n.y = clamp(40, H-40, n.y);
  }
}

function drawGraph(g, pal, state, h, s, strength) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";

  const edgeAlpha = clamp01((0.18 + 0.70*s) * strength);
  const nodeAlpha = clamp01((0.10 + 0.55*s) * strength);
  ctx.lineWidth = 1.1 + 2.8 * s;

  ctx.strokeStyle = `rgba(${Math.floor(pal.edgeR*255)},${Math.floor(pal.edgeG*255)},${Math.floor(pal.edgeB*255)},${edgeAlpha})`;

  for (const e of g.edges) {
    const a = g.nodes[e.a], b = g.nodes[e.b];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  for (const n of g.nodes) {
    const r = (2.8 + Math.min(9, n.w * 0.5)) * (0.9 + 0.6*s);
    ctx.fillStyle = `rgba(${Math.floor(pal.nodeR*255)},${Math.floor(pal.nodeG*255)},${Math.floor(pal.nodeB*255)},${nodeAlpha})`;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI*2);
    ctx.fill();
  }

  ctx.restore();
}

function drawCenterMark(time, pal, state, strength) {
  const label = getCenterLabel();
  const pulse = 0.6 + 0.4*Math.sin(time*1.7);
  const glow = (state === "AURORA") ? 18 : (state === "WATER" ? 12 : 8);

  ctx.save();
  ctx.globalCompositeOperation = "screen";

  ctx.font = `700 34px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.shadowBlur = 0;
  ctx.fillStyle = `rgba(255,255,255,${clamp01(0.55 + 0.35*strength)})`;
  ctx.fillText(label, W*0.5, H*0.5);
  ctx.restore();

  ctx.shadowColor = `rgba(${Math.floor(pal.nodeR*255)},${Math.floor(pal.nodeG*255)},${Math.floor(pal.nodeB*255)},0.65)`;
  ctx.shadowBlur = (glow + pulse*10) * (0.6 + 0.9*strength) * (0.85 + 0.25*breath);

  ctx.fillStyle = `rgba(229,231,235,${clamp01((0.25 + pulse*0.35) * strength)})`;
  ctx.fillText(label, W*0.5, H*0.5);

  ctx.restore();
}

function drawTimelineMarker(p, pal, strength) {
  const x = 14, y = H - 18, w = W - 28, h = 6;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fillRect(x, y, w, h);

  const a = clamp01(0.25 + 0.6 * strength);
  const alpha = HER_LOCKED ? a * 0.35 : a;

  ctx.fillStyle = `rgba(${Math.floor(pal.nodeR*255)},${Math.floor(pal.nodeG*255)},${Math.floor(pal.nodeB*255)},${alpha})`;
  ctx.fillRect(x, y, Math.max(2, w*p), h);
  ctx.restore();
}

function paletteFor(state, h) {
  const base = {
    r: 0.12, g: 0.82, b: 0.95,
    edgeR: 0.20, edgeG: 0.75, edgeB: 1.00,
    nodeR: 0.20, nodeG: 0.95, nodeB: 0.95,
    iceR: 0.65, iceG: 0.85, iceB: 1.00,
  };

  if (state === "ICE") {
    base.r = 0.08; base.g = 0.55; base.b = 0.85;
    base.edgeR = 0.35; base.edgeG = 0.70; base.edgeB = 1.00;
  } else if (state === "WATER") {
    base.r = 0.10; base.g = 0.78; base.b = 0.95;
  } else if (state === "AURORA") {
    base.r = 0.16; base.g = 0.92; base.b = 1.00;
    base.nodeG = 1.00;
  }

  const k = 0.92 + h*0.18;
  base.r *= k; base.g *= k; base.b *= k;
  return base;
}

function loadMemorySeed() {
  try {
    const raw = localStorage.getItem(MEM_KEY);
    if (!raw) return { bias: 0, vol: 0.10, last: Date.now() };
    const obj = JSON.parse(raw);
    return { bias: obj.bias ?? 0, vol: obj.vol ?? 0.10, last: obj.last ?? Date.now() };
  } catch {
    return { bias: 0, vol: 0.10, last: Date.now() };
  }
}
function saveMemorySeed(seed) {
  try { localStorage.setItem(MEM_KEY, JSON.stringify(seed)); } catch {}
}
function memString(m) {
  return `Memory seed: bias=${(m.bias||0).toFixed(2)} · vol=${(m.vol||0).toFixed(2)}`;
}

function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function clamp(a,b,x){ return Math.max(a, Math.min(b, x)); }

/* ============================
   Noise (inline) — fbm2D
   Self-contained so extension never breaks on imports/paths.
   ============================ */

// Small deterministic hash for pseudo-random gradients
function _hash2(ix, iy, seed) {
  // 32-bit integer hash
  let x = (ix * 374761393) ^ (iy * 668265263) ^ (seed * 1442695041);
  x = (x ^ (x >> 13)) >>> 0;
  x = (x * 1274126177) >>> 0;
  return x;
}

function _grad2(ix, iy, seed) {
  const h = _hash2(ix, iy, seed);
  // angle in [0, 2π)
  const a = (h / 4294967296) * Math.PI * 2;
  return { x: Math.cos(a), y: Math.sin(a) };
}

function _fade(t) {
  // smootherstep
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function _lerp(a, b, t) { return a + (b - a) * t; }

function _perlin2(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = x0 + 1,       y1 = y0 + 1;

  const sx = _fade(x - x0);
  const sy = _fade(y - y0);

  const g00 = _grad2(x0, y0, seed);
  const g10 = _grad2(x1, y0, seed);
  const g01 = _grad2(x0, y1, seed);
  const g11 = _grad2(x1, y1, seed);

  const dx0 = x - x0, dy0 = y - y0;
  const dx1 = x - x1, dy1 = y - y1;

  const n00 = g00.x * dx0 + g00.y * dy0;
  const n10 = g10.x * dx1 + g10.y * dy0;
  const n01 = g01.x * dx0 + g01.y * dy1;
  const n11 = g11.x * dx1 + g11.y * dy1;

  const ix0 = _lerp(n00, n10, sx);
  const ix1 = _lerp(n01, n11, sx);
  const v = _lerp(ix0, ix1, sy);

  // map roughly to 0..1
  return 0.5 + 0.5 * v;
}

// Public: fbm2D(x,y,seed,octaves) -> 0..1
function fbm2D(x, y, seed, octaves = 5) {
  let amp = 0.5;
  let freq = 1.0;
  let sum = 0.0;
  let norm = 0.0;

  for (let i = 0; i < octaves; i++) {
    sum += amp * _perlin2(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }

  return sum / Math.max(1e-6, norm);
}
