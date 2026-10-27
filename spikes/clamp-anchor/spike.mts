// 钳制锚定 spike（2D 玩具模型，Y 向下，与编辑器世界同向）
// 语义（2026-10-28 用户纠正定版）：锚定 = 指定点全位置冻结、不滑动；
// IK 结算照常出位姿，锚点被结算带走多少，整角色（身体）就反向横移多少
// 把它送回冻结位——结算位姿本身（相对姿态）不动，即「其余部分反向移动
// 以满足 IK 结算结果」。
// 状态：每锚一条生效记录 {冻结位}。触发在平结算位上判：到达即生效并
// 冻结当帧结算位（高度触发先投影到高度面再冻结，含 X/Z——不沿面滑动）；
// 结算位脱离触发条件即释放。从未生效状态顺序求值，结果确定。
// 跑法：bun spikes/clamp-anchor/spike.mts

type V = { x: number; y: number };
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: V, s: number): V => ({ x: a.x * s, y: a.y * s });
const len = (a: V): number => Math.hypot(a.x, a.y);
const dist = (a: V, b: V): number => len(sub(a, b));

let fails = 0;
function check(name: string, cond: boolean, detail: string) {
  console.log(`${cond ? '✓' : '✗'} ${name} —— ${detail}`);
  if (!cond) fails++;
}

/** 2 骨解析 IK：根 root、段长 l1/l2、目标 target、弯曲侧 bend，返回 [根, 中关节, 末端] */
function solve2(root: V, l1: number, l2: number, target: V, bend: number): [V, V, V] {
  const d = sub(target, root);
  const dd = Math.min(Math.max(len(d), Math.abs(l1 - l2) + 1e-6), l1 + l2 - 1e-6);
  const ux = d.x / (len(d) || 1), uy = d.y / (len(d) || 1);
  const a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const mid: V = { x: root.x + ux * a - uy * h * bend, y: root.y + uy * a + ux * h * bend };
  const end: V = { x: root.x + ux * dd, y: root.y + uy * dd };
  return [root, mid, end];
}

const GROUND_Y = 100;
const L1 = 55, L2 = 55;

/** 锚定求值器：持有生效记录，逐帧吃（根轨， 脚目标），吐（绘制根位， 绘制脚位， Δ）。 */
function makeFootAnchor() {
  let frozen: V | null = null;                       // 冻结位（生效期间恒定）
  return {
    get frozen() { return frozen; },
    frame(rootTrack: V, footTarget: V) {
      const pose = solve2(rootTrack, L1, L2, footTarget, 1);
      const settled = pose[2];                       // 平结算脚位
      if (!frozen && settled.y >= GROUND_Y) {
        frozen = { x: settled.x, y: GROUND_Y };      // 生效：投影到高度面后整位冻结（含 X）
      } else if (frozen && settled.y < GROUND_Y) {
        frozen = null;                               // 释放：平结算位脱离触发条件
      }
      const delta = frozen ? sub(frozen, settled) : { x: 0, y: 0 };
      // 刚性反移：整位姿 +Δ（相对姿态 = IK 结算结果，不动）
      return { drawnRoot: add(pose[0], delta), drawnMid: add(pose[1], delta), drawnFoot: add(settled, delta), delta, settled };
    },
  };
}

// ============ 案例 A：脚锚定全程不滑动，位移由身体反向横移吸收 ============
{
  const a = makeFootAnchor();
  // f0：落脚——脚目标 (10,105) 穿地 5px → 生效，冻结位 (10,100)
  const f0 = a.frame({ x: 0, y: 10 }, { x: 10, y: 105 });
  check('A1 落脚帧：触发锚定、脚钉在冻结位', !!a.frozen && dist(f0.drawnFoot, { x: 10, y: GROUND_Y }) < 0.01,
    `frozen=(${a.frozen?.x},${a.frozen?.y})，Δ=(${f0.delta.x.toFixed(1)},${f0.delta.y.toFixed(1)})`);
  check('A2 结算位姿刚性：反移后膝相对位不变', dist(sub(f0.drawnMid, f0.drawnRoot), sub(solve2({ x: 0, y: 10 }, L1, L2, { x: 10, y: 105 }, 1)[1], { x: 0, y: 10 })) < 1e-9,
    '中关节相对根的偏移与平结算逐值一致（IK 结果不动）');
  // f1：身体前进 14（根轨 +14x），脚目标是世界落脚点（不动）→ 腿重弯吸收，身体照常过脚
  const f1 = a.frame({ x: 14, y: 10 }, { x: 10, y: 105 });
  check('A3 支撑期：脚一步不滑、身体前进 14', dist(f1.drawnFoot, { x: 10, y: GROUND_Y }) < 0.01 && Math.abs(f1.drawnRoot.x - 14) < 0.01,
    `foot=(${f1.drawnFoot.x.toFixed(2)},${f1.drawnFoot.y.toFixed(2)})，body.x=${f1.drawnRoot.x.toFixed(2)}（Δx=${f1.delta.x.toFixed(1)} 只补穿深）`);
  // f2：脚目标被身体带着走（目标 +14x）→ 结算要把脚拖滑 +14，锚定把身体反向横移 −14 抵消
  const f2 = a.frame({ x: 14, y: 10 }, { x: 24, y: 105 });
  check('A4 脚要被拖滑时：身体反向横移 −14、脚仍钉原位', dist(f2.drawnFoot, { x: 10, y: GROUND_Y }) < 0.01 && Math.abs(f2.delta.x + 14) < 0.01 && Math.abs(f2.drawnRoot.x - 0) < 0.01,
    `Δ=(${f2.delta.x.toFixed(1)},${f2.delta.y.toFixed(1)})，绘制 body.x=${f2.drawnRoot.x.toFixed(2)}（根轨 14 被反移抵消）`);
  // f3：抬脚——目标上抬，平结算脚位回地面之上 → 释放，此后无补偿
  const f3 = a.frame({ x: 20, y: 10 }, { x: 26, y: 55 });
  check('A5 抬脚帧：释放锚定、Δ 归零', !a.frozen && f3.delta.x === 0 && f3.delta.y === 0 && dist(f3.drawnFoot, f3.settled) < 1e-9,
    'frozen=null，绘制位 = 结算位');
}

