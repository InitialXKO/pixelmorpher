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

  const result = await samClient.segment({
    points: [{ x, y, label }],
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

  const result = await samClient.segment({
    box: { x1, y1, x2, y2 },
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
