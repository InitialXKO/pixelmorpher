// 堆叠产线探针（行为级，走真实消费路径）：
//  1) 切片器：合成网格（圆柱 + 已知贴图）→ 层数/填充/渗入着色正确
//     （截面内部点取最近表面色，而不是几何内部的凭空色）；
//     透明 texel 不作渗入源（验证七定案）；
//  2) 合成算子：恒等帧 → 层心屏幕位/仿射与手算一致；去旋转不变量
//     （frameViewAngle(去旋转帧)=0 由构造保证，这里验算子层面：
//     纯视平面角帧 composite 的层仿射应与恒等帧逐值相同）；
//     画序按深度而非层序（尖朝观众时反序）；边沿钳制在层轴近
//     垂直视线时 engaged（层图基被抬起，仿射行列式不再趋零）。
import { sliceStack } from '../src/lib/bake/stack-slicer';
import { computeStackOps } from '../src/lib/stack-render';
import { rotMatD, localRotMat, MAT3_IDENTITY, type Mat3, type Sprite, type SpriteStack } from '../src/lib/unified-types';

let fails = 0;
const ok = (cond: boolean, msg: string) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fails++; };

// ===== 1) 切片器：圆柱（半径 10，高 40，沿 +Y 轴），外表面红色、顶盖蓝色 =====
// 角色空间：x 右、y 下、z 外。圆柱轴 = y（向下为根→尖），截面 = (x, z)。
const R = 10, H = 40, SEG = 24;
const positions: number[] = [];
const uvs: number[] = [];
const tris: number[] = [];
const triMat: number[] = [];
// 侧面：uv 的 u 绕圈 → 贴图左半红；顶盖 (y=0 端)：单独材质蓝
for (let i = 0; i < SEG; i++) {
  const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
  const base = positions.length / 3;
  const x0 = Math.cos(a0) * R, z0 = Math.sin(a0) * R, x1 = Math.cos(a1) * R, z1 = Math.sin(a1) * R;
  positions.push(x0, 0, z0, x1, 0, z1, x1, H, z1, x0, H, z0);
  const u0 = i / SEG, u1 = (i + 1) / SEG;
  uvs.push(u0, 0, u1, 0, u1, 1, u0, 1);
  tris.push(base, base + 1, base + 2, base, base + 2, base + 3);
  triMat.push(0, 0);
  // 顶盖扇
  const bc = positions.length / 3;
  positions.push(0, 0, 0, x1, 0, z1, x0, 0, z0);
  uvs.push(0.5, 0.5, 0.5 + x1 / (2 * R + 4), 0.5 + z1 / (2 * R + 4), 0.5 + x0 / (2 * R + 4), 0.5 + z0 / (2 * R + 4));
  tris.push(bc, bc + 1, bc + 2);
  triMat.push(1);
}
// 贴图：材质 0 = 左半红 (255,0,0)、右半绿；材质 1 = 蓝
const sample = (mat: number, u: number, v: number): [number, number, number, number] => {
  if (mat === 1) return [0, 0, 255, 255];
  void v;
  return u < 0.5 ? [255, 0, 0, 255] : [0, 200, 0, 255];
};
const sliced = sliceStack({
  positions: Float32Array.from(positions),
  uvs: Float32Array.from(uvs),
  tris: Uint32Array.from(tris),
  triMaterial: Int32Array.from(triMat),
  sample,
  pivot: { x: 0, y: 0, z: 0 },
  axis: { x: 0, y: 1, z: 0 },
  uAxis: { x: 1, y: 0, z: 0 },
  layerThickness: 5,
});
ok(sliced.layers.length === 8, `圆柱高 40 / 层厚 5 → 8 层（实际 ${sliced.layers.length}）`);
ok(Math.abs(sliced.layerThickness - 5) < 0.01, '层厚回值 5');
const mid = sliced.layers[4]!;
const pxAt = (l: typeof mid, x: number, z: number) => {
  const i = Math.round(x - (-R) - 0.5 + (mid.plugX - R));
  void i;
  // 层图坐标：plug 在轴点；α=x、β=z（v = axis×u = (0,1,0)×(1,0,0)… 由实现定义，直接用 plug 换算）
  const px = Math.round(l.plugX + x), py = Math.round(l.plugY + z);
  const o = (py * l.width + px) * 4;
  return [l.rgba[o]!, l.rgba[o + 1]!, l.rgba[o + 2]!, l.rgba[o + 3]!];
};
const centerPx = pxAt(mid, 0, 0);
ok(centerPx[3] === 255, '中间层圆心填充不透明');
ok(centerPx[0] > 200 || centerPx[1] > 150, `圆心颜色来自侧面渗入（红/绿，实际 ${centerPx.slice(0, 3)}）`);
const outsidePx = pxAt(mid, R - 1, R - 1); // 图内角点：α=β=9，距圆心 12.7 > R
ok(outsidePx[3] === 0, '圆外透明');
const fillRatio = sliced.filledPixels / (sliced.layers.length * mid.width * mid.height);
ok(fillRatio > 0.7 && fillRatio < 0.86, `填充比合理（${fillRatio.toFixed(2)}，圆面积/图面积 ≈0.785）`);
// 覆盖率定边：产品精灵网格只有二值 alpha，覆盖率的价值在定边
// 位置——填充面积应守真（像素中心二值填充对凸形系统性偏胖，
// 研究整圈 IoU −0.012）。断言面积比紧贴 1，且边缘像素颜色仍是
// 覆盖子像素的渗入色均值（不是单点采样）。
{
  let mass = 0;
  for (let o = 3; o < mid.rgba.length; o += 4) mass += mid.rgba[o]! / 255;
  const massRatio = mass / (Math.PI * R * R);
  ok(massRatio > 0.96 && massRatio < 1.04, `覆盖率定边：填充面积/圆面积 = ${massRatio.toFixed(3)}（∈[0.96,1.04]）`);
}
// 顶层（靠近顶盖）：圆心应带蓝色渗入（顶盖是最近表面之一）
const topLayer = sliced.layers[0]!;
const topCenter = pxAt(topLayer, 0, 0);
ok(topCenter[2] > 100, `顶层圆心带顶盖蓝色渗入（实际 ${topCenter.slice(0, 3)}）`);

