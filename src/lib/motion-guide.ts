/**
 * 节点轨迹制导生成（运动层）——pixelfx 制导类（homing-missile /
 * arcane-missiles 缎带绕行）分流落点：制导在创作期求解，产物是普通
 * 节点轨迹（node.trajectory），运行时按既有轨迹插值播放，运行时零改动。
 *
 * 链路口径（与手绘轨迹工具同一条链，不新造格式）：
 * - 求解在画布像素空间进行（起点 = 被制导节点当前帧枢轴画布位，
 *   目标 = 目标节点锚点画布位：插头即枢轴、标记点走 clampPixelWorld
 *   同源的「点 − plug → 镜像翻 x → worldFrame 旋转 → 投影」口径）；
 * - 画布点列 → 轨迹点的换算与手绘工具完全一致（bakeCanvasPointsToTrajectory：
 *   画布增量逆父级世界角旋转 → pxToSub + 基准帧插值 x/y），手绘 handler
 *   与本生成器共用这一份换算；
 * - 写入走既有入口：pushUndo + updateUnifiedNode({ trajectory })。
 *
 * 求解器是纯函数：逐帧转向制导（朝向朝目标转、转率钳制）积分，
 * 无随机、同输入同输出。到达的判定是「距目标 ≤ 一步且转入该步的
 * 转角不超限」——满足才落点到目标并停留；帧预算内到不了则返回
 * 明确错误（不可达不静默烘焙一条到不了的轨迹）。
 *
 * 末段步速整形：恒速纯追踪在目标附近会进轨道回环（转弯半径大于
 * 捕获步长时永远凑不齐捕获条件）。进入末段（距目标 < 1.2 倍全速
 * 转弯半径，下限 2 步长）后，步速按转后朝向误差的余弦缩放（下限
 * 12%）：误差大时减速、转弯半径同比缩小，朝向得以在小步幅下先对
 * 准再全速直进捕获。末段之外恒全速；误差为 0 时系数恒 1——直线
 * 目标退化为恒速直线。默认步速按 (距离 + 0.6×转弯半径×初始误差
 * 弧度)/(总帧数−1) 推导（且不低于距离×1.3 口径）：大转弯的实际
 * 路径比直线距离长，余量覆盖这部分。
 */

import type { Character, DirectionIndex, Node, Sprite } from './unified-types';
import { applyFrameRotation, projectToView, pxToSub, subToPx } from './unified-types';
import { computeWorldTransforms, resolveNodeSpriteId } from './unified-render';
import { interpolateNodeKeyframes } from './engine/render-helpers/puppet-keyframe-interpolation';
import { markPointPx } from './sprite-marks';

// ---------------------------------------------------------------------------
// 角度工具（画布口径：0° = +x 右，顺时针为正——屏幕 y 向下，
// 与精灵标记方向「0=东顺时针 90=南」同口径）
// ---------------------------------------------------------------------------

export function wrapAngleDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function bearingDeg(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

/** 从 current 朝 desired 转，单步转角钳制在 maxStep 内 */
export function turnTowardDeg(current: number, desired: number, maxStep: number): number {
  const delta = wrapAngleDeg(desired - current);
  if (Math.abs(delta) <= maxStep) return desired;
  return current + Math.sign(delta) * maxStep;
}

function dirFromDeg(deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: Math.cos(rad), y: Math.sin(rad) };
}

// ---------------------------------------------------------------------------
// 制导求解器（纯函数，画布像素空间）
// ---------------------------------------------------------------------------

export interface GuidancePathInput {
  start: { x: number; y: number };
  target: { x: number; y: number };
  /** 轨迹总点数（帧数），≥ 2 */
  totalFrames: number;
  /** 转向率上限（度/帧），> 0 */
  maxTurnDegPerFrame: number;
  /** 初速方向（度，画布口径） */
  initialDirDeg: number;
  /** 步速（px/帧）；缺省按距离/(总帧数−1)×1.3 推导（留转向余量） */
  speedPxPerFrame?: number;
  /** 缎带扭转：侧偏正弦幅值（px），缺省 0 = 无侧偏 */
  twistAmpPx?: number;
  /** 缎带扭转：全程正弦圈数，缺省 1 */
  twistCycles?: number;
}

