// 刀光中心语义 + 扫向探针（2026-10-28 用户裁决两项）：
// ① 中心改相对锚点的偏移（甲案）：cx/cy 不再兼任帧内对位点。
//    - 迁移保真：旧预设四档 + 默认规格的旧数值（下方 OLD_* 为基点
//      原值），按迁移规则 cx/cy 归零后用新生成器出帧，与旧语义参
//      照实现（本文件内嵌、逐字复制自基点 bf6eeda 的 slash-fan）
//      在旧数值下出帧的「亮像素相对 plug 集合」逐点一致（帧尺寸
//      可不同、相对位置与像素值一致；镜像帧 plug 横坐标按
//      w − plugX 口径）。
//    - 偏移生效：整数偏移下亮像素集相对 plug 恰好整体平移该偏移。
// ② 扫向开关 dir：缺省 ≡ dir:1 逐字节；dir:-1 自起始角反向行进
//    （同弧段对位时包围盒与顺时针一致、头部落在行进远端、与顺
//    时针帧显著不同、且不是顺时针帧的静态镜像）。
// ③ 迁移 walker 覆盖面：定义/表演字段/表演图规格节点/片段字段
//    归零，引用形态节点不动，二次调用幂等归零。
// ④ 源级接线：导入链标记门控与迁移先于蓝图同步、面板扫向切换
//    与偏移说明与锚点十字、convert dir 透传、蓝图参数表含 dir。
import { readFileSync } from 'node:fs';
import {
  generateSlashFrame, slashFrameLayout, SLASH_PALETTE,
  type SlashFanSpec,
} from '../src/lib/slash-fan';
import { migrateSlashCenterOffsets } from '../src/lib/blueprint/slash-sync';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const PS = [0, 0.2, 0.45, 0.58, 0.8, 1];

