// 堆叠手臂摆回复现探针：按 mapper 口径造角色——肩节点带 ∓90° 摆回角
// （垂臂烘焙的还原），肘节点挂在垂下位置；切片用真实 sliceStack 在
// 角色空间（垂臂状态）切一段圆柱。走真实 attachBoneStacks →
// generateRenderPlan → stackRender 算子 → rasterizeStackOpsData 合成，
// 断言合成图里手臂的指向与「肩指令位置 → 肘指令位置」一致（摆回只
// 施加一次、方向正确）；腿（无摆回角）作对照组。
import { sliceStack } from '../src/lib/bake/stack-slicer';
import { attachBoneStacks } from '../src/lib/bake/stack-attach';
import { generateRenderPlan } from '../src/lib/unified-render';
import { rasterizeStackOpsData } from '../src/lib/stack-render';
import {
  createDefaultNode, createDefaultCostumePiece, pxToSub,
  type Character, type Sprite,
} from '../src/lib/unified-types';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

type V3 = { x: number; y: number; z: number };
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const norm = (a: V3): V3 => { const l = Math.hypot(a.x, a.y, a.z) || 1; return mul(a, 1 / l); };
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/** 沿轴圆柱（角色空间）：pivot 起、axis 向、长 len、半径 r */
function tube(pivot: V3, axisIn: V3, len: number, r: number) {
  const axis = norm(axisIn);
  const u = Math.abs(axis.x) > 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const v = norm(cross(axis, u));
  const uu = norm(cross(v, axis));
  const SEG = 10;
  const positions: number[] = [], uvs: number[] = [], tris: number[] = [], triMat: number[] = [];
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
    const base = positions.length / 3;
    const ring = (t: number, a: number) => add(add(pivot, mul(axis, t)), add(mul(uu, Math.cos(a) * r), mul(v, Math.sin(a) * r)));
    const p00 = ring(0, a0), p01 = ring(0, a1), p11 = ring(len, a1), p10 = ring(len, a0);
    for (const p of [p00, p01, p11, p10]) positions.push(p.x, p.y, p.z);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    tris.push(base, base + 1, base + 2, base, base + 2, base + 3);
    triMat.push(0, 0);
  }
  return {
    positions: Float32Array.from(positions), uvs: Float32Array.from(uvs),
    tris: Uint32Array.from(tris), triMaterial: Int32Array.from(triMat),
  };
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

/**
 * 造一条链：根（躯干）→ 链根节点（可带摆回角）→ 子节点。
 * joints 给角色空间关节位（全局像素，Y 向下）。
 */
function buildChain(opts: {
  charId: string; swingDeg: number;
  rootJoint: V3; midJoint: V3; endJoint: V3;
}) {
  const { charId, swingDeg, rootJoint, midJoint, endJoint } = opts;
  const root = createDefaultNode('root', 'root');
  root.id = `node_${charId}_0`;
  (root.transform as any).variantIndex = 6;
  const mid = createDefaultNode('mid', 'mid');
  mid.id = `node_${charId}_1`;
  mid.parentId = root.id;
  (mid.transform as any).variantIndex = 6;
  mid.transform.angle = swingDeg;
  const end = createDefaultNode('end', 'end');
  end.id = `node_${charId}_2`;
  end.parentId = mid.id;
  (end.transform as any).variantIndex = 6;
  root.children = [mid.id];
  mid.children = [end.id];
  root.sockets = [{
    id: 'sock_mid', name: 'mid', basePosition: { x: 0, y: 0 }, directionOffsets: {},
    offset3D: { x: pxToSub(rootJoint.x), y: pxToSub(rootJoint.y), z: pxToSub(rootJoint.z) },
  }];
  mid.attachment = { type: 'socket', parentSocketId: 'sock_mid', plug: { x: 0, y: 0 } } as never;
  mid.sockets = [{
    id: 'sock_end', name: 'end', basePosition: { x: 0, y: 0 }, directionOffsets: {},
    offset3D: {
      x: pxToSub(midJoint.x - rootJoint.x), y: pxToSub(midJoint.y - rootJoint.y), z: pxToSub(midJoint.z - rootJoint.z),
    },
  }];
  end.attachment = { type: 'socket', parentSocketId: 'sock_end', plug: { x: 0, y: 0 } } as never;
  void endJoint;

  const rootPiece = createDefaultCostumePiece('root');
  const midPiece = createDefaultCostumePiece('mid');
  const endPiece = createDefaultCostumePiece('end');
  // 子节点要有一张图才进渲染计划（其指令位置 = 期望的关节落点）
  const dotSpr: Sprite = {
    id: `spr_${charId}_dot`, name: 'dot', width: 2, height: 2,
    data: [['#ffffff', '#ffffff'], ['#ffffff', '#ffffff']],
    plug: { x: 0, y: 0 },
  } as Sprite;
  endPiece.sprites = { 6: { spriteId: dotSpr.id } } as never;
  root.slot = rootPiece as never;
  mid.slot = midPiece as never;
  end.slot = endPiece as never;
  const character = {
    id: charId, name: '链测试', nodes: { [root.id]: root, [mid.id]: mid, [end.id]: end },
    rootNodeId: root.id, sprites: {},
    costumeSets: [{ id: 'cs1', name: '默认', pieces: { root: rootPiece, mid: midPiece, end: endPiece } }],
    activeCostumeSetId: 'cs1', direction: 6, latitude: 0,
  } as unknown as Character;
  return { character, mid, end };
}

