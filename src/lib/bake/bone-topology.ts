// ============================================================
// PixelMorpher - 骨骼拓扑分析（不依赖骨骼名）
// 流程：建层级 → 子树大小过滤 Helper 噪声 → 找十字（肩）→ 找髋部分岔 → 找手掌 → 部件归属
// 纯逻辑模块，无 three.js 依赖（结构化输入）。
// 可被 Node 脚本直接 import（仅使用类型擦除语法）。
//
// 设计说明：
// - 不用权重过滤结构！Z23 这类模型是"控制骨（0 权重）+ Helper（有权重）"双轨，
//   权重过滤会断掉 Leg1/Arm1 等结构链。用子树大小识别 Helper 噪声。
// - weightSum 保留给调用方（合并阈值/UI 显示），不参与拓扑。
// ============================================================

/** 拓扑分析输入：单根骨骼（调用方从 THREE.Bone 适配） */
export interface TopoBone {
  index: number;
  name: string;
  /** 父 bone index（全局），null = 根 */
  parentIndex: number | null;
  /** bind pose 世界坐标 */
  worldPos: { x: number; y: number; z: number };
  /** 蒙皮权重和（所有 mesh 累计）。~0 表示控制骨/标记（结构仍有效） */
  weightSum: number;
}

/** 部件名（含尾巴/道具） */
export type PartName =
  | 'head' | 'torso' | 'armL' | 'armR' | 'legL' | 'legR'
  | 'tail' | 'props';

export interface TopologyResult {
  /** bone index → 部件（null = 无关骨骼，如零权重叶子标记） */
  boneToPart: (PartName | null)[];
  /** 十字（肩）bone index，null = 未找到 */
  cross: number | null;
  /** 髋部分岔 bone index */
  hipFork: number | null;
  /** 手掌 bone index */
  handL: number | null;
  handR: number | null;
  /** 头链根（颈） */
  headRoot: number | null;
  /** 手指链（每根手指的 bone index，近端→远端） */
  fingersL: number[][];
  fingersR: number[][];
  /** 尾巴链 */
  tail: number[];
  /** 道具/其他 */
  props: number[];
  /** 诊断信息（调试/展示用） */
  notes: string[];
}

export interface TopologyOptions {
  /** 分支"有分量"阈值（子树 bone 数，默认 3）。低于此视为 Helper 噪声 */
  minSubtree?: number;
}

/**
 * 权重过滤工具：返回有变形权重的 bone index 集合。
 * 注意：仅用于合并阈值/UI 显示，不用于拓扑结构（控制骨 0 权重但结构有效）。
 */
export function filterDeformationBones(bones: TopoBone[], epsilon = 1e-6): Set<number> {
  const out = new Set<number>();
  for (const b of bones) if (b.weightSum > epsilon) out.add(b.index);
  return out;
}

type DirClass = 'up' | 'down' | 'side';

