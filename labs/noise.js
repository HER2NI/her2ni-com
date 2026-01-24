// noise.js — lightweight value noise (not perfect Perlin), good for aurora flow.

function hash2(x, y, seed) {
  // 32-bit mix
  let h = seed ^ (x * 374761393) ^ (y * 668265263);
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function smoothstep(t) { return t * t * (3 - 2 * t); }

export function valueNoise2D(x, y, seed = 1337) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;

  const v00 = hash2(xi, yi, seed);
  const v10 = hash2(xi + 1, yi, seed);
  const v01 = hash2(xi, yi + 1, seed);
  const v11 = hash2(xi + 1, yi + 1, seed);

  const u = smoothstep(xf);
  const v = smoothstep(yf);

  const a = v00 + (v10 - v00) * u;
  const b = v01 + (v11 - v01) * u;
  return a + (b - a) * v; // 0..1
}

export function fbm2D(x, y, seed = 1337, octaves = 4) {
  let amp = 0.5, freq = 1.0, sum = 0.0, norm = 0.0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2D(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / norm; // 0..1
}