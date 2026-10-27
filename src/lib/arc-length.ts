// 弧长小工具（借 PoseSketcher utils 的写法与边界处理）：沿折线弧长
// 取点（超尾沿末段方向外推）、按弧长比例/距离切链、折线总长。
// 纯函数、无依赖；笔触建角/草图捕姿与人偶衣物色区共用。

export interface Pt {
  x: number;
  y: number;
}

/** 折线总长 */
export function polylineLength(points: readonly Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return total;
}

/**
 * 沿折线在弧长 d 处取点。d < 0 取首点；d 超总长时沿末段方向外推
 * （对方 getPointAtDistance 的边界口径）。同时返回该点处段方向角。
 */
export function pointAtDistance(
  points: readonly Pt[],
  d: number,
): { x: number; y: number; angle: number } {
  if (points.length === 0) return { x: 0, y: 0, angle: 0 };
  if (points.length === 1) return { x: points[0]!.x, y: points[0]!.y, angle: 0 };
  let rest = d;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    if (rest <= seg) {
      const t = seg > 0 ? Math.max(0, rest / seg) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle };
    }
    rest -= seg;
  }
  // 超尾外推：末段方向延长 rest
  const a = points[points.length - 2]!, b = points[points.length - 1]!;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  return { x: b.x + Math.cos(angle) * rest, y: b.y + Math.sin(angle) * rest, angle };
}

/** 按总长比例取点（ratio 钳 0..1） */
export function pointAtRatio(points: readonly Pt[], ratio: number): { x: number; y: number; angle: number } {
  const r = Math.min(1, Math.max(0, ratio));
  return pointAtDistance(points, polylineLength(points) * r);
}

/**
 * 在弧长 d 处切链 → [前段, 后段]，切点同时是前段尾与后段头（新点对象）。
 * d ≤ 0 → 前段只有首点；d ≥ 总长 → 后段只有尾点。
 */
export function splitChainAtDistance(points: readonly Pt[], d: number): [Pt[], Pt[]] {
  if (points.length < 2) return [[...points], [...points]];
  const cut = pointAtDistance(points, Math.min(Math.max(0, d), polylineLength(points)));
  const head: Pt[] = [];
  const tail: Pt[] = [{ x: cut.x, y: cut.y }];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + seg < d) {
      head.push({ x: a.x, y: a.y });
      acc += seg;
      if (i === points.length - 1) head.push({ x: b.x, y: b.y });
    } else {
      head.push({ x: a.x, y: a.y });
      if (Math.hypot(cut.x - a.x, cut.y - a.y) > 1e-9) head.push({ x: cut.x, y: cut.y });
      for (let j = i; j < points.length; j++) {
        const p = points[j]!;
        if (j === i && Math.hypot(cut.x - p.x, cut.y - p.y) <= 1e-9) continue; // 切点恰落顶点，不重复
        tail.push({ x: p.x, y: p.y });
      }
      return [head, tail];
    }
  }
  return [head.length > 0 ? head : [{ ...points[0]! }], tail];
}

/** 按总长比例切链 */
export function splitChainAtRatio(points: readonly Pt[], ratio: number): [Pt[], Pt[]] {
  const r = Math.min(1, Math.max(0, ratio));
  return splitChainAtDistance(points, polylineLength(points) * r);
}
