// ============================================================
// PixelMorpher - Tile Blob Engine
// Procedural blob tile generation for map tile animation workflow
//
// Workflow:
//   1. Import/Generate 2 base blob materials (A & B)
//   2. Compose 3×3 template from materials with blend params
//   3. Generate 47 tile variations from template
// ============================================================

import type { PixelGrid, PixelColor, BlobGenParams } from './types';
import { rgbaToHexOrNull, rgbToHex } from './engine/utils';
import { hexToRgb } from './engine/color-utils';

// ---- Simple seeded PRNG (Mulberry32) ----

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Value Noise ----

function hash2d(x: number, y: number, seed: number): number {
  let h = seed;
  h = Math.imul(h ^ (x * 374761393), 1103515245);
  h = Math.imul(h ^ (y * 668265263), 1103515245);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);

  const n00 = hash2d(ix, iy, seed);
  const n10 = hash2d(ix + 1, iy, seed);
  const n01 = hash2d(ix, iy + 1, seed);
  const n11 = hash2d(ix + 1, iy + 1, seed);

  const nx0 = n00 + (n10 - n00) * fx;
  const nx1 = n01 + (n11 - n01) * fx;
  return nx0 + (nx1 - nx0) * fy;
}

function fbm(x: number, y: number, seed: number, octaves: number, persistence: number, lacunarity: number): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(x * frequency, y * frequency, seed + i * 31) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / maxValue;
}

// ---- Blob Material Generation ----

// BlobGenParams is now defined in types.ts (canonical location)
export type { BlobGenParams } from './types';

export const DEFAULT_BLOB_GEN_PARAMS: BlobGenParams = {
  seed: 42,
  scale: 0.08,
  octaves: 4,
  persistence: 0.5,
  lacunarity: 2.0,
  threshold: 0.5,
  color1: '#4a7c3f',
  color2: '#8b6b3d',
  irregularity: 0.3,
  edgeSoftness: 0.2,
};

/** Generate a blob material pixel grid */
export function generateBlobMaterial(
  width: number,
  height: number,
  params: BlobGenParams,
): PixelGrid {
  const rng = mulberry32(params.seed);
  const pixels: PixelGrid = [];

  for (let y = 0; y < height; y++) {
    const row: PixelColor[] = [];
    for (let x = 0; x < width; x++) {
      // Base noise value
      let noise = fbm(x * params.scale, y * params.scale, params.seed, params.octaves, params.persistence, params.lacunarity);

      // Add irregularity noise
      if (params.irregularity > 0) {
        const irrNoise = fbm(x * params.scale * 3, y * params.scale * 3, params.seed + 777, 2, 0.5, 2.0);
        noise += (irrNoise - 0.5) * params.irregularity * 0.3;
      }

      // Apply threshold with softness
      const softEdge = params.edgeSoftness * 0.15;
      let blend: number;
      if (softEdge < 0.001) {
        blend = noise >= params.threshold ? 1 : 0;
      } else {
        const low = params.threshold - softEdge;
        const high = params.threshold + softEdge;
        if (noise <= low) blend = 0;
        else if (noise >= high) blend = 1;
        else blend = (noise - low) / (high - low);
      }

      // Blend colors
      if (blend <= 0) {
        row.push(params.color1);
      } else if (blend >= 1) {
        row.push(params.color2);
      } else {
        row.push(lerpColor(params.color1, params.color2, blend));
      }
    }
    pixels.push(row);
  }

  return pixels;
}

// ---- Color Utilities ----

function lerpColor(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(c1);
  const [r2, g2, b2] = hexToRgb(c2);
  return rgbToHex(
    r1 + (r2 - r1) * t,
    g1 + (g2 - g1) * t,
    b1 + (b2 - b1) * t,
  );
}

// ---- Template Composition ----

export interface TemplateBlendParams {
  blendWidth: number;    // Transition zone width in pixels (0-8)
  blendMode: 'smooth' | 'sharp' | 'dither';
  cornerStyle: 'rounded' | 'square' | 'chamfer';
  featherRadius: number; // Feather/blur radius for transitions (0-4)
}

