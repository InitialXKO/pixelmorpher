// 防溢出笔画栅栏模型探针（v3，取代全局洪泛版）：
// 线是栅栏不是隔断墙——开放线段也必须在笔尖附近封严，且贴墙无死区。
import { computeDiskPaintSet, segmentCrossesWall } from '../src/lib/mask-region';

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

const W = 16;
const H = 16;
const blank = () => new Uint8Array(W * H);
const wall = (a: Uint8Array, x: number, y: number) => { a[y * W + x] = 255; };
const has = (set: number[], x: number, y: number) => set.includes(y * W + x);

// 开放竖线段 x=8, y=4..11（起点终点都在图内——v2 全局洪泛在此完全失效）
const openSeg = () => {
  const a = blank();
  for (let y = 4; y <= 11; y++) wall(a, 8, y);
  return a;
};

// D1 笔尖在线左侧、圆盘压线：只涂锚点侧（左），线本身和右侧都不涂
{
  const a = openSeg();
  const set = computeDiskPaintSet(a, W, H, 7, 8, 3, 7, 8);
  ok('D1 锚点侧可涂', has(set, 5, 8) && has(set, 7, 8));
  ok('D1 线像素不可涂', !has(set, 8, 8));
  ok('D1 线右侧不可涂（开放线段也封）', !has(set, 9, 8) && !has(set, 10, 8));
  ok('D1 贴墙像素可涂（无死区）', has(set, 7, 5) && has(set, 7, 11));
}

// D2 笔尖中心已越到线右侧，但锚点还在左侧：只涂左侧月牙，中心脚下不涂
{
  const a = openSeg();
  const set = computeDiskPaintSet(a, W, H, 10, 8, 3, 7, 8);
  ok('D2 越线中心：盘内锚点侧仅剩贴线格可涂', has(set, 7, 8) && !has(set, 6, 8));
  ok('D2 越线中心：中心脚下不可涂', !has(set, 10, 8) && !has(set, 11, 8));
}

// D3 角接阶梯墙（对角线 y=x 一段）：圆盘内不得斜穿
{
  const a = blank();
  for (let i = 3; i <= 12; i++) wall(a, i, i);
  const set = computeDiskPaintSet(a, W, H, 5, 8, 3, 5, 8);
  ok('D3 阶梯墙：种子侧可涂', has(set, 4, 8) && has(set, 5, 9));
  ok('D3 阶梯墙：对侧不可涂（不斜穿）', !has(set, 8, 5) && !has(set, 9, 6));
}

// D4 绕线端：笔尖移到线段端点之外（开放空间），圆盘不再被线切开，可涂对侧
{
  const a = openSeg();
  // 中心在线段上端之外 (8,2)，锚点同处——盘内可达 (9,3)（线端外侧的对面）
  const set = computeDiskPaintSet(a, W, H, 8, 2, 2, 8, 2);
  ok('D4 线端之外可绕行', has(set, 9, 2) && has(set, 9, 3));
}

// D5 锚点在墙上 → 回退圆心；圆心也在墙上 → 空集
{
  const a = openSeg();
  const fallback = computeDiskPaintSet(a, W, H, 6, 8, 2, 8, 8);
  ok('D5 锚点在墙上回退圆心', has(fallback, 6, 8) && !has(fallback, 9, 8));
  const empty = computeDiskPaintSet(a, W, H, 8, 8, 2, 8, 8);
  ok('D5 圆心也在墙上为空集', empty.length === 0);
}

// D6 无墙：整盘可涂
{
  const set = computeDiskPaintSet(blank(), W, H, 8, 8, 2, 8, 8);
  ok('D6 无墙整盘可涂', has(set, 6, 8) && has(set, 8, 6) && has(set, 9, 9) && set.length === 13);
}

// S1 中心轨迹越墙截断：直线穿过竖线 → true；同侧移动 → false；
//    从角接墙的两墙像素角缝挤过（对角 (4,6)→(6,4)，墙在 (5,6)? 用经典角例）
//    墙在 (5,5) 与 (6,6) 时轨迹 (4,7)→(7,4) 擦角 → 2×2 邻域必含墙 → true
{
  const a = openSeg();
  ok('S1 正面穿线为 true', segmentCrossesWall(a, W, H, 6, 8, 10, 8) === true);
  ok('S1 同侧移动为 false', segmentCrossesWall(a, W, H, 4, 4, 6, 12) === false);
  const diag = blank();
  wall(diag, 5, 5); wall(diag, 6, 6);
  ok('S1 角缝挤过为 true', segmentCrossesWall(diag, W, H, 4, 7, 7, 4) === true);
  ok('S1 远离墙为 false', segmentCrossesWall(diag, W, H, 0, 0, 3, 0) === false);
}

console.log(`合计：${pass} 过 / ${fail} 败`);
if (fail > 0) process.exit(1);
