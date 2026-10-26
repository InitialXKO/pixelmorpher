// 连续偏航探针（facingAngle 驱动整个角色绕竖直轴转）：
// +Z 向圆柱摞（南向看是圆盘）+ 子节点沿 +Z 偏移 38——
//  facingAngle 未设/270（南）：圆盘，子关节纯深度（画布位移 0）；
//  facingAngle 0（东）：摞转成横条向 +X 伸展，子关节画布位移 +38，段端对接；
//  facingAngle 180（西）：横条向 −X，子关节 −38；
//  facingAngle 292.5/315：中间态——位移与投影长按 sin 连续变化。
import { sliceStack } from '../src/lib/bake/stack-slicer';
import { attachBoneStacks } from '../src/lib/bake/stack-attach';
import { rasterizeStackOpsData } from '../src/lib/stack-render';
import { generateRenderPlan } from '../src/lib/unified-render';
import {
  createDefaultNode, createDefaultCostumePiece, pxToSub,
  type Character, type Sprite,
} from '../src/lib/unified-types';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

const R = 7, H = 38, SEG = 14;
const positions: number[] = [], uvs: number[] = [], tris: number[] = [], triMat: number[] = [];
for (let i = 0; i < SEG; i++) {
  const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
  const base = positions.length / 3;
  const x0 = Math.cos(a0) * R, y0 = Math.sin(a0) * R, x1 = Math.cos(a1) * R, y1 = Math.sin(a1) * R;
  positions.push(x0, y0, 0, x1, y1, 0, x1, y1, H, x0, y0, H);
  uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
  tris.push(base, base + 1, base + 2, base, base + 2, base + 3);
  triMat.push(0, 0);
}
const sliced = sliceStack({
  positions: Float32Array.from(positions), uvs: Float32Array.from(uvs),
  tris: Uint32Array.from(tris), triMaterial: Int32Array.from(triMat),
  sample: () => [60, 120, 220, 255],
  pivot: { x: 0, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, uAxis: { x: 1, y: 0, z: 0 },
  layerThickness: 4,
});

const charId = 'yc';
function build(facingAngle: number | undefined) {
  const root = createDefaultNode('root', 'root'); root.id = `node_${charId}_0`;
  const mid = createDefaultNode('mid', 'mid'); mid.id = `node_${charId}_1`; mid.parentId = root.id;
  mid.slot = { slotKey: 'mid' } as never;
  const end = createDefaultNode('end', 'end'); end.id = `node_${charId}_2`; end.parentId = mid.id;
  end.slot = { slotKey: 'end' } as never;
  root.children = [mid.id]; mid.children = [end.id];
  root.sockets = [{ id: 'sock_m', name: 'mid', basePosition: { x: 0, y: 0 }, directionOffsets: {}, offset3D: { x: 0, y: 0, z: 0 } }];
  mid.sockets = [{ id: 'sock_e', name: 'end', basePosition: { x: 0, y: 0 }, directionOffsets: {}, offset3D: { x: 0, y: 0, z: pxToSub(H) } }];
  mid.attachment = { type: 'socket', parentSocketId: 'sock_m' } as never;
  end.attachment = { type: 'socket', parentSocketId: 'sock_e' } as never;
  for (const n of [root, mid, end]) (n.transform as unknown as { variantIndex: number }).variantIndex = 6;
  const pieceMid = createDefaultCostumePiece('mid');
  const pieceEnd = createDefaultCostumePiece('end');
  const flat: Sprite = {
    id: 'flatE', name: 'flat', width: 10, height: 10,
    data: Array.from({ length: 10 }, () => Array(10).fill('#888888')),
    plug: { x: pxToSub(5), y: pxToSub(5) },
  } as unknown as Sprite;
  pieceEnd.sprites = { 6: flat } as never;
  const character = {
    id: charId, name: 'yaw测试', nodes: { [root.id]: root, [mid.id]: mid, [end.id]: end },
    rootNodeId: root.id, sprites: {},
    costumeSets: [{ id: 'cs1', name: '默认', pieces: { mid: pieceMid, end: pieceEnd } }],
    activeCostumeSetId: 'cs1', direction: 6, latitude: 0,
    ...(facingAngle !== undefined ? { facingAngle } : {}),
  } as unknown as Character;
  const sprites: Record<string, Sprite> = {};
  const boneStacks = new Map([[1, { rootBoneIndex: 1, rootBoneName: 'mid', jointChar: { x: 0, y: 0, z: 0 }, sliced }]]) as never;
  attachBoneStacks(character, sprites, boneStacks, charId, 'yaw测试');
  return { character, sprites, mid, end };
}

function gridToRgba(spr: Sprite) {
  const h = spr.data.length, w = spr.data[0]?.length ?? 0;
  const rgba = new Uint8ClampedArray(w * h * 4);
  spr.data.forEach((row, y) => row.forEach((c, x) => {
    if (!c) return;
    const o = (y * w + x) * 4;
    rgba[o] = parseInt(c.slice(1, 3), 16); rgba[o + 1] = parseInt(c.slice(3, 5), 16);
    rgba[o + 2] = parseInt(c.slice(5, 7), 16); rgba[o + 3] = 255;
  }));
  return { rgba, width: w, height: h };
}

interface M { w: number; h: number; extPosX: number; extNegX: number; endDx: number; angle: number }
function measure(facingAngle: number | undefined): M {
  const { character, sprites, mid, end } = build(facingAngle);
  const plan = generateRenderPlan(character, 0, 256, 256, 'pixel-perfect', 12,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, sprites);
  const insMid = plan.nodeInstructions.find((i) => i.nodeId === mid.id)!;
  const insEnd = plan.nodeInstructions.find((i) => i.nodeId === end.id)!;
  const sr = insMid.stackRender!;
  const layerRgba = sr.layerSpriteIds.map((id) => (sprites[id] ? gridToRgba(sprites[id]) : null));
  const ras = rasterizeStackOpsData(
    { ops: sr.ops, width: sr.width, height: sr.height, pivotX: sr.pivotX, pivotY: sr.pivotY, key: sr.key },
    layerRgba,
  )!;
  let extPosX = -Infinity, extNegX = Infinity;
  for (let y = 0; y < ras.height; y++) for (let x = 0; x < ras.width; x++) {
    if (ras.rgba[(y * ras.width + x) * 4 + 3] === 0) continue;
    const lx = x - sr.pivotX;
    if (lx > extPosX) extPosX = lx;
    if (lx < extNegX) extNegX = lx;
  }
  return {
    w: ras.width, h: ras.height, extPosX, extNegX,
    endDx: (insEnd.worldX - insMid.worldX) / 16,
    angle: insMid.angle,
  };
}

const base = measure(undefined);
console.log(`    未设: ${base.w}×${base.h} endDx=${base.endDx.toFixed(1)}`);
ok(base.w <= 20 && base.h <= 18, '未设 facingAngle：圆盘（现状不变）');
ok(Math.abs(base.endDx) < 2.5, '未设：子关节纯深度、画布位移 0');

const south = measure(270);
console.log(`    270(S): ${south.w}×${south.h} endDx=${south.endDx.toFixed(1)}`);
ok(south.w === base.w && south.h === base.h, 'facingAngle=270（与离散朝向一致）：与未设逐值相同');
ok(Math.abs(south.endDx) < 2.5, '270：子关节位移仍 0');

const east = measure(0);
console.log(`    0(E): ${east.w}×${east.h} ext+X=${east.extPosX.toFixed(1)} endDx=${east.endDx.toFixed(1)} angle=${east.angle}`);
ok(east.w >= 30, 'facingAngle=0（东）：摞转成横条');
ok(east.extPosX >= 30, '东：合成图向 +X 伸展 ≥30px');
ok(Math.abs(east.endDx - H) < 2.5, '东：子关节画布位移 +38（位置连续旋转）');
ok(Math.abs(east.extPosX - east.endDx) < 8, '东：段端与子关节对接');
ok(Math.abs(east.angle) < 1, '东：偏航不产生平面内自转（angle≈0）');

const west = measure(180);
console.log(`    180(W): ${west.w}×${west.h} ext-X=${west.extNegX.toFixed(1)} endDx=${west.endDx.toFixed(1)}`);
ok(west.w >= 30 && west.extNegX <= -30, 'facingAngle=180（西）：横条向 −X 伸展');
ok(Math.abs(west.endDx + H) < 2.5, '西：子关节画布位移 −38');

const mid1 = measure(292.5);
console.log(`    292.5: ${mid1.w}×${mid1.h} endDx=${mid1.endDx.toFixed(1)}`);
ok(mid1.w > base.w + 3 && mid1.w < east.w - 3, '292.5（南偏东 22.5°）：宽度介于圆盘与横条之间（连续）');
ok(Math.abs(mid1.endDx - H * Math.sin(Math.PI / 8)) < 2.5, '292.5：子关节位移 = 38·sin22.5° ≈ 14.5');

const mid2 = measure(315);
console.log(`    315(SE): endDx=${mid2.endDx.toFixed(1)}`);
ok(Math.abs(mid2.endDx - H * Math.SQRT1_2) < 2.5, '315（东南 45°）：子关节位移 = 38·sin45° ≈ 26.9');

console.log(fails === 0 ? 'STACK YAW PROBE PASS' : `STACK YAW PROBE FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
