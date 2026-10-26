// ============================================================
// 精灵堆叠切片器（3D 导入第二产线，PR #46 研究定案的产品化）
//
// 把一个部件的网格沿主轴切成一摞截面图（层图）：
//   截面 = 平面截网格得轮廓段 → 段链成环 → 偶奇填充定内外
//          （验证四定案：竖直射线对开口壳出空心环、逐行偶奇被
//          短斜段打乱，两种旧法均作废）；
//   着色 = 法向渗入（验证七定案）：截面每点取「最近表面点」的
//          贴图色，表面撒点只取不透明 texel（透明点作源会污染
//          近旁像素，实测全场剪影掉点）。
// 全部计算在角色空间（x 右、y 下、z 向外，全局像素）里完成——
// 调用方负责把模型空间几何与骨骼关节点按 (x, −y, z)·worldToPixels
// 换算进来（与 skeleton-mapper 的 joint3D→offset3D 同一口径）。
// 本模块不依赖 DOM，可在探针里直接跑。
// ============================================================

/** 3D 向量（角色空间，全局像素 / 单位向量） */
export interface Vec3Like { x: number; y: number; z: number }

export interface SliceStackInput {
  /** 顶点位置（角色空间 px），长度 = 顶点数 × 3 */
  positions: ArrayLike<number>;
  /** 顶点 UV，长度 = 顶点数 × 2 */
  uvs: ArrayLike<number>;
  /** 本部件的三角形（顶点索引三元组） */
  tris: ArrayLike<number>;
  /** 每三角形材质下标，长度 = 三角形数 */
  triMaterial: ArrayLike<number>;
  /**
   * 贴图采样：(材质, u, v) → RGBA（0-255）；无贴图时返回材质色。
   * v 的方向约定与调用方的纹理装载一致（烘焙侧按 PMX 约定提供）。
   */
  sample: (mat: number, u: number, v: number) => [number, number, number, number];
  /** 摞原点参考点（根侧关节点，角色空间 px） */
  pivot: Vec3Like;
  /** 层叠方向（根→尖，不必单位化） */
  axis: Vec3Like;
  /** 截面内 u 轴（层图 x 方向，不必单位化、须与 axis 不平行） */
  uAxis: Vec3Like;
  /** 每层厚度（全局像素）；层数 = ceil(轴向跨度 / 层厚) 后夹取 */
  layerThickness: number;
  /** 层图栅格密度：1 = 1 图像素 / 全局像素（原生分辨率） */
  rasterScale?: number;
}

export interface SlicedLayer {
  width: number;
  height: number;
  /** RGBA，行主序，自上（v 最小）而下 */
  rgba: Uint8ClampedArray;
  /** 主轴穿过本层图的图内坐标（连续，左上角为原点，单位图像素） */
  plugX: number;
  plugY: number;
}

export interface SliceStackResult {
  layers: SlicedLayer[];
  /** 实际层厚（全局像素）= 轴向跨度 / 层数 */
  layerThickness: number;
  /** 摞原点：第 0 层根侧端面的截面中心（角色空间 px） */
  origin: Vec3Like;
  /** 层叠方向（单位向量，角色空间） */
  axis: Vec3Like;
  /** 截面内 u 轴（单位向量，与 axis 正交化后） */
  uAxis: Vec3Like;
  /** 截面内 v 轴（单位向量）= axis × u 的右手补全（见实现注） */
  vAxis: Vec3Like;
  /** 填充像素总数（全部层合计，供调用方核查产出非空） */
  filledPixels: number;
}

const dot = (a: Vec3Like, b: Vec3Like) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3Like, b: Vec3Like): Vec3Like => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm = (a: Vec3Like): Vec3Like => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/**
 * 切片主函数。截面坐标系：对任意点 p，
 *   a = (p − pivot)·axis（沿轴距离）、α = (p − pivot)·u、β = (p − pivot)·v，
 * 截面 k = a ∈ [kT, (k+1)T) 的中心平面，层图坐标 = (α, β)。
 * v 轴由 axis × u 定义（保证 (u, v, axis) 右手系）——层图的上下
 * 方向因此由 u 与 axis 唯一决定，调用方不要再单独传 v。
 */
