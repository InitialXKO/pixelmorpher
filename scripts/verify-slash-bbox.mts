// 刀光包围盒探针（用户裁决：移动/放大参数应移动包围盒、盒随几何
// 长大，像素永不被裁）：
// ① 不裁切：同一几何在小用户盒与大用户盒下生成，按各自返回的
//    plug 对齐后小盒帧逐像素等于大盒帧对应像素（多组参数）。
// ② 盒随几何长大：放大半轴后帧尺寸超过用户盒、扇体像素出现在
//    旧盒范围之外。
// ③ 新语义布局锚点（2026-10-28 中心改相对锚点偏移后）：覆盖盒
//    以锚点为中心，默认+四预设（cx/cy 已归零）的有效帧尺寸与
//    plug 位置按下表锚定；像素内容相对 plug 的保真比对（旧语义
//    出帧 vs 迁移后出帧逐点一致）由 verify-slash-center ① 承载
//    （含原本被裁的横斩/大回旋的像素回归）。
// ④ 颜色档：自定义 colors 逐像素取指定色、与内置档不同；编辑
//    器颜色接线在位（源级断言）。
import { readFileSync } from 'node:fs';
import {
  generateSlashFrame, slashFrameLayout, SLASH_PRESETS, defaultSlashSpec,
  type SlashFanSpec,
} from '../src/lib/slash-fan';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const PS = [0, 0.2, 0.45, 0.58, 0.8, 1];

// ---------- ① 不裁切：小盒帧是大盒帧的 plug 对齐子图 ----------
{
  const geos: { name: string; geo: Partial<SlashFanSpec>; user: Partial<SlashFanSpec> }[] = [
    { name: '中心偏移到左上', geo: {}, user: { cx: -30, cy: -30 } },
    { name: '半轴放大到盒外', geo: { rx: 48, ry: 44 }, user: { cx: 0, cy: 0 } },
    { name: '旋转45°大扫角', geo: { rotDeg: 45, a0Deg: -30, sweepDeg: 200, rx: 36, ry: 18 }, user: { cx: 0, cy: 0 } },
    { name: '中心偏移到右上', geo: {}, user: { cx: 28, cy: -28 } },
  ];
  for (const { name, geo, user } of geos) {
    const small: SlashFanSpec = { ...defaultSlashSpec('a'), ...geo, w: 64, h: 64, ...user };
    // 新语义：覆盖盒以锚点为中心，放大 w/h 只扩覆盖、偏移不动
    const big: SlashFanSpec = { ...small, w: small.w + 160, h: small.h + 160 };
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
  const spec: SlashFanSpec = { ...defaultSlashSpec('a'), rx: 48, ry: 44, cx: 0, cy: 0, w: 64, h: 64 };
  const lay = slashFrameLayout(spec);
  ok(lay.w > 64 && lay.h > 64, `② 半轴 48×44 时有效帧 ${lay.w}×${lay.h} 超过用户盒 64×64`);
  // 覆盖盒以锚点（plug）为中心：相对范围 [−32, +32)；扇体像素
  // 出现在此范围之外即盒随几何长大生效（两进度并集断言）
  let outRight = 0, outLeft = 0;
  for (const p of [0.45, 0.6]) {
    const f = generateSlashFrame(spec, p, false);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      if (f.rgba[(y * f.w + x) * 4 + 3]! > 0) {
        if (x - f.plugX >= 32) outRight++;
        if (x - f.plugX < -32) outLeft++;
      }
    }
  }
  ok(outRight > 0 && outLeft > 0, `② 扇体像素出现在旧盒范围之外（右 ${outRight} / 左 ${outLeft} 像素）`);
}

// ---------- ③ 新语义布局锚点 ----------
// 默认 + 四预设（cx/cy 已按新语义归零）：有效帧 = 以锚点为中心
// 的覆盖盒 ∪ 扇形紧包围盒。锚点值取自主会话实测（2026-10-28）：
// 横斩几何盒宽于覆盖盒 → 帧宽 74；下劈几何向下延出 → 帧高 69；
// 大回旋旧语义下靠 cy=42 把盒撑到 70 高，新语义覆盖盒以锚点为
// 中心、几何全程在 64 内 → 回到 64×64。像素内容相对 plug 的保
// 真由 verify-slash-center ① 对旧语义参照实现逐点比对承载。
const legacySpecs: { name: string; spec: SlashFanSpec }[] = [
  { name: '默认', spec: defaultSlashSpec('a') },
  ...SLASH_PRESETS.map((pr) => ({ name: pr.name, spec: { ...defaultSlashSpec('a'), ...pr.params } })),
];
{
  const anchors: Record<string, { w: number; h: number; plugX: number; plugY: number }> = {
    '默认': { w: 64, h: 64, plugX: 32, plugY: 32 },
    '上挑斩': { w: 64, h: 64, plugX: 32, plugY: 32 },
    '横斩': { w: 74, h: 64, plugX: 38, plugY: 32 },
    '下劈': { w: 64, h: 69, plugX: 32, plugY: 32 },
    '大回旋': { w: 64, h: 64, plugX: 32, plugY: 32 },
  };
  for (const { name, spec } of legacySpecs) {
    const a = anchors[name]!;
    const lay = slashFrameLayout(spec);
    ok(lay.w === a.w && lay.h === a.h && lay.plugX === a.plugX && lay.plugY === a.plugY,
      `③ ${name}：有效帧 ${lay.w}×${lay.h}、plug=(${lay.plugX},${lay.plugY}) 符合锚点中心覆盖盒 ∪ 紧包围盒`);
    ok(spec.cx === 0 && spec.cy === 0, `③ ${name}：预设/默认 cx/cy 已是新语义零偏移`);
  }
  // 被裁像素回归（新语义口径）：横斩扇体相对 plug 向左越过覆盖
  // 盒左界（相对 plug < −32）仍有绘制像素；大回旋旧语义下用户盒
  // 下界只到相对 +22（cy=42、盒高 64），扇体最深 +27 被裁——新
  // 覆盖盒下界 +32，旧被裁带 [23, 32) 内的像素回归即不裁证据
  const hz = legacySpecs.find((s) => s.name === '横斩')!.spec;
  let hzOut = 0;
  for (const p of PS) {
    const f = generateSlashFrame(hz, p, false);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      if (f.rgba[(y * f.w + x) * 4 + 3]! > 0 && x - f.plugX < -32) hzOut++;
    }
  }
  ok(hzOut > 0, `③ 横斩：覆盖盒外（相对 plug < −32）绘制像素 ${hzOut} 个，扇体不被裁`);
  const dh = legacySpecs.find((s) => s.name === '大回旋')!.spec;
  let dhBand = 0, dhMaxRel = -Infinity;
  for (const p of PS) {
    const f = generateSlashFrame(dh, p, false);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      if (f.rgba[(y * f.w + x) * 4 + 3]! > 0) {
        const rel = y - f.plugY;
        if (rel >= 23 && rel < 32) dhBand++;
        if (rel > dhMaxRel) dhMaxRel = rel;
      }
    }
  }
  ok(dhBand > 0 && dhMaxRel === 27, `③ 大回旋：旧被裁带 [23,32) 回归 ${dhBand} 个像素、最深相对行 ${dhMaxRel}（与旧实测 27 一致）`);
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
