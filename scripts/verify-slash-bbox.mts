// 刀光包围盒探针（用户裁决：移动/放大参数应移动包围盒、盒随几何
// 长大，像素永不被裁）：
// ① 不裁切：同一几何在小用户盒与大用户盒下生成，按各自返回的
//    plug 对齐后小盒帧逐像素等于大盒帧对应像素（多组参数）。
// ② 盒随几何长大：放大半轴后帧尺寸超过用户盒、扇体像素出现在
//    旧盒范围之外。
// ③ 旧规格不回归：基线哈希生成于本线基点（af5a0c8）未改的生成
//    器（默认+四预设 × 6 进度 × 镜像，sha256 前 16 位）。基点实
//    测（大画布量绘制范围）：默认/上挑斩/下劈原本未被裁 → 修后
//    逐字节一致；横斩（绘制 x 越界 ±34>±32）/大回旋（绘制 y 到
//    27>22）原本已被裁 → 断言旧帧内容按 plug 相对位置原样保全
//    （裁剪哈希）+ 被裁像素回归 + 有效帧尺寸符合扇形紧包围盒。
// ④ 颜色档：自定义 colors 逐像素取指定色、与内置档不同；编辑
//    器颜色接线在位（源级断言）。
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  generateSlashFrame, slashFrameLayout, SLASH_PRESETS, defaultSlashSpec,
  type SlashFanSpec,
} from '../src/lib/slash-fan';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const hash = (w: number, h: number, rgba: Uint8Array) =>
  createHash('sha256').update(`${w}x${h}:`).update(rgba).digest('hex').slice(0, 16);
const PS = [0, 0.2, 0.45, 0.58, 0.8, 1];

// ---------- ① 不裁切：小盒帧是大盒帧的 plug 对齐子图 ----------
{
  const geos: { name: string; geo: Partial<SlashFanSpec>; user: Partial<SlashFanSpec> }[] = [
    { name: '中心移到左上角', geo: {}, user: { cx: 2, cy: 2 } },
    { name: '半轴放大到盒外', geo: { rx: 48, ry: 44 }, user: { cx: 32, cy: 32 } },
    { name: '旋转45°大扫角', geo: { rotDeg: 45, a0Deg: -30, sweepDeg: 200, rx: 36, ry: 18 }, user: { cx: 32, cy: 32 } },
    { name: '中心移到右上角', geo: {}, user: { cx: 60, cy: 4 } },
  ];
  for (const { name, geo, user } of geos) {
    const small: SlashFanSpec = { ...defaultSlashSpec('a'), ...geo, w: 64, h: 64, ...user };
    const big: SlashFanSpec = { ...small, w: small.w + 160, h: small.h + 160, cx: small.cx + 80, cy: small.cy + 80 };
    let aligned = true;
    let compared = 0;
    for (const p of [0.45, 0.6, 0.8]) {
      const a = generateSlashFrame(small, p, false);
      const b = generateSlashFrame(big, p, false);
      const dx = b.plugX - a.plugX, dy = b.plugY - a.plugY;
      for (let y = 0; y < a.h && aligned; y++) {
        for (let x = 0; x < a.w; x++) {
          const bx = x + dx, by = y + dy;
          if (bx < 0 || by < 0 || bx >= b.w || by >= b.h) { aligned = false; break; }
          const ia = (y * a.w + x) * 4, ib = (by * b.w + bx) * 4;
          for (let k = 0; k < 4; k++) if (a.rgba[ia + k] !== b.rgba[ib + k]) { aligned = false; break; }
          compared++;
        }
      }
      if (!aligned) break;
    }
    ok(aligned && compared > 0, `① ${name}：小盒帧逐像素等于大盒帧 plug 对齐位置（${compared} 像素）`);
    // 镜像帧同理（plug 横坐标 = 帧宽 − plugX）
    const a = generateSlashFrame(small, 0.6, true);
    const b = generateSlashFrame(big, 0.6, true);
    const dx = (b.w - b.plugX) - (a.w - a.plugX), dy = b.plugY - a.plugY;
    let mirAligned = true;
    for (let y = 0; y < a.h && mirAligned; y++) {
      for (let x = 0; x < a.w; x++) {
        const bx = x + dx, by = y + dy;
        if (bx < 0 || by < 0 || bx >= b.w || by >= b.h) { mirAligned = false; break; }
        const ia = (y * a.w + x) * 4, ib = (by * b.w + bx) * 4;
        for (let k = 0; k < 4; k++) if (a.rgba[ia + k] !== b.rgba[ib + k]) { mirAligned = false; break; }
      }
    }
    ok(mirAligned, `① ${name}（镜像）：镜像帧同样 plug 对齐一致`);
  }
}

