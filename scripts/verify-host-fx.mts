// verify-host-fx.mts — 宿主后处理段探针（bun 运行）
// 口径：核心是 (像素, t, 种子) 纯函数、不原地改输入；逐模式语义
// 按 host-fx.ts 合同断言（染色保 alpha 与明度、闪刷脉冲峰全白、
// 切片行位移量与分色偏移、逐行可见行数随进度单调、瓦解清除比
// 例随进度单调且前沿染色、面层自底覆盖）；编辑器核心与运行时
// 孪生 dynHostFxApply 逐像素对拍；段解析多实例只取第一个启用。
import {
  applyHostFxToRgba,
  firstHostFxParams,
  hostFxHash01,
  hostFxSeedOf,
  pixelGridToRgba,
  rgbaToPixelGrid,
  type HostFxParamsLike,
} from '../src/lib/host-fx';
import { defaultDynamicParams, normalizeDynamicParams } from '../src/lib/dynamic-patterns';
import { createDynamicRuntime } from '../src/lib/proc-runtime/dynamic-src';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; } else { fail++; console.log(`✗ ${name}`); }
}

const W = 12;
const H = 9;
/** 已知图案：颜色随坐标线性变化（便于追位移），右下角 3x3 透明洞 */
function fixture(): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      d[o] = x * 20;
      d[o + 1] = y * 25;
      d[o + 2] = (x + y) * 10;
      d[o + 3] = x >= 9 && y >= 6 ? 0 : 255;
    }
  }
  return d;
}
function params(over: Partial<HostFxParamsLike>): HostFxParamsLike {
  return {
    hostFxEnabled: true, hostFxMode: 'none', hostFxColor: '#7a4fd0',
    hostFxStrength: 0.8, hostFxHz: 1, hostFxSlicePx: 3, hostFxPhase: 0,
    ...over,
  };
}
const px = (d: Uint8ClampedArray, x: number, y: number) => {
  const o = (y * W + x) * 4;
  return [d[o]!, d[o + 1]!, d[o + 2]!, d[o + 3]!];
};
const eqArr = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// ---- 通则：不原地改输入；禁用/none 直通 ----
{
  const src = fixture();
  const before = new Uint8ClampedArray(src);
  const out = applyHostFxToRgba(src, W, H, params({ hostFxMode: 'tint', hostFxStrength: 1 }), 0.3, 42);
  check('通则 输入未被原地修改', eqArr(src, before));
  check('通则 返回新数组', out !== (src as unknown));
  const off = applyHostFxToRgba(src, W, H, params({ hostFxEnabled: false, hostFxMode: 'tint' }), 0.3, 42);
  check('通则 禁用直通', eqArr(off, src));
  const none = applyHostFxToRgba(src, W, H, params({ hostFxMode: 'none' }), 0.3, 42);
  check('通则 none 直通', eqArr(none, src));
}

// ---- tint：保 alpha、保明度、色相移向宿主色 ----
{
  const src = fixture();
  const host: [number, number, number] = [0x7a, 0x4f, 0xd0];
  const out = applyHostFxToRgba(src, W, H, params({ hostFxMode: 'tint', hostFxStrength: 1 }), 0, 7);
  let alphaOk = true;
  let lumOk = true;
  let ratioOk = true;
  const hLum = (0.2126 * host[0] + 0.7152 * host[1] + 0.0722 * host[2]) / 255;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = px(src, x, y);
      const o = px(out, x, y);
      if (o[3] !== s[3]) alphaOk = false;
      if (s[3] <= 0) { if (o[0] !== s[0] || o[1] !== s[1] || o[2] !== s[2]) lumOk = false; continue; }
      const lumS = 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
      const lumO = 0.2126 * o[0] + 0.7152 * o[1] + 0.0722 * o[2];
      // 明度保留只对未钳制的像素成立：调制目标超 255 被钳后明度
      // 必然下降（合同内行为）；钳制情形由下方逐通道比值断言钉住
      const kPre = lumS / 255 / hLum;
      if (Math.max(host[0], host[1], host[2]) * kPre <= 255 && Math.abs(lumO - lumS) > 2.5) lumOk = false;
      // strength=1 时出色应与宿主色同比例（被宿主明度归一的等比缩放）
      const k = lumS / 255 / hLum;
      const exp = host.map((c) => Math.max(0, Math.min(255, c * k)));
      if (Math.abs(o[0] - exp[0]!) > 1.6 || Math.abs(o[1] - exp[1]!) > 1.6 || Math.abs(o[2] - exp[2]!) > 1.6) ratioOk = false;
    }
  }
  check('tint alpha 全保留', alphaOk);
  check('tint 明度保留（±2.5）', lumOk);
  check('tint strength=1 出色 = 宿主色按明度归一', ratioOk);
  const zero = applyHostFxToRgba(src, W, H, params({ hostFxMode: 'tint', hostFxStrength: 0 }), 0, 7);
  check('tint strength=0 直通', eqArr(zero, src));
}

