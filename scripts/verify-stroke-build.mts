// 笔触建角探针（行为）：笔触 → 关节点位/节点树 → FK 往返一致。
import { buildSkeletonFromStrokes, strokeLimbJoints, strokeTorsoJoints } from '../src/lib/stroke-build';
import { computeWorldTransforms } from '../src/lib/unified-render';
import { subToPx, type Character } from '../src/lib/unified-types';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const near = (a: number, b: number, eps = 1.5) => Math.abs(a - b) < eps;

// 直躯干：(100,20) → (100,200)，长 180，s = 60
const torso = [{ x: 100, y: 20 }, { x: 100, y: 110 }, { x: 100, y: 200 }];
const tj = strokeTorsoJoints(torso);
ok(near(tj.waist.x, 100) && near(tj.waist.y, 200), '腰 = 笔触尾 (100,200)');
ok(near(tj.neckBottom.y, 110), `颈下在 1.5 单位 (y=${tj.neckBottom.y})`);
ok(near(tj.headCenter.y, 50), `头中心在 0.5 单位 (y=${tj.headCenter.y})`);
ok(tj.shoulderL.x > 100 && tj.shoulderR.x < 100, '角色左肩在屏幕右、右肩在屏幕左（正面视图）');
ok(near(Math.abs(tj.shoulderL.x - 100), 24, 2), `肩横偏 0.4·s = 24（实际 ${Math.abs(tj.shoulderL.x - 100).toFixed(1)}）`);
ok(tj.hipL.x > 100 && near(Math.abs(tj.hipL.x - 100), 18, 2), '髋横偏 0.3·s = 18');

// 弯躯干：落点沿弧长（不是直线距离）
const bent = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }]; // 总长 120，s=40
const bj = strokeTorsoJoints(bent);
ok(near(bj.neckTop.x, 40) && near(bj.neckTop.y, 0), '弯笔：颈上沿弧长 40 处 = (40,0)');
ok(near(bj.waist.x, 60) && near(bj.waist.y, 60), '弯笔：腰 = 尾点');

// 肢体笔触切分
const armStroke = [{ x: 124, y: 110 }, { x: 160, y: 130 }, { x: 170, y: 190 }, { x: 200, y: 200 }];
const limb = strokeLimbJoints(armStroke, { x: 124, y: 110 }, 0.4, 0.84, { x: 1, y: 1 }, 100, 36);
ok(limb.snapped === true, '起笔在肩热区内 → 吸附');
ok(near(limb.pts[0].x, 124) && near(limb.pts[0].y, 110), '肢根 = 肩关节（吸附后）');
const far = strokeLimbJoints(armStroke, { x: 0, y: 0 }, 0.4, 0.84, { x: 1, y: 1 }, 100, 36);
ok(far.snapped === false, '起笔离肩远 → 未吸附（仍用笔触）');
// 缺笔 fallback
const fb = strokeLimbJoints(undefined, { x: 0, y: 0 }, 0.4, 0.85, { x: 0, y: 1 }, 100, 36);
ok(near(fb.pts[2].y, 85) && near(fb.pts[3].y, 100), '缺笔：沿 fallback 方向按比例直生');

