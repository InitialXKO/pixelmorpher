// ============================================================
// 骨轴守卫（数据层守卫）：堵 IK 两角反解的参数化奇异点
//
// 背景（机制）：姿态 (angle, tilt) 的局部旋转 L = RU(tilt)·RD(angle)，
// 反解 solveLocalAngleTilt 先用 RD 定目标方向的 h 分量，可达条件是
// |q.h| ≤ ρ，ρ = 骨段静止偏移在朝向基 (h,y) 平面的投影长度。朝向绕
// Y 轴旋转，ρ 对全部朝向的最小值恰为 |O_y|（O = 骨段静止总偏移，
// 世界轴表达）。静止方向落进水平带（|O_y| < 0.5·|O|，即与水平面
// 夹角 < 30°）的骨段，总有一个朝向让它正对纵深轴、ρ≈0、反解钳到
// 边界留下残差（实测 X 向骨在东/西向回放偏 ~19.8px）。
//
// 守卫（用户裁决「按此守卫」）：不改求解器。在数据入口把补的那
// 90° 做成静止帧的固定改轴——给坏段的父节点帧注入视平面 ±90°
// 增益 Γ（经 transform.angle 承载、轨道角同步平移），子节点偏移
// 按 RD(−Γ) 反转、精灵位图按 D4 无损反旋（plug/标记/高度图同步
// 换算），使静止世界几何与绘制逐点不变，而偏移数据转成 +Y 主导
// 表达、ρ 对所有朝向拉满。与烘焙线 T-pose 摆回（甲案）同构：偏移
// 拉直到帧 +Y、方向由节点角承载（stroke-build 肢链同款约定）。
//
// 规范基：南向（6）——偏移的世界轴 (x,y) 平面即南向视平面，帧增益
// 的复合恒等式在此基上精确；节点转向（规范几何）开启时全朝向
// 精确，几何随朝向模式下其余朝向呈视平面贴合（与甲案同取舍）。
//
// 边界（只报不改，见报告字段）：
// - Z 主导坏段（|O_x| 也小）：视平面旋转动不了纵深分量，修不了。
// - 兄弟冲突：父节点同时有 X 向坏段与 Y 向好段时，旋转修一个坏
//   一个——计数打平时不旋转（不拿好段换坏段），坏段留下并点名。
// - 2D socket 子节点（偏移按朝向逐向给、无 offset3D）：其偏移无
//   法在世界轴口径下精确反旋，故父帧增益非零会破坏其位置恒等——
//   这类子树经冲突回退保持原样（2D 段自身在求解器基下恒合规）。
// - 冻结节点：带 tilt 源（基础 tilt/tilt 轨道/蓝图 tilt）、父级
//   切换轨、轨迹、动态平移源（动画修改器/蓝图 translate）的节点
//   不承载帧增益；增益穿过它会破坏复合口径 → 冲突回退。
// - 堆叠件/参数化件/蒙皮快照：呈现与帧耦合方式超出位图反旋的表
//   达面，受影响节点命中任一 → 整角色中止守卫（数据原样）。
// - 倾斜动画（区域内节点在非静止帧有 tilt）下帧复合的共轭残差
//   不在本守卫保证内：静止位姿与 IK 行为（守卫的目的）精确，
//   tilt≡0 的 2D 线全帧精确。
// ============================================================

import {
  pxToSub, subToPx, directionTrig,
  type Character, type CostumePiece, type Node, type Socket, type Sprite,
} from './unified-types';
import {
  d4MapPoint, d4TransformGrid, d4TransformLandmarks, type D4Op,
} from './sprite-transform';
import { cellsFromPaintedSpec, paintedSpecFromCells } from './sprite-marks';
import type { SpriteMark } from './unified-types';

// ---------- 基础几何（规范基 = 世界轴 (x,y) 平面，z 不动） ----------

interface V3 { x: number; y: number; z: number }

/** RD(θ) 作用于 (x,y)：θ 为 90° 倍数时用整数置换（精确、无浮点尘埃）。
 *  RD(+90): (x,y) → (−y, x)；RD(−90): (x,y) → (y, −x)；RD(180): (−x,−y)。 */