// ---------- 旧语义参照实现（逐字复制自基点 bf6eeda 的 slash-fan.ts，仅改名） ----------
function oldHexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function oldSmooth01(t: number): number {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
function oldSlashFrameLayout(spec: SlashFanSpec): { w: number; h: number; plugX: number; plugY: number } {
  const outW = Math.max(4, Math.round(spec.w));
  const outH = Math.max(4, Math.round(spec.h));
  const rx = Math.max(2, spec.rx), ry = Math.max(2, spec.ry);
  const rot = (spec.rotDeg * Math.PI) / 180;
  const a0 = (spec.a0Deg * Math.PI) / 180;
  const sweep = Math.max(0.06, Math.min(5.8, (spec.sweepDeg * Math.PI) / 180));
  const S = 1.22;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  let gx0 = 0, gy0 = 0, gx1 = 0, gy1 = 0;
  const eat = (t: number) => {
    const lx = S * rx * Math.cos(t), ly = S * ry * Math.sin(t);
    const x = lx * cr - ly * sr, y = lx * sr + ly * cr;
    if (x < gx0) gx0 = x;
    if (x > gx1) gx1 = x;
    if (y < gy0) gy0 = y;
    if (y > gy1) gy1 = y;
  };
  eat(a0);
  eat(a0 + sweep);
  const TWO_PI = Math.PI * 2;
  const inRange = (t: number) => {
    let r = (t - a0) % TWO_PI;
    if (r < 0) r += TWO_PI;
    return r <= sweep + 1e-12;
  };
  const tx = Math.atan2(-(ry * sr), rx * cr);
  if (inRange(tx)) eat(tx);
  if (inRange(tx + Math.PI)) eat(tx + Math.PI);
  const ty = Math.atan2(ry * cr, rx * sr);
  if (inRange(ty)) eat(ty);
  if (inRange(ty + Math.PI)) eat(ty + Math.PI);
  const ux0 = Math.min(0, spec.cx + gx0), ux1 = Math.max(outW, spec.cx + gx1);
  const uy0 = Math.min(0, spec.cy + gy0), uy1 = Math.max(outH, spec.cy + gy1);
  const ox = Math.floor(ux0), oy = Math.floor(uy0);
  return {
    w: Math.ceil(ux1) - ox,
    h: Math.ceil(uy1) - oy,
    plugX: spec.cx - ox,
    plugY: spec.cy - oy,
  };
}
function oldGenerateSlashFrame(spec: SlashFanSpec, p: number, mirrored = false) {
  const lay = oldSlashFrameLayout(spec);
  const outW = lay.w;
  const outH = lay.h;
  const buf = new Uint8Array(outW * outH * 4);
  const palette = (spec.colors && spec.colors.length >= 2 ? spec.colors : SLASH_PALETTE).map(oldHexToRgb);
  const cx = lay.plugX, cy = lay.plugY;
  const rx = Math.max(2, spec.rx), ry = Math.max(2, spec.ry);
  const rotRad = (spec.rotDeg * Math.PI) / 180;
  const a0 = (spec.a0Deg * Math.PI) / 180;
  const sweep = Math.max(0.06, Math.min(5.8, (spec.sweepDeg * Math.PI) / 180));
  const thick = Math.max(0.04, Math.min(0.97, spec.thick));
  const gammaAng = Math.max(0.25, spec.gammaAng);
  const softRad = Math.max(0.01, spec.softRad);
  const TWO_PI = Math.PI * 2;
  const cosR = Math.cos(-rotRad), sinR = Math.sin(-rotRad);
  const head = 0.14 + 0.86 * oldSmooth01(p / 0.58);
  const tail = oldSmooth01((p - 0.44) / 0.56) * 1.06;
  if (head - tail >= 0.018) {
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const px = x + 0.5 - cx;
        const py = y + 0.5 - cy;
        const lx = px * cosR - py * sinR;
        const ly = px * sinR + py * cosR;
        const ex = lx / rx, ey = ly / ry;
        const rho = Math.sqrt(ex * ex + ey * ey);
        if (rho > 1.22) continue;
        const t = Math.atan2(ey, ex);
        let rel = t - a0;
        rel = ((rel % TWO_PI) + TWO_PI) % TWO_PI;
        if (rel > sweep) continue;
        const u = rel / sweep;
        if (u < tail || u > head) continue;
        const uNorm = (u - tail) / Math.max(0.001, head - tail);
        let A = Math.pow(Math.max(0, uNorm), gammaAng);
        A *= oldSmooth01(0.15 + 0.85 * uNorm);
        if (A < 0.004) continue;
        const inner = 1 - thick * A;
        const o = (y * outW + x) * 4;
        if (rho <= 1) {
          if (rho < inner - 0.015) continue;
          const s = (rho - inner) / Math.max(0.001, 1 - inner);
          if (s < 0) continue;
          const edge = oldSmooth01(s / softRad);
          if (edge < 0.02) continue;
          const radB = Math.pow(Math.min(1, s), 0.75);
          const angB = Math.pow(uNorm, 0.55);
          const bright = edge * (0.35 + 0.65 * radB) * (0.35 + 0.65 * angB);
          let colIdx = Math.floor((1 - s) * palette.length);
          colIdx += Math.floor((1 - uNorm) * 2.2);
          if (colIdx > palette.length - 1) colIdx = palette.length - 1;
          if (colIdx < 0) colIdx = 0;
          const rgb = palette[colIdx]!;
          const a8 = (bright * 255) | 0;
          if (a8 < 6) continue;
          buf[o] = rgb[0]; buf[o + 1] = rgb[1]; buf[o + 2] = rgb[2]; buf[o + 3] = a8;
        } else {
          const glow = oldSmooth01(1 - (rho - 1) / 0.28);
          if (glow < 0.04) continue;
          const g = glow * 0.24 * A;
          if (g < 0.02) continue;
          const rgb = palette[palette.length - 1]!;
          const a8 = (g * 255) | 0;
          buf[o] = rgb[0]; buf[o + 1] = rgb[1]; buf[o + 2] = rgb[2]; buf[o + 3] = a8;
        }
      }
    }
  }
  if (mirrored) {
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < (outW >> 1); x++) {
        const a = (y * outW + x) * 4;
        const b = (y * outW + (outW - 1 - x)) * 4;
        for (let k = 0; k < 4; k++) {
          const tmp = buf[a + k]!;
          buf[a + k] = buf[b + k]!;
          buf[b + k] = tmp;
        }
      }
    }
  }
  return { w: outW, h: outH, plugX: lay.plugX, plugY: lay.plugY, rgba: buf };
}