export interface GuidancePath {
  /** 画布点列，长度 = totalFrames；points[0] = start，到达后末点 = target */
  points: { x: number; y: number }[];
  /** 每点的出发朝向（度）；末点 = 最后一段朝向，到达后保持不变 */
  headingsDeg: number[];
  /** 首次到达目标的点索引（0 = 起点即目标） */
  arrivalFrame: number;
  /** 实际步速（px/帧） */
  speedPxPerFrame: number;
}

export type GuidanceSolveResult =
  | { ok: true; path: GuidancePath }
  | { ok: false; error: string };

export function solveGuidancePath(input: GuidancePathInput): GuidanceSolveResult {
  const { start, target, totalFrames, maxTurnDegPerFrame } = input;
  if (!Number.isFinite(start.x) || !Number.isFinite(start.y) || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
    return { ok: false, error: '起点或目标坐标无效' };
  }
  if (!Number.isInteger(totalFrames) || totalFrames < 2) {
    return { ok: false, error: '总帧数至少为 2' };
  }
  if (!Number.isFinite(maxTurnDegPerFrame) || maxTurnDegPerFrame <= 0) {
    return { ok: false, error: '转向率必须大于 0（度/帧）' };
  }
  if (!Number.isFinite(input.initialDirDeg)) {
    return { ok: false, error: '初速方向无效' };
  }
  const twistAmp = input.twistAmpPx ?? 0;
  if (!Number.isFinite(twistAmp) || twistAmp < 0) {
    return { ok: false, error: '扭转幅值不能为负' };
  }
  const twistCycles = input.twistCycles ?? 1;
  if (!Number.isFinite(twistCycles) || twistCycles < 0) {
    return { ok: false, error: '扭转圈数不能为负' };
  }
  if (input.speedPxPerFrame !== undefined && (!Number.isFinite(input.speedPxPerFrame) || input.speedPxPerFrame <= 0)) {
    return { ok: false, error: '步速必须大于 0（px/帧）' };
  }

  const dist0 = Math.hypot(target.x - start.x, target.y - start.y);
  let speed: number;
  if (input.speedPxPerFrame !== undefined) {
    speed = input.speedPxPerFrame;
  } else {
    // 默认步速：先按距离×1.3 估转弯半径，再把初始转向弧长折进路程
    const omegaRad = (maxTurnDegPerFrame * Math.PI) / 180;
    const v0 = Math.max(0.5, (dist0 / (totalFrames - 1)) * 1.3);
    const err0Rad = Math.abs((wrapAngleDeg(bearingDeg(start, target) - input.initialDirDeg) * Math.PI) / 180);
    const arcAllowance = 0.6 * (v0 / omegaRad) * err0Rad;
    speed = Math.max(v0, (dist0 + arcAllowance) / (totalFrames - 1));
  }
  // 全速转弯半径与末段整形区（见文件头说明）
  const turnRadiusPx = speed / ((maxTurnDegPerFrame * Math.PI) / 180);
  const terminalZonePx = Math.max(1.2 * turnRadiusPx, 2 * speed);

  const points: { x: number; y: number }[] = [{ x: start.x, y: start.y }];
  const headings: number[] = [];
  let heading = input.initialDirDeg;

  // 起点即目标：整条轨迹停留在起点
  if (dist0 < 0.5) {
    for (let i = 1; i < totalFrames; i++) points.push({ x: start.x, y: start.y });
    for (let i = 0; i < totalFrames; i++) headings.push(heading);
    return { ok: true, path: { points, headingsDeg: headings, arrivalFrame: 0, speedPxPerFrame: speed } };
  }

  let pos = { x: start.x, y: start.y };
  let arrivalFrame = -1;
  for (let i = 1; i < totalFrames; i++) {
    if (arrivalFrame >= 0) {
      points.push({ x: target.x, y: target.y });
      headings.push(heading);
      continue;
    }
    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    const d = Math.hypot(dx, dy);
    const bearing = (Math.atan2(dy, dx) * 180) / Math.PI;
    // 到达判定：一步可达且转入这一方向不超限 → 精确落点
    if (d <= speed + 1e-9 && Math.abs(wrapAngleDeg(bearing - heading)) <= maxTurnDegPerFrame + 1e-9) {
      heading = bearing;
      pos = { x: target.x, y: target.y };
      arrivalFrame = i;
      points.push({ ...pos });
      headings.push(heading);
      continue;
    }
    heading = turnTowardDeg(heading, bearing, maxTurnDegPerFrame);
    // 末段步速整形：区外恒全速；区内按转后误差余弦缩放（下限 12%）
    let stepSpeed = speed;
    if (d < terminalZonePx) {
      const errAfter = Math.abs(wrapAngleDeg(bearing - heading));
      stepSpeed = speed * Math.max(0.12, Math.cos((errAfter * Math.PI) / 180));
    }
    const dir = dirFromDeg(heading);
    pos = { x: pos.x + dir.x * stepSpeed, y: pos.y + dir.y * stepSpeed };
    points.push({ ...pos });
    headings.push(heading);
  }
  // 循环里 headings[k] 记录的是「到达点 k+1 时所用的朝向」；换算成
  // 「点 i 的出发朝向」：点 i 的出发朝向 = headings[i]，末点取最后一步朝向
  const finalHeadings = points.map((_, i) => headings[Math.min(i, headings.length - 1)]!);

  if (arrivalFrame < 0) {
    const last = points[points.length - 1]!;
    const remain = Math.hypot(target.x - last.x, target.y - last.y);
    if (remain <= 1) {
      // 差 ≤1px：末点吸附到目标（朝向不变，吸附量在容差内）
      points[points.length - 1] = { x: target.x, y: target.y };
      arrivalFrame = totalFrames - 1;
    } else {
      return {
        ok: false,
        error: `在 ${totalFrames} 帧、转向 ${maxTurnDegPerFrame}°/帧内无法到达目标（还差 ${remain.toFixed(1)}px）：请增大总帧数或转向率`,
      };
    }
  }

  // 缎带扭转：侧偏 = 幅值 × sin(π·p) 包络 × sin(2π·圈数·p)，
  // p 取飞行段内进度（到达点为界），包络在起点与到达点均为 0，
  // 到达点及其后（停留点）不偏移——到达精度与停留稳定不受扭转影响。
  if (twistAmp > 0 && arrivalFrame > 1) {
    const A = arrivalFrame;
    for (let i = 1; i < A; i++) {
      const p = i / A;
      const lat = twistAmp * Math.sin(Math.PI * p) * Math.sin(2 * Math.PI * twistCycles * p);
      if (lat === 0) continue;
      const h = finalHeadings[i]!;
      const rad = (h * Math.PI) / 180;
      // 侧向 = 朝向逆时针 90° 的垂直向（y 向下口径：(-sin, cos)）
      points[i] = {
        x: points[i]!.x + lat * -Math.sin(rad),
        y: points[i]!.y + lat * Math.cos(rad),
      };
    }
  }

  return { ok: true, path: { points, headingsDeg: finalHeadings, arrivalFrame, speedPxPerFrame: speed } };
}

