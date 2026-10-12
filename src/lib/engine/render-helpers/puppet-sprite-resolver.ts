/**
 * Helper: resolve sprite parts for each puppet node.
 * Extracted from renderPuppetNodes to reduce cyclomatic complexity.
 *
 * For each node, determines which Part to render based on direction,
 * costume set, directionSprites, mirror fallback, and default spritePartId.
 */

import type { Part, PuppetSkeleton, PuppetCharacter, PuppetDirection } from '../../types';
import { DIRECTION_MIRROR } from '../../types';

export interface SpriteMeta {
  partId: string | null;
  direction: PuppetDirection;
  source: string;
}

/**
 * Resolve the sprite Part for each node in the skeleton.
 * Returns a map from nodeId → Part|null and nodeId → SpriteMeta.
 */
export function resolveSpriteParts(
  parts: Part[],
  skeleton: PuppetSkeleton,
  character: PuppetCharacter,
): {
  spritePartMap: Map<string, Part | null>;
  spriteMetaMap: Map<string, SpriteMeta>;
} {
  const partsById = new Map(parts.map(p => [p.id, p]));
  const activeCostumeSet = character.activeCostumeSetId
    ? character.costumeSets.find(cs => cs.id === character.activeCostumeSetId) ?? null
    : null;

  const spritePartMap = new Map<string, Part | null>();
  const spriteMetaMap = new Map<string, SpriteMeta>();
  const direction = skeleton.currentDirection;

  for (const node of skeleton.nodes) {
    const resolved = resolveNodeSprite(node.id, direction, activeCostumeSet, node.directionSprites, node.spritePartId ?? undefined, node.mirrorFrom);
    spritePartMap.set(node.id, resolved.partId ? (partsById.get(resolved.partId) ?? null) : null);
    spriteMetaMap.set(node.id, { partId: resolved.partId, direction, source: resolved.source });
  }

  return { spritePartMap, spriteMetaMap };
}

// ── Internal helpers ──────────────────────────────────────────

interface SpriteResolution {
  partId: string | null;
  source: string;
}

function resolveNodeSprite(
  nodeId: string,
  direction: PuppetDirection,
  activeCostumeSet: { spriteMap: Record<string, string> } | null | undefined,
  directionSprites: Partial<Record<PuppetDirection, string>> | undefined,
  spritePartId: string | undefined,
  mirrorFrom: boolean | undefined,
): SpriteResolution {
  // 1. Check costume set spriteMap first (nodeId:direction)
  if (activeCostumeSet) {
    const costumeKey = `${nodeId}:${direction}`;
    if (activeCostumeSet.spriteMap[costumeKey]) {
      return { partId: activeCostumeSet.spriteMap[costumeKey], source: `costume:${costumeKey}` };
    }
  }

  // 2. Fall back to node.directionSprites[direction]
  if (directionSprites && directionSprites[direction]) {
    return { partId: directionSprites[direction]!, source: `directionSprites:${direction}` };
  }

  // 3. Handle mirror direction fallback for sprite selection
  if (mirrorFrom) {
    const mirrorResult = tryMirrorFallback(nodeId, direction, activeCostumeSet, directionSprites);
    if (mirrorResult) return mirrorResult;
  }

  // 4. Fall back to node.spritePartId
  return { partId: spritePartId ?? null, source: spritePartId ? 'spritePartId' : 'none' };
}

function tryMirrorFallback(
  nodeId: string,
  direction: PuppetDirection,
  activeCostumeSet: { spriteMap: Record<string, string> } | null | undefined,
  directionSprites: Partial<Record<PuppetDirection, string>> | undefined,
): SpriteResolution | null {
  const mirrorDir = DIRECTION_MIRROR[direction];
  if (mirrorDir === direction) return null; // S and N mirror to themselves

  // Check costume set for mirror direction
  if (activeCostumeSet) {
    const mirrorKey = `${nodeId}:${mirrorDir}`;
    if (activeCostumeSet.spriteMap[mirrorKey]) {
      return { partId: activeCostumeSet.spriteMap[mirrorKey], source: `costumeMirror:${mirrorKey}` };
    }
  }

  // Check directionSprites for mirror direction
  if (directionSprites && directionSprites[mirrorDir]) {
    return { partId: directionSprites[mirrorDir]!, source: `directionSpritesMirror:${mirrorDir}` };
  }

  return null;
}
