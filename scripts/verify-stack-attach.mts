// 堆叠挂载探针：手工角色（根 + 躯干节点 + 服装件）+ 合成圆柱切片
// （角色空间）→ attachBoneStacks → 断言：层图进精灵表（一摞一夹、
// 出生标签）、piece.stack 已挂、局部变换正确（静止帧下把 stack
// 局部几何变回角色空间应与切片原值重合）→ 再走呈现消费路径：
// 用宿主节点世界帧 computeStackOps 应产出非空算子。
import { sliceStack } from '../src/lib/bake/stack-slicer';
import { attachBoneStacks } from '../src/lib/bake/stack-attach';
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
const boneStacks = new Map([[4, { rootBoneIndex: 4, rootBoneName: '腰', jointChar: { x: 100, y: 50, z: 0 }, sliced: sliced2 }]]) as never;
const res = attachBoneStacks(character, sprites, boneStacks, charId, '测试');
ok(res.attached === 1 && res.skipped === 0, `挂载成功（attached=${res.attached}, skipped=${res.skipped}）`);
ok(res.layerSprites === sliced2.layers.length, `层图数 = ${res.layerSprites}`);
const someLayer = sprites[`spr_stack_${charId}_b4_0`];
ok(!!someLayer && someLayer.folder === '堆叠/腰', '层图进精灵表且一摞一夹（堆叠/<骨骼名>）');
ok(someLayer?.origin?.boneName === '腰', '出生标签带骨骼名');
const stack = piece.stack;
ok(!!stack, 'piece.stack 已挂');
if (stack) {
  ok(stack.layerSpriteIds.length === sliced2.layers.length, '层序完整');
  // 局部口径校验：origin = 切片 origin − 关节角色位（纯平移，
  // 姿态规范化由呈现端当帧世界帧施加，不在挂载时抵消）
  const err = Math.hypot(
    stack.origin.x - (sliced2.origin.x - 100),
    stack.origin.y - (sliced2.origin.y - 50),
    stack.origin.z - sliced2.origin.z,
  );
  ok(err < 0.01, `局部 origin = 切片 origin − 关节位（误差 ${err.toFixed(3)}px）`);
  const wts = computeWorldTransforms(character, 0, 1024, 1024);
  const wt = wts.get(torso.id)!;
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
ok(insAfter?.mirror === false, '端到端：无镜像映射时指令不镜像（对照）');
// 镜像朝向：当前方向（计划的 currentDirection = 根 variantIndex，
// 本探针为 0）在 mirrorMap 有条目、且无方向平面图（纯堆叠回落路
// 径）时，镜像标志不得被回落丢弃——否则堆叠件与全身朝向不一致
piece.mirrorMap = { 0: 4 } as never;
const planMirror = generateRenderPlan(character, 0, 256, 256, 'pixel-perfect', 12,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, sprites);
const insMirror = planMirror.nodeInstructions.find((i) => i.nodeId === torso.id);
ok(insMirror?.mirror === true && !!insMirror?.stackRender,
  '镜像：纯堆叠件在镜像方向仍带 stackRender 且 mirror=true（整图翻转、画序不变）');

// 像素口径：颜色/图案类修改器逐层生效、形变类不进堆叠解析；
// 摞级 marks 随计划下发（发光定向）
{
  const { resolveStackPixelMods, processStackLayerGrid } = await import('../src/lib/unified-render');
  const mods = [
    { id: 'm1', type: 'color_replace', enabled: true, params: { sourceColor: '#c81e1e', targetColor: '#1e1ec8', tolerance: 30 } },
    { id: 'm2', type: 'bend', enabled: true, params: {} },
    { id: 'm3', type: 'color_replace', enabled: false, params: { sourceColor: '#000000', targetColor: '#ffffff' } },
    { id: 'm4', type: 'outline', enabled: true, params: {} },
  ] as never[];
  const resolved = resolveStackPixelMods(mods, 0) as { id: string }[];
  ok(resolved.length === 1 && resolved[0]?.id === 'm1',
    `像素口径：只有启用的颜色类进堆叠解析（实际 ${resolved.map((r) => r.id).join(',')}）`);
  const stackNow = (piece as { stack?: { layerSpriteIds: string[] } }).stack;
  const layerSpr = sprites[stackNow!.layerSpriteIds[0]!]!;
  const before = JSON.stringify(layerSpr.data);
  const processed = processStackLayerGrid(layerSpr, resolved, 0);
  ok(JSON.stringify(processed) !== before && processed.length === layerSpr.height,
    '像素口径：color_replace 真改到层网格（尺寸不变）');
  ok(processStackLayerGrid(layerSpr, [], 0) === layerSpr.data, '像素口径：无修改器时层网格原样');
  // marks 下发
  const st = (piece as { stack?: { marks?: unknown } }).stack;
  if (st) st.marks = [{ name: 'tip', kind: 'point', x: 1, y: 2 }] as never;
  const planMarks = generateRenderPlan(character, 0, 256, 256, 'pixel-perfect', 12,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, sprites);
  const insMarks = planMarks.nodeInstructions.find((i) => i.nodeId === torso.id);
  ok((insMarks?.stackRender?.marks as { name: string }[] | undefined)?.[0]?.name === 'tip',
    '像素口径：摞级 marks 随 stackRender 下发（发光定向）');
}

console.log(fails === 0 ? 'STACK ATTACH PROBE PASS' : `STACK ATTACH PROBE FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
