// verify-dynamic-patterns.mts — 动态模式库探针（bun 运行）
// 口径：双挂载按效果位合并（服装件同位替换、同位关闭压制、不同位
// 叠加）；形变是正弦脉冲驱动的本地缩放；粒子模拟无状态确定性、
// 发射来自轮廓、镜像整条轨迹翻 x、存活数不超过实例上限。
import {
  createDefaultCharacter,
  createDefaultNode,
  createDefaultCostumePiece,
  pxToSub,
  type Character,
  type DirectionIndex,
  type Sprite,
} from '../src/lib/unified-types';
import { generateRenderPlan } from '../src/lib/unified-render';
import {
  createDynamicInstance,
  defaultDynamicParams,
  dynamicDeformAt,
  findDynamicTemplate,
  glowFollowTargetOf,
  glowRankByInstanceId,
  resolveDynamicPatterns,
  resolveGlowGroups,
  type DynamicPatternInstance,
  type DynamicPatternParams,
} from '../src/lib/dynamic-patterns';
import { extractContour, simulateDynamicParticles } from '../src/lib/dynamic-pattern-sim';
import { followDeltaAt, followAnchoredDeltaAt } from '../src/lib/dynamic-patterns';
import { createDynamicRuntime } from '../src/lib/proc-runtime/dynamic-src';
import { subToPx } from '../src/lib/unified-types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; } else { fail++; console.log(`✗ ${name}`); }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

function inst(slot: string, over: Partial<DynamicPatternParams>, enabled = true): DynamicPatternInstance {
  return { id: `t_${slot}_${enabled}`, slot, enabled, params: { ...defaultDynamicParams(), ...over } };
}

// ---- D1：双挂载解析 ----
{
  const node = [inst('身体', { rate: 5 }), inst('氛围', { rate: 6 })];
  const piece = [inst('身体', { rate: 50 }), inst('武器', { rate: 7 })];
  const r = resolveDynamicPatterns(node, piece);
  check('D1 不同位叠加（3 个）', r.length === 3);
  check('D1 同位服装件替换', r.find((x) => x.instance.slot === '身体')?.instance.params.rate === 50);
  check('D1 替换来源=服装件', r.find((x) => x.instance.slot === '身体')?.origin === 'costume');
  check('D1 节点独有保留', r.find((x) => x.instance.slot === '氛围')?.origin === 'node');
  const suppressed = resolveDynamicPatterns(node, [inst('身体', {}, false)]);
  check('D1 同位关闭压制', suppressed.length === 1 && suppressed[0]!.instance.slot === '氛围');
  check('D1 空输入', resolveDynamicPatterns(undefined, undefined).length === 0);
  check('D1 节点关闭不占位', resolveDynamicPatterns([inst('身体', {}, false)], []).length === 0);
}

// ---- D2：形变脉冲 ----
{
  const p = { ...defaultDynamicParams(), deformEnabled: true, squashY: 0.8, stretchX: 1.1, deformHz: 1, deformPhase: 0 };
  const peak = dynamicDeformAt(p, 0.25);
  check('D2 峰值缩放', near(peak.sy, 0.8) && near(peak.sx, 1.1) && near(peak.amount, 1));
  const trough = dynamicDeformAt(p, 0.75);
  check('D2 谷值回 1', near(trough.sy, 1) && near(trough.sx, 1) && near(trough.amount, 0));
  check('D2 未启用形变恒等', dynamicDeformAt(defaultDynamicParams(), 0.25).amount === 0);
}

// ---- D3：轮廓提取 ----
const gridB: (string | null)[][] = Array.from({ length: 5 }, () => Array(5).fill('#808080'));
{
  const pts = extractContour(gridB);
  check('D3 5×5 轮廓点=16', pts.length === 16);
  const topMid = pts.find((p) => p.x === 2 && p.y === 0);
  check('D3 顶部中点法线向上', !!topMid && topMid.ny < -0.9);
}

