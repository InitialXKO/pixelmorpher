// ============================================================
// PixelMorpher - SAM (Segment Anything Model) Client
// ============================================================
// Lazy-loaded SAM client using sam-web npm package.
// Dynamic imports avoid SSR issues with Next.js.
//
// The SAM worker script is pre-bundled to /public/sam-worker/worker.bundle.js
// using esbuild. This bundle includes onnxruntime-web and SAM2 core logic
// so that the Web Worker can run without bare module specifier resolution.

import type { SAMModelType, SAMStatus } from './types';

// Lazy-loaded SAM client instance
let samClient: any = null;
let samInitialized = false;
// 原图尺寸（setSAMImage 时记录，用于点坐标的 pad 变换）
let samSourceSize: { w: number; h: number } | null = null;

/**
 * sam-web 的 resizeAndPadBox 逻辑（与 node_modules/sam-web/dist/index.js 一致）
 * SAM 把图缩放到 1024 正方形：最长边填满，短边居中 pad
 */
function resizeAndPadBox(
  sourceDim: { w: number; h: number },
  targetDim: { w: number; h: number }
): { x: number; y: number; w: number; h: number } {
  if (sourceDim.h === sourceDim.w) {
    return { x: 0, y: 0, w: targetDim.w, h: targetDim.h };
  } else if (sourceDim.h > sourceDim.w) {
    const newW = (sourceDim.w / sourceDim.h) * targetDim.w;
    const padLeft = Math.floor((targetDim.w - newW) / 2);
    return { x: padLeft, y: 0, w: newW, h: targetDim.h };
  } else {
    const newH = (sourceDim.h / sourceDim.w) * targetDim.h;
    const padTop = Math.floor((targetDim.h - newH) / 2);
    return { x: 0, y: padTop, w: targetDim.w, h: newH };
  }
}

/**
 * 把原图归一化坐标 (0..1) 变换到 SAM 编码的 1024 正方形归一化坐标
 * 修正 sam-web segment() 未做 pad 变换的 bug
 */
function mapPointToEncoded(x: number, y: number): { x: number; y: number } {
  if (!samSourceSize) return { x, y };
  const box = resizeAndPadBox(samSourceSize, { w: 1024, h: 1024 });
  const sx = box.x + x * box.w;
  const sy = box.y + y * box.h;
  return { x: sx / 1024, y: sy / 1024 };
}

/**
 * Initialize SAM model for browser-side segmentation.
 * Downloads the model on first use (~45MB for MobileSAM, ~151MB for SAM2 Tiny).
 * Model files are cached in OPFS for subsequent loads.
 */
export async function initSAM(
  model: SAMModelType = 'mobilesam',
  onProgress?: (status: SAMStatus, progress: number) => void
): Promise<void> {
  if (samInitialized && samClient) return;

  try {
    onProgress?.('loading', 5);

    // Dynamic import to avoid SSR issues with Next.js
    const { SAMClient } = await import('sam-web');

    onProgress?.('loading', 10);

    samClient = new SAMClient({
      model: model === 'sam2_tiny' ? 'sam2_tiny' : 'mobilesam',
      device: 'auto',
      onProgress: (stage: string) => {
        const stageMap: Record<string, SAMStatus> = {
          downloading: 'loading',
          loading: 'loading',
          encoding: 'encoding',
          decoding: 'segmenting',
          ready: 'ready',
        };
        const progressMap: Record<string, number> = {
          downloading: 30,
          loading: 60,
          encoding: 80,
          decoding: 90,
          ready: 100,
        };
        const mappedStatus = stageMap[stage] || 'loading';
        const mappedProgress = progressMap[stage] ?? 50;
        onProgress?.(mappedStatus, mappedProgress);
      },
    });

    onProgress?.('loading', 15);

    // Initialize with the pre-bundled worker script.
    // The worker bundle is at /public/sam-worker/worker.bundle.js, which
    // Next.js serves as a static asset at /sam-worker/worker.bundle.js.
    // This bundle was created by esbuild and includes onnxruntime-web + SAM2 core.
    const workerUrl = new URL('/sam-worker/worker.bundle.js', window.location.origin);
    await samClient.initialize(workerUrl);

    samInitialized = true;
    onProgress?.('ready', 100);
  } catch (error: any) {
    console.error('[SAM] Initialization failed:', error);
    samClient = null;
    samInitialized = false;
    onProgress?.('error', 0);
    throw new Error(`SAM初始化失败: ${error.message}`);
  }
}

