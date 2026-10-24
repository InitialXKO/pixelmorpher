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

import type { PixelGrid } from '../types';

// ---- Sprite Rotation Cache ----

export interface RotationCacheEntry {
  canvas: HTMLCanvasElement;
  resultPivotX: number;
  resultPivotY: number;
}

/**
 * 像素网格全图哈希（FNV-1a，逐格累进）：尺寸 + 每一格的颜色字符串。
 *
 * 旋转缓存的旧指纹只采样四角+中心 5 个点——四角基本恒透明、中心只是单点，
 * 绝大多数像素改动（换色/抖动/描边/位移等）不碰这 5 点，于是改完参数
 * 指纹不变、缓存返回改前烘焙的旋转图：改参数不生效、播放也不生效，
 * 只有别的操作顺带整表清缓存才显形。凡是像素内容可变的精灵（经像素
 * 修改器/蓝图像素链/蒙皮弯曲加工）必须用全图哈希做键，不得用采样指纹。
 * null 与 '' 同为透明，哈希同等对待（视觉同一）。
 *
 * 增量式（createPixelGridHasher）是唯一实现：渲染路径由 pixelsToCanvas
 * 在它本来就要做的全图遍历里逐格喂入，哈希零额外遍历；hashPixelGrid
 * 是同一哈希器的整表便捷封装（探针与离线校验用）。两者结果必须一致，
 * 由 verify-rotation-cache 的等价用例锁死。
 */
export function createPixelGridHasher(width: number, height: number): {
  cell: (cell: string | null | undefined) => void;
  digest: () => string;
} {
  let hash = 0x811c9dc5;
  const mix = (n: number) => {
    hash ^= n;
    hash = Math.imul(hash, 0x01000193);
  };
  mix(width);
  mix(height);
  return {
    cell(cell: string | null | undefined): void {
      if (!cell) {
        mix(0);
        return;
      }
      for (let i = 0; i < cell.length; i++) mix(cell.charCodeAt(i));
      mix(0x2f);
    },
    digest(): string {
      return (hash >>> 0).toString(36);
    },
  };
}

export function hashPixelGrid(grid: PixelGrid): string {
  const h = grid?.length ?? 0;
  const w = h > 0 ? (grid[0]?.length ?? 0) : 0;
  const hasher = createPixelGridHasher(w, h);
  for (let y = 0; y < h; y++) {
    const row = grid[y];
    for (let x = 0; x < w; x++) {
      hasher.cell(row?.[x]);
    }
  }
  return hasher.digest();
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
  scaleX: number = 1,
  skewsKey: string = '',
  // 像素内容全图哈希（hashPixelGrid）：给出时以它为内容指纹并跳过采样——
  // 采样指纹（四角+中心）对像素可变的精灵不成立，仅作无网格来源时的回退。
  contentHash?: string,
): string {
  // Quantize angle to 0.01 degree precision (sub-degree changes are invisible at pixel scale)
  const qAngle = Math.round(angle * 100);
  // Quantize stretch to 0.01 precision
  const qStretch = Math.round(stretch * 100);
  // Quantize scaleX to 0.01 precision（复合仿射路径；默认 1 时与旧键有别，仅内存缓存无持久影响）
  const qScaleX = Math.round(scaleX * 100);
  // Quantize pivot to 0.1 pixel precision
  const qPivotX = Math.round(pivotX * 10);
  const qPivotY = Math.round(pivotY * 10);

  // Canvas fingerprint: width + height + sample of pixel data
  // Sample 4 corner pixels + center pixel as a quick fingerprint
  const w = spriteCanvas.width;
  const h = spriteCanvas.height;
  let fingerprint = `${w}:${h}`;

  if (contentHash) {
    // 全图哈希在手：内容同一性由它判定，采样既冗余又不可靠，直接采用
    fingerprint = `G${contentHash}`;
    return `${fingerprint}:${qAngle}:${qStretch}:${qPivotX}:${qPivotY}:${qScaleX}:${skewsKey}`;
  }

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

  return `${fingerprint}:${qAngle}:${qStretch}:${qPivotX}:${qPivotY}:${qScaleX}:${skewsKey}`;
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