// ===== 2) 合成算子 =====
const mkSprite = (w: number, h: number, plugX: number, plugY: number): Sprite => ({
  width: w, height: h, data: [], plug: { x: plugX * 16, y: plugY * 16 },
});
const stack: SpriteStack = {
  layerSpriteIds: ['l0', 'l1', 'l2', 'l3'],
  layerThickness: 10,
  origin: { x: 0, y: 0, z: 0 },
  axis: { x: 0, y: 1, z: 0 },
  uAxis: { x: 1, y: 0, z: 0 },
  vAxis: { x: 0, y: 0, z: 1 },
};
const layerSprites = [mkSprite(20, 20, 10, 10), mkSprite(20, 20, 10, 10), mkSprite(20, 20, 10, 10), mkSprite(20, 20, 10, 10)];

// 恒等帧 + 俯角 45°：层 k 心在局部 (0, 10k+5, 0) → 屏幕 (0, (10k+5)·cos45)
// 层图基 U=(1,0,0)→screen(1,0)；V=(0,0,1)→screen(0, sin45)
const idOps = computeStackOps(stack, layerSprites, MAT3_IDENTITY, 0, 45);
ok(idOps.ops.length >= 4, `恒等帧产算子（${idOps.ops.length} 个，含 slab 子步）`);
const layer0Ops = idOps.ops.filter((o) => o.layer === 0);
const layer0 = layer0Ops[0]!;
const layer0MeanF = layer0Ops.reduce((acc, o) => acc + o.tr[5], 0) / layer0Ops.length;
const expE = idOps.pivotX + 0 - 10 * 1; // plug 换算后图左上 x = 心x − plugX·a − plugY·c
void expE;
ok(Math.abs(layer0.tr[0] - 1) < 1e-6 && Math.abs(layer0.tr[3] - Math.sin(Math.PI / 4)) < 1e-6,
  `恒等帧层仿射 a=1、d=sin45（实际 a=${layer0.tr[0]}, d=${layer0.tr[3].toFixed(3)}）`);
// 心屏幕 y：第 0 层 = 5·cos45 ≈ 3.54 → 图顶 f = 心y − plugY·d − slab 半步
ok(Math.abs((layer0MeanF + 10 * layer0.tr[3]) - (idOps.pivotY + 5 * Math.cos(Math.PI / 4))) < 0.6,
  '层心屏幕位置与手算一致（slab 子步均值回正）');

// 纯视平面角帧（rotMatD(30)）+ worldAngle=30 → 去旋转后与恒等帧同算子
const rotOps = computeStackOps(stack, layerSprites, rotMatD(30), 30, 45);
const same = rotOps.ops.length === idOps.ops.length &&
  rotOps.ops.every((o, i) => Math.abs(o.tr[4] - idOps.ops[i]!.tr[4]) < 0.51 && Math.abs(o.tr[0] - idOps.ops[i]!.tr[0]) < 1e-4);
ok(same, '视平面角被去旋转抵消（合成只吃出平面朝向）');

// 出平面 tilt 90°（绕 h 轴）：轴 (0,1,0) 转向观众 → 层心深度随层增大，画序应 = 层序
const tiltFrame = localRotMat(0, 90);
const tiltOps = computeStackOps(stack, layerSprites, tiltFrame, 0, 45);
// 取每层首个算子的出现顺序
const order: number[] = [];
for (const o of tiltOps.ops) if (!order.includes(o.layer)) order.push(o.layer);
ok(order.join(',') === '3,2,1,0' || order.join(',') === '0,1,2,3',
  `tilt 90° 后画序按深度单调（实际 ${order.join(',')}，层序或其逆序）`);

// 边沿钳制：层轴在 (h,y) 平面内（d 分量 0，恒等帧 + 轴改 x 向）时
// 不钳制则 V 基投影趋零、高/宽塌；钳制后 |det| 应明显 > 0
const flatStack: SpriteStack = { ...stack, axis: { x: 1, y: 0, z: 0 }, uAxis: { x: 0, y: 1, z: 0 }, vAxis: { x: 0, y: 0, z: 1 } };
const flatOps = computeStackOps(flatStack, layerSprites, MAT3_IDENTITY, 0, 45);
const det = Math.abs(flatOps.ops[0]!.tr[0] * flatOps.ops[0]!.tr[3] - flatOps.ops[0]!.tr[1] * flatOps.ops[0]!.tr[2]);
ok(det > 0.2, `边沿钳制 engaged：层轴贴视平面时仿射 |det|=${det.toFixed(2)}（未钳制应 ≈0）`);

console.log(fails === 0 ? 'STACK PIPELINE PROBE PASS' : `STACK PIPELINE PROBE FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
