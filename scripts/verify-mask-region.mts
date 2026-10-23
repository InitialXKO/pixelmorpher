// 防溢出洪泛区域探针：密封性由模型保证（区域 4 连通 ↔ 墙 8 连通）。
import { computeFloodRegion } from '../src/lib/mask-region';

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

const W = 10;
const H = 10;
const blank = () => new Uint8Array(W * H);
const at = (r: Uint8Array, x: number, y: number) => r[y * W + x] === 1;
const wall = (a: Uint8Array, x: number, y: number) => { a[y * W + x] = 255; };

// R1 无墙：全域可达
{
  const r = computeFloodRegion(blank(), W, H, 0, 0);
  ok('R1 无墙全域可达', r.every((v) => v === 1));
}

// R2 直线墙（竖线 x=5 贯通上下）：左半可达、右半不可达、墙本身不可涂
{
  const a = blank();
  for (let y = 0; y < H; y++) wall(a, 5, y);
  const r = computeFloodRegion(a, W, H, 2, 5);
  ok('R2 直线墙内侧可达', at(r, 0, 0) && at(r, 4, 9));
  ok('R2 直线墙外侧不可达', !at(r, 6, 5) && !at(r, 9, 0));
  ok('R2 墙像素本身不可涂', !at(r, 5, 5));
  ok('R2 贴墙像素可涂（无死区）', at(r, 4, 5));
}

// R3 角接墙（对角阶梯 y=x）：旧射线模型在此斜穿，洪泛必须封死
{
  const a = blank();
  for (let i = 0; i < 10; i++) wall(a, i, i);
  const r = computeFloodRegion(a, W, H, 0, 5); // 左下侧
  ok('R3 角接墙：种子侧可达', at(r, 0, 9) && at(r, 1, 5));
  ok('R3 角接墙：对侧不可达（不斜穿）', !at(r, 9, 0) && !at(r, 5, 1) && !at(r, 9, 4));
}

// R4 封闭框：内部种子 → 只有内部；外部种子 → 只有外部
{
  const a = blank();
  for (let x = 2; x <= 7; x++) { wall(a, x, 2); wall(a, x, 7); }
  for (let y = 2; y <= 7; y++) { wall(a, 2, y); wall(a, 7, y); }
  const rin = computeFloodRegion(a, W, H, 5, 5);
  ok('R4 框内种子：内部可达外部不可达', at(rin, 3, 3) && at(rin, 6, 6) && !at(rin, 0, 0) && !at(rin, 9, 9));
  const rout = computeFloodRegion(a, W, H, 0, 0);
  ok('R4 框外种子：外部可达内部不可达', at(rout, 9, 9) && !at(rout, 5, 5));
}

// R5 开口墙（竖线留一格缺口）：洪泛正当地从缺口绕过——墙没封口不是泄漏
{
  const a = blank();
  for (let y = 0; y < H; y++) { if (y !== 4) wall(a, 5, y); }
  const r = computeFloodRegion(a, W, H, 2, 5);
  ok('R5 开口处可绕行到对侧', at(r, 8, 5));
  ok('R5 缺口格本身可涂', at(r, 5, 4));
}

// R6 种子落在墙上 → 全 0（本笔画无可涂区）
{
  const a = blank();
  for (let y = 0; y < H; y++) wall(a, 5, y);
  const r = computeFloodRegion(a, W, H, 5, 5);
  ok('R6 种子在墙上全 0', r.every((v) => v === 0));
}

// R7 种子越界 → 全 0
{
  const r = computeFloodRegion(blank(), W, H, -1, 99);
  ok('R7 种子越界全 0', r.every((v) => v === 0));
}

// R8 稀疏 alpha（半透明线像素 alpha=100 > 阈值 10）同样算墙
{
  const a = blank();
  for (let y = 0; y < H; y++) a[y * W + 5] = 100;
  const r = computeFloodRegion(a, W, H, 2, 5);
  ok('R8 半透明线像素仍为墙', !at(r, 8, 5));
}

console.log(`合计：${pass} 过 / ${fail} 败`);
if (fail > 0) process.exit(1);