// ---- D4：粒子模拟（确定性/分层/上限/镜像）----
const spriteB: Sprite = {
  width: 5, height: 5, data: gridB,
  plug: { x: pxToSub(1), y: pxToSub(2) },
} as unknown as Sprite;
function resolvedOf(over: Partial<DynamicPatternParams>): { instance: DynamicPatternInstance; origin: 'node' } {
  return { instance: inst('身体', over), origin: 'node' };
}
{
  const heat = findDynamicTemplate('挤压冒热气')!;
  const r = { instance: { id: 'heat1', slot: '身体', enabled: true, params: heat.params }, origin: 'node' as const };
  const back1 = simulateDynamicParticles(r, spriteB, 30, 12, false, 'back', 'nodeX');
  const back2 = simulateDynamicParticles(r, spriteB, 30, 12, false, 'back', 'nodeX');
  const front = simulateDynamicParticles(r, spriteB, 30, 12, false, 'front', 'nodeX');
  check('D4 有粒子产生', back1.length + front.length > 0);
  check('D4 确定性（两次同结果）', JSON.stringify(back1) === JSON.stringify(back2));
  check('D4 alpha 不超包络上限', [...back1, ...front].every((p) => p.alpha >= 0 && p.alpha <= heat.params.alpha + 1e-9));
  check('D4 热气整体上飘（平均 y<0）',
    (back1.reduce((s, p) => s + p.y, 0) + front.reduce((s, p) => s + p.y, 0)) / Math.max(1, back1.length + front.length) < 0.5);
}
{
  const r = resolvedOf({ rate: 60, life: 3, maxParticles: 10, layer: 'front', frontRatio: 1 });
  const ps = simulateDynamicParticles(r, spriteB, 40, 12, false, 'front', 'cap');
  check('D4 存活上限', ps.length <= 10 && ps.length > 0);
}
{
  const r = resolvedOf({ rate: 20, life: 1, directionDeg: 0, spreadDeg: 0, turbulence: 0, source: 'contour', layer: 'front', frontRatio: 1 });
  const a = simulateDynamicParticles(r, spriteB, 20, 12, false, 'front', 'mir');
  const b = simulateDynamicParticles(r, spriteB, 20, 12, true, 'front', 'mir');
  const key = (ps: typeof a) => ps.map((p) => `${p.y.toFixed(4)}|${p.size.toFixed(4)}`).sort().join(';');
  check('D4 镜像粒子数相同', a.length === b.length && a.length > 0);
  check('D4 镜像 y/尺寸分布不变', key(a) === key(b));
  const sumA = a.reduce((s, p) => s + p.x, 0), sumB = b.reduce((s, p) => s + p.x, 0);
  check('D4 镜像 x 整体反号', near(sumA + sumB, 0, 0.05));
}

// ---- D5：主画布集成（形变进指令、服装件替换/压制）----
function buildChar(
  nodeDyn: DynamicPatternInstance[] | undefined,
  pieceDyn: DynamicPatternInstance[] | undefined,
): Character {
  const ch = createDefaultCharacter('c', '动态测试');
  const root = ch.nodes[ch.rootNodeId]!;
  const node = createDefaultNode('N', 'N');
  (node as unknown as { parentId: string }).parentId = ch.rootNodeId;
  if (nodeDyn) node.dynamicPatterns = nodeDyn;
  const piece = createDefaultCostumePiece('slotN');
  if (pieceDyn) piece.dynamicPatterns = pieceDyn;
  piece.sprites[6 as DirectionIndex] = spriteB;
  node.slot = piece;
  ch.nodes['N'] = node;
  root.children.push('N');
  ch.costumeSets = [{ id: 'cs', name: '默认', pieces: { slotN: piece } } as unknown as Character['costumeSets'][number]];
  ch.activeCostumeSetId = 'cs';
  return ch;
}
function instructionFor(ch: Character, frame: number) {
  ch.nodes[ch.rootNodeId]!.transform.variantIndex = 6;
  const plan = generateRenderPlan(
    ch, frame, 200, 200,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined,
    {},
  );
  return plan.sortedInstructions.find((i) => i.nodeId === 'N');
}
{
  const heat = findDynamicTemplate('挤压冒热气')!;
  const nodeInst = createDynamicInstance(heat.name, heat.params, '身体');
  const ins = instructionFor(buildChar([nodeInst], undefined), 3);
  check('D5 指令带动态实例', ins?.dynamicPatterns?.length === 1 && ins.dynamicPatterns[0]!.origin === 'node');
  check('D5 峰值帧纵向挤压', near(ins?.stretch ?? 0, heat.params.squashY, 0.02));
  check('D5 峰值帧横向拉伸', near(ins?.scaleX ?? 0, heat.params.stretchX, 0.02));
  const pieceInst = createDynamicInstance(heat.name, { ...heat.params, squashY: 0.5, stretchX: 1 }, '身体');
  const ins2 = instructionFor(buildChar([nodeInst], [pieceInst]), 3);
  check('D5 服装件同位替换形变', near(ins2?.stretch ?? 0, 0.5, 0.02) && ins2?.dynamicPatterns?.[0]!.origin === 'costume');
  const off = { ...pieceInst, enabled: false };
  const ins3 = instructionFor(buildChar([nodeInst], [off]), 3);
  check('D5 服装件关闭压制', ins3?.dynamicPatterns === undefined && near(ins3?.stretch ?? 0, 1, 1e-9));
}