// ---- flash：脉冲峰（t=0.25, Hz=1）全白向、谷（t=0.75）直通 ----
{
  const src = fixture();
  const peak = applyHostFxToRgba(src, W, H, params({ hostFxMode: 'flash', hostFxStrength: 1 }), 0.25, 7);
  let white = true;
  let alphaOk = true;
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    if (peak[o + 3] !== src[o + 3]) alphaOk = false;
    if (src[o + 3]! > 0 && (peak[o] !== 255 || peak[o + 1] !== 255 || peak[o + 2] !== 255)) white = false;
  }
  check('flash 脉冲峰+strength=1 全白', white);
  check('flash alpha 保留', alphaOk);
  const trough = applyHostFxToRgba(src, W, H, params({ hostFxMode: 'flash', hostFxStrength: 1 }), 0.75, 7);
  check('flash 脉冲谷直通', eqArr(trough, src));
}

// ---- slice：行带位移量 + 分色偏移 + 透明源不造色 ----
{
  const src = fixture();
  const seed = 1234;
  const seedEff = ((seed % 100000) + 100000) % 100000;
  const p = params({ hostFxMode: 'slice', hostFxSlicePx: 2 });
  const out = applyHostFxToRgba(src, W, H, p, 0.25, seed); // 脉冲 = 1
  let moveOk = true;
  let splitOk = true;
  let emptyOk = true;
  for (let y = 0; y < H; y++) {
    const band = Math.floor(y / 3);
    const dir = hostFxHash01(band, seedEff, 913) < 0.5 ? -1 : 1;
    const off = dir * 2;
    const clampX = (v: number) => (v < 0 ? 0 : v >= W ? W - 1 : v);
    for (let x = 0; x < W; x++) {
      const o = px(out, x, y);
      const base = px(src, clampX(x - off), y);
      if (base[3] <= 0) { if (o[3] !== 0) emptyOk = false; continue; }
      if (o[1] !== base[1] || o[3] !== base[3]) moveOk = false;
      if (o[0] !== px(src, clampX(x - off + 1), y)[0]) splitOk = false;
      if (o[2] !== px(src, clampX(x - off - 1), y)[2]) splitOk = false;
    }
  }
  check('slice G/alpha 按行带位移量搬移', moveOk);
  check('slice R+1px / B−1px 分色', splitOk);
  check('slice 透明源不造色', emptyOk);
  const still = applyHostFxToRgba(src, W, H, p, 0.75, seed); // 脉冲 = 0
  let stillOk = true;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = px(still, x, y);
      const s = px(src, x, y);
      if (s[3] <= 0) { if (o[3] !== 0) stillOk = false; continue; }
      if (o[1] !== s[1] || o[3] !== s[3]) stillOk = false;
    }
  }
  check('slice 脉冲谷位移为 0（G/alpha 回位）', stillOk);
}

// ---- rows：可见行是前缀、行数随进度单调 ----
{
  const src = fixture();
  const visRows = (t: number) => {
    const out = applyHostFxToRgba(src, W, H, params({ hostFxMode: 'rows' }), t, 7);
    let n = 0;
    let prefix = true;
    let seenHidden = false;
    for (let y = 0; y < H; y++) {
      const vis = px(out, 0, y)[3] > 0;
      if (vis) { n++; if (seenHidden) prefix = false; } else seenHidden = true;
    }
    return { n, prefix };
  };
  const r0 = visRows(0);
  const r25 = visRows(0.25);
  const r50 = visRows(0.5);
  const r75 = visRows(0.75);
  check('rows p=0 全隐', r0.n === 0);
  check('rows p=0.5 可见 5/9 行', r50.n === 5);
  check('rows 可见行恒为顶部前缀', r25.prefix && r50.prefix && r75.prefix);
  check('rows 可见行数随进度单调不减', r0.n <= r25.n && r25.n <= r50.n && r50.n <= r75.n);
}