/** Check if the full SAM model is ready for use */
export function isSAMReady(): boolean {
  return samInitialized && samClient !== null;
}

/**
 * Set the image for SAM to segment. Must be called before segmentAtPoint.
 * The image is processed (encoded) once, then multiple clicks can be segmented quickly.
 */
export async function setSAMImage(
  imageSource: HTMLCanvasElement | HTMLImageElement
): Promise<void> {
  if (!samClient || !samInitialized) throw new Error('SAM未初始化');
  // 记录原图尺寸，用于点坐标变换
  const w = imageSource instanceof HTMLCanvasElement ? imageSource.width : imageSource.naturalWidth || imageSource.width;
  const h = imageSource instanceof HTMLCanvasElement ? imageSource.height : imageSource.naturalHeight || imageSource.height;
  samSourceSize = { w, h };
  await samClient.setImage(imageSource);
}

/**
 * Segment an object at a specific point using SAM.
 * Coordinates are normalized 0-1.
 * Returns mask data, shape, confidence score, and bounding box.
 */
export async function segmentAtPoint(
  x: number, // 0-1 normalized
  y: number, // 0-1 normalized
  label: 1 | 0 = 1, // 1=foreground, 0=background (for refinement)
  previousMask?: any
): Promise<{
  data: Float32Array;
  shape: [number, number];
  score: number;
  bounds: { x: number; y: number; width: number; height: number };
  bitmap: ImageBitmap;
}> {
  if (!samClient || !samInitialized) throw new Error('SAM未初始化');

  // 修正 sam-web 的 pad bug：把原图坐标变换到编码正方形坐标
  const mapped = mapPointToEncoded(x, y);
  const result = await samClient.segment({
    points: [{ x: mapped.x, y: mapped.y, label }],
    previousMask,
  });

  return result;
}

/**
 * Segment an object within a bounding box using SAM.
 * Coordinates are normalized 0-1.
 */
export async function segmentWithBox(
  x1: number, y1: number, // 0-1 normalized top-left
  x2: number, y2: number, // 0-1 normalized bottom-right
  previousMask?: any
): Promise<{
  data: Float32Array;
  shape: [number, number];
  score: number;
  bounds: { x: number; y: number; width: number; height: number };
  bitmap: ImageBitmap;
}> {
  if (!samClient || !samInitialized) throw new Error('SAM未初始化');

  const m1 = mapPointToEncoded(x1, y1);
  const m2 = mapPointToEncoded(x2, y2);
  const result = await samClient.segment({
    box: { x1: m1.x, y1: m1.y, x2: m2.x, y2: m2.y },
    previousMask,
  });

  return result;
}

/**
 * Dispose SAM client and free resources.
 */
export function disposeSAM(): void {
  if (samClient) {
    try {
      samClient.dispose();
    } catch {
      // Ignore disposal errors
    }
    samClient = null;
    samInitialized = false;
    samSourceSize = null;
  }
}

/**
 * Check browser capabilities for SAM (WebGPU, OPFS, Workers).
 */
async function checkSAMCapabilities(): Promise<{
  webgpu: boolean;
  opfs: boolean;
  workers: boolean;
  recommended: string;
}> {
  try {
    const { SAMClient } = await import('sam-web');
    return await SAMClient.checkCapabilities();
  } catch {
    return { webgpu: false, opfs: false, workers: false, recommended: 'none' };
  }
}