// ---------- ② 盒随几何长大 ----------
{
  const spec: SlashFanSpec = { ...defaultSlashSpec('a'), rx: 48, ry: 44, cx: 32, cy: 32, w: 64, h: 64 };
  const lay = slashFrameLayout(spec);
  ok(lay.w > 64 && lay.h > 64, `② 半轴 48×44 时有效帧 ${lay.w}×${lay.h} 超过用户盒 64×64`);
  // 扇形随进度先展尾侧（左）后展头侧（右）：两进度并集断言
  let outRight = 0, outLeft = 0;
  for (const p of [0.45, 0.6]) {
    const f = generateSlashFrame(spec, p, false);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      if (f.rgba[(y * f.w + x) * 4 + 3]! > 0) {
        if (x - f.plugX >= 64 - 32) outRight++;
        if (x - f.plugX < -32) outLeft++;
      }
    }
  }
  ok(outRight > 0 && outLeft > 0, `② 扇体像素出现在旧盒范围之外（右 ${outRight} / 左 ${outLeft} 像素）`);
}

// ---------- ③ 旧规格不回归（基线哈希：基点 af5a0c8 未改生成器） ----------
const BASELINE: Record<string, Record<string, string>> = {
  '默认': { '0|0': 'fcd7c9a0eaf1cb29', '0|1': 'ebac94184923e3b1', '0.2|0': '78f9f1460bd32ecd', '0.2|1': '56a41f9a53572068', '0.45|0': 'ec7769413cf99dca', '0.45|1': '6083ac491f867c5a', '0.58|0': '59c2d3b259fff6ef', '0.58|1': '2b7b7ea57c28f07e', '0.8|0': '3c40031bbf44b766', '0.8|1': 'cf5eb97f128cadcb', '1|0': 'f340b29d944dad0f', '1|1': 'f340b29d944dad0f' },
  '上挑斩': { '0|0': 'fcd7c9a0eaf1cb29', '0|1': 'ebac94184923e3b1', '0.2|0': '78f9f1460bd32ecd', '0.2|1': '56a41f9a53572068', '0.45|0': 'ec7769413cf99dca', '0.45|1': '6083ac491f867c5a', '0.58|0': '59c2d3b259fff6ef', '0.58|1': '2b7b7ea57c28f07e', '0.8|0': '3c40031bbf44b766', '0.8|1': 'cf5eb97f128cadcb', '1|0': 'f340b29d944dad0f', '1|1': 'f340b29d944dad0f' },
  '横斩': { '0|0': '6ad27c4f3f173028', '0|1': '5507b290ac8cb7a2', '0.2|0': '4e677a0faa67afe7', '0.2|1': 'e9f166358cf22a20', '0.45|0': '4a75a135cfe289f8', '0.45|1': 'cbe8ea4f25877019', '0.58|0': 'bc5bd94247f5770a', '0.58|1': '831aedd4595214b8', '0.8|0': '52fa8e0a9249bab7', '0.8|1': 'a6dc0badbb6f944c', '1|0': 'f340b29d944dad0f', '1|1': 'f340b29d944dad0f' },
  '下劈': { '0|0': 'fb5df6664811f989', '0|1': '3f1c3db689b812d9', '0.2|0': '4dadc2165dc122c8', '0.2|1': '69d6b4399d85a06d', '0.45|0': '497141281608e753', '0.45|1': 'ccabf2478d185578', '0.58|0': '97485b6e7f4da136', '0.58|1': 'd0066dc76e101136', '0.8|0': 'eb4ffd3b8cdc2aca', '0.8|1': '651dbf8f3f3e1651', '1|0': 'f340b29d944dad0f', '1|1': 'f340b29d944dad0f' },
  '大回旋': { '0|0': 'c6b1410f2c4d5dd9', '0|1': '90299b0c63585383', '0.2|0': 'ec60f2f1e429d278', '0.2|1': 'd0156da73f6ec4a2', '0.45|0': '937624a68eb242a6', '0.45|1': '0048cf509042068e', '0.58|0': 'e8d483da9b6e9811', '0.58|1': 'c2dac3e79f34d230', '0.8|0': '02f8b92c03c73c60', '0.8|1': '92b36283b7dc8171', '1|0': 'f340b29d944dad0f', '1|1': 'f340b29d944dad0f' },
};
const legacySpecs: { name: string; spec: SlashFanSpec }[] = [
  { name: '默认', spec: defaultSlashSpec('a') },
  ...SLASH_PRESETS.map((pr) => ({ name: pr.name, spec: { ...defaultSlashSpec('a'), ...pr.params } })),
];
{ // 原本未被裁的 3 个：逐字节一致 + 布局不变
  for (const { name, spec } of legacySpecs.filter((s) => ['默认', '上挑斩', '下劈'].includes(s.name))) {
    let same = true;
    for (const p of PS) for (const mir of [false, true]) {
      const f = generateSlashFrame(spec, p, mir);
      if (hash(f.w, f.h, f.rgba) !== BASELINE[name]![`${p}|${mir ? 1 : 0}`]) same = false;
    }
    const lay = slashFrameLayout(spec);
    ok(same && lay.w === 64 && lay.h === 64 && lay.plugX === spec.cx && lay.plugY === spec.cy,
      `③ ${name}（原本未裁）：6 进度 × 镜像逐字节一致、布局仍 64×64/plug=(${spec.cx},${spec.cy})`);
  }
}
{ // 原本已被裁的 2 个：旧帧内容保全（裁剪哈希）+ 被裁像素回归 + 布局符合紧包围盒
  const grown: Record<string, { w: number; h: number; plugX: number; plugY: number }> = {
    '横斩': { w: 74, h: 64, plugX: 38, plugY: 54 },
    '大回旋': { w: 64, h: 70, plugX: 32, plugY: 42 },
  };
  const cropHash = (spec: SlashFanSpec, p: number) => {
    const f = generateSlashFrame(spec, p, false);
    const ox = f.plugX - spec.cx, oy = f.plugY - spec.cy;
    const crop = new Uint8Array(64 * 64 * 4);
    for (let y = 0; y < 64; y++) {
      crop.set(f.rgba.subarray(((y + oy) * f.w + ox) * 4, ((y + oy) * f.w + ox + 64) * 4), y * 64 * 4);
    }
    return hash(64, 64, crop);
  };
  for (const { name, spec } of legacySpecs.filter((s) => s.name in grown)) {
    const g = grown[name]!;
    const lay = slashFrameLayout(spec);
    ok(lay.w === g.w && lay.h === g.h && lay.plugX === g.plugX && lay.plugY === g.plugY,
      `③ ${name}（原本已裁）：有效帧 ${lay.w}×${lay.h}、plug=(${lay.plugX},${lay.plugY}) 符合扇形紧包围盒并集`);
    let kept = true;
    for (const p of PS) if (cropHash(spec, p) !== BASELINE[name]![`${p}|0`]) kept = false;
    ok(kept, `③ ${name}：旧帧 64×64 内容在新帧 plug 对齐裁剪下逐字节保全（6 进度）`);
  }
  // 被裁像素回归：横斩旧足迹外（列 <6 或 ≥70）、大回旋旧足迹下（行 ≥64）出现绘制像素
  const hz = legacySpecs.find((s) => s.name === '横斩')!.spec;
  let hzOut = 0;
  for (const p of [0, 0.1, 0.2, 0.3, 0.4, 0.45, 0.5, 0.58, 0.6, 0.7, 0.8, 0.9, 1]) {
    const f = generateSlashFrame(hz, p, false);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      if (f.rgba[(y * f.w + x) * 4 + 3]! > 0 && (x < 6 || x >= 70)) hzOut++;
    }
  }
  ok(hzOut > 0, `③ 横斩：被裁像素回归（旧足迹外绘制像素 ${hzOut} 个）`);
  const dh = legacySpecs.find((s) => s.name === '大回旋')!.spec;
  let dhOut = 0, dhMaxRow = -1;
  for (const p of [0, 0.1, 0.2, 0.3, 0.4, 0.45, 0.5, 0.58, 0.6, 0.7, 0.8, 0.9, 1]) {
    const f = generateSlashFrame(dh, p, false);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      if (f.rgba[(y * f.w + x) * 4 + 3]! > 0) { if (y >= 64) dhOut++; if (y > dhMaxRow) dhMaxRow = y; }
    }
  }
  ok(dhOut > 0 && dhMaxRow === 69, `③ 大回旋：被裁像素回归（旧足迹下 ${dhOut} 个、最深行 ${dhMaxRow}=基点实测 27+plugY 42）`);
}

