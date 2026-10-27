// 伪3D旋转（tilt）× 堆叠探针：工具把拖拽角写成节点的 tilt 关键帧，
// 子树零写入、靠 frame 复合传播。本探针把 tilt 直接设在宿主节点上，
// 走 generateRenderPlan → stackRender → 栅格化，量：
//  1) 合成图沿肢体方向的投影长度随 tilt 按 cos 收缩（真旋转，非压扁贴图）；
//  2) 段端与子关节投影位置在 tilt 下仍对接；
//  3) tilt 正负翻转时层画序翻转；tilt 120° 时合成图越过枢轴向反向延伸；
//  4) 对照：平面精灵在默认设置（透视缩短关）下 tilt 不产生 foreshorten，
//     开启后 foreshorten ≈ cos(tilt)，且带 stackRender 的指令恒无 foreshorten（不双重缩短）。
import { sliceStack } from '../src/lib/bake/stack-slicer';
import { attachBoneStacks } from '../src/lib/bake/stack-attach';
import { rasterizeStackOpsData } from '../src/lib/stack-render';
import { computeWorldTransforms, generateRenderPlan } from '../src/lib/unified-render';
import { projectToView } from '../src/lib/unified-types';
import {
  createDefaultNode, createDefaultCostumePiece, pxToSub,
  type Character, type Sprite,
} from '../src/lib/unified-types';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

// 圆柱（角色空间，沿 +Y，半径 7，长 38，根在原点）
const R = 7, H = 38, SEG = 14;
const positions: number[] = [], uvs: number[] = [], tris: number[] = [], triMat: number[] = [];
for (let i = 0; i < SEG; i++) {
  const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
  const base = positions.length / 3;
  const x0 = Math.cos(a0) * R, z0 = Math.sin(a0) * R, x1 = Math.cos(a1) * R, z1 = Math.sin(a1) * R;
  positions.push(x0, 0, z0, x1, 0, z1, x1, H, z1, x0, H, z0);
  uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
  tris.push(base, base + 1, base + 2, base, base + 2, base + 3);
  triMat.push(0, 0);
}
const sliced = sliceStack({
  positions: Float32Array.from(positions), uvs: Float32Array.from(uvs),
  tris: Uint32Array.from(tris), triMaterial: Int32Array.from(triMat),
  sample: () => [60, 120, 220, 255],
  pivot: { x: 0, y: 0, z: 0 }, axis: { x: 0, y: 1, z: 0 }, uAxis: { x: 1, y: 0, z: 0 },
  layerThickness: 4,
});

