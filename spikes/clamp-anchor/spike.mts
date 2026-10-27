// 钳制锚定 spike（2D 玩具模型，Y 向下，与编辑器世界同向）：
// 验证核心语义——「指定点由 IK 结算到达触发条件后暂时锚定，
// 角色其余部分反向移动以满足 IK 结算结果」。
// 每帧流程：① 平结算（根位来自轨道、各链解到各自目标）；
// ② 触发求值（在平结算位上判）；③ 锚定生效后，该点的链目标被锚点位
// 覆盖，根平移 Δ = 锚点位 − 结算位，其余链照常重解，迭代到收敛。
// 锚点位是结算位的纯函数（高度=投影到平面、目标点=目标本身、范围=钳进
// 区域），故无状态：任意帧独立求值结果一致，scrub/convert 采样安全。
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

/** 一帧：根轨 rootTrack、脚链目标 footTarget（著者在地面之下 authored 的落脚点）。
 *  平结算后脚穿地 ≥ 地面线 → 高度锚触发；锚点位 = 脚位投影到地面线。
 *  返回 { root（补偿后）, foot, hipAuthored } */
function frameWithAnchor(rootTrack: V, footTarget: V) {
  let root = { ...rootTrack };
  let pose = solve2(root, L1, L2, footTarget, 1);
  let foot = pose[2];
  if (foot.y < GROUND_Y) return { root, foot, engaged: false, penetration: 0 };
  const penetration = foot.y - GROUND_Y;
  const anchorPos: V = { x: foot.x, y: GROUND_Y };
  for (let i = 0; i < 3; i++) {
    root = add(root, sub(anchorPos, foot));              // 反向移动：根 += 残差
    pose = solve2(root, L1, L2, anchorPos, 1);           // 锚定覆盖同点链目标后重解
    foot = pose[2];
  }
  return { root, foot, engaged: true, penetration };
}

// ============ 案例 A：脚落地面锚定 + 下蹲（根轨下沉）时身体被反推 ============
{
  const stepTarget: V = { x: 10, y: 105 };               // 落脚点 authored 在地面下 5px（常态：步态目标贴地过冲）
  const f1 = frameWithAnchor({ x: 0, y: 10 }, stepTarget);
  check('A1 站立帧：脚穿地 5px 触发锚定、脚钉回地面', f1.engaged && dist(f1.foot, { x: 10, y: GROUND_Y }) < 0.01,
    `foot=(${f1.foot.x.toFixed(2)},${f1.foot.y.toFixed(2)})，穿深=${f1.penetration.toFixed(1)}`);
  check('A2 站立帧：根被反推 5px（其余部分反向移动）', Math.abs(f1.root.y - (10 - 5)) < 0.01,
    `root.y 10 → ${f1.root.y.toFixed(2)}`);
  const f2 = frameWithAnchor({ x: 0, y: 30 }, stepTarget);   // 下蹲：根轨下沉 20
  check('A3 下蹲帧：脚仍钉在地面原位', f2.engaged && dist(f2.foot, { x: 10, y: GROUND_Y }) < 0.01,
    `foot=(${f2.foot.x.toFixed(2)},${f2.foot.y.toFixed(2)})`);
  check('A4 下蹲帧：髋只沉到 25（著者 30 − 穿深 5 由锚定反推吸收）', Math.abs(f2.root.y - 25) < 0.01,
    `root.y=${f2.root.y.toFixed(2)}`);
  const air = frameWithAnchor({ x: 0, y: -60 }, { x: 10, y: 30 });  // 抬脚帧：脚在地面之上
  check('A5 未触发帧：无锚定、根位 = 根轨原值', !air.engaged && air.root.y === -60 && Math.abs(air.foot.y - 30) < 0.01,
    `engaged=false，root.y=${air.root.y}`);
}

// ============ 案例 B：多锚单遍补偿的最小二乘最优性（点对/双脚） ============
{
  // 已结算位姿固定时，单个平移 Δ 不可能同时满足两个不同残差；
  // 加权均值 Δ* = Σw·r / Σw 使加权残差平方和最小——这是每遍补偿的解，
  // 迭代遍负责让链重弯吸收剩余差（案例 A 已示单锚精确收敛）。
  const feet: V[] = [{ x: -18, y: 104 }, { x: 30, y: 97 }];        // 平结算双脚位（左穿地、右离地）
  const anchors: V[] = [{ x: -18, y: GROUND_Y }, { x: 30, y: GROUND_Y }];
  const res = feet.map((f, i) => sub(anchors[i], f));
  const delta = mul(add(res[0], res[1]), 0.5);
  const sse = (d: V) => feet.reduce((s, f, i) => s + dist(add(f, d), anchors[i]) ** 2, 0);
  const sseStar = sse(delta);
  const worse = [add(delta, { x: 3, y: 0 }), add(delta, { x: 0, y: 2 }), res[0], res[1]]
    .every((d) => sse(d) >= sseStar - 1e-9);
  check('B1 双锚平移补偿：残差均值使平方和最小', worse && sseStar > 0,
    `Δ*=(${delta.x.toFixed(2)},${delta.y.toFixed(2)})，sse=${sseStar.toFixed(2)}（偏向任一单脚锚都更差）`);
  // 优先级权重：左脚权重 3 → Δ 偏向左脚
  const dw = mul(add(mul(res[0], 3), res[1]), 0.25);
  check('B2 权重即优先级：高权重锚补偿后残差更小', dist(add(feet[0], dw), anchors[0]) < dist(add(feet[1], dw), anchors[1]),
    `左残差=${dist(add(feet[0], dw), anchors[0]).toFixed(2)} < 右残差=${dist(add(feet[1], dw), anchors[1]).toFixed(2)}`);
}

// ============ 案例 C：精灵边缘锚（脚掌底边贴地）——平移的边界与带旋转的解 ============
{
  const p1: V = { x: -14, y: 108 }, p2: V = { x: 10, y: 96 };       // 结算位：底边倾斜、部分穿地
  const d1: V = { x: 0, y: GROUND_Y - p1.y }, d2: V = { x: 0, y: GROUND_Y - p2.y };
  const dt = mul(add(d1, d2), 0.5);
  const q1 = add(p1, dt), q2 = add(p2, dt);
  check('C1 平移-only 锚边：中点贴地、边倾斜原样保留', Math.abs((q1.y + q2.y) / 2 - GROUND_Y) < 1e-9 && Math.abs((q2.y - q1.y) - (p2.y - p1.y)) < 1e-9,
    `中点 y=${((q1.y + q2.y) / 2).toFixed(2)}，边倾斜 ${p2.y - p1.y} → ${q2.y - q1.y}（不变）`);
  // 平移+绕心旋转（2D 刚体对齐）：目标段 = 同长、水平、贴地
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

// ============ 案例 D：无状态锚点位的幂等性（触发可纯函数求值） ============
{
  const proj = (p: V): V => ({ x: p.x, y: Math.min(p.y, GROUND_Y) });  // 高度锚：穿地侧钳回地面线（Y 向下）
  const foot: V = { x: 10, y: 112 };
  check('D1 高度锚点位幂等：锚过的位再锚不变', dist(proj(proj(foot)), proj(foot)) < 1e-12, 'proj(proj(p)) == proj(p)');
  const atTarget = (p: V, t: V): V => t;
  check('D2 目标点锚点位与结算位无关（纯函数）', dist(atTarget(foot, { x: 3, y: 99 }), { x: 3, y: 99 }) === 0, 'anchor = target');
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
