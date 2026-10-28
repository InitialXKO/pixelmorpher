// ============================================================
// D6 毛发（StrandSim 对应项）：一束发丝 = 多条独立链，共享
// 驱动与参数。求解器不新增——每条发丝就是一期链摆（Verlet
// 链 + 烘焙折算 + 指纹），发束只是「生成 + 整束烘焙 +
// 聚合新鲜度」的组织层。发丝之间无横向约束（与布料的差
// 别恰在此：布料靠列间约束成片，毛发靠各自独立垂摆）。
// ============================================================

import type { Character, KeyframeTrack, Node as UnifiedNode } from '../unified-types';
import { createDefaultCostumePiece } from '../unified-types';
import {
  collectChain, bakeChainSwing, isChainBakeFresh,
  type ChainBakeParams, type ChainBakeRecord,
} from './verlet-chain';

/** 生成发束节点（纯数据组装）：root 下挂 N 根发丝链，
 * 发丝根沿 x 均布、整束按扇角张开（中间直下、两侧外倾），
 * 链节偏移按各自倾角算。节点命名 `${root}_hair_<丝>_<节>`。 */
export function generateHairStrands(
  rootId: string, strands: number, segs: number,
  spacing = 5, segLen = 7, fanDeg = 50,
): { nodes: Record<string, UnifiedNode>; strandIds: string[][] } {
  const nodes: Record<string, UnifiedNode> = {};
  const strandIds: string[][] = [];
  const mk = (id: string, parentId: string | undefined, x: number, y: number, children: string[]): UnifiedNode => ({
    id, name: id, parentId, role: 'bone',
    transform: { x, y, angle: 0, variantIndex: 2, stretch: 1 },
    attachment: { type: 'fixed' }, sockets: [], tracks: {}, modifiers: [], children,
    // 写侧必须写 slot（slotKey = 节点 id，与工厂口径同键）
    slot: createDefaultCostumePiece(id),
  } as unknown as UnifiedNode);
  for (let c = 0; c < strands; c++) {
    const frac = strands === 1 ? 0 : c / (strands - 1) - 0.5;
    const th = (frac * fanDeg * Math.PI) / 180;
    const dx = Math.sin(th) * segLen;
    const dy = Math.cos(th) * segLen;
    const col: string[] = [];
    for (let r = 0; r < segs; r++) {
      const id = `${rootId}_hair_${c}_${r}`;
      col.push(id);
      const parentId = r === 0 ? rootId : col[r - 1];
      const x = r === 0 ? frac * 2 * (strands - 1) * spacing * 0.5 : dx;
      const y = r === 0 ? 0 : dy;
      nodes[id] = mk(id, parentId, Math.round(x * 100) / 100, Math.round(y * 100) / 100,
        r + 1 < segs ? [`${rootId}_hair_${c}_${r + 1}`] : []);
    }
    strandIds.push(col);
  }
  return { nodes, strandIds };
}

/** 按命名约定找回发束（发丝根 = root 的直属发丝链头） */
export function detectHairStrands(character: Character, rootId: string): string[][] | null {
  if (!character.nodes[rootId]) return null;
  const strands: string[][] = [];
  for (let c = 0; ; c++) {
    const first = `${rootId}_hair_${c}_0`;
    if (!character.nodes[first]) break;
    const { nodeIds } = collectChain(character, first);
    if (nodeIds.length >= 2) strands.push(nodeIds);
  }
  return strands.length > 0 ? strands : null;
}

/** 整束烘焙：逐丝走一期链烘焙（同一驱动、同一参数），
 * 记录按发丝根存回 Character.chainBakes 的口径由调用方完成 */
export function bakeHairSwing(
  character: Character,
  strandIds: string[][],
  params: ChainBakeParams,
  fromFrame: number,
  toFrame: number,
  frameRate: number,
): { records: Record<string, ChainBakeRecord>; angleTracks: Record<string, KeyframeTrack> } {
  const records: Record<string, ChainBakeRecord> = {};
  const angleTracks: Record<string, KeyframeTrack> = {};
  for (const ids of strandIds) {
    const res = bakeChainSwing(character, ids, params, fromFrame, toFrame, frameRate);
    records[ids[0]] = res.record;
    Object.assign(angleTracks, res.angleTracks);
  }
  return { records, angleTracks };
}

/** 聚合新鲜度：每根发丝都有档案且都新鲜才算新鲜；
 * 返回 stale = 无档案或已过期的发丝根 id 列表 */
export function hairStaleStrands(
  character: Character,
  strandIds: string[][],
  frameRate: number,
): string[] {
  const stale: string[] = [];
  for (const ids of strandIds) {
    const rec = character.chainBakes?.[ids[0]];
    if (!rec || !isChainBakeFresh(character, rec, frameRate)) stale.push(ids[0]);
  }
  return stale;
}