export const DEFAULT_TEMPLATE_BLEND_PARAMS: TemplateBlendParams = {
  blendWidth: 2,
  blendMode: 'smooth',
  cornerStyle: 'rounded',
  featherRadius: 1,
};

/**
 * Generate a 3×3 template from two materials.
 *
 * The template represents a tile where each corner is assigned one of the two materials.
 * The 9 sub-regions (4 corners, 4 edges, 1 center) show how the materials blend.
 *
 * @param materialA - Material A pixel grid
 * @param materialB - Material B pixel grid
 * @param tileWidth - Width of a single tile
 * @param tileHeight - Height of a single tile
 * @param blendParams - How the two materials blend together
 * @param cornerMask - Which corners are material B [NE, SE, SW, NW]
 * @param edgeMask - Which edges are material B [N, E, S, W] (optional, derived from corners if omitted)
 * @returns Full tile pixel grid
 */
export function composeTileFromTemplate(
  materialA: PixelGrid,
  materialB: PixelGrid,
  tileWidth: number,
  tileHeight: number,
  blendParams: TemplateBlendParams,
  cornerMask: [boolean, boolean, boolean, boolean], // [NE, SE, SW, NW]
  edgeMask?: [boolean, boolean, boolean, boolean], // [N, E, S, W] - optional
): PixelGrid {
  const pixels: PixelGrid = [];
  const matAH = materialA.length;
  const matAW = matAH > 0 ? materialA[0].length : 0;
  const matBH = materialB.length;
  const matBW = matBH > 0 ? materialB[0].length : 0;

  for (let y = 0; y < tileHeight; y++) {
    const row: PixelColor[] = [];
    for (let x = 0; x < tileWidth; x++) {
      // Normalized position (0-1)
      const nx = x / tileWidth;
      const ny = y / tileHeight;

      // Sample from each material
      const ax = Math.floor(nx * matAW) % matAW;
      const ay = Math.floor(ny * matAH) % matAH;
      const bx = Math.floor(nx * matBW) % matBW;
      const by = Math.floor(ny * matBH) % matBH;

      const pixelA = materialA[ay]?.[ax] ?? null;
      const pixelB = materialB[by]?.[bx] ?? null;

      // Calculate distance-based blend factor
      // Each corner influences the region nearest to it
      const blend = computeBlendFactor(nx, ny, cornerMask, edgeMask, blendParams);

      // Apply blend
      if (blend <= 0) {
        row.push(pixelA);
      } else if (blend >= 1) {
        row.push(pixelB);
      } else {
        if (pixelA === null && pixelB === null) {
          row.push(null);
        } else if (pixelA === null) {
          row.push(pixelB);
        } else if (pixelB === null) {
          row.push(pixelA);
        } else {
          row.push(lerpColor(pixelA, pixelB, blend));
        }
      }
    }
    pixels.push(row);
  }

  return pixels;
}

/**
 * Compute blend factor at normalized position (nx, ny) based on which corners
 * are material B.
 *
 * Corner layout:
 *   NW(3) ---- NE(0)
 *    |          |
 *   SW(2) ---- SE(1)
 */