function rotXY(x: number, y: number, deg: number): { x: number; y: number } {
  const q = ((Math.round(deg / 90) % 4) + 4) % 4;
  if (q === 0) return { x, y };
  if (q === 1) return { x: -y, y: x };
  if (q === 2) return { x: -x, y: -y };
  return { x: y, y: -x };
}

const normGain = (g: number): number => {
  const m = ((g % 360) + 360) % 360;
  return m > 180 ? m - 360 : m;
};

/** socketOffsetTo3D 的本地复刻（避免从 unified-render 引重依赖成环）：
 *  offset3D 优先；否则 2D 偏移按朝向 trig 映射（sx 沿视平面右向量）。 */
function socketOffsetPx(socket: Socket, dir: number): V3 {
  if (socket.offset3D) {
    return { x: subToPx(socket.offset3D.x), y: subToPx(socket.offset3D.y), z: subToPx(socket.offset3D.z) };
  }
  const off = (socket.directionOffsets as Record<number, { x: number; y: number } | undefined>)[dir] ?? socket.basePosition;
  const sx = subToPx(off.x);
  const sy = subToPx(off.y);
  const t = directionTrig((dir ?? 6) as never);
  return { x: sx * t.cos, y: sy, z: sx * t.sin };
}

type SegKind = 'socket3d' | 'socket2d' | 'fixed' | 'none';

interface SegInfo {
  /** 总静止偏移（px，世界轴）：socket/固定偏移 + 子节点 transform 偏移（y 吃 stretch），与 FK 合成同口径 */
  total: V3;
  kind: SegKind;
  socket?: Socket;
  /** transform 偏移分量（SubPixel 域，y 已乘 stretch）：反旋时保持不动、只转结构偏移 */
  tSub: V3;
}

/** 子节点相对父节点的总静止偏移（computeChildTransforms 的静止合成复刻）。 */
function segmentOffset(parent: Node, child: Node): SegInfo {
  const t = child.transform;
  const tSub: V3 = { x: t.x, y: t.y * (t.stretch ?? 1), z: t.z ?? 0 };
  const tPx: V3 = { x: subToPx(tSub.x), y: subToPx(tSub.y), z: subToPx(tSub.z) };
  if (child.attachment.type === 'socket' && child.attachment.parentSocketId) {
    const socket = parent.sockets.find((s) => s.id === child.attachment.parentSocketId);
    if (socket) {
      const s3 = socketOffsetPx(socket, parent.transform.variantIndex ?? 6);
      return {
        total: { x: s3.x + tPx.x, y: s3.y + tPx.y, z: s3.z + tPx.z },
        kind: socket.offset3D ? 'socket3d' : 'socket2d',
        socket,
        tSub,
      };
    }
    return { total: tPx, kind: 'none', tSub };
  }
  if (child.attachment.type === 'fixed') {
    const f = child.attachment.fixedOffset ?? { x: 0, y: 0 };
    return {
      total: { x: subToPx(f.x) + tPx.x, y: subToPx(f.y) + tPx.y, z: tPx.z },
      kind: 'fixed',
      tSub,
    };
  }
  return { total: tPx, kind: 'none', tSub };
}

const segLen = (o: V3): number => Math.hypot(o.x, o.y, o.z);

/** 合规判据：静止方向与水平面夹角 ≥ 30°（|O_y| ≥ 0.5·|O|）→ 全朝向 ρ 有底。 */
function isBadSeg(o: V3): boolean {
  const len = segLen(o);
  if (len < 1) return false; // <1px 无方向可言
  return Math.abs(o.y) < 0.5 * len;
}

// ---------- 冻结判据（承载不了帧增益的节点） ----------

const ANIM_MOD_TYPES = new Set([
  'pendulum', 'wheel', 'bounce', 'breath', 'wobble',
  'gait', 'custom_wave', 'float', 'shake', 'elastic', 'expression',
]);

