// labs.js — H.E.R-Crystal v0.2 (H(t) field + S(t) geometry + intro void + breath pulse)

import { fbm2D } from "./noise.js";
import { recordWebM, downloadBlob } from "./recorder.js";

/** ---------------------------
 *  DOM
 * -------------------------- */
const el = {
  input: document.getElementById("chatInput"),
  btnRender: document.getElementById("btnRender"),
  btnIdle: document.getElementById("btnIdle"),
  btnExport: document.getElementById("btnExport"),
  canvas: document.getElementById("crystal"),
  stateTag: document.getElementById("stateTag"),
  htTag: document.getElementById("htTag"),
  turnTag: document.getElementById("turnTag"),
  memTag: document.getElementById("memTag"),
  labelMode: document.getElementById("labelMode"),
  memoryInfluence: document.getElementById("memoryInfluence"),
  memoryVal: document.getElementById("memoryVal"),
  geoDensity: document.getElementById("geoDensity"),
  geoVal: document.getElementById("geoVal"),
  t1: document.getElementById("t1"),
  t2: document.getElementById("t2"),
  hys: document.getElementById("hys"),
  autoExportToggle: document.getElementById("autoExportToggle"),
};

const customWrap = document.getElementById("customLabelWrap");
const customInput = document.getElementById("customLabel");

const ctx = el.canvas.getContext("2d", { alpha: false });
const W = el.canvas.width, H = el.canvas.height;

/** ---------------------------
 *  Memory seed (localStorage)
 * -------------------------- */
const MEM_KEY = "her_crystal_seed_v0";
const mem = loadMemorySeed();
updateMemHud();

/** ---------------------------
 *  Runtime state
 * -------------------------- */
let mode = "IDLE"; // IDLE | RUN
let parsed = { turns: [], features: [], ht: [], st: [] };
let graph = { nodes: [], edges: [] };

let t = 0;
let lastRenderTs = performance.now();

// Black-ice void → awakening envelope (0..1)
let intro = 0;

// Breath pulse when scan crosses a new turn boundary (0..1)
let breath = 0;
let lastTurnIndex = -1;

// --- Best-3-seconds capture ---
let captureTimeline = [];
let autoExportArmed = false;

const exportController = {
  active: false,
  startT: 0,
  durationSec: 3.5,
  t0Wall: 0,
};

const stateMachine = {
  state: "IDLE",
  update(h, t1, t2, hys) {
    const s = this.state;
    if (s === "ICE") {
      if (h > t1 + hys) this.state = (h >= t2 ? "AURORA" : "WATER");
    } else if (s === "WATER") {
      if (h < t1 - hys) this.state = "ICE";
      else if (h > t2 + hys) this.state = "AURORA";
    } else if (s === "AURORA") {
      if (h < t2 - hys) this.state = (h <= t1 ? "ICE" : "WATER");
    } else {
      this.state = (h < t1 ? "ICE" : (h < t2 ? "WATER" : "AURORA"));
    }
    return this.state;
  }
};

/** ---------------------------
 *  UI bindings
 * -------------------------- */
el.memoryInfluence.addEventListener("input", () => {
  el.memoryVal.textContent = Number(el.memoryInfluence.value).toFixed(2);
});
el.geoDensity.addEventListener("input", () => {
  el.geoVal.textContent = Number(el.geoDensity.value).toFixed(2);
});
el.memoryVal.textContent = Number(el.memoryInfluence.value).toFixed(2);
el.geoVal.textContent = Number(el.geoDensity.value).toFixed(2);

el.btnIdle.addEventListener("click", () => {
  mode = "IDLE";
  stateMachine.state = "IDLE";
  el.stateTag.textContent = "IDLE";
  el.htTag.textContent = "Hs: — · Ss: —";
  el.turnTag.textContent = "Turns: —";
  intro = 0;
  breath = 0;
  lastTurnIndex = -1;
  captureTimeline = [];
  autoExportArmed = false;
  exportController.active = false;
});

el.btnRender.addEventListener("click", () => {
  const text = el.input.value || "";
  parsed = parseTranscript(text);

  // Features per turn (generic)
  parsed.features = parsed.turns.map(t => featuresForTurn(t.text));

  // H(t) = metaphorical “alignment / interaction coherence” (all turns)
  parsed.ht = computeHTCurve(parsed.features, mem, Number(el.memoryInfluence.value));

  // S(t) = “silicon effectiveness” proxy (assistant turns only)
  parsed.st = computeSTCurve(parsed.turns);

  // Geometry graph from full transcript (density slider)
  graph = buildKeywordGraph(parsed.turns, Number(el.geoDensity.value));

  mode = "RUN";
  t = 0;
  intro = 0;          // start in void, fade in
  breath = 0;
  lastTurnIndex = -1;

  captureTimeline = [];
  autoExportArmed = !!el.autoExportToggle?.checked;

  el.turnTag.textContent = `Turns: ${parsed.turns.length}`;
});

