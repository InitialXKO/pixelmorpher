// ============================================================
// PixelMorpher - Unified Playback Scheduler (B1)
// ============================================================
// Replaces the dual requestAnimationFrame loops in Timeline.tsx
// and PixelCanvas.tsx with a single coordinated loop.
//
// Problem: Timeline's rAF drives frame advancement, PixelCanvas's
// rAF drives rendering. Without coordination, there's ~16ms delay
// between frame advancement and rendering (one full rAF tick).
//
// Solution: A single rAF loop that advances the frame AND triggers
// rendering in the same animation frame. The scheduler notifies
// registered render callbacks immediately after advancing the frame,
// eliminating the inter-rAF delay.
// ============================================================

import { useProjectStore } from './store';

type RenderCallback = () => void;

/** Registered render callbacks that should be called in the same rAF tick as frame advancement */
const renderCallbacks = new Set<RenderCallback>();

/** Whether the scheduler is currently running */
let isRunning = false;

/** The current rAF handle */
let rafHandle: number | null = null;

/** Time accumulator for frame-accurate playback */
let lastTimestamp = 0;

/** Register a render callback to be called after each frame advancement */
export function registerRenderCallback(cb: RenderCallback): () => void {
  renderCallbacks.add(cb);
  return () => { renderCallbacks.delete(cb); };
}

/** Start the unified playback loop */
export function startPlayback(): void {
  if (isRunning) return;
  isRunning = true;
  lastTimestamp = 0;

  const loop = (timestamp: number) => {
    if (!isRunning) return;

    if (lastTimestamp === 0) {
      lastTimestamp = timestamp;
      rafHandle = requestAnimationFrame(loop);
      return;
    }

    const { currentFrame, totalFrames, frameRate } = useProjectStore.getState();
    const frameDuration = 1000 / frameRate;
    const elapsed = timestamp - lastTimestamp;

    if (elapsed >= frameDuration) {
      const framesToAdvance = Math.floor(elapsed / frameDuration);
      lastTimestamp += framesToAdvance * frameDuration;

      const nextFrame = currentFrame + framesToAdvance;
      const newFrame = nextFrame >= totalFrames ? nextFrame % totalFrames : nextFrame;
      useProjectStore.getState().setCurrentFrame(newFrame);

      // B1: Notify all render callbacks in the SAME rAF tick.
      // This eliminates the ~16ms delay of the old dual-loop approach
      // where PixelCanvas could only pick up the state change in the next rAF.
      for (const cb of renderCallbacks) {
        try { cb(); } catch (_) { /* skip failing callbacks */ }
      }
    }

    rafHandle = requestAnimationFrame(loop);
  };

  rafHandle = requestAnimationFrame(loop);
}

/** Stop the unified playback loop */
export function stopPlayback(): void {
  isRunning = false;
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
}

/** Check if the scheduler is currently running */
function isPlaybackRunning(): boolean {
  return isRunning;
}