function isFrozenNode(node: Node): boolean {
  if ((node.transform.tilt ?? 0) !== 0) return true;
  if ((node.tracks.tilt?.keyframes.length ?? 0) > 0) return true;
  if ((node.tracks.parentKeys?.keyframes.length ?? 0) > 0) return true;
  if (node.trajectory && node.trajectory.length > 0) return true;
  // 动画修改器会给 transform 叠加动态平移/旋转（平移使总偏移不再是静态量）
  if ((node.modifiers ?? []).some((m) => m.enabled && ANIM_MOD_TYPES.has(m.type))) return true;
  // 蓝图 transform 节点的 translate/tilt 同理（rotate 是纯角叠加、安全）
  const bp = (node as { blueprint?: { nodes?: Array<{ type?: string; params?: Record<string, unknown> }> } | null }).blueprint;
  if (bp?.nodes) {
    for (const bn of bp.nodes) {
      if (bn.type !== 'transform') continue;
      const p = bn.params ?? {};
      if (Number(p.translateX ?? 0) !== 0 || Number(p.translateY ?? 0) !== 0 || Number(p.translateZ ?? 0) !== 0 || Number(p.tilt ?? 0) !== 0) return true;
    }
  }
  return false;
}

// ---------- 帧增益求解（纯计算，不动数据） ----------

interface GainSolution {
  gains: Map<string, number>;   // 节点 id → 累积帧增益 Γ（90° 倍数，已归一到 (−180,180]）
  deltas: Map<string, number>;  // 节点 id → 自身角增量 δ
}

interface WalkConflict { atNode: string; gainRoot: string; gainRootDelta: number }

/**
 * 自顶向下给每个节点定 Γ：父帧增益 Γ 选自 {继承, 继承±90}，
 * 按「子段坏数 → 新坏数 → 是否动帧 → −90 优先」字典序取最优；
 * 增益非零时无法精确反旋的子节点（2D socket/无挂接且偏移非零）
 * 使候选作废；冻结节点遇非零继承增益 → 冲突（由调用方禁掉
 * 引入该增益的区域根 δ 后重算）。
 */
