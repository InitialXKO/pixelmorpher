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
// 姿态归零：所有非根节点 transform 角度 0
const posed = Object.values(res.nodes).filter((n) => n.id !== res.rootNodeId && (n.transform.angle !== 0 || n.transform.x !== 0 || n.transform.y !== 0));
ok(posed.length === 0, '非根节点姿态归零（偏移全在 socket）');

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