export function sliceStack(input: SliceStackInput): SliceStackResult {
  const axis = norm(input.axis);
  // u 正交化：去掉沿 axis 的分量后单位化
  const ua = dot(input.uAxis, axis);
  const uAxis = norm({
    x: input.uAxis.x - axis.x * ua,
    y: input.uAxis.y - axis.y * ua,
    z: input.uAxis.z - axis.z * ua,
  });
  const vAxis = cross(axis, uAxis);
  const P = input.pivot;
  const triCount = Math.floor(input.tris.length / 3);

  // 逐顶点截面坐标 (a, α, β)
  const vCount = Math.floor(input.positions.length / 3);
  const va = new Float64Array(vCount);
  const vAl = new Float64Array(vCount);
  const vBe = new Float64Array(vCount);
  let aMin = Infinity, aMax = -Infinity, alMin = Infinity, alMax = -Infinity, beMin = Infinity, beMax = -Infinity;
  for (let i = 0; i < vCount; i++) {
    const dx = input.positions[i * 3]! - P.x;
    const dy = input.positions[i * 3 + 1]! - P.y;
    const dz = input.positions[i * 3 + 2]! - P.z;
    const a = dx * axis.x + dy * axis.y + dz * axis.z;
    const al = dx * uAxis.x + dy * uAxis.y + dz * uAxis.z;
    const be = dx * vAxis.x + dy * vAxis.y + dz * vAxis.z;
    va[i] = a; vAl[i] = al; vBe[i] = be;
    if (a < aMin) aMin = a; if (a > aMax) aMax = a;
    if (al < alMin) alMin = al; if (al > alMax) alMax = al;
    if (be < beMin) beMin = be; if (be > beMax) beMax = be;
  }
  const span = Math.max(1e-6, aMax - aMin);
  const NL = Math.max(1, Math.min(128, Math.round(span / Math.max(1, input.layerThickness))));
  const T = span / NL;
  const s = input.rasterScale ?? 1; // 图像素 / 全局像素
  const W = Math.max(2, Math.ceil((alMax - alMin) * s));
  const H = Math.max(2, Math.ceil((beMax - beMin) * s));
  // 图坐标：像素 (i, j) 中心 ↔ (α, β) = (alMin + (i+0.5)/s, beMin + (j+0.5)/s)
  const origin: Vec3Like = {
    x: P.x + axis.x * aMin,
    y: P.y + axis.y * aMin,
    z: P.z + axis.z * aMin,
  };

  const sample = input.sample;

  // 三角按 a 范围分桶到层
  const buckets: number[][] = Array.from({ length: NL }, () => []);
  for (let t = 0; t < triCount; t++) {
    const a0 = va[input.tris[t * 3]!]!, a1 = va[input.tris[t * 3 + 1]!]!, a2 = va[input.tris[t * 3 + 2]!]!;
    const l0 = Math.max(0, Math.floor((Math.min(a0, a1, a2) - aMin) / T));
    const l1 = Math.min(NL - 1, Math.floor((Math.max(a0, a1, a2) - aMin) / T));
    for (let l = l0; l <= l1; l++) buckets[l]!.push(t);
  }

  // ===== 法向渗入着色场：表面撒点（只取不透明）→ 体素波次传播 =====
  // 体素边长 ≈ 层厚（截面内分辨够用、体素数可控）
  const CELL = Math.max(2, T);
  const gx0 = alMin, gy0 = aMin, gz0 = beMin; // 场坐标 = (α, a, β)
  const gnx = Math.max(1, Math.ceil((alMax - alMin) / CELL));
  const gny = Math.max(1, Math.ceil(span / CELL));
  const gnz = Math.max(1, Math.ceil((beMax - beMin) / CELL));
  const sPos: number[] = []; const sUv: number[] = []; const sMat: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = input.tris[t * 3]!, i1 = input.tris[t * 3 + 1]!, i2 = input.tris[t * 3 + 2]!;
    const ax = vAl[i0]!, ay = va[i0]!, az = vBe[i0]!;
    const e1x = vAl[i1]! - ax, e1y = va[i1]! - ay, e1z = vBe[i1]! - az;
    const e2x = vAl[i2]! - ax, e2y = va[i2]! - ay, e2z = vBe[i2]! - az;
    const crx = e1y * e2z - e1z * e2y, cry = e1z * e2x - e1x * e2z, crz = e1x * e2y - e1y * e2x;
    const area = 0.5 * Math.sqrt(crx * crx + cry * cry + crz * crz);
    const n = Math.min(500, Math.max(1, Math.ceil(area / (CELL * CELL))));
    const m = Math.ceil(Math.sqrt(n));
    const mat = input.triMaterial[t] ?? 0;
    const u0 = input.uvs[i0 * 2]!, v0 = input.uvs[i0 * 2 + 1]!;
    const u1 = input.uvs[i1 * 2]!, v1 = input.uvs[i1 * 2 + 1]!;
    const u2 = input.uvs[i2 * 2]!, v2 = input.uvs[i2 * 2 + 1]!;
    for (let a2 = 0; a2 < m; a2++) for (let b2 = 0; b2 < m; b2++) {
      let fu = (a2 + 0.5) / m, fv = (b2 + 0.5) / m;
      if (fu + fv > 1) { fu = 1 - fu; fv = 1 - fv; }
      const w0 = 1 - fu - fv;
      const uu = u0 * w0 + u1 * fu + u2 * fv, vv = v0 * w0 + v1 * fu + v2 * fv;
      if (sample(mat, uu, vv)[3] < 128) continue; // 透明 texel 不是表面，不作渗入源（验证七定案）
      sPos.push(ax + e1x * fu + e2x * fv, ay + e1y * fu + e2y * fv, az + e1z * fu + e2z * fv);
      sUv.push(uu, vv);
      sMat.push(mat);
    }
  }
  const gN = gnx * gny * gnz;
  const vBest = new Int32Array(gN).fill(-1);
  const vDist = new Float64Array(gN).fill(Infinity);
  const vidx = (ix: number, iy: number, iz: number) => (iy * gnz + iz) * gnx + ix;
  const clampI = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  for (let si = 0; si < sMat.length; si++) {
    const x = sPos[si * 3]!, y = sPos[si * 3 + 1]!, z = sPos[si * 3 + 2]!;
    const ix = clampI(Math.floor((x - gx0) / CELL), gnx - 1);
    const iy = clampI(Math.floor((y - gy0) / CELL), gny - 1);
    const iz = clampI(Math.floor((z - gz0) / CELL), gnz - 1);
    const id = vidx(ix, iy, iz);
    const cx = gx0 + (ix + 0.5) * CELL, cy = gy0 + (iy + 0.5) * CELL, cz = gz0 + (iz + 0.5) * CELL;
    const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz);
    if (d2 < vDist[id]!) { vDist[id] = d2; vBest[id] = si; }
  }
  {
    // 波次 BFS：按体素步数分波传播，同波内以真实距离 tie-break。
    // 不用标签校正式松弛——近等距样本会让标签反复翻转、队列爆炸
    // （验证七实测小球 480 万条不收敛）；波次版每体素至多入队一次。
    const step = new Int32Array(gN).fill(-1);
    const queue: number[] = [];
    for (let id = 0; id < gN; id++) if (vBest[id]! >= 0) { step[id] = 0; queue.push(id); }
    const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head]!; const si = vBest[id]!; if (si < 0) continue;
      const ix = id % gnx, iz = Math.floor(id / gnx) % gnz, iy = Math.floor(id / (gnx * gnz));
      const sx = sPos[si * 3]!, sy = sPos[si * 3 + 1]!, sz = sPos[si * 3 + 2]!;
      for (const [dx, dy, dz] of NB) {
        const jx = ix + dx, jy = iy + dy, jz = iz + dz;
        if (jx < 0 || jy < 0 || jz < 0 || jx >= gnx || jy >= gny || jz >= gnz) continue;
        const nid = vidx(jx, jy, jz);
        const cx = gx0 + (jx + 0.5) * CELL, cy = gy0 + (jy + 0.5) * CELL, cz = gz0 + (jz + 0.5) * CELL;
        const d2 = (sx - cx) * (sx - cx) + (sy - cy) * (sy - cy) + (sz - cz) * (sz - cz);
        if (step[nid]! < 0) { step[nid] = step[id]! + 1; vBest[nid] = si; vDist[nid] = d2; queue.push(nid); }
        else if (step[nid]! === step[id]! + 1 && d2 < vDist[nid]!) { vBest[nid] = si; vDist[nid] = d2; }
      }
    }
  }
  const bleedSrc = (al: number, a: number, be: number): { mat: number; u: number; v: number } | null => {
    const ix = clampI(Math.floor((al - gx0) / CELL), gnx - 1);
    const iy = clampI(Math.floor((a - gy0) / CELL), gny - 1);
    const iz = clampI(Math.floor((be - gz0) / CELL), gnz - 1);
    const si = vBest[vidx(ix, iy, iz)]!;
    if (si < 0) return null;
    return { mat: sMat[si]!, u: sUv[si * 2]!, v: sUv[si * 2 + 1]! };
  };

  // ===== 逐层：平面截段 → 段链成环 → 扫描线偶奇填充 → 渗入着色 =====
  interface Seg { x0: number; z0: number; x1: number; z1: number }
  const layers: SlicedLayer[] = [];
  let filledPixels = 0;
  const segs: Seg[] = [];
  for (let l = 0; l < NL; l++) {
    const hm = aMin + l * T + T / 2;
    segs.length = 0;
    for (const t of buckets[l]!) {
      const i0 = input.tris[t * 3]!, i1 = input.tris[t * 3 + 1]!, i2 = input.tris[t * 3 + 2]!;
      const idx = [i0, i1, i2];
      const pts: [number, number][] = [];
      for (let e = 0; e < 3; e++) {
        const ia = idx[e]!, ib = idx[(e + 1) % 3]!;
        const da = va[ia]! - hm, db = va[ib]! - hm;
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
          const tt = da / (da - db);
          pts.push([
            vAl[ia]! + (vAl[ib]! - vAl[ia]!) * tt,
            vBe[ia]! + (vBe[ib]! - vBe[ia]!) * tt,
          ]);
        }
      }
      if (pts.length === 2) segs.push({ x0: pts[0]![0], z0: pts[0]![1], x1: pts[1]![0], z1: pts[1]![1] });
    }
    // 段链成环（端点量化键匹配，与验证四/五同法）
    const qk = (x: number, z: number) => Math.round(x * 50) + ':' + Math.round(z * 50);
    const adj = new Map<string, { seg: number; end: 0 | 1 }[]>();
    segs.forEach((sg, si) => {
      const k0 = qk(sg.x0, sg.z0), k1 = qk(sg.x1, sg.z1);
      let a0 = adj.get(k0); if (!a0) { a0 = []; adj.set(k0, a0); } a0.push({ seg: si, end: 0 });
      let a1 = adj.get(k1); if (!a1) { a1 = []; adj.set(k1, a1); } a1.push({ seg: si, end: 1 });
    });
    const used = new Uint8Array(segs.length);
    const loops: [number, number][][] = [];
    for (let si = 0; si < segs.length; si++) {
      if (used[si]) continue;
      used[si] = 1;
      const sg = segs[si]!;
      const pts: [number, number][] = [[sg.x0, sg.z0], [sg.x1, sg.z1]];
      const startKey = qk(sg.x0, sg.z0);
      let curKey = qk(sg.x1, sg.z1);
      let guard = 0;
      while (curKey !== startKey && guard++ < segs.length + 2) {
        const cands = adj.get(curKey) ?? [];
        const nxt = cands.find((c) => !used[c.seg]);
        if (!nxt) break;
        used[nxt.seg] = 1;
        const ns = segs[nxt.seg]!;
        const other: [number, number] = nxt.end === 0 ? [ns.x1, ns.z1] : [ns.x0, ns.z0];
        pts.push(other);
        curKey = qk(other[0], other[1]);
      }
      if (pts.length >= 3) loops.push(pts);
    }
    // 扫描线偶奇填充（环多边形边与像素中心行求交，成对填）
    const rgba = new Uint8ClampedArray(W * H * 4);
    if (loops.length > 0) {
      for (let j = 0; j < H; j++) {
        const be = beMin + (j + 0.5) / s;
        const xs: number[] = [];
        for (const loop of loops) {
          for (let e = 0; e < loop.length; e++) {
            const [x0, z0] = loop[e]!;
            const [x1, z1] = loop[(e + 1) % loop.length]!;
            if ((z0 <= be && z1 > be) || (z1 <= be && z0 > be)) {
              xs.push(x0 + ((be - z0) / (z1 - z0)) * (x1 - x0));
            }
          }
        }
        if (xs.length < 2) continue;
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const iFrom = Math.max(0, Math.ceil((xs[k]! - alMin) * s - 0.5));
          const iTo = Math.min(W - 1, Math.floor((xs[k + 1]! - alMin) * s - 0.5));
          for (let i = iFrom; i <= iTo; i++) {
            const al = alMin + (i + 0.5) / s;
            const src = bleedSrc(al, hm, be);
            if (!src) continue;
            const [r, g, b, a] = sample(src.mat, src.u, src.v);
            if (a < 128) continue;
            const o = (j * W + i) * 4;
            rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
            filledPixels++;
          }
        }
      }
    }
    layers.push({
      width: W, height: H, rgba,
      plugX: (0 - alMin) * s,
      plugY: (0 - beMin) * s,
    });
  }

  return { layers, layerThickness: T, origin, axis, uAxis, vAxis, filledPixels };
}