// ---------------------------------------------------------------------------
// 画布点列 → 节点轨迹烘焙（与手绘轨迹工具同一份换算，手绘 handler 共用）
// ---------------------------------------------------------------------------

export interface TrajectoryBakeBasis {
  /** 基准帧被制导节点的父级局部 x（SubPixel，插值口径） */
  baseX: number;
  /** 基准帧被制导节点的父级局部 y（SubPixel，插值口径） */
  baseY: number;
  /** 基准帧被制导节点枢轴的画布位（px） */
  baseWorld: { x: number; y: number };
  /** 父级世界角（度） */
  parentWorldAngleDeg: number;
}

/**
 * 画布点列 → node.trajectory 点列（{frame, x, y}，父级局部 SubPixel）。
 * frames 缺省为点索引（0..n-1）；手绘工具按其采样口径显式传帧号。
 */
export function bakeCanvasPointsToTrajectory(
  canvasPoints: { x: number; y: number }[],
  basis: TrajectoryBakeBasis,
  frames?: number[],
): { frame: number; x: number; y: number }[] {
  const angleRad = (basis.parentWorldAngleDeg * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  return canvasPoints.map((pt, i) => {
    const ddx = pt.x - basis.baseWorld.x;
    const ddy = pt.y - basis.baseWorld.y;
    const localDx = ddx * cosA + ddy * sinA;
    const localDy = -ddx * sinA + ddy * cosA;
    return {
      frame: frames ? frames[i]! : i,
      x: Math.round(basis.baseX + pxToSub(localDx)),
      y: Math.round(basis.baseY + pxToSub(localDy)),
    };
  });
}

// ---------------------------------------------------------------------------
// 基准与锚点解析（画布像素口径，与主渲染/手绘工具同源）
// ---------------------------------------------------------------------------

export interface GuideEnv {
  /** 基准帧（取当前帧位姿为基准，与手绘工具同口径） */
  frame: number;
  canvasWidth: number;
  canvasHeight: number;
  /** 全局精灵表（缺省用 character.sprites） */
  sprites?: Record<string, Sprite>;
  /** 几何朝向覆盖（编辑器 nodeTurn3D 开关口径，与 computePivotWorldPosition 同参） */
  geometryDirection?: DirectionIndex;
}

export type GuideAnchor =
  | { kind: 'plug' }
  | { kind: 'mark'; name: string };

type PointResult = { ok: true; point: { x: number; y: number } } | { ok: false; error: string };

function guideTransforms(character: Character, env: GuideEnv) {
  return computeWorldTransforms(
    character, env.frame, env.canvasWidth, env.canvasHeight,
    undefined, undefined, undefined, undefined, env.geometryDirection,
  );
}

function pivotFromTransforms(
  character: Character,
  transforms: Map<string, import('./unified-render').WorldTransform>,
  nodeId: string,
  env: GuideEnv,
): { x: number; y: number } | null {
  const wt = transforms.get(nodeId);
  if (!wt) return null;
  const rootNode = character.nodes[character.rootNodeId];
  const currentDirection = (rootNode?.transform.variantIndex ?? 0) as DirectionIndex;
  const proj = projectToView(wt.worldX, wt.worldY, wt.worldZ, currentDirection);
  return {
    x: subToPx(proj.canvasX + pxToSub(env.canvasWidth / 2)),
    y: subToPx(proj.canvasY + pxToSub(env.canvasHeight / 2)),
  };
}

/** 节点枢轴画布位（与 use-canvas-state 的 computePivotWorldPosition 同口径） */
export function nodePivotCanvasPx(character: Character, nodeId: string, env: GuideEnv): { x: number; y: number } | null {
  return pivotFromTransforms(character, guideTransforms(character, env), nodeId, env);
}

/**
 * 目标锚点画布位：
 * - plug：节点枢轴本身（精灵插头落点即枢轴）；
 * - mark：目标节点当前精灵上的点标记——走 clampPixelWorld 同源口径
 *   （标记像素 − plug → 镜像翻 x → worldFrame 旋转 → 投影增量 + 枢轴）。
 */
export function nodeAnchorCanvasPx(
  character: Character,
  nodeId: string,
  anchor: GuideAnchor,
  env: GuideEnv,
): PointResult {
  const transforms = guideTransforms(character, env);
  const pivot = pivotFromTransforms(character, transforms, nodeId, env);
  if (!pivot) return { ok: false, error: '无法解析目标节点的位置' };
  if (anchor.kind === 'plug') return { ok: true, point: pivot };

  const wt = transforms.get(nodeId);
  if (!wt) return { ok: false, error: '无法解析目标节点的位置' };
  const dir = (wt.variantIndex ?? 0) as DirectionIndex;
  const spriteId = resolveNodeSpriteId(character, nodeId, dir, env.sprites);
  const table = env.sprites ?? (character.sprites as Record<string, Sprite> | undefined);
  const sprite = spriteId ? table?.[spriteId] : undefined;
  if (!sprite) return { ok: false, error: '目标节点当前没有精灵，无法取标记点' };
  const mp = markPointPx(sprite, anchor.name);
  if (!mp) return { ok: false, error: `目标精灵上没有点标记「${anchor.name}」` };
  const plugPx = sprite.plug ? subToPx(sprite.plug.x) : sprite.width / 2;
  const plugPy = sprite.plug ? subToPx(sprite.plug.y) : sprite.height / 2;
  let lx = mp.x - plugPx;
  const ly = mp.y - plugPy;
  if (wt.mirror) lx = -lx;
  const r = applyFrameRotation(wt.worldFrame, lx, ly, 0, dir);
  const rootNode = character.nodes[character.rootNodeId];
  const currentDirection = (rootNode?.transform.variantIndex ?? 0) as DirectionIndex;
  const dProj = projectToView(pxToSub(r.x), pxToSub(r.y), pxToSub(r.z), currentDirection);
  return {
    ok: true,
    point: { x: pivot.x + subToPx(dProj.canvasX), y: pivot.y + subToPx(dProj.canvasY) },
  };
}

/** 父级世界角（度，从根累加当前帧插值角度，与手绘工具 computeNodeWorldAngle 同算法） */
export function parentWorldAngleDeg(character: Character, parentId: string, frame: number): number {
  const ivMap = interpolateNodeKeyframes(character, frame);
  const chain: string[] = [];
  let cur: string | undefined = parentId;
  while (cur) {
    chain.unshift(cur);
    cur = character.nodes[cur]?.parentId ?? undefined;
  }
  let angle = 0;
  for (const id of chain) {
    const n = character.nodes[id];
    angle += ivMap.get(id)?.angle ?? n?.transform.angle ?? 0;
  }
  return angle;
}

// ---------------------------------------------------------------------------
// 主入口：校验 → 解析起终点 → 求解 → 烘焙（不写 store，写入由调用方走
// pushUndo + updateUnifiedNode，与手绘工具同一纪律）
// ---------------------------------------------------------------------------

export interface GenerateGuidedTrajectoryInput {
  character: Character;
  /** 被制导节点 id */
  nodeId: string;
  /** 目标节点 id（须与被制导节点同角色、且不是自身） */
  targetNodeId: string;
  anchor: GuideAnchor;
  totalFrames: number;
  maxTurnDegPerFrame: number;
  /** 初速方向（度）；缺省 = 起点→目标的方位角 */
  initialDirDeg?: number;
  speedPxPerFrame?: number;
  twistAmpPx?: number;
  twistCycles?: number;
  env: GuideEnv;
}

export type GenerateGuidedTrajectoryResult =
  | {
      ok: true;
      trajectory: { frame: number; x: number; y: number }[];
      start: { x: number; y: number };
      target: { x: number; y: number };
      arrivalFrame: number;
      speedPxPerFrame: number;
    }
  | { ok: false; error: string };

export function generateGuidedTrajectory(input: GenerateGuidedTrajectoryInput): GenerateGuidedTrajectoryResult {
  const { character, nodeId, targetNodeId, anchor, env } = input;
  const node: Node | undefined = character.nodes[nodeId];
  if (!node) return { ok: false, error: '被制导节点不存在' };
  if (!character.nodes[targetNodeId]) return { ok: false, error: '目标节点不存在' };
  if (nodeId === targetNodeId) return { ok: false, error: '目标不能是节点自身' };
  if (!Number.isInteger(input.totalFrames) || input.totalFrames < 2) {
    return { ok: false, error: '总帧数至少为 2' };
  }
  if (!Number.isFinite(input.maxTurnDegPerFrame) || input.maxTurnDegPerFrame <= 0) {
    return { ok: false, error: '转向率必须大于 0（度/帧）' };
  }

  const start = nodePivotCanvasPx(character, nodeId, env);
  if (!start) return { ok: false, error: '无法解析被制导节点的当前位置' };
  const targetRes = nodeAnchorCanvasPx(character, targetNodeId, anchor, env);
  if (!targetRes.ok) return targetRes;
  const target = targetRes.point;

  const solved = solveGuidancePath({
    start,
    target,
    totalFrames: input.totalFrames,
    maxTurnDegPerFrame: input.maxTurnDegPerFrame,
    initialDirDeg: input.initialDirDeg ?? bearingDeg(start, target),
    speedPxPerFrame: input.speedPxPerFrame,
    twistAmpPx: input.twistAmpPx,
    twistCycles: input.twistCycles,
  });
  if (!solved.ok) return solved;

  // 烘焙基准（与手绘工具同口径：基准帧插值 x/y + 枢轴画布位 + 父级世界角）
  const ivMap = interpolateNodeKeyframes(character, env.frame);
  const iv = ivMap.get(nodeId);
  const baseX = iv?.x ?? node.transform.x;
  const baseY = iv?.y ?? node.transform.y;
  const parentAngle = node.parentId && character.nodes[node.parentId]
    ? parentWorldAngleDeg(character, node.parentId, env.frame)
    : 0;
  const trajectory = bakeCanvasPointsToTrajectory(solved.path.points, {
    baseX,
    baseY,
    baseWorld: start,
    parentWorldAngleDeg: parentAngle,
  });
  return {
    ok: true,
    trajectory,
    start,
    target,
    arrivalFrame: solved.path.arrivalFrame,
    speedPxPerFrame: solved.path.speedPxPerFrame,
  };
}
