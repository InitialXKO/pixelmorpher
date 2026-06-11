// ============================================================
// PixelMorpher - Color Utilities
// hexToRgb, hexToRgbCached, unpackRgb, hexBrightness, hexSaturation,
// lerpColor, adjustSaturation, blendColors, dimColor, darkenColor,
// lightenColor, colorDistance, blendColorsPixel, hexToRgbObj
// ============================================================

// P1-3: hexToRgb LRU cache — avoid repeated parseInt for same colors
const _rgbCache = new Map<string, number>();
const _RGB_CACHE_MAX = 4096;

export function hexToRgbCached(hex: string): number {
  let v = _rgbCache.get(hex);
  if (v !== undefined) return v;
  const h = hex.replace('#', '');
  v = (parseInt(h.slice(0, 2), 16) << 16) | (parseInt(h.slice(2, 4), 16) << 8) | parseInt(h.slice(4, 6), 16);
  if (_rgbCache.size >= _RGB_CACHE_MAX) {
    const first = _rgbCache.keys().next().value;
    if (first !== undefined) _rgbCache.delete(first);
  }
  _rgbCache.set(hex, v);
  return v;
}

/** Extract [r,g,b] from packed int (from hexToRgbCached) */
function unpackRgb(packed: number): [number, number, number] {
  return [(packed >> 16) & 0xFF, (packed >> 8) & 0xFF, packed & 0xFF];
}

/** Parse hex color (#rrggbb) to [r, g, b] — P1-3: uses cached version internally */
export function hexToRgb(hex: string): [number, number, number] {
  return unpackRgb(hexToRgbCached(hex));
}

/** Compute perceived brightness of a hex color, normalized to [0, 1] */
export function hexBrightness(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Compute perceived saturation of a hex color, normalized to [0, 1] */
export function hexSaturation(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

/** Adjust the saturation of a hex color */
export function adjustSaturation(hex: string, targetSat: number): string {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return hex; // can't adjust black

  const gray = Math.round((max + min) / 2);
  if (targetSat <= 0.001) {
    return `#${gray.toString(16).padStart(2, '0')}${gray.toString(16).padStart(2, '0')}${gray.toString(16).padStart(2, '0')}`;
  }

  const nr = Math.min(255, Math.max(0, Math.round(gray + (r - gray) * targetSat)));
  const ng = Math.min(255, Math.max(0, Math.round(gray + (g - gray) * targetSat)));
  const nb = Math.min(255, Math.max(0, Math.round(gray + (b - gray) * targetSat)));
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

/** Dim a hex color by a factor (0 = black, 1 = original) */
export function dimColor(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  const nr = Math.round(r * factor);
  const ng = Math.round(g * factor);
  const nb = Math.round(b * factor);
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

/** Linearly interpolate between two hex colors — P1-3: uses cached hexToRgb */
export function lerpColor(hex1: string, hex2: string, t: number): string {
  const v1 = hexToRgbCached(hex1);
  const v2 = hexToRgbCached(hex2);
  const r = Math.round(((v1 >> 16) & 0xFF) + (((v2 >> 16) & 0xFF) - ((v1 >> 16) & 0xFF)) * t);
  const g = Math.round(((v1 >> 8) & 0xFF) + (((v2 >> 8) & 0xFF) - ((v1 >> 8) & 0xFF)) * t);
  const b = Math.round((v1 & 0xFF) + ((v2 & 0xFF) - (v1 & 0xFF)) * t);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

export function colorDistance(c1: string, c2: string): number {
  const v1 = hexToRgbCached(c1);
  const v2 = hexToRgbCached(c2);
  const dr = ((v1 >> 16) & 0xFF) - ((v2 >> 16) & 0xFF);
  const dg = ((v1 >> 8) & 0xFF) - ((v2 >> 8) & 0xFF);
  const db = (v1 & 0xFF) - (v2 & 0xFF);
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function darkenColor(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  const nr = Math.round(r * factor);
  const ng = Math.round(g * factor);
  const nb = Math.round(b * factor);
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

export function lightenColor(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  const nr = Math.min(255, Math.round(r + (255 - r) * factor));
  const ng = Math.min(255, Math.round(g + (255 - g) * factor));
  const nb = Math.min(255, Math.round(b + (255 - b) * factor));
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

/** Simple color blend helper for PixelEdit modifier */
export function blendColorsPixel(base: string, overlay: string, mode: 'multiply' | 'screen' | 'overlay', opacity: number): string {
  const b = hexToRgbObj(base);
  const o = hexToRgbObj(overlay);
  if (!b || !o) return overlay;
  let r: number, g: number, bl: number;
  if (mode === 'multiply') {
    r = Math.round(b.r * o.r / 255);
    g = Math.round(b.g * o.g / 255);
    bl = Math.round(b.b * o.b / 255);
  } else if (mode === 'screen') {
    r = Math.round(255 - (255 - b.r) * (255 - o.r) / 255);
    g = Math.round(255 - (255 - b.g) * (255 - o.g) / 255);
    bl = Math.round(255 - (255 - b.b) * (255 - o.b) / 255);
  } else { // overlay
    r = b.r < 128 ? Math.round(2 * b.r * o.r / 255) : Math.round(255 - 2 * (255 - b.r) * (255 - o.r) / 255);
    g = b.g < 128 ? Math.round(2 * b.g * o.g / 255) : Math.round(255 - 2 * (255 - b.g) * (255 - o.g) / 255);
    bl = b.b < 128 ? Math.round(2 * b.b * o.b / 255) : Math.round(255 - 2 * (255 - b.b) * (255 - o.b) / 255);
  }
  r = Math.round(b.r * (1 - opacity) + r * opacity);
  g = Math.round(b.g * (1 - opacity) + g * opacity);
  bl = Math.round(b.b * (1 - opacity) + bl * opacity);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${bl.toString(16).padStart(2,'0')}`;
}

/** Parse hex color to RGB object (for PixelEdit blend helper) */
function hexToRgbObj(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