function computeBlendFactor(
  nx: number,
  ny: number,
  cornerMask: [boolean, boolean, boolean, boolean], // [NE, SE, SW, NW]
  edgeMask: [boolean, boolean, boolean, boolean] | undefined, // [N, E, S, W]
  params: TemplateBlendParams,
): number {
  // Corner positions
  const corners = [
    { x: 1, y: 0, isB: cornerMask[0] }, // NE
    { x: 1, y: 1, isB: cornerMask[1] }, // SE
    { x: 0, y: 1, isB: cornerMask[2] }, // SW
    { x: 0, y: 0, isB: cornerMask[3] }, // NW
  ];

  // Derive edge states from edgeMask if provided, otherwise from adjacent corners
  // An edge is "B" if specified as B, or (if not specified) if BOTH adjacent corners are B
  const edgeN = edgeMask ? edgeMask[0] : (corners[3].isB && corners[0].isB); // NW & NE
  const edgeE = edgeMask ? edgeMask[1] : (corners[0].isB && corners[1].isB); // NE & SE
  const edgeS = edgeMask ? edgeMask[2] : (corners[2].isB && corners[1].isB); // SW & SE
  const edgeW = edgeMask ? edgeMask[3] : (corners[3].isB && corners[2].isB); // NW & SW

  // Calculate "B influence" at this point using distance-based weighting
  // Each B-corner and B-edge contributes influence that falls off with distance
  const blendW = Math.max(0.01, params.blendWidth);
  let bInfluence = 0;
  let totalWeight = 0;

  // Corner influences - each corner has a quadrant of influence
  for (const corner of corners) {
    const dx = Math.abs(nx - corner.x);
    const dy = Math.abs(ny - corner.y);
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Weight falls off with distance, stronger near the corner
    const maxDist = 1.0; // corners are at most sqrt(2) apart
    const weight = Math.max(0, 1 - dist / maxDist);
    totalWeight += weight;

    if (corner.isB) {
      bInfluence += weight;
    }
  }

  // Edge influences - edges affect the middle band
  const edges = [
    { axis: 'h', pos: 0, isB: edgeN },   // North edge
    { axis: 'h', pos: 1, isB: edgeS },   // South edge
    { axis: 'v', pos: 0, isB: edgeW },   // West edge
    { axis: 'v', pos: 1, isB: edgeE },   // East edge
  ];

  for (const edge of edges) {
    if (!edge.isB) continue;

    let dist: number;
    if (edge.axis === 'h') {
      dist = Math.abs(ny - edge.pos);
    } else {
      dist = Math.abs(nx - edge.pos);
    }

    const weight = Math.max(0, 1 - dist * 2);
    if (weight > 0) {
      totalWeight += weight * 0.8;
      bInfluence += weight * 0.8;
    }
  }

  // Center influence - if all corners are B, center is B
  const allCornersB = cornerMask.every(c => c);
  if (allCornersB) {
    const cx = 0.5, cy = 0.5;
    const dist = Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2);
    const weight = Math.max(0, 1 - dist * 2);
    totalWeight += weight * 0.5;
    bInfluence += weight * 0.5;
  }

  // Normalize
  let blend = totalWeight > 0 ? bInfluence / totalWeight : 0;

  // Apply corner style
  if (params.cornerStyle === 'rounded') {
    // Smooth the blend with a curve
    blend = smoothstep(blend);
  } else if (params.cornerStyle === 'chamfer') {
    // Sharper transition
    blend = blend > 0.3 ? Math.min(1, blend * 1.5) : blend * 0.5;
  } else {
    // Square - use step function with softness from blendWidth
    if (blend < 0.5 - blendW * 0.05) blend = 0;
    else if (blend > 0.5 + blendW * 0.05) blend = 1;
    else blend = (blend - 0.5 + blendW * 0.05) / (blendW * 0.1);
  }

  // Apply blend mode
  if (params.blendMode === 'sharp') {
    blend = blend > 0.45 ? 1 : 0;
  } else if (params.blendMode === 'dither') {
    // Ordered dithering approximation
    if (blend > 0.3 && blend < 0.7) {
      const threshold = ((nx * 8) % 2 + (ny * 8) % 2) > 1 ? 0.4 : 0.6;
      blend = blend > threshold ? 1 : 0;
    } else {
      blend = blend > 0.5 ? 1 : 0;
    }
  }

  return Math.max(0, Math.min(1, blend));
}

// ---- Blob Tile Generation ----

/**
 * Edge/corner mask for a single tile in the blob tile set.
 * Represents which of the 4 edges and 4 corners are "material B".
 */
