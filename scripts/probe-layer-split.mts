/**
 * 探针：图层拆分 + 图层装配（行为探针，走真实消费路径）
 * 夹具 bake 数据（16×16，armL 两骨骼，关节分段口径：关节 (2,8)→(12,8)
 * 水平链，段界 = 过关节 (12,8) 的垂线，x≤12 归骨骼 0、x≥13 归骨骼 1；
 * 夹具不带 ID 帧——拆分已改关节分段，不再消费 ID 掩码）：骨骼 0 全红
 * 单层；骨骼 1 两层（上半绿 = 视图 1、下半蓝 = 视图 0），partLayers
 * 的 rank 故意与视图号反序。
 * 断言：分层纯色性 / 与合并拆分的像素划分等价 / rank 排序 / 装配子节点
 * （socket 零偏移、children 登记、zIndex 落在骨骼的深度桶内、件精灵纯色）。
 */
import { splitSixParts, splitSixPartsLayered, mapBonesToNodesLayered } from '../src/lib/bake/skeleton-mapper.ts';
import type { SixPartBakeData } from '../src/lib/bake/threejs-baker-sixpart.ts';

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

const W = 16, H = 16;
const color = new Uint8ClampedArray(W * H * 4);
const layer = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    if (x <= 12) {
      color.set([255, 0, 0, 255], o);
      layer[o] = 1;
    } else if (y < 8) {
      color.set([0, 255, 0, 255], o);
      layer[o] = 2;
    } else {
      color.set([0, 0, 255, 255], o);
      layer[o] = 1;
    }
    layer[o + 3] = 255;
  }
}
const bones = [
  { index: 0, name: 'root', parentIndex: null, joint3D: { x: 0, y: 1, z: 0 }, jointPixels: { 6: { x: 2, y: 8 } } },
  { index: 1, name: 'seg', parentIndex: 0, joint3D: { x: 0.2, y: 0.6, z: 0 }, jointPixels: { 6: { x: 12, y: 8 } } },
] as any;
const bake = {
  bones,
  groups: [{
    part: 'armL', direction: 6, latitude: 0,
    jointPixels: { 0: { x: 2, y: 8 }, 1: { x: 12, y: 8 } },
    colorPixels: color, layerPixels: layer, cameraHalf: 1,
  }],
  partBoneMap: { armL: [0, 1] },
  boneToPart: ['armL', 'armL'],
  width: W, height: H,
  normalization: { center: { x: 0, y: 0, z: 0 }, scale: 1 },
  merge: { effectiveIndex: [0, 1] },
  globalCameraHalf: 1,
  partLayers: {
    armL: [
      { key: 'armL|0', label: '下层材质', rank: 1 },
      { key: 'armL|1', label: '上层材质', rank: 0 },
    ],
  },
  droppedTriCount: 0, absorbedTriCount: 0, absorbedReweightedCount: 0,
} as unknown as SixPartBakeData;

const cells = (grid: (string | null)[][]) => {
  let n = 0; const colors = new Set<string>();
  for (const row of grid) for (const c of row) if (c) { n++; colors.add(c); }
  return { n, colors };
};

const layered = splitSixPartsLayered(bake, { paletteSize: 16 });
const merged = splitSixParts(bake, { paletteSize: 16 });

check('两骨骼都在', layered.size === 2);
const b0 = layered.get(0)!;
const b1 = layered.get(1)!;
check('骨骼 0 单层', b0.layers.length === 1, `layers=${b0.layers.length}`);
check('骨骼 0 层纯红', (() => { const { colors } = cells(b0.layers[0].directions[0].grid); return colors.size === 1 && colors.has('#ff0000'); })());
check('骨骼 1 两层', b1.layers.length === 2, `layers=${b1.layers.length}`);
check('layers 按 rank 排序（视图 1 在前）', b1.layers[0].layerIndex === 1 && b1.layers[1].layerIndex === 0);
const green = b1.layers.find((l) => l.layerIndex === 1)!;
const blue = b1.layers.find((l) => l.layerIndex === 0)!;
check('绿层纯绿', (() => { const { colors, n } = cells(green.directions[0].grid); return n > 0 && colors.size === 1 && colors.has('#00ff00'); })());
check('蓝层纯蓝', (() => { const { colors, n } = cells(blue.directions[0].grid); return n > 0 && colors.size === 1 && colors.has('#0000ff'); })());
const m1 = merged.get(1)!;
const mCells = cells(m1.directions.find((d) => d.direction === 6)!.grid).n;
const lCells = cells(green.directions[0].grid).n + cells(blue.directions[0].grid).n;
check('划分等价：两层格数之和 = 合并拆分格数', lCells === mCells, `${lCells} vs ${mCells}`);
check('全帧注册一致：两层 jointX/jointY 与合并拆分相同', (() => {
  const md = m1.directions.find((d) => d.direction === 6)!;
  return green.directions[0].jointX === md.jointX && green.directions[0].jointY === md.jointY
    && blue.directions[0].jointX === md.jointX && blue.directions[0].jointY === md.jointY;
})());

// 装配
const mapped = mapBonesToNodesLayered(layered, 'T', 'test');
const nodes = mapped.character.nodes;
const boneNode = nodes['node_T_1'];
const childId = boneNode.children.find((c) => c.includes('_layer'));
check('图层子节点已建', !!childId, childId);
const child = childId ? nodes[childId] : undefined;
check('子节点 parentId = 骨骼节点', child?.parentId === 'node_T_1');
check('子节点 attachment 指向骨骼节点上的 socket', !!child && child.attachment.type === 'socket'
  && boneNode.sockets.some((s) => s.id === (child.attachment as any).parentSocketId));
const sock = boneNode.sockets.find((s) => s.id === (child?.attachment as any)?.parentSocketId);
check('图层 socket offset3D 全零', !!sock && sock.offset3D?.x === 0 && sock.offset3D?.y === 0 && sock.offset3D?.z === 0);
check('子节点 zIndex 在骨骼深度桶内 (bone.z, bone.z+1)', !!child && child.zIndex > boneNode.zIndex && child.zIndex < boneNode.zIndex + 1,
  `bone=${boneNode.zIndex} child=${child?.zIndex}`);
check('统计节点数 = 3（2 骨骼 + 1 图层）', mapped.stats.nodes === 3, `nodes=${mapped.stats.nodes}`);
const childPiece = mapped.character.costumeSets[0].pieces[(child as any)?.slot?.slotKey];
const childSpriteId = (childPiece?.sprites as any)?.[6]?.spriteId;
const childSprite = childSpriteId ? mapped.sprites[childSpriteId] : undefined;
check('子节点件精灵存在且纯蓝（非基底图层）', !!childSprite && (() => { const { colors } = cells(childSprite.data as any); return colors.size === 1 && colors.has('#0000ff'); })());

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