function solveGains(
  character: Character,
  banned: Set<string>,
): { sol: GainSolution } | { conflict: WalkConflict } {
  const nodes = character.nodes;
  const gains = new Map<string, number>();
  const deltas = new Map<string, number>();
  const segCache = new Map<string, SegInfo>();
  const segOf = (parent: Node, child: Node): SegInfo => {
    const k = `${parent.id}>${child.id}`;
    let v = segCache.get(k);
    if (!v) { v = segmentOffset(parent, child); segCache.set(k, v); }
    return v;
  };

  type Frame = { node: Node; inherited: number; gainRoot: string | null; gainRootDelta: number };
  const stack: Frame[] = [{ node: nodes[character.rootNodeId]!, inherited: 0, gainRoot: null, gainRootDelta: 0 }];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const { node, inherited, gainRoot, gainRootDelta } = stack.pop()!;
    if (!node || visited.has(node.id)) continue;
    visited.add(node.id);
    const frozen = isFrozenNode(node);
    if (frozen && normGain(inherited) !== 0) {
      return { conflict: { atNode: node.id, gainRoot: gainRoot!, gainRootDelta } };
    }
    // 候选 δ（冻结节点只能 0）
    const candDeltas = frozen ? [0] : [0, -90, 90].filter((d) => !banned.has(`${node.id}:${d}`));
    let best: { delta: number; gain: number; score: [number, number, number, number] } | null = null;
    let baselineBad: boolean[] | null = null;
    const scoreLess = (a: [number, number, number, number], b: [number, number, number, number]): boolean => {
      for (let i = 0; i < 4; i++) { if (a[i] !== b[i]) return a[i]! < b[i]!; }
      return false;
    };
    for (const delta of candDeltas) {
      const gain = inherited + delta;
      const gN = normGain(gain);
      const bads: boolean[] = [];
      let invalid = false;
      for (const childId of node.children) {
        const child = nodes[childId];
        if (!child) { bads.push(false); continue; }
        const seg = segOf(node, child);
        if (gN !== 0 && segLen(seg.total) > 0 && (seg.kind === 'socket2d' || seg.kind === 'none')) {
          invalid = true; // 该子偏移无法精确反旋，非零增益会破坏其位置恒等
          bads.push(isBadSeg(seg.total)); // 不可达状态，仅作打平参考
          continue;
        }
        const r = rotXY(seg.total.x, seg.total.y, -gain);
        bads.push(isBadSeg({ x: r.x, y: r.y, z: seg.total.z }));
      }
      if (delta === 0) baselineBad = bads;
      if (invalid) continue;
      const badCount = bads.filter(Boolean).length;
      const newlyBad = bads.filter((b, i) => b && !(baselineBad?.[i] ?? false)).length;
      const score: [number, number, number, number] = [
        badCount, newlyBad, delta === 0 ? 0 : 1, delta === 0 ? 0 : delta === -90 ? 1 : 2,
      ];
      if (!best || scoreLess(score, best.score)) best = { delta, gain, score };
    }
    if (!best) {
      // 全部候选作废：只可能因继承的非零增益穿不过本节点 → 冲突回退到区域根
      if (normGain(inherited) !== 0 && gainRoot) {
        return { conflict: { atNode: node.id, gainRoot, gainRootDelta } };
      }
      // 继承为零时 δ=0 恒有效，不应到此；兜底按 0 处理
      best = { delta: 0, gain: inherited, score: [0, 0, 0, 0] };
    }
    const myGainRoot = normGain(inherited) !== 0 ? gainRoot : best.delta !== 0 ? node.id : null;
    const myGainRootDelta = normGain(inherited) !== 0 ? gainRootDelta : best.delta;
    gains.set(node.id, normGain(best.gain));
    deltas.set(node.id, best.delta);
    // 子节点入栈（逆序保持 children 顺序处理，确定性）
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = nodes[node.children[i]!];
      if (!child) continue;
      const inh = child.attachment.inheritRotation === false ? 0 : best.gain;
      stack.push({
        node: child,
        inherited: inh,
        gainRoot: normGain(inh) !== 0 ? myGainRoot : null,
        gainRootDelta: myGainRootDelta,
      });
    }
  }
  // 孤儿节点（不在 root 可达集内）：按零继承处理（其段以父级实际增益为准，
  // 父不可达时增益无从复合——保持原样不纳入守卫）
  for (const node of Object.values(nodes)) {
    if (!visited.has(node.id)) { gains.set(node.id, 0); deltas.set(node.id, 0); }
  }
  return { sol: { gains, deltas } };
}

// ---------- 精灵 D4 反旋（位图/plug/高度图/地标/标记全量换算） ----------

