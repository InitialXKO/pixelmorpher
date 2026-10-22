// ============================================================
// PixelMorpher - 关节盘批量操作（画布空白菜单「清除/重新生成所有关节盘」）
//
// 关节盘是渲染时按节点 attachment 生成的（nodeHasJointDisc 为唯一判定）：
//  · 清除 = 全部 socket 连接节点的 autoJointDisc 置 false（开关关掉，
//    jointWidth/discColor 等参数保留，重新生成可恢复）。
//  · 重新生成 = autoJointDisc 恢复默认（删除字段）、discColor 清除（回到
//    渲染时自动采样）、jointWidth 按节点当前精灵以导入同一量法重测
//    （measureOpeningWidth，规范方向 6 优先，与 mapBonesToNodes 写入时同口径）；
//    测不到的节点删除 jointWidth，渲染端按截面/精灵回退估算。
// 两者都只作用于 socket 连接的节点，返回新 Character（未变更时原样返回）。
// ============================================================

import type { Character, Sprite } from './unified-types';
import { subToPx } from './unified-types';
import { resolveNodeSpriteId } from './unified-render';
import { measureOpeningWidth } from './bake/skeleton-mapper';

function discNodes(character: Character) {
  return Object.values(character.nodes).filter(
    (n) => n.attachment?.type === 'socket' && !!n.attachment.parentSocketId,
  );
}

/** 清除全部关节盘：socket 连接节点的生成开关置 false */
export function clearJointDiscs(character: Character): { character: Character; changed: number } {
  let changed = 0;
  const nodes = { ...character.nodes };
  for (const node of discNodes(character)) {
    if (node.attachment.autoJointDisc === false) continue;
    nodes[node.id] = { ...node, attachment: { ...node.attachment, autoJointDisc: false } };
    changed++;
  }
  return changed > 0 ? { character: { ...character, nodes }, changed } : { character, changed: 0 };
}

/** 重新生成全部关节盘：开关恢复、配色回自动、开口宽按当前精灵重测 */
export function regenerateJointDiscs(
  character: Character,
  sprites: Record<string, Sprite>,
): { character: Character; changed: number } {
  let changed = 0;
  const nodes = { ...character.nodes };
  for (const node of discNodes(character)) {
    // 当前精灵（与渲染同一解析）：规范方向 6 优先，其余方向兜底
    let sprite: Sprite | null = null;
    for (const dir of [6, 0, 1, 2, 3, 4, 5, 7] as const) {
      const sid = resolveNodeSpriteId(character, node.id, dir, sprites);
      if (sid && sprites[sid]) {
        sprite = sprites[sid];
        break;
      }
    }
    let jointWidth: number | null = null;
    if (sprite?.data) {
      const plug = sprite.plug ?? node.attachment.plug;
      const cx = plug ? subToPx(plug.x) : Math.floor(sprite.width / 2);
      const cy = plug ? subToPx(plug.y) : sprite.height - 1;
      jointWidth = measureOpeningWidth(sprite.data, cx, cy);
    }
    const att = node.attachment;
    const nextAtt = { ...att };
    delete nextAtt.autoJointDisc;
    delete nextAtt.discColor;
    if (jointWidth !== null) nextAtt.jointWidth = jointWidth;
    else delete nextAtt.jointWidth;
    if (
      att.autoJointDisc === nextAtt.autoJointDisc &&
      att.discColor === nextAtt.discColor &&
      att.jointWidth === nextAtt.jointWidth
    ) {
      continue;
    }
    nodes[node.id] = { ...node, attachment: nextAtt };
    changed++;
  }
  return changed > 0 ? { character: { ...character, nodes }, changed } : { character, changed: 0 };
}