// ---- dissolve：清除数 = 哈希超阈数（精确）、随进度单调、前沿染色 ----
{
  const src = fixture();
  const seed = 99;
  const seedEff = ((seed % 100000) + 100000) % 100000;
  const clearedAt = (t: number, strength: number) => {
    const out = applyHostFxToRgba(src, W, H, params({ hostFxMode: 'dissolve', hostFxStrength: strength }), t, seed);
    let cleared = 0;
    for (let i = 0; i < W * H; i++) if (src[i * 4 + 3]! > 0 && out[i * 4 + 3] === 0) cleared++;
    return { out, cleared };
  };
  const prog = 0.5;
  const T = prog * (1 + 0); // strength=0
  let expected = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (px(src, x, y)[3] > 0 && hostFxHash01(x, y, seedEff) > T) expected++;
  }
  const d50 = clearedAt(0.5, 0);
  check('dissolve 清除数 = 哈希超阈数（精确）', d50.cleared === expected);
  const d25 = clearedAt(0.25, 0);
  const d75 = clearedAt(0.75, 0);
  check('dissolve 清除数随进度单调不增', d25.cleared >= d50.cleared && d50.cleared >= d75.cleared);
  let expected99 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (px(src, x, y)[3] > 0 && hostFxHash01(x, y, seedEff) > 0.99) expected99++;
  }
  check('dissolve p=0.99 清除数 = 哈希超阈数（精确）', clearedAt(0.99, 0).cleared === expected99);
  // 前沿染色：幸存且 T−n<0.08 的像素 rgb 恰为宿主色；其余幸存原样
  let edgeOk = true;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = px(src, x, y);
      if (s[3] <= 0) continue;
      const o = px(d50.out, x, y);
      if (o[3] === 0) continue;
      const n = hostFxHash01(x, y, seedEff);
      if (T - n < 0.08) { if (!(o[0] === 0x7a && o[1] === 0x4f && o[2] === 0xd0)) edgeOk = false; }
      else if (o[0] !== s[0] || o[1] !== s[1] || o[2] !== s[2]) edgeOk = false;
    }
  }
  check('dissolve 前沿染宿主色、非前沿原样', edgeOk);
}

// ---- creep：自底覆盖、边界行发光色、覆盖行数随进度单调 ----
{
  const src = fixture();
  const coveredRows = (t: number) => {
    const out = applyHostFxToRgba(src, W, H, params({ hostFxMode: 'creep' }), t, 7);
    let n = 0;
    for (let y = 0; y < H; y++) {
      const s = px(src, 0, y);
      const o = px(out, 0, y);
      if (s[3] > 0 && (o[0] !== s[0] || o[1] !== s[1] || o[2] !== s[2])) n++;
    }
    return { out, n };
  };
  const c25 = coveredRows(0.25);
  const c50 = coveredRows(0.5);
  const c75 = coveredRows(0.75);
  check('creep 覆盖行数随进度单调不减', c25.n <= c50.n && c50.n <= c75.n);
  check('creep p=0.5 覆盖底 4 行（edgeY=5）', c50.n === 4);
  // 边界行（y=5）= 宿主色向白混 0.45
  const edge = px(c50.out, 0, 5);
  const expEdge = [0x7a, 0x4f, 0xd0].map((c) => Math.round(c + (255 - c) * 0.45));
  check('creep 边界行发光色', Math.abs(edge[0]! - expEdge[0]!) <= 1 && Math.abs(edge[1]! - expEdge[1]!) <= 1 && Math.abs(edge[2]! - expEdge[2]!) <= 1);
  // 覆盖区（y=8）：出色 / 宿主色逐通道比 ∈ {0.55, 0.8, 1.05}
  const cov = px(c50.out, 2, 8);
  const hostC = [0x7a, 0x4f, 0xd0];
  const shades = [0.55, 0.8, 1.05];
  const ratioOk = hostC.every((c, i) => shades.some((s) => Math.abs(cov[i]! - Math.min(255, c * s)) <= 1.6));
  check('creep 覆盖区宿主色三阶调制', ratioOk);
  // 未覆盖区原样、alpha 全程不动
  let topOk = true;
  let alphaOk = true;
  for (let y = 0; y < 5; y++) for (let x = 0; x < W; x++) {
    const s = px(src, x, y);
    const o = px(c50.out, x, y);
    if (o[0] !== s[0] || o[1] !== s[1] || o[2] !== s[2]) topOk = false;
  }
  for (let i = 0; i < W * H; i++) if (c50.out[i * 4 + 3] !== src[i * 4 + 3]) alphaOk = false;
  check('creep 未覆盖区原样', topOk);
  check('creep alpha 不动', alphaOk);
}

// ---- 段解析：只取第一个启用 ----
{
  const a = params({ hostFxMode: 'tint' });
  const b = params({ hostFxMode: 'flash' });
  const off = params({ hostFxEnabled: false, hostFxMode: 'creep' });
  const noneP = params({ hostFxMode: 'none' });
  check('解析 取第一个启用', firstHostFxParams([off, noneP, a, b]) === a);
  check('解析 全禁用为 null', firstHostFxParams([off, noneP]) === null);
  check('解析 空列表为 null', firstHostFxParams([]) === null);
}

