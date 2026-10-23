// ============================================================
// 遮罩防溢出：笔画栅栏模型——一支笔画不得越过防溢出线。
//
// 模型沿革（前两版为什么都不对）：
// v1 逐像素射线：笔刷中心向候选像素拉 1px 抽样射线——中心快拖跳线、
//    斜线角缝斜穿、终点不查，三处漏。
// v2 全局洪泛：落笔种子对整图洪泛定区域——只对闭合/抵边的线有效；
//    用户画的线是单条开放线段（起点终点都在图内），洪泛从两端绕过去，
//    区域等于全图，栅栏形同虚设。（用户纠正：「线本身的起点和终点会被
//    绕过去」）
// v3（现行）笔画盘内洪泛：线是栅栏不是隔断墙。每个盖章点只涂「笔尖圆盘
//    内、与上一盖章中心 4 连通」的像素（墙=线像素）；相邻盖章中心间再做
//    越墙截断检查（中心轨迹采样压到墙即本章不涂、锚点不越墙）。
//    - 开放线段在笔尖附近就是有效的墙：圆盘被线切开，只涂锚点一侧；
//    - 角接阶梯墙（8 连通）对 4 连通洪泛数学密封，斜穿不存在；
//    - 贴墙像素全可涂（线在边界外、不留余量时精灵最外圈不丢）；
//    - 绕线端：必须把笔真的从线端外侧绕过去（经过开放空间），与栅栏的
//      物理直觉一致；抬笔在对侧落笔 = 明确的新笔画，不受上一支约束。
// ============================================================

/** 从 RGBA ImageData 抽出 alpha 平面（防溢出线画布的读取口径） */
export function alphaPlaneFromImageData(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    alpha[i] = data[i * 4 + 3]!;
  }
  return alpha;
}

/**
 * 中心轨迹 (x0,y0)→(x1,y1) 是否压到墙：沿线段以 ≤0.5px 步长采样，
 * 每点查其 2×2 邻域（角点擦过也算压到——防中心从阶梯墙的角缝里挤过去）。
 */
export function segmentCrossesWall(
  alpha: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  x0: number, y0: number,
  x1: number, y1: number,
  threshold: number = 10,
): boolean {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist / 0.5));
  for (let i = 0; i <= steps; i++) {
    const px = Math.floor(x0 + ((x1 - x0) * i) / steps);
    const py = Math.floor(y0 + ((y1 - y0) * i) / steps);
    for (let oy = 0; oy <= 1; oy++) {
      for (let ox = 0; ox <= 1; ox++) {
        const qx = px + ox;
        const qy = py + oy;
        if (qx < 0 || qy < 0 || qx >= width || qy >= height) continue;
        if (alpha[qy * width + qx]! > threshold) return true;
      }
    }
  }
  return false;
}

/**
 * 一个盖章点可涂的像素集合（绝对索引 y*width+x）：
 * 笔尖圆盘内（(px-cx)²+(py-cy)² ≤ r²，与画布填充同一口径）、非墙、
 * 且与锚点 4 连通的连通分量。锚点通常是上一盖章中心——它保证本章的
 * 涂料与笔画已涂部分同侧；锚点不在盘内或落在墙上时回退圆心，
 * 圆心也在墙上则本章无可涂像素（空数组）。
 */
export function computeDiskPaintSet(
  alpha: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  anchorX: number,
  anchorY: number,
  threshold: number = 10,
): number[] {
  const r2 = radius * radius;
  const inDisk = (px: number, py: number) => {
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy <= r2;
  };
  const isWall = (px: number, py: number) => alpha[py * width + px]! > threshold;

  let sx = anchorX;
  let sy = anchorY;
  if (sx < 0 || sy < 0 || sx >= width || sy >= height || !inDisk(sx, sy) || isWall(sx, sy)) {
    sx = cx;
    sy = cy;
  }
  if (sx < 0 || sy < 0 || sx >= width || sy >= height || isWall(sx, sy)) return [];

  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(height - 1, Math.ceil(cy + radius));
  const visited = new Uint8Array(width * height);
  const start = sy * width + sx;
  const stack: number[] = [start];
  visited[start] = 1;
  const out: number[] = [];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    out.push(cur);
    const px = cur % width;
    const py = (cur / width) | 0;
    const tryPush = (nx: number, ny: number) => {
      if (nx < x0 || nx > x1 || ny < y0 || ny > y1) return;
      const n = ny * width + nx;
      if (visited[n] || !inDisk(nx, ny) || isWall(nx, ny)) return;
      visited[n] = 1;
      stack.push(n);
    };
    tryPush(px - 1, py);
    tryPush(px + 1, py);
    tryPush(px, py - 1);
    tryPush(px, py + 1);
  }
  return out;
}