// ---------- 工具 ----------
type FrameLike = { w: number; h: number; plugX: number; plugY: number; rgba: Uint8Array };
/** 亮像素相对 plug 的集合（键 = 相对坐标，值 = RGBA）；镜像帧按 w − plugX 口径 */
function relSet(f: FrameLike, mirrored: boolean): Map<string, string> {
  const plugX = mirrored ? f.w - f.plugX : f.plugX;
  const m = new Map<string, string>();
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const o = (y * f.w + x) * 4;
    if (f.rgba[o + 3]! > 0) {
      m.set(`${x - plugX},${y - f.plugY}`, `${f.rgba[o]},${f.rgba[o + 1]},${f.rgba[o + 2]},${f.rgba[o + 3]}`);
    }
  }
  return m;
}
const setsEqual = (a: Map<string, string>, b: Map<string, string>): boolean => {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
};

// ---------- ① 迁移保真 ----------
const OLD_DEFAULT: SlashFanSpec = {
  anchorNodeId: 'a', frameCount: 6, w: 64, h: 64,
  cx: 32, cy: 52, rx: 27, ry: 25, rotDeg: -12, a0Deg: -150, sweepDeg: 130,
  thick: 0.62, gammaAng: 1.4, softRad: 0.28,
};
const OLD_SPECS: { name: string; spec: SlashFanSpec }[] = [
  { name: '默认', spec: OLD_DEFAULT },
  { name: '上挑斩', spec: { ...OLD_DEFAULT } },
  { name: '横斩', spec: { ...OLD_DEFAULT, cx: 32, cy: 54, rx: 31, ry: 20, rotDeg: 0, a0Deg: -170, sweepDeg: 150, thick: 0.55, gammaAng: 1.2, softRad: 0.24 } },
  { name: '下劈', spec: { ...OLD_DEFAULT, cx: 32, cy: 10, rx: 24, ry: 30, rotDeg: 6, a0Deg: 20, sweepDeg: 130, thick: 0.7, gammaAng: 1.6, softRad: 0.3 } },
  { name: '大回旋', spec: { ...OLD_DEFAULT, cx: 32, cy: 42, rx: 26, ry: 24, rotDeg: 18, a0Deg: -200, sweepDeg: 250, thick: 0.72, gammaAng: 1.1, softRad: 0.32 } },
  // 任意旧数值（用户手调过的非预设值）：旧语义下偏移恒为 0，归零同样保真
  { name: '手调值', spec: { ...OLD_DEFAULT, cx: 7, cy: 61, rx: 40, ry: 18, rotDeg: 33, a0Deg: -80, sweepDeg: 210 } },
];
{
  let allSame = true;
  let compared = 0;
  for (const { name, spec } of OLD_SPECS) {
    const migrated: SlashFanSpec = { ...spec, cx: 0, cy: 0 };
    for (const p of PS) for (const mir of [false, true]) {
      const a = relSet(oldGenerateSlashFrame(spec, p, mir), mir);
      const b = relSet(generateSlashFrame(migrated, p, mir), mir);
      compared += a.size;
      if (!setsEqual(a, b)) {
        allSame = false;
        console.log(`    ① 不一致：${name} p=${p} mir=${mir} 旧 ${a.size} px / 新 ${b.size} px`);
      }
    }
  }
  ok(allSame, `① 迁移保真：6 份旧规格 × 6 进度 × 镜像，亮像素相对 plug 集合逐点一致（比对 ${compared} 像素次）`);
}

