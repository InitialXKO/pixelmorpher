// ============================================================
// 遮罩防溢出区域：以笔画起点对防溢出线做 4 连通洪泛，得到本笔画可涂区域。
//
// 旧实现是「笔刷中心向每个候选像素拉 1px 抽样射线」，三处漏：
// ① 笔刷中心快拖时直接落到线外侧，射线全程在外侧、不穿线，整团漏出；
// ② 斜线是角点相接的阶梯（8 连通墙），取整抽样的射线能从角缝斜穿；
// ③ 射线终点不查，贴线判定系统性松动。
// 数字拓扑的固定配对：区域 4 连通 ↔ 墙 8 连通即密封——4 连通洪泛要穿过
// 角接墙必须踩线像素本身。因此线维持 1px 原画法即可，判定模型换洪泛。
// 区域只约束单支笔画（种子 = 落笔点）：落笔在哪侧，本笔画就只能涂哪侧；
// 墙没画到边、留了开口时洪泛正当地绕过去——那是墙没封口，不是泄漏。
// ============================================================

/**
 * 计算从 (sx, sy) 出发、被墙（alpha > threshold）阻隔的 4 连通可达区域。
 * @param alpha  单通道 alpha 平面（行优先，长度 = width*height）
 * @returns      Uint8Array(width*height)，1 = 本笔画可涂
 *               种子落在墙上 → 全 0（本笔画无可涂区，抬笔重点）
 *               种子越界 → 全 0
 */
export function computeFloodRegion(
  alpha: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  threshold: number = 10,
): Uint8Array {
  const region = new Uint8Array(width * height);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return region;
  const start = sy * width + sx;
  if (alpha[start]! > threshold) return region;

  const stack = new Int32Array(width * height);
  let sp = 0;
  stack[sp++] = start;
  region[start] = 1;
  while (sp > 0) {
    const cur = stack[--sp]!;
    const cx = cur % width;
    // 左
    if (cx > 0) {
      const n = cur - 1;
      if (!region[n] && alpha[n]! <= threshold) { region[n] = 1; stack[sp++] = n; }
    }
    // 右
    if (cx < width - 1) {
      const n = cur + 1;
      if (!region[n] && alpha[n]! <= threshold) { region[n] = 1; stack[sp++] = n; }
    }
    // 上
    if (cur >= width) {
      const n = cur - width;
      if (!region[n] && alpha[n]! <= threshold) { region[n] = 1; stack[sp++] = n; }
    }
    // 下
    if (cur < width * (height - 1)) {
      const n = cur + width;
      if (!region[n] && alpha[n]! <= threshold) { region[n] = 1; stack[sp++] = n; }
    }
  }
  return region;
}

/** 从 RGBA ImageData 抽出 alpha 平面（防溢出线画布的读取口径） */
export function alphaPlaneFromImageData(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    alpha[i] = data[i * 4 + 3]!;
  }
  return alpha;
}