// ============ 案例 B：多锚单遍补偿的最小二乘最优性（点对/双脚） ============
{
  const feet: V[] = [{ x: -18, y: 104 }, { x: 30, y: 97 }];        // 平结算双脚位
  const anchors: V[] = [{ x: -18, y: GROUND_Y }, { x: 28, y: GROUND_Y }];  // 两脚各自的冻结位
  const res = feet.map((f, i) => sub(anchors[i], f));
  const delta = mul(add(res[0], res[1]), 0.5);
  const sse = (d: V) => feet.reduce((s, f, i) => s + dist(add(f, d), anchors[i]) ** 2, 0);
  const sseStar = sse(delta);
  const worse = [add(delta, { x: 3, y: 0 }), add(delta, { x: 0, y: 2 }), res[0], res[1]]
    .every((d) => sse(d) >= sseStar - 1e-9);
  check('B1 双锚刚性反移：残差均值使平方和最小', worse && sseStar > 0,
    `Δ*=(${delta.x.toFixed(2)},${delta.y.toFixed(2)})，sse=${sseStar.toFixed(2)}（偏向任一单脚锚都更差）`);
  const dw = mul(add(mul(res[0], 3), res[1]), 0.25);
  check('B2 权重即优先级：高权重锚补偿后残差更小', dist(add(feet[0], dw), anchors[0]) < dist(add(feet[1], dw), anchors[1]),
    `左残差=${dist(add(feet[0], dw), anchors[0]).toFixed(2)} < 右残差=${dist(add(feet[1], dw), anchors[1]).toFixed(2)}`);
}

// ============ 案例 C：精灵边缘锚（脚掌底边）——平移的边界与带旋转的解 ============
{
  const p1: V = { x: -14, y: 108 }, p2: V = { x: 10, y: 96 };       // 结算位：底边倾斜、部分穿地
  const tgt1: V = { x: -14, y: GROUND_Y }, tgt2: V = { x: 10, y: GROUND_Y };  // 冻结目标段（生效帧冻结）
  const d1 = sub(tgt1, p1), d2 = sub(tgt2, p2);
  const dt = mul(add(d1, d2), 0.5);
  const q1 = add(p1, dt), q2 = add(p2, dt);
  check('C1 平移-only 锚边：中点贴合冻结段、边倾斜原样保留', Math.abs((q1.y + q2.y) / 2 - GROUND_Y) < 1e-9 && Math.abs((q2.y - q1.y) - (p2.y - p1.y)) < 1e-9,
    `中点 y=${((q1.y + q2.y) / 2).toFixed(2)}，边倾斜 ${p2.y - p1.y} → ${q2.y - q1.y}（不变）`);
  const mid = mul(add(p1, p2), 0.5);
  const half = len(sub(p2, p1)) / 2;
  const tgt: [V, V] = [{ x: mid.x - half, y: GROUND_Y }, { x: mid.x + half, y: GROUND_Y }];
  const tm = mul(add(tgt[0], tgt[1]), 0.5);
  const ang = Math.atan2(tgt[1].y - tgt[0].y, tgt[1].x - tgt[0].x) - Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const rot = (p: V): V => {
    const dx = p.x - mid.x, dy = p.y - mid.y;
    return { x: tm.x + dx * Math.cos(ang) - dy * Math.sin(ang), y: tm.y + dx * Math.sin(ang) + dy * Math.cos(ang) };
  };
  const r1 = rot(p1), r2 = rot(p2);
  check('C2 平移+旋转锚边：两端点精确贴合目标段', dist(r1, tgt[0]) < 0.01 && dist(r2, tgt[1]) < 0.01,
    `err1=${dist(r1, tgt[0]).toFixed(4)} err2=${dist(r2, tgt[1]).toFixed(4)}（带旋转才有精确解）`);
}

// ============ 案例 D：冻结语义——生效期间冻结位不随结算位漂移 ============
{
  const a = makeFootAnchor();
  a.frame({ x: 0, y: 10 }, { x: 10, y: 105 });                      // 生效，冻结 (10,100)
  const frozenAt = a.frozen && { ...a.frozen };
  a.frame({ x: 6, y: 14 }, { x: 16, y: 108 });                      // 结算位大变
  a.frame({ x: -4, y: 6 }, { x: 6, y: 103 });
  check('D1 生效期间冻结位恒定（不滑动、不重投影）', !!frozenAt && !!a.frozen && dist(frozenAt, a.frozen) === 0,
    `冻结位始终 (${a.frozen?.x},${a.frozen?.y})`);
  // 从未生效状态重演同一序列 → 同一冻结位（顺序求值确定性）
  const b = makeFootAnchor();
  b.frame({ x: 0, y: 10 }, { x: 10, y: 105 });
  check('D2 同序列重演得同一冻结位', !!b.frozen && dist(b.frozen, { x: 10, y: GROUND_Y }) === 0, '顺序求值确定');
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
