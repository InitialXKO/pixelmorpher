// ============================================================
// PixelMorpher - Noise Utilities
// seededRandom, hashString, simplex2D, fbmNoise, animRng, animEase
// ============================================================

/** Deterministic seeded PRNG (LCG) */
export function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return (s >>> 0) / 4294967295;
  };
}

/** Hash a string to a 32-bit integer */
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

// Simple 2D noise implementation for procedural animations
export function simplex2D(x: number, y: number): number {
  // Simplified Perlin noise using hash
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const smooth = (t: number) => t * t * (3 - 2 * t);
  const sfx = smooth(fx);
  const sfy = smooth(fy);

  const hash = (x: number, y: number) => {
    let h = x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return (h ^ (h >> 16)) / 2147483648;
  };

  const n00 = hash(ix, iy);
  const n10 = hash(ix + 1, iy);
  const n01 = hash(ix, iy + 1);
  const n11 = hash(ix + 1, iy + 1);

  const nx0 = n00 + (n10 - n00) * sfx;
  const nx1 = n01 + (n11 - n01) * sfx;
  return nx0 + (nx1 - nx0) * sfy;
}

export function fbmNoise(x: number, y: number, octaves: number, seed: number): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * simplex2D(x * frequency + seed, y * frequency + seed * 0.7);
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / maxValue;
}

/** Seeded PRNG for deterministic randomness in animation modifiers */
export function animRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Easing function for animation modifiers */
export function animEase(t: number, type: string): number {
  const ct = Math.max(0, Math.min(1, t));
  switch (type) {
    case 'linear': return ct;
    case 'ease_in': return ct * ct;
    case 'ease_out': return 1 - (1 - ct) * (1 - ct);
    case 'smooth': default: return ct * ct * (3 - 2 * ct);
  }
}

/** Simple seeded PRNG for deterministic random in geometric deformations */
export function geoRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
