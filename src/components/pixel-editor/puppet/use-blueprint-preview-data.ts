'use client';

// ============================================================
// useBlueprintPreviewData — 蓝图编辑器预览数据的共同构造
// PuppetModifierPanel / CharacterBlueprintEditor / GlobalBlueprintEditor 三处共用，
// 禁止各写一份：characterNodes 的精灵解析与 costumeSets 的格式转换必须同口径。
// - spritesTable：全局精灵表（store）
// - costumeSetsNewFormat：pieces 的 SpriteRef → 内嵌 { data }（costume 蓝图节点用）
// - characterNodes：整角色预览数据（精灵走共享解析 resolvePreviewSprite，含变体层）
// ============================================================

import { useMemo } from 'react';
import { useProjectStore } from '@/lib/store';
import type { Character } from '@/lib/unified-types';
import { resolvePreviewSprite } from '@/lib/sprite-resolve';
import { modifiersToBlueprint } from '@/lib/blueprint/migrate';

export function useBlueprintPreviewData(character: Character | null | undefined) {
  const spritesTable = useProjectStore((s) => s.sprites);

  // 角色即 Character（取服装集给 costume 蓝图节点用）
  const costumeSets = character?.costumeSets ?? [];
  // 边界转换：Puppet spriteMap 格式 → 新 pieces 格式（costume 蓝图节点用）
  // Puppet: spriteMap["nodeId:direction"] -> spriteId
  // 新格式: pieces[nodeId].sprites[direction].data = pixels
  const costumeSetsNewFormat = useMemo(() => {
    const sprites = useProjectStore.getState().sprites ?? {};
    return costumeSets.map((cs: any) => {
      const pieces: Record<string, { sprites: Record<number, { data: unknown }>, mirrorMap?: Record<number, number> }> = {};
      // 新格式：cs.pieces[slotKey].sprites[direction] = { spriteId }
      const srcPieces = cs.pieces ?? {};
      for (const [slotKey, piece] of Object.entries(srcPieces) as any) {
        const pieceSprites: Record<number, { data: unknown }> = {};
        const dirMap = (piece as any).sprites ?? {};
        for (const [dirStr, ref] of Object.entries(dirMap) as any) {
          const direction = Number(dirStr);
          if (isNaN(direction)) continue;
          const spriteId = (ref as any)?.spriteId;
          const sprite = spriteId ? sprites[spriteId] : null;
          if (!sprite?.data) continue;
          pieceSprites[direction] = { data: sprite.data };
        }
        pieces[slotKey] = { sprites: pieceSprites, mirrorMap: (piece as any).mirrorMap };
      }
      return { id: cs.id, name: cs.name, pieces };
    });
  }, [costumeSets]);

  // 整角色预览数据：所有节点的精灵和蓝图（含层级）
  const characterNodes = useMemo(() => {
    if (!character) return undefined;
    // 新模型：从 activeCostumeSet 经 slotKey → spriteId → sprites 表取像素
    const activeSet = (character.costumeSets ?? []).find((cs: any) => cs.id === character.activeCostumeSetId)
      ?? (character.costumeSets ?? [])[0];
    // 建 socket 位置映射：socketId -> {nodeId, x, y}
    const socketMap = new Map<string, { x: number; y: number }>();
    for (const n of Object.values(character?.nodes ?? {})) {
      for (const s of (n.sockets ?? [])) {
        socketMap.set(s.id, { x: s.basePosition?.x ?? 0, y: s.basePosition?.y ?? 0 });
      }
    }
    // 建 parent 映射：通过 plug.socketId 找到父节点
    const nodeBySocket = new Map<string, string>();
    for (const n of Object.values(character?.nodes ?? {})) {
      for (const s of (n.sockets ?? [])) {
        nodeBySocket.set(s.id, n.id);
      }
    }
    return Object.values(character?.nodes ?? {}).map((n: any) => {
      // 共享解析：与主渲染一致（含 mirrorMap 与槽位变体层）
      // 件键同主渲染口径：无槽位定义的节点回退节点 id（写侧以节点 id 为键）
      const slotKey = n.slot?.slotKey ?? n.id;
      // 预览默认南向（6）；方向由调用方按当前帧定
      const resolved = resolvePreviewSprite(slotKey, 6, activeSet as any, spritesTable as any, character?.slotVariants?.[slotKey]);
      const sprite = resolved.sprite;
      const bp = n.blueprint ?? (n.modifiers?.length ? modifiersToBlueprint(n.modifiers) : null);
      const attachment = n.attachment;
      const parentId = n.parentId ?? null;
      const socketId = attachment?.type === 'socket' ? attachment.parentSocketId ?? null : null;
      const sock = socketId ? socketMap.get(socketId) : null;
      const plug = attachment?.plug;
      return {
        id: n.id,
        name: n.name,
        blueprint: bp,
        spritePixels: sprite?.data ?? null,
        spriteW: sprite?.width,
        spriteH: sprite?.height,
        heightmap: sprite?.heightmap ?? null,
        parentId,
        socketId,
        socketX: sock?.x ?? 0,
        socketY: sock?.y ?? 0,
        plugX: plug?.x ?? 0,
        plugY: plug?.y ?? 0,
        variantIndex: n.transform?.variantIndex ?? 0,
      };
    });
  }, [character, spritesTable]);

  return { spritesTable, costumeSetsNewFormat, characterNodes };
}