const charId = 'tc';
function buildCharacter(withStack: boolean) {
  const root = createDefaultNode('root', 'root');
  root.id = `node_${charId}_0`;
  const mid = createDefaultNode('mid', 'mid');
  mid.id = `node_${charId}_1`;
  mid.parentId = root.id;
  mid.slot = { slotKey: 'mid' } as never;
  const end = createDefaultNode('end', 'end');
  end.id = `node_${charId}_2`;
  end.parentId = mid.id;
  end.slot = { slotKey: 'end' } as never;
  root.children = [mid.id];
  mid.children = [end.id];
  root.sockets = [{
    id: 'sock_m', name: 'mid', basePosition: { x: 0, y: 0 }, directionOffsets: {},
    offset3D: { x: 0, y: 0, z: 0 },
  }];
  mid.sockets = [{
    id: 'sock_e', name: 'end', basePosition: { x: 0, y: 0 }, directionOffsets: {},
    offset3D: { x: 0, y: pxToSub(H), z: 0 },
  }];
  mid.attachment = { type: 'socket', parentSocketId: 'sock_m' } as never;
  end.attachment = { type: 'socket', parentSocketId: 'sock_e' } as never;
  for (const n of [root, mid, end]) (n.transform as unknown as { variantIndex: number }).variantIndex = 6;
  const piece = createDefaultCostumePiece('mid');
  const character = {
    id: charId, name: 'tilt测试', nodes: { [root.id]: root, [mid.id]: mid, [end.id]: end },
    rootNodeId: root.id, sprites: {},
    costumeSets: [{ id: 'cs1', name: '默认', pieces: { mid: piece } }],
    activeCostumeSetId: 'cs1', direction: 6, latitude: 0,
  } as unknown as Character;
  const sprites: Record<string, Sprite> = {};
  if (withStack) {
    const boneStacks = new Map([[1, { rootBoneIndex: 1, rootBoneName: 'mid', jointChar: { x: 0, y: 0, z: 0 }, sliced }]]) as never;
    const res = attachBoneStacks(character, sprites, boneStacks, charId, 'tilt测试');
    if (res.attached !== 1) throw new Error('attach failed');
  } else {
    // 平面件：一张 14×38 的竖条精灵（枢轴在顶端中心）
    const flat: Sprite = {
      id: 'flat1', name: 'flat', width: 14, height: H,
      data: Array.from({ length: H }, () => Array(14).fill('#3c78dc')),
      plug: { x: pxToSub(7), y: 0 },
    } as unknown as Sprite;
    piece.sprites = { 6: flat } as never;
  }
  return { character, sprites, mid, end, root };
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

interface Measure { maxY: number; minY: number; firstLayer: number; endDy: number; pixels: number }
function measure(tilt: number): Measure {
  const { character, sprites, mid, end } = buildCharacter(true);
  (mid.transform as unknown as { tilt: number }).tilt = tilt;
  const plan = generateRenderPlan(character, 0, 256, 256, 'pixel-perfect', 12,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, sprites);
  const ins = plan.nodeInstructions.find((i) => i.nodeId === mid.id)!;
  const sr = ins.stackRender!;
  const layerRgba = sr.layerSpriteIds.map((id) => (sprites[id] ? gridToRgba(sprites[id]) : null));
  const ras = rasterizeStackOpsData(
    { ops: sr.ops, width: sr.width, height: sr.height, pivotX: sr.pivotX, pivotY: sr.pivotY, key: sr.key },
    layerRgba,
  )!;
  const ang = ((ins.angle ?? 0) * Math.PI) / 180;
  let maxY = -Infinity, minY = Infinity, pixels = 0;
  for (let y = 0; y < ras.height; y++) for (let x = 0; x < ras.width; x++) {
    if (ras.rgba[(y * ras.width + x) * 4 + 3] === 0) continue;
    pixels++;
    const lx = x - sr.pivotX, ly = y - sr.pivotY;
    const wy = lx * Math.sin(ang) + ly * Math.cos(ang);
    if (wy > maxY) maxY = wy;
    if (wy < minY) minY = wy;
  }
  // 子关节的投影相对位移（与 mid 世界位之差，画布 px）
  const wts = computeWorldTransforms(character, 0, 256, 256, 12);
  const wm = wts.get(mid.id)!, we = wts.get(end.id)!;
  const pm = projectToView(wm.worldX, wm.worldY, wm.worldZ, 6);
  const pe = projectToView(we.worldX, we.worldY, we.worldZ, 6);
  if (process.env.DBG) console.log(`    [dbg tilt=${tilt}] angle=${ins.angle} endDy=${(pe.canvasY - pm.canvasY) / 16}`);
  return { maxY, minY, firstLayer: sr.ops[0]?.layer ?? -1, endDy: (pe.canvasY - pm.canvasY) / 16, pixels };
}

const m0 = measure(0);
console.log(`    tilt 0: maxY=${m0.maxY.toFixed(1)} endDy=${m0.endDy.toFixed(1)} px=${m0.pixels}`);
ok(m0.maxY > 34 && m0.maxY < 47, 'tilt 0：合成图沿 +Y 伸满段长');
ok(Math.abs(m0.endDy - H) < 2.5, 'tilt 0：子关节在 +38');

const m60 = measure(60);
console.log(`    tilt 60: maxY=${m60.maxY.toFixed(1)} endDy=${m60.endDy.toFixed(1)} firstLayer=${m60.firstLayer} px=${m60.pixels}`);
ok(m60.maxY > 13 && m60.maxY < 29, 'tilt 60：投影长度按 cos60 收缩到约一半（真旋转）');
ok(Math.abs(m60.endDy - H * 0.5) < 3.5, 'tilt 60：子关节投影同步移到 +19');
ok(Math.abs(m60.maxY - m60.endDy) < 9, 'tilt 60：段端仍与子关节对接（差 < 9px）');
ok(m60.pixels > 200, 'tilt 60：合成图非空');

const mN60 = measure(-60);
console.log(`    tilt -60: maxY=${mN60.maxY.toFixed(1)} firstLayer=${mN60.firstLayer}`);
ok(mN60.maxY > 13 && mN60.maxY < 29, 'tilt -60：投影长度同样收缩');
ok(mN60.firstLayer !== m60.firstLayer, 'tilt 正负翻转：最先绘制的层不同（画序按深度翻转）');

const m90 = measure(90);
console.log(`    tilt 90: maxY=${m90.maxY.toFixed(1)} minY=${m90.minY.toFixed(1)} px=${m90.pixels}`);
ok(m90.pixels > 100 && m90.maxY < 22, 'tilt 90：肢体正对观众，合成图收成截面大小、仍非空');

const m120 = measure(120);
console.log(`    tilt 120: maxY=${m120.maxY.toFixed(1)} minY=${m120.minY.toFixed(1)} endDy=${m120.endDy.toFixed(1)}`);
ok(m120.minY < -11, 'tilt 120：合成图越过枢轴向反向延伸');
ok(Math.abs(m120.endDy - H * -0.5) < 3.5, 'tilt 120：子关节投影到 -19');

// 对照：平面精灵的 foreshorten
{
  const { character, sprites, mid } = buildCharacter(false);
  (mid.transform as unknown as { tilt: number }).tilt = 60;
  const planOff = generateRenderPlan(character, 0, 256, 256, 'pixel-perfect', 12,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, sprites);
  const insOff = planOff.nodeInstructions.find((i) => i.nodeId === mid.id)!;
  ok(insOff.foreshorten === undefined, '平面件 tilt 60（透视缩短关）：无 foreshorten，贴图不缩短');
  const planOn = generateRenderPlan(character, 0, 256, 256, 'pixel-perfect', 12,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, sprites, undefined, true);
  const insOn = planOn.nodeInstructions.find((i) => i.nodeId === mid.id)!;
  console.log(`    平面件 tilt 60（透视缩短开）：foreshorten=${insOn.foreshorten?.toFixed(3)}`);
  ok(insOn.foreshorten !== undefined && Math.abs(insOn.foreshorten - 0.5) < 0.08,
    '平面件 tilt 60（透视缩短开）：foreshorten ≈ cos60 = 0.5');
}
{
  const { character, sprites, mid } = buildCharacter(true);
  (mid.transform as unknown as { tilt: number }).tilt = 60;
  const planOn = generateRenderPlan(character, 0, 256, 256, 'pixel-perfect', 12,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, sprites, undefined, true);
  const insOn = planOn.nodeInstructions.find((i) => i.nodeId === mid.id)!;
  ok(!!insOn.stackRender && insOn.foreshorten === undefined,
    '堆叠件 tilt 60（透视缩短开）：有 stackRender 且 foreshorten 恒空（不双重缩短）');
}

console.log(fails === 0 ? 'STACK TILT PROBE PASS' : `STACK TILT PROBE FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