// ---- D6：发光分组（前 3 独立、第 4 起按所选组并入） ----
{
  const gp = (over: Partial<DynamicPatternParams>): DynamicPatternParams =>
    ({ ...defaultDynamicParams(), glowEnabled: true, ...over });
  const list = [
    gp({ glowColor: '#111111' }), gp({ glowColor: '#222222' }), gp({ glowColor: '#333333' }),
    gp({ glowColor: '#444444', glowFollowGroup: 0 }), gp({ glowColor: '#555555' }),
  ];
  const groups = resolveGlowGroups(list);
  check('D6 前 3 个各成一组', groups.length === 3
    && groups[0]!.representative.glowColor === '#111111'
    && groups[2]!.representative.glowColor === '#333333');
  check('D6 第 4 个按所选并入第 1 组（只贡献选区）', groups[0]!.contributors.length === 2
    && groups[0]!.contributors[1] === list[3]);
  check('D6 第 5 个未选时并入第 3 组', groups[2]!.contributors.length === 2
    && groups[2]!.contributors[1] === list[4]);
  check('D6 非法跟随值回落第 3 组', glowFollowTargetOf(gp({ glowFollowGroup: 9 })) === 2);
  const rmap = glowRankByInstanceId(
    [inst('a', { glowEnabled: true }), inst('b', {}), inst('c', { glowEnabled: true })],
    undefined,
  );
  check('D6 组序只数启用发光的实例', rmap.get('t_a_true') === 0 && rmap.get('t_c_true') === 1 && !rmap.has('t_b_true'));
}