// ---------- ① 偏移生效：整数偏移 = 像素集恰好整体平移 ----------
{
  const base: SlashFanSpec = { ...OLD_DEFAULT, cx: 0, cy: 0 };
  const shifted = (set: Map<string, string>, dx: number, dy: number) => {
    const m = new Map<string, string>();
    for (const [k, v] of set) {
      const [x, y] = k.split(',').map(Number);
      m.set(`${x! + dx},${y! + dy}`, v);
    }
    return m;
  };
  let exact = true;
  for (const [dx, dy] of [[20, 0], [-20, 0], [0, 20], [13, -7]] as const) {
    for (const p of [0.2, 0.45, 0.8]) {
      const a = relSet(generateSlashFrame(base, p, false), false);
      const b = relSet(generateSlashFrame({ ...base, cx: dx, cy: dy }, p, false), false);
      if (!setsEqual(shifted(a, dx, dy), b)) exact = false;
    }
  }
  ok(exact, '① 偏移生效：cx/cy 改 ±20、(13,−7) 时亮像素集相对 plug 恰好整体平移该偏移（3 进度）');
  // 质心口径（容差内）：cx +20 → 质心 Δ=(+20, 0)
  const centroid = (f: FrameLike) => {
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const a = f.rgba[(y * f.w + x) * 4 + 3]!;
      if (a > 0) { sx += (x - f.plugX) * a; sy += (y - f.plugY) * a; n += a; }
    }
    return { x: sx / n, y: sy / n };
  };
  const c0 = centroid(generateSlashFrame(base, 0.45, false));
  const cX = centroid(generateSlashFrame({ ...base, cx: 20 }, 0.45, false));
  const cY = centroid(generateSlashFrame({ ...base, cy: 20 }, 0.45, false));
  ok(Math.abs(cX.x - c0.x - 20) < 0.01 && Math.abs(cX.y - c0.y) < 0.01
    && Math.abs(cY.y - c0.y - 20) < 0.01 && Math.abs(cY.x - c0.x) < 0.01,
    `① 质心平移：cx+20 Δ=(${(cX.x - c0.x).toFixed(2)},${(cX.y - c0.y).toFixed(2)})、cy+20 Δ=(${(cY.x - c0.x).toFixed(2)},${(cY.y - c0.y).toFixed(2)})`);
}