// ---- 参数管道：缺省值与规范化 ----
{
  const d = defaultDynamicParams();
  check('缺省 hostFx 合同值', d.hostFxEnabled === false && d.hostFxMode === 'none'
    && d.hostFxColor === '#7a4fd0' && d.hostFxStrength === 0.8 && d.hostFxHz === 1
    && d.hostFxSlicePx === 3 && d.hostFxPhase === 0);
  const n = normalizeDynamicParams({
    ...d,
    hostFxEnabled: true,
    hostFxMode: 'bogus' as never,
    hostFxColor: 'red',
    hostFxStrength: 7,
    hostFxHz: -2,
    hostFxSlicePx: 99,
    hostFxPhase: 2.25,
  });
  check('规范化 模式回落 none', n.hostFxMode === 'none');
  check('规范化 颜色回落缺省', n.hostFxColor === '#7a4fd0');
  check('规范化 强度钳 1', n.hostFxStrength === 1);
  check('规范化 速率钳 0', n.hostFxHz === 0);
  check('规范化 切片钳 8', n.hostFxSlicePx === 8);
  check('规范化 相位归一 0.25', Math.abs(n.hostFxPhase - 0.25) < 1e-9);
}

// ---- 网格适配往返 ----
{
  const grid = [
    ['#ff0000', null, '#00ff00'],
    [null, '#0000ff', null],
  ];
  const { data, w, h } = pixelGridToRgba(grid);
  check('适配 尺寸', w === 3 && h === 2);
  const back = rgbaToPixelGrid(data, w, h);
  check('适配 往返无损', JSON.stringify(back) === JSON.stringify(grid));
  const cleared = applyHostFxToRgba(data, w, h, params({ hostFxMode: 'rows', hostFxHz: 0, hostFxPhase: 0.4 }), 0, 1);
  const backRows = rgbaToPixelGrid(cleared, w, h);
  check('适配 rows 清行变 null', JSON.stringify(backRows[0]) === JSON.stringify(grid[0]) && backRows[1]!.every((c) => c === null));
}

// ---- 双路对拍：编辑器核心 vs 运行时孪生 dynHostFxApply ----
{
  const rt = createDynamicRuntime();
  const src = fixture();
  // 第二张随机图（哈希确定性生成）
  const rnd = new Uint8ClampedArray(17 * 13 * 4);
  for (let i = 0; i < 17 * 13; i++) {
    rnd[i * 4] = Math.floor(hostFxHash01(i, 1, 5) * 256);
    rnd[i * 4 + 1] = Math.floor(hostFxHash01(i, 2, 5) * 256);
    rnd[i * 4 + 2] = Math.floor(hostFxHash01(i, 3, 5) * 256);
    rnd[i * 4 + 3] = hostFxHash01(i, 4, 5) > 0.25 ? 255 : 0;
  }
  const modes = ['tint', 'flash', 'slice', 'rows', 'dissolve', 'creep'] as const;
  let allOk = true;
  let resolverOk = true;
  for (const mode of modes) {
    for (const t of [0, 0.13, 0.25, 0.5, 0.77, 1.3]) {
      for (const seed of [0, 7, -31337, 123456789]) {
        const p = params({ hostFxMode: mode, hostFxStrength: 0.65, hostFxHz: 1.7, hostFxSlicePx: 2.5, hostFxPhase: 0.2 });
        const a = applyHostFxToRgba(src, W, H, p, t, seed);
        const b = rt.dynHostFxApply(new Uint8ClampedArray(src), W, H, p as never, t, seed);
        if (!eqArr(a, b)) { allOk = false; console.log(`  对拍不一致 ${mode} t=${t} seed=${seed}`); }
        const a2 = applyHostFxToRgba(rnd, 17, 13, p, t, seed);
        const b2 = rt.dynHostFxApply(new Uint8ClampedArray(rnd), 17, 13, p as never, t, seed);
        if (!eqArr(a2, b2)) { allOk = false; console.log(`  对拍不一致(随机图) ${mode} t=${t} seed=${seed}`); }
      }
    }
  }
  check('对拍 六模式×多时刻×多种子逐像素一致', allOk);
  // 解析孪生：dynHostFxFirst 与 firstHostFxParams 同选
  const pa = params({ hostFxMode: 'tint' });
  const pb = params({ hostFxMode: 'flash' });
  const list = [
    { id: 'i0', params: params({ hostFxEnabled: false, hostFxMode: 'creep' }) },
    { id: 'i1', params: pa },
    { id: 'i2', params: pb },
  ];
  const picked = rt.dynHostFxFirst(list as never[]);
  check('对拍 解析孪生同选第一个启用', picked?.id === 'i1');
  check('种子派生与孪生同源（dynSeedOf 式）', hostFxSeedOf('i1') === 3304);
}

console.log(`verify-host-fx: ${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