export function analyzeTopology(bones: TopoBone[], opts: TopologyOptions = {}): TopologyResult {
  const minSub = opts.minSubtree ?? 3;
  const n = bones.length;
  const notes: string[] = [];
  const empty = (reason: string): TopologyResult => ({
    boneToPart: new Array<PartName | null>(n).fill(null),
    cross: null, hipFork: null, handL: null, handR: null, headRoot: null,
    fingersL: [], fingersR: [], tail: [], props: [],
    notes: [reason],
  });
  if (n === 0) return empty('没有骨骼');

  // ---- 直接 children（全部 bones，不过滤） ----
  const children: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const p = bones[i].parentIndex;
    if (p !== null && p >= 0 && p < n) children[p].push(i);
  }
  const parentOf = (i: number): number | null => {
    const p = bones[i].parentIndex;
    return p !== null && p >= 0 && p < n ? p : null;
  };

  // ---- 子树大小 memo ----
  const subMemo = new Array<number>(n).fill(-1);
  const subSize = (i: number): number => {
    if (subMemo[i] >= 0) return subMemo[i];
    let s = 1;
    for (const c of children[i]) s += subSize(c);
    subMemo[i] = s;
    return s;
  };
  const isStructural = (i: number): boolean => subSize(i) >= minSub;

  // ---- 链方向：从 start 沿主链（最大子树）走 steps 步 ----
  const chainDir = (start: number, steps = 4): { x: number; y: number; z: number } => {
    let cur = start;
    for (let s = 0; s < steps; s++) {
      const ch = children[cur];
      if (ch.length === 0) break;
      // 跟最大子树的（主链延续，跳过 Helper 噪声）
      let best = ch[0], bestSize = -1;
      for (const c of ch) {
        const sz = subSize(c);
        if (sz > bestSize) { bestSize = sz; best = c; }
      }
      cur = best;
    }
    const a = bones[start].worldPos;
    const b = bones[cur].worldPos;
    return { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  };
  const classify = (d: { x: number; y: number; z: number }): DirClass | null => {
    const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
    const m = Math.max(ax, ay, az);
    if (m < 1e-9) return null;
    if (ay >= ax && ay >= az) return d.y > 0 ? 'up' : 'down';
    return 'side';
  };

  // ---- 单链跟到底 ----
  const followChain = (start: number): number[] => {
    const out = [start];
    const seen = new Set<number>([start]);
    let cur = start;
    for (;;) {
      const ch = children[cur];
      if (ch.length !== 1) break;
      cur = ch[0];
      if (seen.has(cur)) break;
      seen.add(cur);
      out.push(cur);
    }
    return out;
  };

  // ---- 在候选中找 XZ 平面最反向的一对 ----
  const oppositePair = (node: number, cands: number[]): [number, number] | null => {
    const p = bones[node].worldPos;
    let best: [number, number] | null = null;
    let bestCos = Infinity;
    for (let a = 0; a < cands.length; a++) {
      for (let b = a + 1; b < cands.length; b++) {
        const pa = bones[cands[a]].worldPos;
        const pb = bones[cands[b]].worldPos;
        const vax = pa.x - p.x, vaz = pa.z - p.z;
        const vbx = pb.x - p.x, vbz = pb.z - p.z;
        const na = Math.hypot(vax, vaz), nb = Math.hypot(vbx, vbz);
        if (na < 1e-9 || nb < 1e-9) continue;
        const cos = (vax * vbx + vaz * vbz) / (na * nb);
        if (cos < -0.3 && cos < bestCos) {
          bestCos = cos;
          best = [cands[a], cands[b]];
        }
      }
    }
    return best;
  };

  // ================= 找十字（肩） =================
  // 条件：≥1 up 结构分支 + ≥2 side 结构分支且有一对反向
  // 取 Y 最高的候选
  let cross: number | null = null;
  let headChild = -1;
  let armPair: [number, number] | null = null;
  {
    let bestY = -Infinity;
    for (let i = 0; i < n; i++) {
      const ch = children[i];
      if (ch.length < 3) continue;
      // 结构分支（过滤 Helper 叶子）
      const struct = ch.filter(isStructural);
      if (struct.length < 3) continue;
      const ups: number[] = [];
      const sides: number[] = [];
      for (const c of struct) {
        const dc = classify(chainDir(c));
        if (dc === 'up') ups.push(c);
        else if (dc === 'side') sides.push(c);
      }
      if (ups.length < 1 || sides.length < 2) continue;
      const pair = oppositePair(i, sides);
      if (!pair) continue;
      const y = bones[i].worldPos.y;
      if (y > bestY) {
        bestY = y;
        cross = i;
        let bu = ups[0], bdy = -Infinity;
        for (const u of ups) {
          const dy = bones[u].worldPos.y - bones[i].worldPos.y;
          if (dy > bdy) { bdy = dy; bu = u; }
        }
        headChild = bu;
        armPair = pair;
      }
    }
  }
  if (cross === null || !armPair) {
    notes.push('未找到十字结构（肩），拓扑分析失败');
    return { ...empty('未找到十字结构'), notes };
  }
  const crossNode = cross;
  notes.push(`十字: ${bones[crossNode].name}（头→${bones[headChild].name}，臂→${bones[armPair[0]].name} / ${bones[armPair[1]].name}）`);

  const armL = bones[armPair[0]].worldPos.x >= bones[armPair[1]].worldPos.x ? armPair[0] : armPair[1];
  const armR = armL === armPair[0] ? armPair[1] : armPair[0];

  // ================= 找髋部分岔 =================
  // 从十字沿 parent 下行，第一个有 ≥2 down 结构分支且能配对的节点
  let hipFork: number | null = null;
  let legPair: [number, number] | null = null;
  let hipExtras: number[] = [];
  {
    let cur: number | null = parentOf(crossNode);
    const seen = new Set<number>();
    while (cur !== null && !seen.has(cur)) {
      seen.add(cur);
      const struct = children[cur].filter(isStructural);
      const downs = struct.filter((c) => classify(chainDir(c)) === 'down');
      if (downs.length >= 2) {
        const pair = oppositePair(cur, downs);
        if (pair) {
          hipFork = cur;
          legPair = pair;
          hipExtras = downs.filter((d) => d !== pair[0] && d !== pair[1]);
          break;
        }
      }
      cur = parentOf(cur);
    }
  }
  let legL = -1, legR = -1;
  const tailRoots: number[] = [];
  if (hipFork !== null && legPair) {
    notes.push(`髋部: ${bones[hipFork].name}（腿→${bones[legPair[0]].name} / ${bones[legPair[1]].name}${hipExtras.length ? `，额外→${hipExtras.map((e) => bones[e].name).join(',')}` : ''}）`);
    legL = bones[legPair[0]].worldPos.x >= bones[legPair[1]].worldPos.x ? legPair[0] : legPair[1];
    legR = legL === legPair[0] ? legPair[1] : legPair[0];
    for (const e of hipExtras) {
      if (followChain(e).length >= 2) tailRoots.push(e);
    }
  } else {
    notes.push('未找到髋部分岔（无腿？），腿部留空');
  }

  // ================= 找手掌 =================
  // 沿手臂主链下行，第一个有 ≥3 条手指候选链（单链长 2~6）的节点。
  // Helper 叶子链长为 1，不计入，避免 Arm1 这类多 Helper 节点误判。
  const findHand = (armRoot: number): { hand: number | null; fingers: number[][]; others: number[] } => {
    let cur = armRoot;
    const seen = new Set<number>();
    for (;;) {
      if (seen.has(cur)) return { hand: null, fingers: [], others: [] };
      seen.add(cur);
      const ch = children[cur];
      const fingerCands: number[][] = [];
      const others: number[] = [];
      for (const c of ch) {
        const chain = followChain(c);
        if (chain.length >= 2 && chain.length <= 6) fingerCands.push(chain);
        else others.push(c);
      }
      if (fingerCands.length >= 3) {
        return { hand: cur, fingers: fingerCands, others };
      }
      if (ch.length === 0) return { hand: null, fingers: [], others: [] };
      let best = ch[0], bestSize = -1;
      for (const c of ch) {
        const s = subSize(c);
        if (s > bestSize) { bestSize = s; best = c; }
      }
      cur = best;
    }
  };
  const handLRes = findHand(armL);
  const handRRes = findHand(armR);
  notes.push(`手掌: 左→${handLRes.hand !== null ? bones[handLRes.hand].name : '无'}（${handLRes.fingers.length} 指），右→${handRRes.hand !== null ? bones[handRRes.hand].name : '无'}（${handRRes.fingers.length} 指）`);

  // ================= 部件归属 =================
  const boneToPart: (PartName | null)[] = new Array(n).fill(null);
  const inSubtree = (root: number, target: number): boolean => {
    let cur: number | null = target;
    while (cur !== null) {
      if (cur === root) return true;
      cur = parentOf(cur);
    }
    return false;
  };

  // 躯干路径：cross → hipFork（含两端；hipFork 为 null 时到根）
  const pathSet = new Set<number>();
  {
    let cur: number | null = crossNode;
    const seen = new Set<number>();
    while (cur !== null && !seen.has(cur)) {
      seen.add(cur);
      pathSet.add(cur);
      if (hipFork !== null && cur === hipFork) break;
      cur = parentOf(cur);
    }
  }

  const tailSet = new Set<number>();
  for (const t of tailRoots) {
    const stack = [t];
    const seen = new Set<number>();
    while (stack.length) {
      const i = stack.pop()!;
      if (seen.has(i)) continue;
      seen.add(i);
      tailSet.add(i);
      for (const c of children[i]) stack.push(c);
    }
  }

  for (let i = 0; i < n; i++) {
    // 零权重叶子标记（如 g_X_Trajectory）直接丢弃
    if (bones[i].weightSum <= 1e-9 && children[i].length === 0) continue;
    if (inSubtree(headChild, i)) { boneToPart[i] = 'head'; continue; }
    if (inSubtree(armL, i)) { boneToPart[i] = 'armL'; continue; }
    if (inSubtree(armR, i)) { boneToPart[i] = 'armR'; continue; }
    if (legL >= 0 && inSubtree(legL, i)) { boneToPart[i] = 'legL'; continue; }
    if (legR >= 0 && inSubtree(legR, i)) { boneToPart[i] = 'legR'; continue; }
    if (tailSet.has(i)) { boneToPart[i] = 'tail'; continue; }
    let cur: number | null = i;
    let isTorso = false;
    const seen = new Set<number>();
    while (cur !== null && !seen.has(cur)) {
      seen.add(cur);
      if (pathSet.has(cur)) { isTorso = true; break; }
      cur = parentOf(cur);
    }
    if (isTorso) { boneToPart[i] = 'torso'; continue; }
    boneToPart[i] = 'props';
  }

  const props: number[] = [];
  for (let i = 0; i < n; i++) if (boneToPart[i] === 'props') props.push(i);
  if (props.length) notes.push(`道具: ${props.length} 个（${props.slice(0, 5).map((p) => bones[p].name).join(',')}${props.length > 5 ? '…' : ''}）`);

  const countPart = (p: PartName): number => boneToPart.filter((x) => x === p).length;
  notes.push(`部件统计: 头${countPart('head')} / 躯干${countPart('torso')} / 左臂${countPart('armL')} / 右臂${countPart('armR')} / 左腿${countPart('legL')} / 右腿${countPart('legR')} / 尾${countPart('tail')} / 道具${countPart('props')}`);

  return {
    boneToPart,
    cross: crossNode,
    hipFork,
    handL: handLRes.hand,
    handR: handRRes.hand,
    headRoot: headChild,
    fingersL: handLRes.fingers,
    fingersR: handRRes.fingers,
    tail: [...tailSet],
    props,
    notes,
  };
}
