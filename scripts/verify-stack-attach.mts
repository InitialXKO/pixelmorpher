// 堆叠挂载探针：手工角色（根 + 躯干节点 + 服装件）+ 合成圆柱切片
// （角色空间）→ attachPartStacks → 断言：层图进精灵表（一摞一夹、
// 出生标签）、piece.stack 已挂、局部变换正确（静止帧下把 stack
// 局部几何变回角色空间应与切片原值重合）→ 再走呈现消费路径：
// 用宿主节点世界帧 computeStackOps 应产出非空算子。
import { sliceStack } from '../src/lib/bake/stack-slicer';
import { attachPartStacks } from '../src/lib/bake/stack-attach';
import { computeStackOps } from '../src/lib/stack-render';
import { computeWorldTransforms, generateRenderPlan } from '../src/lib/unified-render';
import {
  createDefaultNode, createDefaultCostumePiece, pxToSub,
  mat3Apply, worldToViewBasis,
  type Character, type Sprite,
} from '../src/lib/unified-types';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

// 合成圆柱（同 verify-stack-pipeline 的形状，移到角色空间 (100, 50, 0) 处）
const R = 10, H = 40, SEG = 16;
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
  sample: () => [200, 30, 30, 255],
  pivot: { x: 100, y: 50, z: 0 }, axis: { x: 0, y: 1, z: 0 }, uAxis: { x: 1, y: 0, z: 0 },
  layerThickness: 5,
});
// 注意：几何本身在原点附近，pivot 只是切片参考系原点——把几何平移到 pivot 处重切
const moved = positions.slice();
for (let i = 0; i < moved.length; i += 3) { moved[i] += 100; moved[i + 1] += 50; }
const sliced2 = sliceStack({
  positions: Float32Array.from(moved), uvs: Float32Array.from(uvs),
  tris: Uint32Array.from(tris), triMaterial: Int32Array.from(triMat),
  sample: () => [200, 30, 30, 255],
  pivot: { x: 100, y: 50, z: 0 }, axis: { x: 0, y: 1, z: 0 }, uAxis: { x: 1, y: 0, z: 0 },
  layerThickness: 5,
});
void sliced;

// 手工角色：root（在原点）→ torso 节点（socket offset3D = (100, 50, 0) px）
const charId = 'testchar';
const root = createDefaultNode('root', 'root');
root.id = `node_${charId}_0`;
const torso = createDefaultNode('torso', 'torso');
torso.id = `node_${charId}_4`;
torso.parentId = root.id;
torso.slot = { slotKey: 'torso' } as never;
root.children = [torso.id];
root.sockets = [{
  id: 'sock_t', name: 'torso', basePosition: { x: 0, y: 0 }, directionOffsets: {},
  offset3D: { x: pxToSub(100), y: pxToSub(50), z: 0 },
}];
torso.attachment = { type: 'socket', parentSocketId: 'sock_t' } as never;
const piece = createDefaultCostumePiece('torso');
const character = {
  id: charId, name: '测试', nodes: { [root.id]: root, [torso.id]: torso },
  rootNodeId: root.id, sprites: {},
  costumeSets: [{ id: 'cs1', name: '默认', pieces: { torso: piece } }],
  activeCostumeSetId: 'cs1', direction: 6, latitude: 0,
} as unknown as Character;

const sprites: Record<string, Sprite> = {};
// 对照：挂摞前生成计划，躯干指令不应带 stackRender
const planBefore = generateRenderPlan(character, 0, 256, 256, 'pixel-perfect', 12,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, sprites);
const insBefore = planBefore.nodeInstructions.find((i) => i.nodeId === torso.id);
ok(!insBefore, '对照：挂摞前躯干无指令（该件此时无任何视觉）');
const partStacks = new Map([['torso', { rootBoneIndex: 4, rootBoneName: '腰', sliced: sliced2 }]]) as never;
const res = attachPartStacks(character, sprites, partStacks, charId, '测试');
ok(res.attached === 1 && res.skipped === 0, `挂载成功（attached=${res.attached}, skipped=${res.skipped}）`);
ok(res.layerSprites === sliced2.layers.length, `层图数 = ${res.layerSprites}`);
const someLayer = sprites[`spr_stack_${charId}_torso_0`];
ok(!!someLayer && someLayer.folder === '堆叠/躯干', '层图进精灵表且一摞一夹（堆叠/躯干）');
ok(someLayer?.origin?.boneName === '腰', '出生标签带骨骼名');
const stack = piece.stack;
ok(!!stack, 'piece.stack 已挂');
if (stack) {
  ok(stack.layerSpriteIds.length === sliced2.layers.length, '层序完整');
  // 往返校验：局部 origin 经宿主世界帧变回角色空间 == 切片 origin
  const wts = computeWorldTransforms(character, 0, 1024, 1024);
  const wt = wts.get(torso.id)!;
  const dir = wt.variantIndex;
  const nodeBasis = worldToViewBasis(wt.worldX / 16, wt.worldY / 16, wt.worldZ / 16, dir);
  const back = mat3Apply(wt.worldFrame, stack.origin.x, stack.origin.y, stack.origin.z);
  const backChar = { h: back.h + nodeBasis.h, y: back.y + nodeBasis.y, d: back.d + nodeBasis.d };
  // 比较在帧的朝向基坐标里做（切片原值先变进同一基）
  const slicedBasis = worldToViewBasis(sliced2.origin.x, sliced2.origin.y, sliced2.origin.z, dir);
  const err = Math.hypot(backChar.h - slicedBasis.h, backChar.y - slicedBasis.y, backChar.d - slicedBasis.d);
  ok(err < 0.6, `局部 origin 往返误差 ${err.toFixed(2)}px（<0.6）`);
  // 呈现消费：当帧帧算子非空
  const layerSprites = stack.layerSpriteIds.map((id) => sprites[id]);
  const ops = computeStackOps(stack, layerSprites, wt.worldFrame, wt.worldAngle, 45);
  ok(ops.ops.length > 0 && ops.width > 10 && ops.height > 10,
    `呈现算子非空（ops=${ops.ops.length}, 图 ${ops.width}×${ops.height}）`);
}
// 端到端：挂摞后生成计划，躯干指令应带 stackRender（真实消费路径）
const planAfter = generateRenderPlan(character, 0, 256, 256, 'pixel-perfect', 12,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, sprites);
const insAfter = planAfter.nodeInstructions.find((i) => i.nodeId === torso.id);
ok(!!insAfter?.stackRender && insAfter.stackRender.ops.length > 0 && insAfter.stackRender.key.startsWith('stack:'),
  `端到端：计划指令带 stackRender（ops=${insAfter?.stackRender?.ops.length}）`);
ok(insAfter?.foreshorten === undefined, '端到端：堆叠指令不带透视缩短（合成已含）');

console.log(fails === 0 ? 'STACK ATTACH PROBE PASS' : `STACK ATTACH PROBE FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