function runCase(label: string, swingDeg: number, rootJoint: V3, midJoint: V3) {
  const charId = label;
  const { character, mid, end } = buildChain({ charId, swingDeg, rootJoint, midJoint, endJoint: midJoint });
  // 切片：角色空间垂下圆柱（rootJoint → midJoint）
  const geo = tube(rootJoint, sub(midJoint, rootJoint), Math.hypot(...Object.values(sub(midJoint, rootJoint)) as [number, number, number]), 6);
  const sliced = sliceStack({
    ...geo,
    sample: () => [200, 60, 60, 255],
    pivot: rootJoint,
    axis: sub(midJoint, rootJoint),
    uAxis: { x: 1, y: 0, z: 0 },
    layerThickness: 4,
  });
  const sprites: Record<string, Sprite> = { [`spr_${charId}_dot`]: (character.nodes[end.id]!.slot as never as { __x?: never }) && (null as never) };
  // 把 dot 精灵登记进表（endPiece 引用它）
  sprites[`spr_${charId}_dot`] = {
    id: `spr_${charId}_dot`, name: 'dot', width: 2, height: 2,
    data: [['#ffffff', '#ffffff'], ['#ffffff', '#ffffff']],
    plug: { x: 0, y: 0 },
  } as Sprite;
  const res = attachBoneStacks(character, sprites,
    new Map([[1, { rootBoneIndex: 1, rootBoneName: 'mid', jointChar: rootJoint, sliced }]]), charId, '链测试');
  ok(res.attached === 1, `${label}: 挂载成功`);
  const plan = generateRenderPlan(character, 0, 512, 512, 'pixel-perfect', 12,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, sprites);
  const insMid = plan.nodeInstructions.find((i) => i.nodeId === mid.id);
  const insEnd = plan.nodeInstructions.find((i) => i.nodeId === end.id);
  ok(!!insMid?.stackRender, `${label}: 肩指令带 stackRender`);
  if (!insMid?.stackRender || !insEnd) return;
  // 合成并算质心（合成图坐标）
  const sr = insMid.stackRender;
  const layerRgba = sr.layerSpriteIds.map((id) => {
    const s = sprites[id];
    return s ? gridToRgba(s) : null;
  });
  const raster = rasterizeStackOpsData(
    { ops: sr.ops, width: sr.width, height: sr.height, pivotX: sr.pivotX, pivotY: sr.pivotY, key: sr.key },
    layerRgba,
  );
  ok(!!raster, `${label}: 合成图非空`);
  if (!raster) return;
  let mx = 0, my = 0, n = 0;
  for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) {
    if (raster.rgba[(y * raster.width + x) * 4 + 3]! > 0) { mx += x; my += y; n++; }
  }
  const cx = mx / n - sr.pivotX, cy = my / n - sr.pivotY;
  // 执行端：translate(world) + rotate(worldAngle) 后，质心方向应与
  // 肩→肘的世界方向一致
  const ang = (insMid.angle * Math.PI) / 180;
  const fx = cx * Math.cos(ang) - cy * Math.sin(ang);
  const fy = cx * Math.sin(ang) + cy * Math.cos(ang);
  const ex = (insEnd.worldX - insMid.worldX) / 256; // sub→px 只差比例，方向不变
  const ey = (insEnd.worldY - insMid.worldY) / 256;
  const el = Math.hypot(ex, ey) || 1;
  const fl = Math.hypot(fx, fy) || 1;
  const cos = (fx * ex + fy * ey) / (fl * el);
  const deg = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
  // 关节对接：合成图沿期望方向的最远不透明像素应到达子关节
  // （段长 = 肩→肘距离；旧口径层心带俯角时只到约 71%）
  const ux = ex / el, uy = ey / el;
  let maxProj = -Infinity;
  for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) {
    if (raster.rgba[(y * raster.width + x) * 4 + 3]! === 0) continue;
    const lx = x - sr.pivotX, ly = y - sr.pivotY;
    const wx = lx * Math.cos(ang) - ly * Math.sin(ang);
    const wy = lx * Math.sin(ang) + ly * Math.cos(ang);
    const p = wx * ux + wy * uy;
    if (p > maxProj) maxProj = p;
  }
  const segLenPx = Math.hypot(insEnd.worldX - insMid.worldX, insEnd.worldY - insMid.worldY) / 16;
  console.log(`    ${label}: 沿段向最远像素=${maxProj.toFixed(1)}px / 段长=${segLenPx.toFixed(1)}px`);
  ok(maxProj > segLenPx * 0.88 && maxProj < segLenPx * 1.25,
    `${label}: 段端到达子关节（${maxProj.toFixed(1)} 在 ${segLenPx.toFixed(1)} 的 0.88–1.25 倍内）`);
  console.log(`    ${label}: 合成质心(局部)=(${cx.toFixed(1)},${cy.toFixed(1)}) 指令角=${insMid.angle.toFixed(1)}° 最终向=(${fx.toFixed(1)},${fy.toFixed(1)}) 期望向=(${ex.toFixed(1)},${ey.toFixed(1)}) 夹角=${deg.toFixed(1)}°`);
  ok(deg < 12, `${label}: 手臂指向与肩→肘方向一致（夹角 ${deg.toFixed(1)}° < 12°）`);
}

// 手臂：肩在 (30,-40)，垂臂肘在 (34,-2)（向下 38），摆回 -90°
runCase('arm', -90, { x: 30, y: -40, z: 0 }, { x: 34, y: -2, z: 0 });
// 腿（对照）：髋在 (10,10)，膝在 (12,48)（向下 38），无摆回
runCase('leg', 0, { x: 10, y: 10, z: 0 }, { x: 12, y: 48, z: 0 });

console.log(fails === 0 ? 'STACK ARM SWING PROBE PASS' : `STACK ARM SWING PROBE FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