// ---------- ② 扫向 ----------
{
  const base: SlashFanSpec = { ...OLD_DEFAULT, cx: 0, cy: 0 };
  // 缺省 ≡ dir:1 逐字节（顺时针零回归：带符号角距在 dir=1 时与旧式恒等）
  let identical = true;
  const dirSpecs: SlashFanSpec[] = [
    base,
    { ...base, cx: -14, cy: 22, rotDeg: 30, a0Deg: 40, sweepDeg: 250 },
    { ...base, rx: 40, ry: 16, sweepDeg: 320 },
  ];
  for (const s of dirSpecs) for (const p of PS) for (const mir of [false, true]) {
    const a = generateSlashFrame(s, p, mir);
    const b = generateSlashFrame({ ...s, dir: 1 }, p, mir);
    if (a.w !== b.w || a.h !== b.h || a.plugX !== b.plugX || a.plugY !== b.plugY
      || !a.rgba.every((v, i) => v === b.rgba[i])) identical = false;
  }
  ok(identical, '② 顺时针零回归：dir 缺省与 dir:1 的帧（尺寸/plug/RGBA）逐字节一致（3 规格 × 6 进度 × 镜像）');

  // 同弧段对位：逆时针自 a0+sweep 出发反向扫同一弧段 → 静态包围盒（布局）与顺时针一致
  let bboxSame = true;
  for (const s of dirSpecs) {
    const cw = slashFrameLayout(s);
    const ccw = slashFrameLayout({ ...s, a0Deg: s.a0Deg + s.sweepDeg, dir: -1 });
    if (cw.w !== ccw.w || cw.h !== ccw.h || cw.plugX !== ccw.plugX || cw.plugY !== ccw.plugY) bboxSame = false;
  }
  ok(bboxSame, '② 逆时针同弧段对位（a0+扫过角出发）：有效帧布局 w/h/plug 与顺时针逐值一致');

  // 头部位置：中间帧亮像素质心方向更贴行进远端（头部端）
  const endDir = (s: SlashFanSpec, deg: number) => {
    const t = (deg * Math.PI) / 180;
    const rot = (s.rotDeg * Math.PI) / 180;
    const lx = Math.max(2, s.rx) * Math.cos(t), ly = Math.max(2, s.ry) * Math.sin(t);
    const x = lx * Math.cos(rot) - ly * Math.sin(rot), y = lx * Math.sin(rot) + ly * Math.cos(rot);
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  };
  const centroidRelCenter = (f: FrameLike, s: SlashFanSpec) => {
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const a = f.rgba[(y * f.w + x) * 4 + 3]!;
      if (a > 0) { sx += (x - f.plugX - s.cx) * a; sy += (y - f.plugY - s.cy) * a; n += a; }
    }
    const vx = sx / n, vy = sy / n;
    const len = Math.hypot(vx, vy) || 1;
    return { x: vx / len, y: vy / len };
  };
  const dot = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x * b.x + a.y * b.y;
  const s = base;
  const cwC = centroidRelCenter(generateSlashFrame(s, 0.45, false), s);
  const cwHead = dot(cwC, endDir(s, s.a0Deg + s.sweepDeg));
  const cwTail = dot(cwC, endDir(s, s.a0Deg));
  const ccwSpec: SlashFanSpec = { ...s, a0Deg: s.a0Deg + s.sweepDeg, dir: -1 };
  const ccwC = centroidRelCenter(generateSlashFrame(ccwSpec, 0.45, false), ccwSpec);
  const ccwHead = dot(ccwC, endDir(s, s.a0Deg)); // 行进远端 = a0 端
  const ccwTail = dot(ccwC, endDir(s, s.a0Deg + s.sweepDeg));
  ok(cwHead > cwTail && ccwHead > ccwTail,
    `② 头部跟随扫向：顺时针质心贴头端（${cwHead.toFixed(2)} > 尾端 ${cwTail.toFixed(2)}）、逆时针贴其行进远端（${ccwHead.toFixed(2)} > ${ccwTail.toFixed(2)}）`);

  // 同规格只改 dir：与顺时针帧显著不同，且不是静态镜像
  const cwF = generateSlashFrame(s, 0.45, false);
  const ccwF = generateSlashFrame({ ...s, dir: -1 }, 0.45, false);
  const cwSet = relSet(cwF, false);
  const ccwSet = relSet(ccwF, false);
  let diff = 0;
  for (const [k, v] of cwSet) if (ccwSet.get(k) !== v) diff++;
  for (const k of ccwSet.keys()) if (!cwSet.has(k)) diff++;
  ok(diff > 200, `② 逆时针（同 a0）与顺时针帧显著不同（相对 plug 集合差 ${diff} 像素）`);
  const mirSet = relSet(generateSlashFrame(s, 0.45, true), true);
  let mirDiff = 0;
  for (const [k, v] of mirSet) if (ccwSet.get(k) !== v) mirDiff++;
  for (const k of ccwSet.keys()) if (!mirSet.has(k)) mirDiff++;
  ok(mirDiff > 200, `② 逆时针不是顺时针的静态镜像（与镜像帧集合差 ${mirDiff} 像素）`);
}

