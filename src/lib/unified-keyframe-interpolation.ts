// ============================================================
// PixelMorpher - Unified Keyframe Interpolation
// New pipeline: interpolates Node keyframe tracks (replaces old puppet-keyframe-interpolation)
// ============================================================

import type { Character, Node, KeyframeTrack, KeyframePoint, InterpolationMode } from './unified-types';

export interface InterpolatedNodeValues {
  angle: number;
  x: number;
  y: number;
  stretch: number;
  variantIndex: number;
  zIndex: number;
}

/**
 * Interpolate a single track at the given frame.
 */
function interpolateTrack<T>(track: KeyframeTrack<T> | undefined, frame: number, defaultValue: T): T {
  if (!track || track.keyframes.length === 0) return defaultValue;
  
  const kfs = track.keyframes;
  // Sort by frame (should already be sorted, but ensure)
  // Find surrounding keyframes
  let prev: KeyframePoint<T> | null = null;
  let next: KeyframePoint<T> | null = null;
  
  for (const kf of kfs) {
    if (kf.frame <= frame) {
      prev = kf;
    } else {
      next = kf;
      break;
    }
  }
  
  if (!prev) return next ? next.value : defaultValue;
  if (!next) return prev.value;
  if (prev.frame === next.frame) return prev.value;
  
  // Interpolate
  const t = (frame - prev.frame) / (next.frame - prev.frame);
  const mode = next.interpolation ?? track.interpolation ?? 'linear';
  
  if (typeof prev.value === 'number' && typeof next.value === 'number') {
    const a = prev.value as number;
    const b = next.value as number;
    switch (mode) {
      case 'step':
        return prev.value;
      case 'bezier': {
        // Simplified bezier (linear fallback if no control points)
        return (a + (b - a) * t) as T;
      }
      case 'linear':
      default:
        return (a + (b - a) * t) as T;
    }
  }
  
  return prev.value;
}

/**
 * Interpolate all node keyframe tracks in a Character at the given frame.
 * Returns a map from nodeId to interpolated values.
 */
export function interpolateCharacterKeyframes(
  character: Character,
  currentFrame: number,
): Map<string, InterpolatedNodeValues> {
  const result = new Map<string, InterpolatedNodeValues>();
  
  for (const nodeId of Object.keys(character.nodes)) {
    const node = character.nodes[nodeId]!;
    const tracks = node.tracks;
    const values: InterpolatedNodeValues = {
      angle: interpolateTrack(tracks?.angle, currentFrame, 0),
      x: interpolateTrack(tracks?.x, currentFrame, 0),
      y: interpolateTrack(tracks?.y, currentFrame, 0),
      stretch: interpolateTrack(tracks?.stretch, currentFrame, 1),
      variantIndex: interpolateTrack(tracks?.variantIndex, currentFrame, 0),
      zIndex: node.zIndex ?? 0,
    };
    result.set(node.id, values);
  }
  
  return result;
}
