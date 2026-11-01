// ============================================================
// Telea 真实现探针（用户 2026-11-01 裁定：Telea 改真实现）
//  inpaintPixels 从迭代边界加权平均换成 Telea 2004 原算法
//  （fast marching 求 T + 按 T 升序逐格一阶泰勒外推 + dir/dst/lev
//  三项权重）。本探针的断言必须能区分新旧算法，不许只测「洞填上了」：
//   A) 结构延续：1px 线穿空洞时填值须留在「线色一侧」（过线/背景
//      中点），粗线（3px）中行不得低于线色。阈值按本实现实测剖面
//      取（1px 线宽2 洞=149、宽3 洞=146/122/149、粗线中行≥231；
//      旧平均法同夹具为 97、92..102、158..200，逐项必红——已用
//      git stash 旧实现自查）。说明：1px 硬线跨洞在 Telea 下仍会
//      衰减（OpenCV 官方 Telea 同夹具衰减更甚），断言的是「不塌
//      回平均值」，不是无损接续。
//   B) 斜向线性渐变：线性场的一阶外推是精确的，Telea 填值应近乎
//      精确续上渐变面（实测最大误差 ≤4）；逐层平均从边界层起
//      系统性偏移（同夹具旧实现最大误差 24）。
//   C) 半径语义：radius=1 时首格只能取轴向邻居 → 恰为线色；
//      radius=3 引入对角背景梯度 → 值被拉低但仍在线一侧。
//   D) 基本面：全填满、合法颜色、输入不被改、空 mask 原样返回、
//      孤立掩码格（四周皆透明）保持 null、非掩码像素逐格不变。
//   E) 孪生对拍：包内 pxInpaint（PIXEL_SRC）与产品侧逐格全等。
// ============================================================

import { inpaintPixels } from '../src/lib/inpainting';
import { PIXEL_SRC } from '../src/lib/proc-runtime/pixel-src';
import type { PixelGrid } from '../src/lib/types';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`);
  }
}

const gray = (v: number) => {
  const h = Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h}${h}${h}`;
};
const val = (c: string | null) => (c === null ? NaN : parseInt(c.slice(1, 3), 16));
const HEX_RE = /^#[0-9a-f]{6}$/;

function lineGrid(lineRows: number[]): PixelGrid {
  const W = 15, H = 9;
  const grid: PixelGrid = [];
  for (let y = 0; y < H; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < W; x++) row.push(gray(lineRows.includes(y) ? 200 : 32));
    grid.push(row);
  }
  return grid;
}
function bandMask(x0: number, x1: number): Set<string> {
  const mask = new Set<string>();
  for (let y = 0; y < 9; y++) for (let x = x0; x <= x1; x++) mask.add(`${x},${y}`);
  return mask;
}

// ---------- A) 结构延续 ----------
{
  // A1: 1px 线（行 4），洞宽 2（x=6..7）
  const out1 = inpaintPixels(lineGrid([4]), bandMask(6, 7), 3);
  check('A1 1px 线/宽2 洞：线格 ≥135（实测 149；旧平均 97）',
    val(out1[4][6]) >= 135 && val(out1[4][7]) >= 135,
    `实得 ${val(out1[4][6])},${val(out1[4][7])}`);
  check('A2 线外洞格仍近背景（(6,2) 与 (7,6) ≤80，不纵向糊线）',
    val(out1[2][6]) <= 80 && val(out1[6][7]) <= 80,
    `实得 ${val(out1[2][6])},${val(out1[6][7])}`);

  // A3: 1px 线，洞宽 3（x=6..8）：全程过中点 116（更近线色 than 背景）
  const out2 = inpaintPixels(lineGrid([4]), bandMask(6, 8), 3);
  const prof = [6, 7, 8].map(x => val(out2[4][x]));
  check('A3 1px 线/宽3 洞：全程 ≥118（实测 146,122,149；旧平均 92..102）',
    prof.every(v => v >= 118), `实得 ${prof.join(',')}`);

  // A4: 粗线 3px（行 3..5），洞宽 5（x=5..9）：中行不低于线色、边行不塌
  const out3 = inpaintPixels(lineGrid([3, 4, 5]), bandMask(5, 9), 3);
  const mid = [5, 6, 7, 8, 9].map(x => val(out3[4][x]));
  const edge = [3, 5].flatMap(y => [5, 6, 7, 8, 9].map(x => val(out3[y][x])));
  check('A4 粗线中行全程 ≥200（实测 ≥231；旧平均低至 158）',
    mid.every(v => v >= 200), `实得 ${mid.join(',')}`);
  check('A5 粗线边行全程 ≥175（实测 ≥184）',
    edge.every(v => v >= 175), `实得 ${edge.join(',')}`);
}

// ---------- B) 斜向线性渐变 ----------
{
  // 11x11：v = (x+y)*12；中心 5x5（3..7）为空洞。真值中心 (5,5)=120
  const S = 11;
  const grid: PixelGrid = [];
  for (let y = 0; y < S; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < S; x++) row.push(gray((x + y) * 12));
    grid.push(row);
  }
  const mask = new Set<string>();
  for (let y = 3; y <= 7; y++) for (let x = 3; x <= 7; x++) mask.add(`${x},${y}`);
  const out = inpaintPixels(grid, mask, 3);
  let maxErr = 0;
  for (let y = 3; y <= 7; y++) {
    for (let x = 3; x <= 7; x++) {
      maxErr = Math.max(maxErr, Math.abs(val(out[y][x]) - (x + y) * 12));
    }
  }
  check('B1 渐变空洞内最大误差 ≤4（一阶外推对线性场近乎精确；旧平均 24）', maxErr <= 4,
    `最大误差 ${maxErr}`);
  check('B2 中心 (5,5) ≈ 120（±3）', Math.abs(val(out[5][5]) - 120) <= 3, `实得 ${val(out[5][5])}`);
}