// ---------- ③ 迁移 walker 覆盖面 ----------
{
  const specNode = (cx: number, cy: number) => ({
    id: 'slashfx', type: 'slash_fan', inputs: {},
    params: { enabled: true, anchorNodeId: 'a', cx, cy }, ui: { x: 0, y: 0 },
  });
  const chars: Record<string, any> = {
    ch1: {
      slashDefs: [{ id: 'd1', name: '定义', spec: { ...OLD_DEFAULT } }],
      performances: [{
        id: 'p1',
        slashEffect: { ...OLD_DEFAULT, cx: 11, cy: 22 },
        graphs: {
          a: {
            version: 1, outputId: 'out',
            nodes: [
              specNode(32, 52),
              { id: 'hand', type: 'slash_fan', inputs: {}, params: { cx: 5, cy: 6 }, ui: { x: 0, y: 0 } },
              { id: 'ref', type: 'slash_fan', inputs: {}, params: { enabled: true, __defId: 'd1' }, ui: { x: 0, y: 0 } },
              { id: 'other', type: 'time', inputs: {}, params: {}, ui: { x: 0, y: 0 } },
            ],
          },
        },
      }],
    },
  };
  const clips: any[] = [{ slashEffect: { ...OLD_DEFAULT, cx: 3, cy: 4 } }, {}];
  const n = migrateSlashCenterOffsets(chars, clips);
  const perf = chars.ch1.performances[0];
  const nodes = perf.graphs.a.nodes;
  ok(chars.ch1.slashDefs[0].spec.cx === 0 && chars.ch1.slashDefs[0].spec.cy === 0
    && perf.slashEffect.cx === 0 && perf.slashEffect.cy === 0
    && clips[0].slashEffect.cx === 0 && clips[0].slashEffect.cy === 0,
    '③ 定义/表演字段/片段字段 cx/cy 归零');
  ok(nodes[0].params.cx === 0 && nodes[0].params.cy === 0 && nodes[1].params.cx === 0 && nodes[1].params.cy === 0,
    '③ 表演图规格形态节点（面板节点 + 手加节点）params 归零');
  ok(!('cx' in nodes[2].params) && nodes[2].params.__defId === 'd1',
    '③ 引用形态节点不存规格、原样未动');
  ok(n === 5, `③ 归零份数 = 5（定义/表演字段/片段/图节点 ×2），实际 ${n}`);
  ok(migrateSlashCenterOffsets(chars, clips) === 0, '③ 幂等：二次迁移归零 0 份');
}

// ---------- ④ 源级接线 ----------
{
  const slice = readFileSync(new URL('../src/lib/store/project-slice.ts', import.meta.url), 'utf8');
  const migIdx = slice.indexOf('migrateSlashCenterOffsets(');
  const syncIdx = slice.indexOf('syncCharacterSlashBlueprints(ch as any)');
  ok(slice.includes("slashCenterVersion !== 1") && migIdx > 0 && syncIdx > migIdx
    && slice.includes('slashCenterVersion: 1'),
    '④ 导入链：slashCenterVersion 门控迁移且排在刀光蓝图同步之前、提交时落标记 1');
  const types = readFileSync(new URL('../src/lib/types.ts', import.meta.url), 'utf8');
  ok(types.includes('slashCenterVersion?: number'), '④ 工程类型含 slashCenterVersion 标记字段');
  const editor = readFileSync(new URL('../src/components/pixel-editor/puppet/SlashEffectEditor.tsx', import.meta.url), 'utf8');
  ok(editor.includes('逆时针') && editor.includes('相对锚点的偏移') && editor.includes('frame.plugX'),
    '④ 面板：扫向切换 + 中心偏移说明 + 预览锚点十字（按 frame.plug 叠绘）');
  const conv = readFileSync(new URL('../src/lib/proc-runtime/convert.ts', import.meta.url), 'utf8');
  ok(conv.includes("spec.dir === -1 ? { dir: -1 }"), '④ convert：dir=-1 透传进包（缺省不落字段）');
  const specsSrc = readFileSync(new URL('../src/lib/blueprint/specs.ts', import.meta.url), 'utf8');
  const syncSrc = readFileSync(new URL('../src/lib/blueprint/slash-sync.ts', import.meta.url), 'utf8');
  ok(specsSrc.includes("'dir'") && syncSrc.includes("'dir'"),
    '④ 蓝图：slash_fan 参数表与同步数值键含 dir（图往返不丢扫向）');
}

console.log(fails === 0 ? 'SLASH CENTER + DIR PROBE PASS' : `SLASH CENTER + DIR PROBE FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