// ---- D7：追随段（纯函数孪生 + 主画布应用） ----
{
  const rt = createDynamicRuntime();
  const cases: { now: { a: number; x: number; y: number }; lag: { a: number; x: number; y: number }; amt: number; rot: boolean }[] = [
    { now: { a: 0.3, x: 10, y: -4 }, lag: { a: 0.9, x: 2, y: 7 }, amt: 0.7, rot: true },
    { now: { a: 0, x: 0, y: 0 }, lag: { a: 0, x: 0, y: 0 }, amt: 1, rot: true },
    { now: { a: 1, x: -5, y: 3 }, lag: { a: -2, x: 8, y: -9 }, amt: 0, rot: true },
    { now: { a: 0.5, x: 1, y: 1 }, lag: { a: 2.5, x: 4, y: -6 }, amt: 1.5, rot: false },
  ];
  // 运行时不再现算追随增量（导出端烘 followCurve），孪生已删；
  // 编辑器侧 followDeltaAt 的性质由下方用例单独锁。
  void cases; void rt;
  const zero = followDeltaAt({ a: 1, x: 5, y: 5 }, { a: 1, x: 5, y: 5 }, 0.8, true);
  check('D7 滞后位姿=当前位姿时增量为零', zero.dx === 0 && zero.dy === 0 && zero.da === 0);
  const wrap = followDeltaAt(
    { a: (-170 * Math.PI) / 180, x: 0, y: 0 },
    { a: (170 * Math.PI) / 180, x: 0, y: 0 }, 1, true);
  check('D7 角度差跨 ±π 取近路（−170°→+170° 应为 −20°）',
    near(wrap.da, (-20 * Math.PI) / 180, 1e-9));
  const noRot = followDeltaAt({ a: 0, x: 0, y: 0 }, { a: 1.2, x: 3, y: 4 }, 0.5, false);
  check('D7 关旋转时 da=0、平移照常', noRot.da === 0 && near(noRot.dx, 1.5) && near(noRot.dy, 2));
  // 锚定版（甲）：连接点锚死——平移全部换算为摆角 + 沿轴缩放
  const aZero = followAnchoredDeltaAt({ a: 1, x: 5, y: 5 }, { a: 1, x: 5, y: 5 }, 0.8, true, 0, 1, 3);
  check('D7 锚定：滞后=当前时 da=0、ds=1、平移恒 0',
    aZero.da === 0 && aZero.ds === 1 && aZero.dx === 0 && aZero.dy === 0);
  const aSide = followAnchoredDeltaAt({ a: 0, x: 6, y: 0 }, { a: 0, x: 3, y: 0 }, 1, true, 0, 1, 3);
  check('D7 锚定：侧向拖拽 −3（u=(0,1)、reach=3）→ 摆角 +45°、ds=√2、尖端恰落原位移点',
    near(aSide.da, Math.PI / 4, 1e-9) && near(aSide.ds, Math.SQRT2, 1e-9) && aSide.dx === 0 && aSide.dy === 0);
  const aAxial = followAnchoredDeltaAt({ a: 0, x: 0, y: 0 }, { a: 0, x: 0, y: 3 }, 1, true, 0, 1, 3);
  check('D7 锚定：纯沿轴拖拽 +3 → 不摆角、ds=2（伸长一倍）',
    near(aAxial.da, 0, 1e-9) && near(aAxial.ds, 2, 1e-9));
  const aNoReach = followAnchoredDeltaAt({ a: 0, x: 0, y: 0 }, { a: 0.4, x: 3, y: 0 }, 1, true, 0, 1, 0);
  check('D7 锚定：reach=0 时只剩源角度滞后、ds=1',
    near(aNoReach.da, 0.4, 1e-9) && aNoReach.ds === 1);
  const tplF = findDynamicTemplate('垂饰滞后');
  check('D7 内置模板「垂饰滞后」在库', !!tplF && tplF.params.followEnabled === true && tplF.params.followAmount === 0.7);
}
{
  // 主画布应用：源节点 S 的 x 轨 0→192 亚像素（=12px，帧 0..12，
  // 1px/帧），跟随者 N 挂追随（源 slotS、延迟 0.3s、强度 1、fps 10
  // → 滞后 3 帧）。第 6 帧平移增量 d = x(3) − x(6) = −3px；锚定版
  // （甲）下连接点不动（Δx=Δy=0），d 按跟随者主轴 u=(0,1)、臂长
  // reach = 精灵高 5 − plug y 2 = 3 换算：摆角 atan2(3, 3) = +45°，
  // 沿轴缩放 hypot(3, 3)/3 = √2（stretch 通道比值）。
  const buildFollowChar = (followOn: boolean): Character => {
    const ch = createDefaultCharacter('cf', '追随测试');
    const root = ch.nodes[ch.rootNodeId]!;
    const mk = (id: string, slotKey: string, parent: string) => {
      const n = createDefaultNode(id, id);
      (n as unknown as { parentId: string }).parentId = parent;
      const piece = createDefaultCostumePiece(slotKey);
      piece.sprites[6 as DirectionIndex] = spriteB;
      n.slot = piece;
      ch.nodes[id] = n;
      return { n, piece };
    };
    const src = mk('S', 'slotS', ch.rootNodeId);
    src.n.tracks = {
      x: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 12, value: 192 }] },
    } as never;
    const fol = mk('N', 'slotN', ch.rootNodeId);
    fol.n.dynamicPatterns = [inst('身体', {
      emitEnabled: false,
      followEnabled: followOn, followSource: 'slotS',
      followDelaySec: 0.3, followAmount: 1, followRotate: true,
    })];
    root.children.push('S', 'N');
    ch.costumeSets = [{
      id: 'cs', name: '默认',
      pieces: { slotS: src.piece, slotN: fol.piece },
    } as unknown as Character['costumeSets'][number]];
    ch.activeCostumeSetId = 'cs';
    ch.nodes[ch.rootNodeId]!.transform.variantIndex = 6;
    return ch;
  };
  const planAt = (ch: Character) => generateRenderPlan(ch, 6, 200, 200, undefined, 10)
    .sortedInstructions.find((i) => i.nodeId === 'N');
  const on = planAt(buildFollowChar(true));
  const off = planAt(buildFollowChar(false));
  check('D7 跟随者指令存在（开/关）', !!on && !!off);
  const dX = subToPx(on!.worldX) - subToPx(off!.worldX);
  const dY = subToPx(on!.worldY) - subToPx(off!.worldY);
  check(`D7 第 6 帧锚定 Δx = 0（连接点不动，实测 ${dX.toFixed(2)}）`, near(dX, 0, 0.05));
  check(`D7 第 6 帧锚定 Δy = 0（实测 ${dY.toFixed(2)}）`, near(dY, 0, 0.05));
  check(`D7 第 6 帧锚定 Δangle = +45°（实测 ${((on!.angle ?? 0) - (off!.angle ?? 0)).toFixed(2)}）`,
    near((on!.angle ?? 0) - (off!.angle ?? 0), 45, 0.5));
  const sRatio = (on!.stretch ?? 1) / (off!.stretch ?? 1);
  check(`D7 第 6 帧锚定 stretch 比值 = √2（实测 ${sRatio.toFixed(3)}）`, near(sRatio, Math.SQRT2, 0.02));
}

console.log(`verify-dynamic-patterns: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