// ---------- C) 半径语义 ----------
{
  const grid = lineGrid([4]);
  const mask = bandMask(5, 9);
  const outR1 = inpaintPixels(grid, mask, 1);
  const outR3 = inpaintPixels(grid, mask, 3);
  check('C1 radius=1 时 (5,4) 恰为线色 200（仅轴向邻居）', val(outR1[4][5]) === 200,
    `实得 ${val(outR1[4][5])}`);
  const r3 = val(outR3[4][5]);
  check('C2 radius=3 时 (5,4) 被对角梯度拉低但仍在线一侧（120..199，实测 146；旧平均 99）',
    r3 >= 120 && r3 < 200, `实得 ${r3}`);
  check('C3 半径确实改变结果', val(outR1[4][5]) !== r3);
}

// ---------- D) 基本面 ----------
{
  // 小洞全填 + 合法颜色 + 输入不变
  const grid: PixelGrid = [
    [gray(10), gray(20), gray(30), gray(40), gray(50)],
    [gray(15), null, null, null, gray(55)],
    [gray(25), null, null, null, gray(65)],
    [gray(35), null, null, null, gray(75)],
    [gray(45), gray(50), gray(60), gray(70), gray(80)],
  ];
  const snapshot = JSON.stringify(grid);
  const mask = new Set<string>();
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) mask.add(`${x},${y}`);
  const out = inpaintPixels(grid, mask, 3);
  let allFilled = true;
  let allValid = true;
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) {
      if (out[y][x] === null) allFilled = false;
      else if (!HEX_RE.test(out[y][x] as string)) allValid = false;
    }
  }
  check('D1 小空洞全填满', allFilled);
  check('D2 填值均为合法 #rrggbb', allValid);
  check('D3 输入网格未被修改', JSON.stringify(grid) === snapshot);
  let borderSame = true;
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    if (!mask.has(`${x},${y}`) && out[y][x] !== grid[y][x]) borderSame = false;
  }
  check('D4 非掩码像素逐格不变', borderSame);

  // 空 mask → 原样返回（同一引用，与旧契约一致）
  check('D5 空 mask 返回原引用', inpaintPixels(grid, new Set(), 3) === grid);

  // 孤立掩码格：四周皆透明（BLOCKED），前锋不可达 → 保持 null；
  // 其余非掩码透明格也保持 null
  const iso: PixelGrid = [
    [null, null, null, null, null],
    [null, null, null, null, null],
    [null, null, gray(99), null, null],
    [null, null, null, null, null],
    [null, null, null, null, null],
  ];
  const isoOut = inpaintPixels(iso, new Set(['2,2']), 3);
  check('D6 孤立掩码格无已知邻居 → 保持 null', isoOut[2][2] === null);
  check('D7 非掩码透明格保持 null', isoOut[0][0] === null && isoOut[4][4] === null);

  // 掩码盖住有色格（选区重绘）：应被邻居外推覆盖，不保留原色
  const painted: PixelGrid = [
    [gray(0), gray(0), gray(0)],
    [gray(0), gray(255), gray(0)],
    [gray(0), gray(0), gray(0)],
  ];
  const pOut = inpaintPixels(painted, new Set(['1,1']), 3);
  check('D8 掩码内有色格被重绘为邻域外推值（近 0，非原 255）', val(pOut[1][1]) <= 40,
    `实得 ${val(pOut[1][1])}`);
}

// ---------- E) 孪生对拍 ----------
{
  const factory = new Function(`${PIXEL_SRC}\nreturn { pxInpaint };`);
  const rt = factory() as {
    pxInpaint: (p: PixelGrid, m: Set<string>, r: number) => PixelGrid;
  };
  const gridA = lineGrid([4]);
  const maskA = bandMask(5, 9);
  const twinA = rt.pxInpaint(gridA, maskA, 3);
  const prodA = inpaintPixels(gridA, maskA, 3);
  check('E1 接线条夹具：孪生逐格全等', JSON.stringify(twinA) === JSON.stringify(prodA));

  const S = 11;
  const g2: PixelGrid = [];
  for (let y = 0; y < S; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < S; x++) row.push(gray((x + y) * 12));
    g2.push(row);
  }
  const m2 = new Set<string>();
  for (let y = 3; y <= 7; y++) for (let x = 3; x <= 7; x++) m2.add(`${x},${y}`);
  const twinB = rt.pxInpaint(g2, m2, 5);
  const prodB = inpaintPixels(g2, m2, 5);
  check('E2 渐变夹具（半径 5）：孪生逐格全等', JSON.stringify(twinB) === JSON.stringify(prodB));
}

console.log(`\nverify-telea-inpaint: ${passed} 过 / ${failed} 败`);
if (failed > 0) process.exit(1);