// ---------- ④ 颜色档 ----------
{
  const mono: SlashFanSpec = { ...defaultSlashSpec('a'), colors: ['#123456', '#123456'] };
  const f = generateSlashFrame(mono, 0.45, false);
  let painted = 0, allMono = true;
  for (let i = 0; i < f.rgba.length; i += 4) {
    if (f.rgba[i + 3]! > 0) {
      painted++;
      if (f.rgba[i] !== 0x12 || f.rgba[i + 1] !== 0x34 || f.rgba[i + 2] !== 0x56) allMono = false;
    }
  }
  ok(allMono && painted > 200, `④ 双停靠同色 #123456：全部 ${painted} 个绘制像素取指定色`);
  const two: SlashFanSpec = { ...defaultSlashSpec('a'), colors: ['#ff0000', '#0000ff'] };
  const f2 = generateSlashFrame(two, 0.45, false);
  const fb = generateSlashFrame(defaultSlashSpec('a'), 0.45, false);
  let hasRed = false, hasBlue = false, builtinHasPureRed = false;
  for (let i = 0; i < f2.rgba.length; i += 4) {
    if (f2.rgba[i + 3]! > 0 && f2.rgba[i] === 255 && f2.rgba[i + 1] === 0 && f2.rgba[i + 2] === 0) hasRed = true;
    if (f2.rgba[i + 3]! > 0 && f2.rgba[i] === 0 && f2.rgba[i + 1] === 0 && f2.rgba[i + 2] === 255) hasBlue = true;
  }
  for (let i = 0; i < fb.rgba.length; i += 4) {
    if (fb.rgba[i + 3]! > 0 && fb.rgba[i] === 255 && fb.rgba[i + 1] === 0 && fb.rgba[i + 2] === 0) builtinHasPureRed = true;
  }
  ok(hasRed && hasBlue && !builtinHasPureRed, '④ 红/蓝双色档：外弧侧纯红、内界侧纯蓝像素均出现（内置档无纯红）');
  const src = readFileSync(new URL('../src/components/pixel-editor/puppet/SlashEffectEditor.tsx', import.meta.url), 'utf8');
  ok(src.includes('type="color"') && src.includes('SLASH_PALETTE') && src.includes('恢复内置') && src.includes('linear-gradient'),
    '④ 编辑器颜色接线在位（取色器/渐变预览带/恢复内置/内置档回显）');
}

console.log(fails === 0 ? 'SLASH BBOX PROBE PASS' : `SLASH BBOX PROBE FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