export interface TileMask {
  /** Which edges are material B [N, E, S, W] */
  edges: [boolean, boolean, boolean, boolean];
  /** Which corners are material B [NE, SE, SW, NW] */
  corners: [boolean, boolean, boolean, boolean];
  /** Human-readable label */
  label: string;
}

/** Direction labels for edges */
const EDGE_LABELS = ['N', 'E', 'S', 'W'];
const CORNER_LABELS = ['NE', 'SE', 'SW', 'NW'];

/**
 * Generate all valid blob tile masks.
 *
 * A corner can only be B if at least one of its two adjacent edges is B.
 * This constraint eliminates invalid configurations.
 * Total count: 161 unique edge+corner combinations (including all rotations/reflections).
 */
function generateAllTileMasks(): TileMask[] {
  const masks: TileMask[] = [];

  // Iterate all 16 edge combinations
  for (let edgeBits = 0; edgeBits < 16; edgeBits++) {
    const edges: [boolean, boolean, boolean, boolean] = [
      !!(edgeBits & 8), // N
      !!(edgeBits & 4), // E
      !!(edgeBits & 2), // S
      !!(edgeBits & 1), // W
    ];

    // For each edge combination, enumerate valid corner combinations
    // A corner can be B only if at least one adjacent edge is B
    // NE: needs N or E
    // SE: needs S or E
    // SW: needs S or W
    // NW: needs N or W

    const neAllowed = edges[0] || edges[1];
    const seAllowed = edges[2] || edges[1];
    const swAllowed = edges[2] || edges[3];
    const nwAllowed = edges[0] || edges[3];

    const maxCornerBits =
      (neAllowed ? 8 : 0) | (seAllowed ? 4 : 0) | (swAllowed ? 2 : 0) | (nwAllowed ? 1 : 0);

    // Iterate all valid corner combinations
    for (let cornerBits = 0; cornerBits <= maxCornerBits; cornerBits++) {
      // Check if this corner combination is valid
      const ne = !!(cornerBits & 8);
      const se = !!(cornerBits & 4);
      const sw = !!(cornerBits & 2);
      const nw = !!(cornerBits & 1);

      // Skip invalid: corner is B but not allowed
      if (ne && !neAllowed) continue;
      if (se && !seAllowed) continue;
      if (sw && !swAllowed) continue;
      if (nw && !nwAllowed) continue;

      const corners: [boolean, boolean, boolean, boolean] = [ne, se, sw, nw];

      // Build label
      const parts: string[] = [];
      if (edges.every(e => e) && corners.every(c => c)) {
        parts.push('all');
      } else if (edges.every(e => !e) && corners.every(c => !c)) {
        parts.push('none');
      } else {
        edges.forEach((e, i) => { if (e) parts.push(EDGE_LABELS[i]); });
        corners.forEach((c, i) => { if (c) parts.push(CORNER_LABELS[i]); });
      }

      masks.push({
        edges,
        corners,
        label: parts.join('+') || 'none',
      });
    }
  }

  return masks;
}

/** Cached tile masks */
let _cachedMasks: TileMask[] | null = null;

export function getAllTileMasks(): TileMask[] {
  if (!_cachedMasks) {
    _cachedMasks = generateAllTileMasks();
  }
  return _cachedMasks;
}

export interface TileGenParams {
  variation: number;  // Per-tile pixel variation (0-1)
  seed: number;       // Seed for variation
  detail: number;     // Detail level 1-3
}

export const DEFAULT_TILE_GEN_PARAMS: TileGenParams = {
  variation: 0.1,
  seed: 123,
  detail: 2,
};

/**
 * Generate all blob tiles from two materials and a template configuration.
 * Produces 161 tiles covering all valid edge+corner mask combinations.
 *
 * @param materialA - Material A pixel grid
 * @param materialB - Material B pixel grid
 * @param tileWidth - Width of each tile
 * @param tileHeight - Height of each tile
 * @param blendParams - Template blend parameters
 * @param genParams - Tile generation parameters
 * @returns Array of tile pixel grids with their masks
 */