el.btnExport.addEventListener("click", async () => {
  try {
    const blob = await recordWebM(el.canvas, 8000, 30);
    const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
    downloadBlob(blob, `HER-Crystal_${stamp}.webm`);
  } catch (e) {
    alert(`Export failed: ${e.message}`);
  }
});

// Label controls
el.labelMode.addEventListener("change", () => {
  if (!customWrap) return;
  const on = (el.labelMode.value === "CUSTOM");
  customWrap.style.visibility = on ? "visible" : "hidden";
  customWrap.setAttribute("aria-hidden", on ? "false" : "true");
});
if (customWrap) {
  const on = (el.labelMode.value === "CUSTOM");
  customWrap.style.visibility = on ? "visible" : "hidden";
  customWrap.setAttribute("aria-hidden", on ? "false" : "true");
}

/** ---------------------------
 *  Main loop
 * -------------------------- */
requestAnimationFrame(loop);

function loop(now) {
  const dt = Math.min(0.05, (now - lastRenderTs) / 1000);
  lastRenderTs = now;

  t += dt;

  // intro envelope: black ice → awake (about 10–14 seconds)
  if (mode === "RUN") intro = clamp01(intro + dt * 0.09);
  else intro = clamp01(intro + dt * 0.05); // idle also gently wakes

  // breath decay
  breath *= 0.92;

  if (mode === "IDLE") renderIdle(t);
  else renderRun(t);

  requestAnimationFrame(loop);
}

/** ---------------------------
 *  Parsing (v0: User:/Assistant:)
 * -------------------------- */
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

/** ---------------------------
 *  Text features (cheap + local)
 * -------------------------- */
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

/** ---------------------------
 *  H(t): metaphorical interaction alignment curve
 * -------------------------- */
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
  updateMemHud();

  return ht;
}

function avgAbsDiff(arr) {
  let s = 0;
  for (let i=1;i<arr.length;i++) s += Math.abs(arr[i]-arr[i-1]);
  return s / (arr.length - 1);
}

/** ---------------------------
 *  S(t): “silicon effectiveness” proxy (assistant turns only)
 *  Measures structure, clarity, interconnection, novelty (metaphorical).
 * -------------------------- */
