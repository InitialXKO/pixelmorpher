// ============================================================
// sprite-resolve — 共享精灵解析逻辑
// 主渲染、蓝图预览、整角色预览三处必须一致：
//   activeCostumeSet → pieces[slotKey].sprites[direction]
//   → direct 命中则用，否则 mirrorMap[direction] 回退
//   → SpriteRef 查全局表，内嵌 Sprite 直接用
// ============================================================

import type { CostumePiece, CostumeSet, DirectionIndex, Sprite, SpriteRef } from './unified-types';

export interface ResolvedSprite {
  sprite: Sprite | null;
  mirror: boolean;
  spriteId: string | null;
}

function resolveEntry(
  entry: Sprite | SpriteRef | undefined,
  spritesTable?: Record<string, Sprite>,
): { sprite: Sprite | null; spriteId: string | null } {
  if (!entry) return { sprite: null, spriteId: null };
  if ('spriteId' in entry) {
    const id = (entry as SpriteRef).spriteId;
    return { sprite: spritesTable?.[id] ?? null, spriteId: id };
  }
  return { sprite: entry as Sprite, spriteId: null };
}

/**
 * 服装件分层解析（主渲染与预览的共同实现，禁止另写一份）：
 * 变体直达 → 变体镜像 → 基础直达 → 基础镜像。
 * variantId 来自角色的槽位变体指派（Character.slotVariants[slotKey]）；
 * 变体层只需画与基础不同的图，未命中自动回落基础层，变体永不留空洞。
 */
export function resolvePieceSprite(
  piece: CostumePiece | undefined,
  direction: DirectionIndex,
  variantId: string | undefined,
  spritesTable?: Record<string, Sprite>,
): ResolvedSprite {
  if (!piece) {
    return { sprite: null, mirror: false, spriteId: null };
  }
  const layers: (Partial<Record<DirectionIndex, Sprite | SpriteRef>> | undefined)[] = [
    variantId ? piece.variantSprites?.[variantId] : undefined,
    piece.sprites,
  ];
  for (const layer of layers) {
    if (!layer) continue;
    const direct = resolveEntry(layer[direction], spritesTable);
    if (direct.sprite) {
      return { sprite: direct.sprite, mirror: false, spriteId: direct.spriteId };
    }
    const mirrorSource = piece.mirrorMap?.[direction];
    if (mirrorSource !== undefined) {
      const mirrored = resolveEntry(layer[mirrorSource], spritesTable);
      if (mirrored.sprite) {
        return { sprite: mirrored.sprite, mirror: true, spriteId: mirrored.spriteId };
      }
    }
  }
  return { sprite: null, mirror: false, spriteId: null };
}

/**
 * 解析指定槽位、方向的精灵（与主渲染 resolveSprite 同逻辑）
 */
export function resolvePreviewSprite(
  slotKey: string | undefined,
  direction: number,
  costumeSet: CostumeSet | undefined,
  spritesTable?: Record<string, Sprite>,
  variantId?: string,
): ResolvedSprite {
  if (!slotKey || !costumeSet) {
    return { sprite: null, mirror: false, spriteId: null };
  }
  const piece = (costumeSet.pieces as Record<string, CostumePiece>)[slotKey];
  return resolvePieceSprite(piece, direction as DirectionIndex, variantId, spritesTable);
}

/**
 * 从服装集列表中取 active 的（找不到则取第一个）
 */
export function getActiveCostumeSet(
  costumeSets: CostumeSet[] | undefined,
  activeId: string | undefined,
): CostumeSet | undefined {
  if (!costumeSets?.length) return undefined;
  return costumeSets.find((cs) => cs.id === activeId) ?? costumeSets[0];
}