// 完整建树 + FK 往返
const res = buildSkeletonFromStrokes(
  { torso, armL: armStroke },
  { characterId: 'sb1', center: { x: 100, y: 110 } },
);
ok(Object.keys(res.nodes).length === 15, `节点数 15（实际 ${Object.keys(res.nodes).length}）`);
ok(res.snapped.armL === true && res.snapped.legR === false, '吸附记录：左臂吸附、右腿缺笔');
const character = {
  id: 'sb1', name: '笔触', nodes: res.nodes, rootNodeId: res.rootNodeId,
  sprites: {}, costumeSets: [], activeCostumeSetId: null, direction: 6, latitude: 0,
} as unknown as Character;
const wt = computeWorldTransforms(character, 0, 512, 512, 12);
let maxErr = 0;
for (const node of Object.values(res.nodes)) {
  const t = wt.get(node.id);
  if (!t) { ok(false, `FK 缺节点 ${node.name}`); continue; }
  const j = res.joints[node.name]!;
  maxErr = Math.max(maxErr, Math.abs(subToPx(t.worldX) - j.x), Math.abs(subToPx(t.worldY) - j.y));
}
ok(maxErr < 1.5, `FK 往返：全部关节点位误差 < 1.5px（最大 ${maxErr.toFixed(2)}）`);
// 结构节点（躯干/头）角归零；肢链节点角 = 骨向（2D 约定）
const byName = (n: string) => Object.values(res.nodes).find((x) => x.name === n)!;
ok(byName('torso').transform.angle === 0 && byName('head').transform.angle === 0, '结构节点角归零');
ok(Object.values(res.nodes).every((n) => n.transform.x === 0 || n.id === res.rootNodeId), '非根节点无平移姿态');
// 关节角与骨向一致：每条肢链节点 frame +Y（画布向）≈ 其骨方向；
// 末端节点 frame +Y ≈ 末节方向（末端方位相符）
{
  const { frameYAxisWorld } = await import('../src/lib/unified-types');
  const wt2 = computeWorldTransforms(character, 0, 512, 512, 12);
  // frame +Y 是世界轴向向量，与关节世界坐标同空间，直接比
  const frameDir = (nodeId: string) => {
    const t = wt2.get(nodeId)!;
    const y = frameYAxisWorld(t.worldFrame, 6);
    return { x: y.x, y: y.y };
  };
  const segDir = (a: string, b: string) => {
    const d = { x: res.joints[b]!.x - res.joints[a]!.x, y: res.joints[b]!.y - res.joints[a]!.y };
    const l = Math.hypot(d.x, d.y) || 1;
    return { x: d.x / l, y: d.y / l };
  };
  const dot = (u: { x: number; y: number }, v: { x: number; y: number }) => u.x * v.x + u.y * v.y;
  // 左臂有笔触：上臂 frame ≈ 肩→肘方向；前臂 frame ≈ 肘→腕方向
  ok(dot(frameDir(byName('upper_arm_L').id), segDir('upper_arm_L', 'lower_arm_L')) > 0.999,
    '左上臂 frame +Y 对齐骨向（肩→肘）');
  ok(dot(frameDir(byName('lower_arm_L').id), segDir('lower_arm_L', 'hand_L')) > 0.999,
    '左前臂 frame +Y 对齐骨向（肘→腕）');
  // 右臂缺笔（A 势直生）：末端（手）frame ≈ 末节方向
  const handR = frameDir(byName('hand_R').id);
  const wristR = res.joints['hand_R']!, elbowR = res.joints['lower_arm_R']!;
  const tipDir = { x: handR.x, y: handR.y };
  const lastSeg = { x: wristR.x - elbowR.x, y: wristR.y - elbowR.y };
  const ll = Math.hypot(lastSeg.x, lastSeg.y) || 1;
  ok(dot(tipDir, { x: lastSeg.x / ll, y: lastSeg.y / ll }) > 0.999,
    '右手（末端）frame +Y 对齐末节方向');
  // 角度数值：左上臂角 = atan2(−dx, dy) 口径
  const d = { x: res.joints['lower_arm_L']!.x - res.joints['upper_arm_L']!.x, y: res.joints['lower_arm_L']!.y - res.joints['upper_arm_L']!.y };
  const expect = (Math.atan2(-d.x, d.y) * 180) / Math.PI;
  ok(Math.abs(byName('upper_arm_L').transform.angle - expect) < 0.01,
    `左上臂关节角 = 骨向角 ${expect.toFixed(1)}°（实际 ${byName('upper_arm_L').transform.angle.toFixed(1)}°）`);
}

// 顺手配链：四条 2bone、默认禁用、目标 = 静止尖端位（启用后姿态不跳）
ok(res.ikChains.length === 4, `配链 4 条（实际 ${res.ikChains.length}）`);
ok(res.ikChains.every((c) => c.solver === '2bone' && c.enabled === false && c.tipLength === undefined),
  '链口径：2bone / 默认禁用 / 尖端长不写死');
const byName2 = (n: string) => Object.values(res.nodes).find((x) => x.name === n)!;
for (const c of res.ikChains) {
  ok(res.nodes[c.rootNodeId] !== undefined && res.nodes[c.endNodeId] !== undefined, `链 ${c.id} 根/末节点存在`);
}
const charWithChains = { ...character, ikChains: res.ikChains.map((c) => ({ ...c, enabled: true })) } as unknown as Character;
const wtIk = computeWorldTransforms(charWithChains, 0, 512, 512, 12);
let maxIkErr = 0;
for (const node of Object.values(res.nodes)) {
  const t = wtIk.get(node.id)!;
  const j = res.joints[node.name]!;
  maxIkErr = Math.max(maxIkErr, Math.abs(subToPx(t.worldX) - j.x), Math.abs(subToPx(t.worldY) - j.y));
}
ok(maxIkErr < 2.5, `四链全启用（目标=静止尖端）姿态基本不动（最大漂移 ${maxIkErr.toFixed(2)}px）`);

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
