// 机甲变体探针验收门（研究线布局纪律的产品落地）：每个部位至少
// 三份规格（异种子 / 异粗细 / 异段长）出图必须两两互异、且结构
// 连贯——轮廓单连通、无内部透明洞（内部不许透）。手写常量坐标的
// 部位过不了种子这一份（出图不变），构造断裂的过不了连贯检查。
// 用法：bun scripts/verify-mecha-variants.mts（失败退出码 1）
import { createHash } from 'node:crypto';
import { generateMechaPartSet, generateMechaHullBody } from '../src/lib/mecha/parts.ts';

type Sprite = { width: number; height: number; rgba: Uint8ClampedArray };
let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { console.log(`✓ ${name}`); passed++; }
  else { console.log(`✗ ${name}${detail ? '：' + detail : ''}`); failed++; }
}
const hash = (s: Sprite) => createHash('md5').update(Buffer.from(s.rgba.buffer, s.rgba.byteOffset, s.rgba.byteLength)).digest('hex');

/** 结构连贯：不透明像素单连通（最大块 ≥99%）+ 无内部透明洞（边框洪泛不可达的透明像素） */
function coherent(s: Sprite): { ok: boolean; detail: string } {
  const { width: W, height: H, rgba } = s;
  const op = new Uint8Array(W * H);
  let total = 0;
  for (let i = 0; i < W * H; i++) if (rgba[i * 4 + 3] > 8) { op[i] = 1; total++; }
  if (!total) return { ok: false, detail: '全透明' };
  // 连通块（4 向）
  const seen = new Uint8Array(W * H);
  let largest = 0;
  const stack: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (!op[i] || seen[i]) continue;
    let size = 0; stack.length = 0; stack.push(i); seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!, x = c % W, y = (c / W) | 0; size++;
      if (x > 0 && op[c - 1] && !seen[c - 1]) { seen[c - 1] = 1; stack.push(c - 1); }
      if (x < W - 1 && op[c + 1] && !seen[c + 1]) { seen[c + 1] = 1; stack.push(c + 1); }
      if (y > 0 && op[c - W] && !seen[c - W]) { seen[c - W] = 1; stack.push(c - W); }
      if (y < H - 1 && op[c + W] && !seen[c + W]) { seen[c + W] = 1; stack.push(c + W); }
    }
    if (size > largest) largest = size;
  }
  if (largest < total * 0.99) return { ok: false, detail: `轮廓碎裂：最大连通块 ${largest}/${total}` };
  // 内部洞：从四边洪泛透明区，未达的透明像素即被轮廓包住的洞
  const reach = new Uint8Array(W * H);
  stack.length = 0;
  for (let x = 0; x < W; x++) { if (!op[x]) { reach[x] = 1; stack.push(x); } if (!op[(H - 1) * W + x]) { reach[(H - 1) * W + x] = 1; stack.push((H - 1) * W + x); } }
  for (let y = 0; y < H; y++) { if (!op[y * W]) { reach[y * W] = 1; stack.push(y * W); } if (!op[y * W + W - 1]) { reach[y * W + W - 1] = 1; stack.push(y * W + W - 1); } }
  while (stack.length) {
    const c = stack.pop()!, x = c % W, y = (c / W) | 0;
    if (x > 0 && !op[c - 1] && !reach[c - 1]) { reach[c - 1] = 1; stack.push(c - 1); }
    if (x < W - 1 && !op[c + 1] && !reach[c + 1]) { reach[c + 1] = 1; stack.push(c + 1); }
    if (y > 0 && !op[c - W] && !reach[c - W]) { reach[c - W] = 1; stack.push(c - W); }
    if (y < H - 1 && !op[c + W] && !reach[c + W]) { reach[c + W] = 1; stack.push(c + W); }
  }
  let holes = 0;
  for (let i = 0; i < W * H; i++) if (!op[i] && !reach[i]) holes++;
  if (holes > 0) return { ok: false, detail: `内部透明洞 ${holes} px` };
  return { ok: true, detail: '' };
}

function gate(label: string, variants: [string, Sprite][]) {
  const hs = variants.map(([, s]) => hash(s));
  check(`${label}：三种规格两两互异`, new Set(hs).size === hs.length, `哈希 ${hs.map((x) => x.slice(0, 6)).join('/')}`);
  for (const [vn, s] of variants) {
    const c = coherent(s);
    check(`${label}·${vn}：结构连贯`, c.ok, c.detail);
  }
}

for (const fam of ['olive', 'agile', 'powersuit'] as const) {
  const base = generateMechaPartSet(fam);
  const seedV = generateMechaPartSet(fam, undefined, { leg: { seed: 913 }, arm: { seed: 913 }, torso: { seed: 913 }, head: { seed: 913 } });
  const sizeV = generateMechaPartSet(fam, undefined, {
    leg: { wScale: 1.3 }, arm: { bulk: 1.3, upperLen: 1.15 },
    torso: { chestW: 175, chestH: 140 }, head: { w: 118, h: 96 },
  });
  gate(`${fam} 腿`, [['基准', base.leg], ['异种子', seedV.leg], ['异粗细', sizeV.leg]]);
  gate(`${fam} 臂`, [['基准', base.armUpper], ['异种子', seedV.armUpper], ['异粗细', sizeV.armUpper]]);
  gate(`${fam} 躯干`, [['基准', base.torso], ['异种子', seedV.torso], ['异尺寸', sizeV.torso]]);
  gate(`${fam} 头`, [['基准', base.head], ['异种子', seedV.head], ['异尺寸', sizeV.head]]);
}
{
  const b = generateMechaHullBody('walker');
  const s = generateMechaHullBody('walker', { seed: 913 });
  const z = generateMechaHullBody('walker', { hullW: 300, hullH: 130 });
  gate('车体(walker)', [['基准', b], ['异种子', s], ['异尺寸', z]]);
}

console.log(`\n合计：${passed} 过 / ${failed} 败`);
process.exit(failed ? 1 : 0);