function rotateMark(mark: SpriteMark, op: D4Op, w: number, h: number): SpriteMark {
  const dims = d4MapPoint(op, 0, 0, w, h);
  const mapPt = (nx: number, ny: number): { x: number; y: number } => {
    const p = d4MapPoint(op, nx * w, ny * h, w, h);
    return { x: p.x / dims.w, y: p.y / dims.h };
  };
  const lin = (dx: number, dy: number): { x: number; y: number } => {
    // D4 旋转的线性部分（作用于绝对量后按新尺寸归一）
    const ax = dx * w, ay = dy * h;
    const r = op === 'rot90' ? { x: -ay, y: ax } : op === 'rot270' ? { x: ay, y: -ax } : { x: -ax, y: -ay };
    return { x: r.x / dims.w, y: r.y / dims.h };
  };
  switch (mark.kind) {
    case 'point': {
      const p = mapPt(mark.x, mark.y);
      return { ...mark, x: p.x, y: p.y };
    }
    case 'vector': {
      const p = mapPt(mark.x, mark.y);
      const d = lin(mark.dx, mark.dy);
      return { ...mark, x: p.x, y: p.y, dx: d.x, dy: d.y };
    }
    case 'direction': {
      const add = op === 'rot90' ? 90 : op === 'rot180' ? 180 : 270;
      return { ...mark, angleDeg: (((mark.angleDeg + add) % 360) + 360) % 360 };
    }
    case 'region': {
      const r = mark.region;
      if (r.by === 'rect') {
        const a = mapPt(r.x, r.y);
        const b = mapPt(r.x + r.w, r.y + r.h);
        return {
          ...mark,
          region: {
            by: 'rect',
            x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
            w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
          },
        };
      }
      if (r.by === 'circle') {
        const c = mapPt(r.cx, r.cy);
        return { ...mark, region: { by: 'circle', cx: c.x, cy: c.y, r: r.r } };
      }
      if (r.by === 'painted') {
        const cells = cellsFromPaintedSpec(r, r.mask.w, r.mask.h);
        const grid: number[][] = [];
        for (let y = 0; y < r.mask.h; y++) grid.push(Array.from(cells.slice(y * r.mask.w, (y + 1) * r.mask.w)));
        const rotated = d4TransformGrid(grid, op, 0);
        const flat = new Uint8Array(rotated.length * (rotated[0]?.length ?? 0));
        rotated.forEach((row, y) => row.forEach((v, x) => { flat[y * row.length + x] = v; }));
        return { ...mark, region: paintedSpecFromCells(flat, rotated[0]?.length ?? 0, rotated.length) };
      }
      return mark; // color 选区与几何无关
    }
    default:
      return mark; // value 标记无几何
  }
}

/** 精灵整体 D4 旋转（与 store 的 transformSprite 同口径；纯函数、返回新对象）。 */
export function rotateSpriteD4(src: Sprite, op: D4Op): Sprite {
  const w = src.width;
  const h = src.height;
  const dims = d4MapPoint(op, 0, 0, w, h);
  const out: Sprite = {
    ...src,
    width: dims.w,
    height: dims.h,
    data: d4TransformGrid(src.data, op, null),
  };
  if (src.plug) {
    const p = d4MapPoint(op, subToPx(src.plug.x), subToPx(src.plug.y), w, h);
    out.plug = { x: pxToSub(p.x), y: pxToSub(p.y) };
  }
  if (src.heightmap) out.heightmap = d4TransformGrid(src.heightmap, op, 0);
  if (src.landmarks) out.landmarks = d4TransformLandmarks(src.landmarks, op, w, h);
  if (src.marks) out.marks = src.marks.map((m) => rotateMark(m, op, w, h));
  return out;
}

/** 帧增益 Γ → 精灵应反旋的 D4 操作（位图转 −Γ）。 */
function d4ForGain(gain: number): D4Op | null {
  const g = normGain(gain);
  if (g === 0) return null;
  if (g === 90) return 'rot270';
  if (g === -90) return 'rot90';
  return 'rot180'; // ±180
}

// ---------- 报告 ----------

export interface BoneAxisGuardReport {
  changed: boolean;
  /** 获得非零帧增益的节点 id */
  gainedNodes: string[];
  /** 修复的坏段（父节点 id → 子节点 id） */
  fixedSegments: Array<{ parentId: string; childId: string }>;
  /** 仍不合规的段及原因：'z-dominant' 视平面旋转修不了 /
   *  'sibling-tradeoff' 修它坏兄弟、计数打平未动 /
   *  'blocked-by-sibling' 父帧增益被不可反旋的兄弟段（2D socket 等）堵住 */
  unfixableSegments: Array<{ parentId: string; childId: string; reason: 'z-dominant' | 'sibling-tradeoff' | 'blocked-by-sibling' }>;
  /** 因冲突回退（区域根 δ 被禁）而放弃的区域根节点 id */
  conflictRoots: string[];
  /** 整角色中止原因（命中时数据保证原样未动） */
  aborted?: string;
}

const emptyReport = (): BoneAxisGuardReport => ({
  changed: false, gainedNodes: [], fixedSegments: [], unfixableSegments: [], conflictRoots: [],
});

// ---------- 主入口 ----------