export function generateAllTiles(
  materialA: PixelGrid,
  materialB: PixelGrid,
  tileWidth: number,
  tileHeight: number,
  blendParams: TemplateBlendParams,
  genParams: TileGenParams,
): { mask: TileMask; pixels: PixelGrid }[] {
  const masks = getAllTileMasks();
  const rng = mulberry32(genParams.seed);

  return masks.map((mask, index) => {
    // Generate the base tile from the template, passing both edges and corners
    let tilePixels = composeTileFromTemplate(
      materialA,
      materialB,
      tileWidth,
      tileHeight,
      blendParams,
      mask.corners,
      mask.edges,
    );

    // Apply variation
    if (genParams.variation > 0) {
      tilePixels = applyVariation(tilePixels, materialA, materialB, genParams.variation, rng);
    }

    return { mask, pixels: tilePixels };
  });
}

/**
 * Apply random variation to a tile's pixels.
 * Adds/subtracts small amounts of material A or B to create natural variation.
 */
function applyVariation(
  tile: PixelGrid,
  materialA: PixelGrid,
  materialB: PixelGrid,
  variation: number,
  rng: () => number,
): PixelGrid {
  const h = tile.length;
  const w = h > 0 ? tile[0].length : 0;
  const matAH = materialA.length;
  const matAW = matAH > 0 ? materialA[0].length : 0;
  const matBH = materialB.length;
  const matBW = matBH > 0 ? materialB[0].length : 0;

  return tile.map((row, y) =>
    row.map((pixel, x) => {
      if (pixel === null) return null;

      // Random chance to swap toward A or B
      const r = rng();
      if (r < variation * 0.5) {
        // Swap toward material B
        const bx = x % matBW;
        const by = y % matBH;
        return materialB[by]?.[bx] ?? pixel;
      } else if (r < variation) {
        // Swap toward material A
        const ax = x % matAW;
        const ay = y % matAH;
        return materialA[ay]?.[ax] ?? pixel;
      }
      return pixel;
    })
  );
}

// ---- Import Helpers ----

/** Convert ImageData to PixelGrid */
export function imageDataToTilePixels(imageData: ImageData): PixelGrid {
  const { width, height, data } = imageData;
  const pixels: PixelGrid = [];
  for (let y = 0; y < height; y++) {
    const row: PixelColor[] = [];
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      row.push(rgbaToHexOrNull(r, g, b, a));
    }
    pixels.push(row);
  }
  return pixels;
}

/** Create an empty pixel grid */
function createEmptyTileGrid(w: number, h: number): PixelGrid {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => null as PixelColor));
}

/** Render a PixelGrid to a canvas ImageData */
function tileGridToImageData(grid: PixelGrid, bgColor: string = '#000000'): ImageData {
  const h = grid.length;
  const w = h > 0 ? grid[0].length : 0;
  const data = new Uint8ClampedArray(w * h * 4);
  const [bgR, bgG, bgB] = hexToRgb(bgColor);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const pixel = grid[y]?.[x];
      if (pixel === null) {
        data[i] = bgR;
        data[i + 1] = bgG;
        data[i + 2] = bgB;
        data[i + 3] = 255;
      } else {
        const [r, g, b] = hexToRgb(pixel);
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
  }

  return new ImageData(data, w, h);
}

/** Draw a PixelGrid onto a canvas 2D context at a given position and scale */
export function drawTileGridToCanvas(
  ctx: CanvasRenderingContext2D,
  grid: PixelGrid,
  x: number,
  y: number,
  scale: number = 1,
  bgColor: string = '#000000',
): void {
  const h = grid.length;
  const w = h > 0 ? grid[0].length : 0;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const pixel = grid[py]?.[px];
      ctx.fillStyle = pixel ?? bgColor;
      ctx.fillRect(x + px * scale, y + py * scale, scale, scale);
    }
  }
}
