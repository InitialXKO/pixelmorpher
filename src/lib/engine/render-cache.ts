// ============================================================
// PixelMorpher - Render Cache System
// ============================================================
// Provides LRU caches for expensive rendering operations:
// 1. Sprite rotation cache: memoizes renderPixelPerfectRotation results
//    by variantIndex:angle:stretch:plugX:plugY + canvas fingerprint
// 2. Disc bitmap cache: memoizes pre-rendered disc ellipses
//    by diameter:fillColor:outlineColor
//
// Both caches use a shared LRU eviction strategy with configurable
// maximum entries. Canvas objects in the cache are reused (not
// recreated) when the same inputs occur, eliminating GC pressure
// from per-frame canvas creation/destruction.
// ============================================================

// ---- Generic LRU Cache ----

interface CacheEntry<V> {
  key: string;
  value: V;
  accessTime: number;
}

/**
 * Simple LRU cache with time-based ordering.
 * Evicts the least-recently-accessed entry when capacity is exceeded.
 */
class LRUCache<V> {
  private entries: Map<string, CacheEntry<V>> = new Map();
  private readonly maxSize: number;
  private accessCounter: number = 0;

  constructor(maxSize: number = 256) {
    this.maxSize = maxSize;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (entry) {
      entry.accessTime = ++this.accessCounter;
      return entry.value;
    }
    return undefined;
  }

  set(key: string, value: V): void {
    const existing = this.entries.get(key);
    if (existing) {
      existing.value = value;
      existing.accessTime = ++this.accessCounter;
      return;
    }

    // Evict LRU if at capacity
    if (this.entries.size >= this.maxSize) {
      let lruKey: string | null = null;
      let lruTime = Infinity;
      for (const [k, v] of this.entries) {
        if (v.accessTime < lruTime) {
          lruTime = v.accessTime;
          lruKey = k;
        }
      }
      if (lruKey !== null) {
        this.entries.delete(lruKey);
      }
    }

    this.entries.set(key, { key, value, accessTime: ++this.accessCounter });
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  clear(): void {
    this.entries.clear();
    this.accessCounter = 0;
  }

  get size(): number {
    return this.entries.size;
  }
}

// ---- Sprite Rotation Cache ----

export interface RotationCacheEntry {
  canvas: HTMLCanvasElement;
  resultPivotX: number;
  resultPivotY: number;
}

const rotationCache = new LRUCache<RotationCacheEntry>(512);

/**
 * Generate a cache key for sprite rotation.
 * Uses canvas dimensions + pixel data hash + angle + stretch + pivot.
 *
 * The canvas fingerprint is derived from width, height, and a lightweight
 * sampling of pixel data (not a full hash — we trade perfect accuracy
 * for speed). For most animations, the sprite doesn't change between
 * frames, so this cache is highly effective.
 *
 * IMPORTANT: The cache key must include the canvas content fingerprint,
 * not just dimensions + angle, because the same node can have different
 * sprites at different frames (e.g., due to modifier changes, direction
 * changes, or costume switches).
 */
export function getRotationCacheKey(
  spriteCanvas: HTMLCanvasElement,
  angle: number,
  stretch: number,
  pivotX: number,
  pivotY: number,
): string {
  // Quantize angle to 0.01 degree precision (sub-degree changes are invisible at pixel scale)
  const qAngle = Math.round(angle * 100);
  // Quantize stretch to 0.01 precision
  const qStretch = Math.round(stretch * 100);
  // Quantize pivot to 0.1 pixel precision
  const qPivotX = Math.round(pivotX * 10);
  const qPivotY = Math.round(pivotY * 10);

  // Canvas fingerprint: width + height + sample of pixel data
  // Sample 4 corner pixels + center pixel as a quick fingerprint
  const w = spriteCanvas.width;
  const h = spriteCanvas.height;
  let fingerprint = `${w}:${h}`;

  try {
    const ctx = spriteCanvas.getContext('2d');
    if (ctx) {
      // Sample a few pixels for fingerprint (5 points)
      const samplePoints = [
        [0, 0],
        [w - 1, 0],
        [0, h - 1],
        [w - 1, h - 1],
        [Math.floor(w / 2), Math.floor(h / 2)],
      ];
      for (const [sx, sy] of samplePoints) {
        if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
          const pixel = ctx.getImageData(sx, sy, 1, 1).data;
          fingerprint += `:${pixel[0]},${pixel[1]},${pixel[2]},${pixel[3]}`;
        }
      }
    }
  } catch {
    // Canvas may be tainted or not accessible — use dimensions only
  }

  return `${fingerprint}:${qAngle}:${qStretch}:${qPivotX}:${qPivotY}`;
}

/**
 * Look up a cached rotation result.
 * Returns undefined if not cached.
 */
export function getCachedRotation(key: string): RotationCacheEntry | undefined {
  return rotationCache.get(key);
}

/**
 * Store a rotation result in the cache.
 */
export function setCachedRotation(key: string, entry: RotationCacheEntry): void {
  rotationCache.set(key, entry);
}

// ---- Disc Bitmap Cache ----

export interface DiscCacheEntry {
  canvas: HTMLCanvasElement;
  radius: number;
}

const discCache = new LRUCache<DiscCacheEntry>(128);

/**
 * Generate a cache key for disc rendering.
 * Discs are pure geometric shapes — only diameter, fillColor, and outlineColor
 * determine the output, so the cache key is straightforward.
 */
export function getDiscCacheKey(
  diameter: number,
  fillColor: string,
  outlineColor: string,
): string {
  // Quantize diameter to 0.5 pixel precision
  const qDiameter = Math.round(diameter * 2);
  return `${qDiameter}:${fillColor}:${outlineColor}`;
}

/**
 * Look up a cached disc bitmap.
 * Returns undefined if not cached.
 */
export function getCachedDisc(key: string): DiscCacheEntry | undefined {
  return discCache.get(key);
}

/**
 * Store a disc bitmap in the cache.
 */
export function setCachedDisc(key: string, entry: DiscCacheEntry): void {
  discCache.set(key, entry);
}

// ---- Cache Management ----

/**
 * Clear all render caches.
 * Should be called when the project data changes significantly
 * (e.g., switching projects, undo/redo operations).
 */
export function clearRenderCaches(): void {
  rotationCache.clear();
  discCache.clear();
}

/**
 * Clear only the rotation cache.
 * Should be called when sprite data changes but disc data is still valid.
 */
function clearRotationCache(): void {
  rotationCache.clear();
}

/**
 * Clear only the disc cache.
 * Should be called when costume colors change but sprites are still valid.
 */
function clearDiscCache(): void {
  discCache.clear();
}