function computeSTCurve(turns) {
  const st = new Array(turns.length).fill(0.45);

  const stop = new Set(["the","and","a","to","of","in","is","it","that","for","on","with","as","i","you","we","are","be","or","was","were","this","at","by","from","an","not"]);
  let prevSet = new Set();
  let seen = new Set();
  let sPrev = 0.45;

  for (let i = 0; i < turns.length; i++) {
    const trn = turns[i];
    if (trn.role !== "assistant") {
      // carry forward previous silicon effectiveness through user turns
      st[i] = sPrev;
      continue;
    }

    const f = featuresForTurn(trn.text);
    const words = (trn.text.toLowerCase().match(/[a-z0-9']+/g) || [])
      .filter(w => w.length >= 4 && !stop.has(w));
    const curSet = new Set(words);

    // Depth: enough substance, not just verbosity
    const depth = clamp01((f.len - 40) / 220);

    // Clarity: penalize repetition + volatility markers
    const clarity = clamp01((1 - f.rep) - 0.25 * clamp01((f.ex + f.q) / 20));

    // Interconnection: overlap with previous assistant concept set
    const overlap = setOverlap(curSet, prevSet);
    const interconnection = clamp01(overlap * 1.35);

    // Novelty: fraction of new keywords introduced (but bounded)
    let newCount = 0;
    for (const w of curSet) if (!seen.has(w)) newCount++;
    const noveltyRaw = curSet.size ? (newCount / curSet.size) : 0;
    const novelty = clamp01(1 - Math.abs(noveltyRaw - 0.45) * 1.6); // best around ~45% new

    // Weighted
    let s = 0.35 * depth + 0.30 * interconnection + 0.20 * clarity + 0.15 * novelty;

    // Smooth
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

/** ---------------------------
 *  Keyword graph (geometry overlay)
 * -------------------------- */
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

/** ---------------------------
 *  Label
 * -------------------------- */
function getCenterLabel() {
  if (el.labelMode.value === "CUSTOM") {
    const v = (customInput?.value || "").trim();
    return v.length ? v : "H.E.R";
  }
  return "H.E.R";
}

/** ---------------------------
 *  Rendering
 * -------------------------- */
function renderIdle(time) {
  // Black-ice void: very low H/S, slow pulse
  const pulse = 0.5 + 0.5 * Math.sin(time * 1.0);
  const h = clamp01((0.42 + (mem.bias || 0) * 0.05) + (pulse - 0.5) * 0.05);
  const s = clamp01(0.42 + (pulse - 0.5) * 0.03);

  drawCrystal(time, h, s, "IDLE", null);
  el.stateTag.textContent = "IDLE";
  el.htTag.textContent = `Hₛ: ${h.toFixed(2)} · Sₛ: ${s.toFixed(2)}`;
}

function renderRun(time) {
  if (exportController.active) {
  const elapsed = (performance.now() - exportController.t0Wall) / 1000;
  time = exportController.startT + elapsed;
  }
  const turns = parsed.turns.length;
  if (!turns) {
    renderIdle(time);
    return;
  }

  // Scan along turns
  const speed = 0.22;
  const x = (time * speed) % 1;
  const idxFloat = x * (turns - 1);

  const i0 = Math.floor(idxFloat);
  const i1 = Math.min(turns - 1, i0 + 1);
  const frac = idxFloat - i0;

  // Breath pulse on boundary
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

  captureTimeline.push({ t: time, h, s, score: 0.6*h + 0.4*s });
  if (captureTimeline.length > 6000) captureTimeline.shift(); // safety cap

  const t1 = Number(el.t1.value);
  const t2 = Number(el.t2.value);
  const hys = Number(el.hys.value);

  const stName = stateMachine.update(h, t1, t2, hys);

  drawCrystal(time, h, s, stName, idxFloat);

  el.stateTag.textContent = stName;
  el.htTag.textContent = `Hₛ(t): ${h.toFixed(2)} · Sₛ(t): ${s.toFixed(2)}`;

  if (autoExportArmed && intro > 0.92) {
  const span = captureTimeline[captureTimeline.length - 1].t - captureTimeline[0].t;
  if (span >= 8.0) {
    autoExportArmed = false;
    autoExportBest3();
  }
}
}

function drawCrystal(time, h, s, state, idxFloat) {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);

  const pal = paletteFor(state, h);

  const fieldStrength = intro * (0.10 + 0.55 * h) * (0.85 + 0.25 * breath);
  const geoStrength   = intro * (0.18 + 0.78 * s);

  drawAuroraField(time, pal, state, h, fieldStrength);

  if (graph.nodes.length) {
    const stability = clamp01(0.15 + 0.85 * s) * (0.75 + 0.25 * intro);
    stepGraph(graph, stability, time);
    drawGraph(graph, pal, state, h, s, geoStrength);
  }

  drawCenterMark(time, pal, state, geoStrength);

  if (idxFloat != null) {
    const p = idxFloat / Math.max(1, parsed.turns.length - 1);
    drawTimelineMarker(p, pal, fieldStrength);
  }
}

function drawAuroraField(time, pal, state, h, strength) {
  const img = ctx.getImageData(0, 0, W, H);
  const data = img.data;

  const speed = (state === "ICE") ? 0.06 : (state === "WATER" ? 0.12 : 0.18);
  const scale = (state === "ICE") ? 0.020 : (state === "WATER" ? 0.016 : 0.013);
  const bands = (state === "AURORA") ? 1.35 : (state === "WATER" ? 1.05 : 0.85);
  const sharp = (state === "ICE") ? 1.8 : (state === "WATER" ? 1.1 : 0.8);

  const seed = 2000 + Math.floor((mem.last || 0) % 10000);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = x * scale;
      const ny = y * scale;

      const n1 = fbm2D(nx + time*speed, ny, seed, 5);
      const n2 = fbm2D(nx, ny + time*speed*0.9, seed + 77, 4);
      let v = (0.55*n1 + 0.45*n2);

      v = Math.pow(clamp01(v), sharp);
      const band = Math.sin((ny * 22.0) + v * 6.5 + time * speed * 3.0) * 0.5 + 0.5;
      const lum = clamp01((v * 0.85 + band * 0.55) * bands);

      const b = clamp01(lum * (0.20 + h * 0.95) * strength);

      let edge = 0;
      if (state === "ICE") {
        const g = Math.abs(fbm2D(nx*1.8, ny*1.8, seed+999, 3) - 0.5);
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

  ctx.putImageData(img, 0, 0);

  const grd = ctx.createRadialGradient(W*0.5, H*0.5, H*0.15, W*0.5, H*0.5, H*0.75);
  grd.addColorStop(0, "rgba(0,0,0,0)");
  grd.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = grd;
  ctx.fillRect(0,0,W,H);
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

/**
 * h = “carbon alignment” proxy (field)
 * s = “silicon effectiveness” proxy (geometry)
 */
function drawGraph(g, pal, state, h, s, strength) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";

  const edgeAlpha = clamp01((0.10 + 0.55*s) * strength);
  const nodeAlpha = clamp01((0.12 + 0.70*s) * strength);

  // edges (thicker with S)
  ctx.lineWidth = 0.9 + 2.2 * s;
  ctx.strokeStyle = `rgba(${Math.floor(pal.edgeR*255)},${Math.floor(pal.edgeG*255)},${Math.floor(pal.edgeB*255)},${edgeAlpha})`;

  for (const e of g.edges) {
    const a = g.nodes[e.a], b = g.nodes[e.b];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // nodes (larger with S)
  for (const n of g.nodes) {
    const r = (2.8 + Math.min(9, n.w * 0.5)) * (0.9 + 0.6*s);
    ctx.fillStyle = `rgba(${Math.floor(pal.nodeR*255)},${Math.floor(pal.nodeG*255)},${Math.floor(pal.nodeB*255)},${nodeAlpha})`;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI*2);
    ctx.fill();
  }

  ctx.restore();
}

function findBestWindow(tl, durationSec = 3.5) {
  if (!tl || tl.length < 2) return null;

  let best = { startT: tl[0].t, avg: -Infinity, durationSec };

  // Two-pointer sliding window
  let sum = 0;
  let i = 0;
  let j = 0;

  while (i < tl.length) {
    const startT = tl[i].t;
    const endT = startT + durationSec;

    while (j < tl.length && tl[j].t <= endT) {
      sum += tl[j].score;
      j++;
    }

    const count = Math.max(1, j - i);
    const avg = sum / count;

    if (avg > best.avg) best = { startT, avg, durationSec };

    sum -= tl[i].score;
    i++;
  }

  return best;
}

function fileStamp() {
  return new Date().toISOString().slice(0,19).replace(/[:T]/g, "-");
}

function signatureFromBest(best, peakH, peakS) {
  // lightweight deterministic signature (upgrade to hash later)
  const a = Math.round(best.avg * 1000);
  const b = Math.round(peakH * 1000);
  const c = Math.round(peakS * 1000);
  return `A${a}_H${b}_S${c}`;
}

async function autoExportBest3() {
  const best = findBestWindow(captureTimeline, 3.5);
  if (!best) return;

  // compute peak H/S inside best window
  let peakH = 0, peakS = 0;
  for (const p of captureTimeline) {
    if (p.t >= best.startT && p.t <= best.startT + best.durationSec) {
      if (p.h > peakH) peakH = p.h;
      if (p.s > peakS) peakS = p.s;
    }
  }

  exportController.active = true;
  exportController.startT = best.startT;
  exportController.durationSec = best.durationSec;
  exportController.t0Wall = performance.now();

  const blob = await recordWebM(el.canvas, best.durationSec * 1000, 30);
  exportController.active = false;

  const sig = signatureFromBest(best, peakH, peakS);
  const name = `HER-Crystal_best3s_${sig}_${fileStamp()}.webm`;
  downloadBlob(blob, name);
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

  // base readable layer
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.shadowBlur = 0;
  ctx.fillStyle = `rgba(255,255,255,${clamp01(0.55 + 0.35*strength)})`;
  ctx.fillText(label, W*0.5, H*0.5);
  ctx.restore();

  // glow layer
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

  ctx.fillStyle = `rgba(${Math.floor(pal.nodeR*255)},${Math.floor(pal.nodeG*255)},${Math.floor(pal.nodeB*255)},${clamp01(0.25 + 0.6*strength)})`;
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

/** ---------------------------
 *  Memory seed helpers
 * -------------------------- */
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
function updateMemHud() {
  el.memTag.textContent = `Memory seed: bias=${(mem.bias||0).toFixed(2)} · vol=${(mem.vol||0).toFixed(2)}`;
}

function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function clamp(a,b,x){ return Math.max(a, Math.min(b, x)); }