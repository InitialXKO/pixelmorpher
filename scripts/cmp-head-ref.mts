// 同尺全幅并排图（防漏三号关）：把产品头与参考头按同一尺度并排——
// 尺度锚 = 穹顶顶点 → 颏底的核高，两边都从像素实测、不许按裁图
// 各自放大。裁图对照（两边各截一块对过）不算关轮证据；关轮证据
// 必须是这张整颗头同尺并排图。用法：
//   bun scripts/cmp-head-ref.mts [条目] [参考图] [参考头框 x0,y0,x1,y1] [出图]
// 缺省 = 敏捷头 + ref-agile-full.png + 头框 (400,25,640,350)。
// 参考头框只框头核（穹顶/脸/颏 + 鳍根），鳍尖在框外——出图会注明。
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { BUILTIN_ENTRIES, libraryIndexOf } from '../src/lib/library-entries.ts';
import { renderMechaEntry } from '../src/lib/mecha/entry-render.ts';

const entryId = process.argv[2] ?? 'mecha-head-agile';
const refImg = process.argv[3] ?? '/home/hatch/workspace/scratch/legcmp/ref-agile-full.png';
const refCrop = process.argv[4] ?? '400,25,640,350';
const outPng = process.argv[5] ?? '/home/hatch/workspace/scratch/legcmp/cmp-agile-samescale.png';

const idx = libraryIndexOf(BUILTIN_ENTRIES);
const r = renderMechaEntry(idx, entryId);
const s = r?.outputs.head;
if (!s) { console.error(entryId, '无 head 输出'); process.exit(1); }
const w = s.width, h = s.height;
const rgba = Buffer.from(s.rgba.buffer, s.rgba.byteOffset, s.rgba.byteLength);
// 产品核高实测：颏底 = alpha 框底；穹顶顶点 = 中央带最上亮色
// （min(R,G,B)>140——排除蓝鳍与橙眼，只剩白穹）
let chinY = -1;
for (let y = h - 1; y >= 0 && chinY < 0; y--) for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3] > 8) { chinY = y; break; }
let apexY = -1;
for (let y = 0; y < h && apexY < 0; y++) {
  for (let x = Math.floor(w * 0.25); x < Math.floor(w * 0.8); x++) {
    const o = (y * w + x) * 4;
    if (rgba[o + 3] > 8 && Math.min(rgba[o], rgba[o + 1], rgba[o + 2]) > 140) { apexY = y; break; }
  }
}
if (apexY < 0 || chinY < 0) { console.error('产品核高量不出'); process.exit(1); }
const prodCore = chinY - apexY;
console.log(`产品 ${entryId}：${w}x${h} 穹顶 y=${apexY} 颏底 y=${chinY} 核高 ${prodCore}px`);
writeFileSync('/tmp/cmp-prod.rgba', rgba);
writeFileSync('/tmp/cmp-prod.json', JSON.stringify({ w, h, apexY, chinY, core: prodCore }));

const py = spawnSync('python3', ['scripts/cmp-head-ref.py', refImg, refCrop, outPng], { cwd: process.cwd(), encoding: 'utf-8' });
process.stdout.write(py.stdout ?? '');
process.stderr.write(py.stderr ?? '');
process.exit(py.status ?? 1);
