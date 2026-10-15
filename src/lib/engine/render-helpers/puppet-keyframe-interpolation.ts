/**
 * Helper: interpolate node keyframes.
 * Uses new Character/Node types (migrated from PuppetSkeleton).
 *
 * For each node, interpolates from node.tracks, then evaluates
 * blueprint/modifiers and adds to values.
 */

import type { Character, Node, KeyframeTrack } from '../../unified-types';
import type { InterpolatedNodeValues } from './types';
import { computePartAnimationTransform } from '../animation-dispatch';
import { evaluateBlueprint } from '../../blueprint/eval';
import { modifiersToBlueprint } from '../../blueprint/migrate';

// hold 等有状态节点的跨帧存储
const blueprintNodeState = new Map<string, any>();
let lastFrame = -1;

function interpolateTrack(track: KeyframeTrack<number> | undefined, frame: number, defaultValue: number): number {
  if (!track || track.keyframes.length === 0) return defaultValue;
  const kfs = track.keyframes;
  let prev: typeof kfs[0] | null = null;
  let next: typeof kfs[0] | null = null;
  for (const kf of kfs) {
    if (kf.frame <= frame) prev = kf;
    else { next = kf; break; }
  }
  if (!prev) return next ? next.value : defaultValue;
  if (!next || prev.frame === next.frame) return prev.value;
  const t = (frame - prev.frame) / (next.frame - prev.frame);
  const mode = next.interpolation ?? track.interpolation ?? 'linear';
  if (mode === 'step') return prev.value;
  return prev.value + (next.value - prev.value) * t;
}

function interpolateSingleNode(node: Node, currentFrame: number): InterpolatedNodeValues {
  const tracks = node.tracks;
  return {
    angle: interpolateTrack(tracks?.angle, currentFrame, 0),
    stretch: interpolateTrack(tracks?.stretch, currentFrame, 1),
    x: interpolateTrack(tracks?.x, currentFrame, 0),
    y: interpolateTrack(tracks?.y, currentFrame, 0),
    variantIndex: 0,
    zIndex: node.zIndex ?? 0,
    skewX: 0,
    skewY: 0,
    scaleX: 1,
  };
}

function interpolateCharacterInternal(
  character: Character,
  currentFrame: number,
): Map<string, InterpolatedNodeValues> {
  const result = new Map<string, InterpolatedNodeValues>();

  if (currentFrame < lastFrame || currentFrame > lastFrame + 5) {
    blueprintNodeState.clear();
  }
  lastFrame = currentFrame;

  const nodeOutputs = new Map<string, { rotation: number; translateX: number; translateY: number; scaleX: number; scaleY: number; skewX: number; skewY: number; zIndex: number }>();

  for (let pass = 0; pass < 2; pass++) {
    for (const nodeId of Object.keys(character.nodes)) {
      const node = character.nodes[nodeId]!;
      const values = interpolateSingleNode(node, currentFrame);
      // 优先用 node.blueprint（已同步，含手动编辑）；无蓝图时从 modifiers 生成
      const blueprint = (node as any).blueprint ?? (node.modifiers?.length ? modifiersToBlueprint(node.modifiers as any) : null);
      if (blueprint) {
        const t = evaluateBlueprint(blueprint, {
          frame: currentFrame,
          frameRate: 12,
          vars: {},
          nodeOutputs: pass === 1 ? nodeOutputs : undefined,
          nodeState: blueprintNodeState,
        } as any);
        values.angle += t.rotation;
        values.x += t.translateX;
        values.y += t.translateY;
        values.stretch *= t.scaleY;
        values.scaleX *= t.scaleX;
        values.skewX += t.skewX;
        values.skewY += t.skewY;
        if (t.zIndex !== 0) values.zIndex = t.zIndex;
        if (pass === 0) {
          nodeOutputs.set(node.id, {
            rotation: t.rotation,
            translateX: t.translateX,
            translateY: t.translateY,
            scaleX: t.scaleX,
            scaleY: t.scaleY,
            skewX: t.skewX,
            skewY: t.skewY,
            zIndex: t.zIndex,
          });
        }
      } else {
        const mods = node.modifiers ?? [];
        if (mods.length > 0) {
          const t = computePartAnimationTransform(mods as any, currentFrame, 12);
          values.angle += t.rotation;
          values.x += t.translateX;
          values.y += t.translateY;
          values.stretch *= t.scaleY;
        }
      }
      if (pass === 1) {
        result.set(node.id, values);
      }
    }
  }

  return result;
}

/**
 * Compute interpolated values for every node in the character.
 */
export function interpolateNodeKeyframes(
  character: Character,
  currentFrame: number,
): Map<string, InterpolatedNodeValues> {
  return interpolateCharacterInternal(character, currentFrame);
}
