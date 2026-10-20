// 验证甲案：本分支 IK 求解语义应与 main 一致（基点与目标同在含中心空间）。
// 方法：对真实项目角色，取 FK 关节 → 按 applyIKChain 的确切算法（尖端虚拟关节 +
// 蓝图目标 + FABRIK/2bone 求解器）复刻两遍求解：
//   A) base = 关节原值（旧 buggy 语义：原点空间基点 vs 含中心目标）
//   B) base = 关节 + 画布中心（main 语义 / 修复后语义）
// 再与 computeWorldTransforms（含 IK）的实际关节角逐角比对：实际必须等于 B 且不等于 A。
import { readFileSync } from 'fs';
import { computeWorldTransforms } from '../src/lib/unified-render';
import { evaluateBlueprint, EVALUATORS } from '../src/lib/blueprint/eval';
import { asNumber } from '../src/lib/blueprint/ir';
import { subToPx } from '../src/lib/unified-types';

const raw = JSON.parse(readFileSync('/home/hatch/workspace/user/files/1_0_hzs0.pxm', 'utf-8'));
const proj = raw.project;
const W = proj.canvasWidth ?? 256;
const H = proj.canvasHeight ?? 256;
const character = (Object.values(proj.unifiedCharacters) as any[])[0];
const frameRate = proj.frameRate ?? 12;

let fail = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✓' : '✗'} ${label}: ${detail}`);
  if (!ok) fail++;
}

function chainJointIds(chain: any): string[] {
  const ids: string[] = [];
  let cur: string | undefined = chain.endNodeId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    ids.unshift(cur);
    if (cur === chain.rootNodeId) break;
    cur = character.nodes[cur]?.parentId;
  }
  return ids;
}

/** 复刻 applyIKChain 的求解部分；baseShift 控制基点空间 */
function replicateSolve(chain: any, frame: number, baseShift: { x: number; y: number }) {
  const fkChar = JSON.parse(JSON.stringify(character));
  fkChar.ikChains = fkChar.ikChains.map((c: any) => ({ ...c, enabled: false }));
  const fk = computeWorldTransforms(fkChar, frame, W, H, frameRate);
  const jointIds = chainJointIds(chain);
  const joints = jointIds.map((id) => {
    const t = fk.get(id)!;
    return { x: subToPx(t.worldX), y: subToPx(t.worldY), angle: t.worldAngle };
  });
  const lengths: number[] = [];
  for (let i = 0; i < joints.length - 1; i++) {
    lengths.push(Math.hypot(joints[i + 1].x - joints[i].x, joints[i + 1].y - joints[i].y));
  }
  // 尖端（与 applyIKChain 同逻辑）
  let tipLength = chain.tipLength ?? 0;
  if (tipLength <= 0) {
    const endNode = character.nodes[chain.endNodeId];
    const sprite = endNode?.sprite;
    if (sprite && sprite.height > 0) {
      const plugY = sprite.plug ? subToPx(sprite.plug.y) : sprite.height / 2;
      tipLength = Math.max(1, sprite.height - plugY);
    } else if (lengths.length > 0) {
      tipLength = lengths[lengths.length - 1];
    }
  }
  if (tipLength > 1e-6) {
    const lastJ = joints[joints.length - 1];
    const rad = (lastJ.angle * Math.PI) / 180;
    joints.push({ x: lastJ.x + -Math.sin(rad) * tipLength, y: lastJ.y + Math.cos(rad) * tipLength, angle: lastJ.angle });
    lengths.push(tipLength);
  }
  let targetX = chain.target.x;
  let targetY = chain.target.y;
  if (chain.targetBlueprint) {
    const r = evaluateBlueprint(chain.targetBlueprint, { frame, frameRate, vars: {} } as any);
    if (Number.isFinite(r.translateX)) targetX = r.translateX + W / 2;
    if (Number.isFinite(r.translateY)) targetY = r.translateY + H / 2;
  }
  const baseX = joints[0].x + baseShift.x;
  const baseY = joints[0].y + baseShift.y;
  const ikNode: any = chain.solver === '2bone' && lengths.length === 2
    ? { id: 'ik', type: 'ik_2bone', inputs: {}, params: { targetX, targetY, len1: lengths[0], len2: lengths[1], baseX, baseY, bendDir: chain.bendDir ?? 1 } }
    : { id: 'ik', type: 'ik_fabrik', inputs: {}, params: { targetX, targetY, lengths: lengths.join(','), baseX, baseY } };
  const evaluator = EVALUATORS[ikNode.type];
  const ikResult = evaluator(ikNode, {}, { frame: 0, frameRate: 12, vars: {} } as any);
  const toYAxis = (a: number) => a - 90;
  let angles: number[];
  if (ikNode.type === 'ik_2bone') {
    const a1 = toYAxis(asNumber(ikResult.angle1));
    const a2 = asNumber(ikResult.angle2);
    const elbow = a1 + a2;
    angles = jointIds.map((_, idx) => (idx === 0 ? a1 : elbow));
  } else {
    const v: any = ikResult.angles;
    const s = typeof v === 'object' && v !== null && 'value' in v ? String(v.value) : '';
    const rawA = s.split(',').map(Number).filter((n) => !isNaN(n)).map(toYAxis);
    angles = jointIds.map((_, idx) => rawA[Math.min(idx, rawA.length - 1)] ?? 0);
  }
  return { jointIds, angles };
}

for (const frame of [0, 7, 15, 22]) {
  const solved = computeWorldTransforms(character, frame, W, H, frameRate);
  for (const chain of character.ikChains as any[]) {
    if (!chain.enabled) continue;
    const A = replicateSolve(chain, frame, { x: 0, y: 0 });            // 旧语义
    const B = replicateSolve(chain, frame, { x: W / 2, y: H / 2 });    // main 语义
    const actual = A.jointIds.map((id) => solved.get(id)!.worldAngle);
    const eqB = actual.every((a, i) => Math.abs(a - B.angles[i]) < 1e-6);
    const eqA = actual.every((a, i) => Math.abs(a - A.angles[i]) < 1e-6);
    check(`${chain.name} f${frame} 实际角 == main 语义`, eqB,
      `实际 [${actual.map((a) => a.toFixed(2)).join(', ')}] main [${B.angles.map((a) => a.toFixed(2)).join(', ')}] 旧 [${A.angles.map((a) => a.toFixed(2)).join(', ')}]`);
    check(`${chain.name} f${frame} 实际角 != 旧错位语义`, !eqA || eqB, eqA && !eqB ? '仍与旧语义一致——修复未生效' : '已脱离旧语义');
  }
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