/**
 * 对单个角色施加骨轴守卫（就地修改 character 与 sprites 表——
 * 与工程读入规范化的既有补挂同风格）。合规角色保证零改动
 * （changed=false 且数据逐字不变）。返回逐项报告。
 */
export function guardCharacterBoneAxes(
  character: Character,
  sprites: Record<string, Sprite>,
): BoneAxisGuardReport {
  const report = emptyReport();
  const nodes = character.nodes;
  if (!nodes || !nodes[character.rootNodeId]) return report;

  // ---- 增益求解（冲突 → 禁区域根 δ → 重算） ----
  const banned = new Set<string>();
  let sol: GainSolution | null = null;
  for (let attempt = 0; attempt < 1000; attempt++) {
    const r = solveGains(character, banned);
    if ('sol' in r) { sol = r.sol; break; }
    const key = `${r.conflict.gainRoot}:${r.conflict.gainRootDelta}`;
    if (banned.has(key) || r.conflict.gainRootDelta === 0) break; // 无可退 → 中止（下方按 sol=null 处理）
    banned.add(key);
    report.conflictRoots.push(r.conflict.gainRoot);
  }
  if (!sol) { report.aborted = 'gain-conflict-unresolvable'; return report; }

  const gained = Object.values(nodes).filter((n) => normGain(sol!.gains.get(n.id) ?? 0) !== 0);
  report.gainedNodes = gained.map((n) => n.id);

  // 守卫前后段合规对照（报告用；也决定是否需要动数据）
  const segBefore = new Map<string, boolean>();
  const segAfter = new Map<string, boolean>();
  for (const parent of Object.values(nodes)) {
    for (const childId of parent.children) {
      const child = nodes[childId];
      if (!child) continue;
      const seg = segmentOffset(parent, child);
      segBefore.set(`${parent.id}>${childId}`, isBadSeg(seg.total));
      const g = sol.gains.get(parent.id) ?? 0;
      const r = rotXY(seg.total.x, seg.total.y, -g);
      segAfter.set(`${parent.id}>${childId}`, isBadSeg({ x: r.x, y: r.y, z: seg.total.z }));
    }
  }
  for (const [k, bad] of segBefore) {
    const [parentId, childId] = k.split('>');
    if (bad && !segAfter.get(k)) report.fixedSegments.push({ parentId: parentId!, childId: childId! });
    else if (bad && segAfter.get(k)) {
      const parent = nodes[parentId!]!;
      const seg = segmentOffset(parent, nodes[childId!]!);
      const fixable = Math.abs(seg.total.x) >= 0.5 * segLen(seg.total);
      const blockedBySibling = parent.children.some((cid) => {
        const c = nodes[cid];
        if (!c) return false;
        const s = segmentOffset(parent, c);
        return segLen(s.total) > 0 && (s.kind === 'socket2d' || s.kind === 'none');
      });
      report.unfixableSegments.push({
        parentId: parentId!, childId: childId!,
        reason: !fixable ? 'z-dominant' : blockedBySibling ? 'blocked-by-sibling' : 'sibling-tradeoff',
      });
    }
  }
  if (gained.length === 0) return report; // 无帧增益 → 数据零改动（坏段仅点名）

  // ---- 中止预检（任一命中 → 整角色不动） ----
  const pieceKeyOf = (n: Node): string => n.slot?.slotKey ?? n.id;
  const piecesOf = (n: Node): CostumePiece[] => {
    const out: CostumePiece[] = [];
    if (n.slot) out.push(n.slot);
    for (const set of character.costumeSets ?? []) {
      const p = set.pieces[pieceKeyOf(n)];
      if (p && p !== n.slot) out.push(p);
    }
    return out;
  };
  for (const n of gained) {
    for (const p of piecesOf(n)) {
      if (p.stack) { report.aborted = `stack-piece:${n.id}`; return { ...emptyReport(), unfixableSegments: report.unfixableSegments, conflictRoots: report.conflictRoots, aborted: report.aborted }; }
      if (p.parametric) { report.aborted = `parametric-piece:${n.id}`; return { ...emptyReport(), unfixableSegments: report.unfixableSegments, conflictRoots: report.conflictRoots, aborted: report.aborted }; }
    }
  }
  if (Object.values(nodes).some((n) => n.attachment.skinningSnapshot)) {
    report.aborted = 'skinning-snapshot-present';
    return { ...emptyReport(), unfixableSegments: report.unfixableSegments, conflictRoots: report.conflictRoots, aborted: report.aborted };
  }
  // 引用精灵必须在表中可解析（否则无法反旋 → 中止）
  const refIds = new Set<string>();
  const collectRefs = (piece: CostumePiece) => {
    const maps: Array<Record<string, unknown>> = [
      piece.sprites as Record<string, unknown>,
      ...Object.values(piece.latitudeSprites ?? {}),
      ...Object.values(piece.variantSprites ?? {}),
      piece.scaleVariants as Record<string, unknown>,
    ];
    for (const m of maps) {
      for (const v of Object.values(m ?? {})) {
        if (v && typeof v === 'object') {
          const rec = v as Record<string, unknown>;
          if (typeof rec.spriteId === 'string' && !('data' in rec)) refIds.add(rec.spriteId);
          else if ('data' in rec) { /* 内嵌精灵、就地可转 */ }
          else {
            // scaleVariants 的值是「方向 → 精灵」二级表
            for (const v2 of Object.values(rec)) {
              const r2 = v2 as Record<string, unknown>;
              if (r2 && typeof r2.spriteId === 'string' && !('data' in r2)) refIds.add(r2.spriteId);
            }
          }
        }
      }
    }
  };
  for (const n of gained) for (const p of piecesOf(n)) collectRefs(p);
  for (const id of refIds) {
    if (!sprites[id]) {
      report.aborted = `missing-sprite:${id}`;
      return { ...emptyReport(), unfixableSegments: report.unfixableSegments, conflictRoots: report.conflictRoots, aborted: report.aborted };
    }
  }

  // ---- 施加 1：节点角（基础角 + angle 轨道全点平移 δ） ----
  for (const n of Object.values(nodes)) {
    const d = sol.deltas.get(n.id) ?? 0;
    if (d === 0) continue;
    n.transform.angle += d;
    const track = n.tracks.angle;
    if (track) for (const kf of track.keyframes) kf.value += d;
  }

  // ---- 施加 2：子节点偏移按 RD(−Γ父) 反旋（结构偏移承载，transform 分量不动） ----
  for (const parent of Object.values(nodes)) {
    const g = normGain(sol.gains.get(parent.id) ?? 0);
    if (g === 0) continue;
    for (const childId of parent.children) {
      const child = nodes[childId];
      if (!child) continue;
      const seg = segmentOffset(parent, child);
      if (segLen(seg.total) === 0) continue;
      if (seg.kind !== 'socket3d' && seg.kind !== 'fixed') continue; // socket2d/none 已被冲突回退排除到 Γ=0
      // 总偏移（SubPixel 域）= 结构偏移 + tSub；旋转总量后减回 tSub（tSub 是姿态分量、不动）
      const structuralSub: V3 = seg.kind === 'socket3d'
        ? { x: seg.socket!.offset3D!.x, y: seg.socket!.offset3D!.y, z: seg.socket!.offset3D!.z }
        : { x: (child.attachment.fixedOffset ?? { x: 0, y: 0 }).x, y: (child.attachment.fixedOffset ?? { x: 0, y: 0 }).y, z: 0 };
      const totalSub: V3 = {
        x: structuralSub.x + seg.tSub.x,
        y: structuralSub.y + seg.tSub.y,
        z: structuralSub.z + seg.tSub.z,
      };
      const r = rotXY(totalSub.x, totalSub.y, -g);
      if (seg.kind === 'socket3d') {
        seg.socket!.offset3D = { x: r.x - seg.tSub.x, y: r.y - seg.tSub.y, z: structuralSub.z };
      } else {
        child.attachment.fixedOffset = { x: r.x - seg.tSub.x, y: r.y - seg.tSub.y };
      }
    }
  }

  // ---- 施加 3：精灵 D4 反旋（帧增益节点的绘制恒等） ----
  const rotatedByOp = new Map<string, string>(); // `${spriteId}|${op}` → 新 id
  const rotatedCopyId = (spriteId: string, op: D4Op): string => {
    const key = `${spriteId}|${op}`;
    const hit = rotatedByOp.get(key);
    if (hit) return hit;
    const src = sprites[spriteId]!;
    let newId = `${spriteId}__axg_${op}`;
    if (sprites[newId] && sprites[newId] !== src) {
      let k = 2;
      while (sprites[`${newId}_${k}`]) k++;
      newId = `${newId}_${k}`;
    }
    const copy = rotateSpriteD4(src, op);
    copy.id = newId;
    copy.name = `${src.name ?? spriteId}·轴守卫`;
    delete copy.origin;
    delete copy.folder;
    sprites[newId] = copy;
    rotatedByOp.set(key, newId);
    return newId;
  };
  const embeddedCache = new Map<Sprite, Sprite>();
  const rotateValue = (v: Sprite | { spriteId: string }, op: D4Op): Sprite | { spriteId: string } => {
    const rec = v as unknown as Record<string, unknown>;
    if (typeof rec.spriteId === 'string' && !('data' in rec)) {
      return { spriteId: rotatedCopyId(rec.spriteId, op) };
    }
    const spr = v as Sprite;
    let out = embeddedCache.get(spr);
    if (!out) { out = rotateSpriteD4(spr, op); embeddedCache.set(spr, out); }
    return out;
  };
  const rotatePieceMaps = (piece: CostumePiece, op: D4Op) => {
    const spinMap = (m: Record<string, Sprite | { spriteId: string }>) => {
      for (const k of Object.keys(m)) m[k] = rotateValue(m[k]!, op) as never;
    };
    spinMap(piece.sprites as Record<string, Sprite | { spriteId: string }>);
    for (const m of Object.values(piece.latitudeSprites ?? {})) spinMap(m as Record<string, Sprite | { spriteId: string }>);
    for (const m of Object.values(piece.variantSprites ?? {})) spinMap(m as Record<string, Sprite | { spriteId: string }>);
    for (const m of Object.values(piece.scaleVariants ?? {})) spinMap(m as unknown as Record<string, Sprite | { spriteId: string }>);
  };
  for (const n of gained) {
    const op = d4ForGain(sol.gains.get(n.id) ?? 0)!;
    if (n.sprite) {
      let out = embeddedCache.get(n.sprite);
      if (!out) { out = rotateSpriteD4(n.sprite, op); embeddedCache.set(n.sprite, out); }
      n.sprite = out;
    }
    for (const p of piecesOf(n)) rotatePieceMaps(p, op);
    // attachment.plug 是精灵图空间内的偏移向量，随位图同旋（线性部分）
    if (n.attachment.plug) {
      const lin = op === 'rot90' ? { x: -n.attachment.plug.y, y: n.attachment.plug.x }
        : op === 'rot270' ? { x: n.attachment.plug.y, y: -n.attachment.plug.x }
        : { x: -n.attachment.plug.x, y: -n.attachment.plug.y };
      n.attachment.plug = lin;
    }
  }

  report.changed = true;
  return report;
}

/** 工程级入口（读入规范化/快照共用）：逐角色守卫，返回是否任一角色被改。 */
export function guardProjectBoneAxes(
  characters: Record<string, Character>,
  sprites: Record<string, Sprite>,
): { changed: boolean; reports: Record<string, BoneAxisGuardReport> } {
  const reports: Record<string, BoneAxisGuardReport> = {};
  let changed = false;
  for (const [cid, ch] of Object.entries(characters ?? {})) {
    if (!ch?.nodes) continue;
    const r = guardCharacterBoneAxes(ch, sprites);
    reports[cid] = r;
    if (r.changed) changed = true;
  }
  return { changed, reports };
}
