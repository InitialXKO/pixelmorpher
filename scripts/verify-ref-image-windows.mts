// 参考图窗口对位探针：主画布 / 草图捕姿 / 画火柴人三处共用
// lib/ref-image 的几何定义，断言同一参考图点在三处对应的角色空间
// 坐标逐点一致（参考图与骨架的相对关系不随窗口改变）。
import {
  drawRefImage, loadRefImage, refImagePoint, refImageReady, refImageRect, refImageRectForWindow,
} from '../src/lib/ref-image';
import { buildSkeletonFromStrokes, pointerToCanvasPt } from '../src/lib/stroke-build';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

// ---- 1. contain 居中矩形（与主画布原内联公式逐项对拍） ----
const oracle = (fw: number, fh: number, iw: number, ih: number) => {
  const scale = Math.min(fw / iw, fh / ih);
  const dw = iw * scale, dh = ih * scale;
  return { dx: (fw - dw) / 2, dy: (fh - dh) / 2, dw, dh };
};
for (const [fw, fh, iw, ih] of [
  [512, 512, 1000, 500], [512, 512, 400, 900], [256, 256, 256, 256],
  [440, 500, 2000, 1000], [300, 700, 111, 333], [512, 384, 640, 480],
] as const) {
  const r = refImageRect(fw, fh, iw, ih);
  const o = oracle(fw, fh, iw, ih);
  ok(near(r.dx, o.dx) && near(r.dy, o.dy) && near(r.dw, o.dw) && near(r.dh, o.dh),
    `contain 矩形与主画布原公式一致 (${fw}×${fh} 帧, 图 ${iw}×${ih})`);
  ok(r.dw <= fw + 1e-9 && r.dh <= fh + 1e-9 && (near(r.dw, fw) || near(r.dh, fh)),
    'contain: 不溢出且一维贴边');
  ok(near(r.dx + r.dw / 2, fw / 2) && near(r.dy + r.dh / 2, fh / 2), '矩形中心 = 帧中心');
}

// ---- 2. 草图捕姿窗口（尺寸 == 工程画布）逐像素一致 ----
{
  const r1 = refImageRect(512, 512, 1000, 500);
  const r2 = refImageRectForWindow(512, 512, 1000, 500, 512, 512);
  ok(near(r1.dx, r2.dx) && near(r1.dy, r2.dy) && near(r1.dw, r2.dw) && near(r1.dh, r2.dh),
    '捕姿窗口矩形与主画布逐像素一致（平移为 0）');
}

// ---- 3. 画火柴人窗口（440×500 固定窗口）：只平移、不缩放 ----
{
  const main = refImageRect(512, 512, 1000, 500);
  const win = refImageRectForWindow(512, 512, 1000, 500, 440, 500);
  ok(near(win.dw, main.dw) && near(win.dh, main.dh), '火柴人窗口矩形尺寸与主画布相同（同比例）');
  ok(near(win.dx - main.dx, (440 - 512) / 2) && near(win.dy - main.dy, (500 - 512) / 2),
    '火柴人窗口矩形平移 = 中心差 ((440−512)/2, (500−512)/2)');
}

// ---- 4. 核心：同一参考图点的角色空间坐标在三处一致 ----
// 角色空间坐标的定义（全仓口径）：画布 px − 该画布中心。
// 主画布/捕姿以工程画布为帧；火柴人窗口以自身中心为原点（笔触
// 换算 rel(p) = p − 窗口中心，见 stroke-build）。断言：图上任意
// 归一化点 (u,v)，由三处矩形算出的 px 减去各自中心，结果相同。
{
  const frames: [number, number][] = [[512, 512], [256, 256], [384, 640]];
  const wins: [number, number][] = [[440, 500]];
  const imgs: [number, number][] = [[1000, 500], [400, 900], [800, 800]];
  let allOk = true;
  for (const [fw, fh] of frames) for (const [iw, ih] of imgs) {
    const main = refImageRect(fw, fh, iw, ih);
    for (const [ww, wh] of wins) {
      const win = refImageRectForWindow(fw, fh, iw, ih, ww, wh);
      for (const u of [0, 0.25, 0.5, 0.75, 1]) for (const v of [0, 0.3, 0.5, 1]) {
        const pm = refImagePoint(main, u, v);
        const pw = refImagePoint(win, u, v);
        if (!near(pm.x - fw / 2, pw.x - ww / 2) || !near(pm.y - fh / 2, pw.y - wh / 2)) {
          allOk = false;
          console.log(`    不一致: 帧 ${fw}×${fh} 图 ${iw}×${ih} 窗 ${ww}×${wh} 点 (${u},${v})`);
        }
      }
    }
  }
  ok(allOk, '参考图任意点的角色空间坐标：主画布与火柴人窗口逐点一致');
}

// ---- 5. 与笔触建角真实换算的衔接：窗口中心即角色原点 ----
// 直躯干笔触自窗口 (220,100) 画到 (220,280)：腰点角色坐标应为
// (0, 30)——同一世界点在 512 工程画布上是 px (256,286)，减画布
// 中心 (256,256) 同为 (0,30)，参考图按中心对齐画进窗口不改变它。
{
  const built = buildSkeletonFromStrokes(
    { torso: [{ x: 220, y: 100 }, { x: 220, y: 190 }, { x: 220, y: 280 }] },
    { characterId: 'probe', center: { x: 220, y: 250 }, canvasSize: { w: 512, h: 512 } },
  );
  ok(near(built.joints.pelvis!.x, 0, 1e-6) && near(built.joints.pelvis!.y, 30, 1e-6),
    `笔触建角：腰点角色坐标 (0,30)（实际 ${built.joints.pelvis!.x},${built.joints.pelvis!.y}）`);
}

// ---- 6. drawRefImage 绘制口径：透明度/关平滑/矩形透传 ----
{
  const calls: unknown[][] = [];
  let alpha = -1, smoothing = true, saves = 0, restores = 0;
  const stubCtx = {
    save() { saves++; },
    restore() { restores++; },
    set globalAlpha(v: number) { alpha = v; },
    get globalAlpha() { return alpha; },
    set imageSmoothingEnabled(v: boolean) { smoothing = v; },
    get imageSmoothingEnabled() { return smoothing; },
    drawImage(...args: unknown[]) { calls.push(args); },
  };
  const fakeImg = { width: 10, height: 10 };
  drawRefImage(stubCtx as never, fakeImg as never, { dx: 3, dy: 4, dw: 50, dh: 60 }, 0.35);
  ok(calls.length === 1 && calls[0]![0] === fakeImg && calls[0]![1] === 3 && calls[0]![2] === 4
    && calls[0]![3] === 50 && calls[0]![4] === 60, 'drawRefImage 以给定矩形 drawImage 一次');
  ok(alpha === 0.35, 'drawRefImage 透明度透传');
  ok(smoothing === false, 'drawRefImage 关闭图像平滑（像素口径）');
  ok(saves === 1 && restores === 1, 'drawRefImage save/restore 配对');
}

// ---- 7. 指针换算跨显示缩放一致（火柴人窗口缩放显示后落点不偏） ----
// 窗口画布位图恒 440×500，显示尺寸随视口缩放。断言：同一画布点在
// 1:1 / 0.5 / 1.5 倍显示 + 任意偏移的矩形下，client 坐标换算回同一
// 画布坐标；笔触采样/吸附/命中共用这一条换算。
{
  const W = 440, H = 500;
  const cases: { rect: { left: number; top: number; width: number; height: number }; pt: { x: number; y: number } }[] = [
    { rect: { left: 100, top: 50, width: 440, height: 500 }, pt: { x: 220, y: 250 } },
    { rect: { left: 30, top: 20, width: 220, height: 250 }, pt: { x: 220, y: 250 } },
    { rect: { left: 0, top: 0, width: 660, height: 750 }, pt: { x: 220, y: 250 } },
    { rect: { left: 17, top: 311, width: 308, height: 350 }, pt: { x: 123.4, y: 234.5 } },
    { rect: { left: 17, top: 311, width: 308, height: 350 }, pt: { x: 0, y: 0 } },
    { rect: { left: 17, top: 311, width: 308, height: 350 }, pt: { x: 440, y: 500 } },
  ];
  let allOk = true;
  for (const { rect, pt } of cases) {
    const cx = rect.left + (pt.x / W) * rect.width;
    const cy = rect.top + (pt.y / H) * rect.height;
    const back = pointerToCanvasPt(cx, cy, rect, W, H);
    if (!near(back.x, pt.x, 1e-9) || !near(back.y, pt.y, 1e-9)) {
      allOk = false;
      console.log(`    换算不一致: 矩形 ${rect.width}×${rect.height}@(${rect.left},${rect.top}) 点 (${pt.x},${pt.y}) → (${back.x},${back.y})`);
    }
  }
  ok(allOk, '指针换算：任意显示缩放/偏移下同一画布点换算一致');
}

// ---- 8. loadRefImage 加载订阅合同（首开补画所依赖的通知链） ----
// 向导首画可能赶在图未就绪时：绘制跳过、靠加载完成通知触发重绘。
// 用可控假 Image 断言合同：未就绪时订阅登记、就绪时全部订阅者恰
// 触发一次、就绪后再订阅不登记（调用方直接画）、不同 URL 独立。
{
  class FakeImage {
    static last: FakeImage | null = null;
    src = '';
    complete = false;
    naturalWidth = 0;
    naturalHeight = 0;
    onload: (() => void) | null = null;
    constructor() { FakeImage.last = this; }
    finishLoad() { this.complete = true; this.naturalWidth = 240; this.naturalHeight = 320; this.onload?.(); }
  }
  (globalThis as unknown as { Image: unknown }).Image = FakeImage;

  let n1 = 0, n2 = 0, n3 = 0;
  const imgA = loadRefImage('probe://a.png', () => n1++);
  ok(!refImageReady(imgA as never), '订阅合同：加载中图未就绪（绘制应跳过、等通知）');
  const imgA2 = loadRefImage('probe://a.png', () => n2++);
  ok(imgA2 === imgA, '订阅合同：同 URL 共用同一图实例（缓存一份）');
  FakeImage.last!.finishLoad();
  ok(n1 === 1 && n2 === 1, '订阅合同：加载完成时全部订阅者各触发一次');
  const imgA3 = loadRefImage('probe://a.png', () => n3++);
  ok(imgA3 === imgA && refImageReady(imgA3 as never), '订阅合同：已就绪图再取仍是同一实例且就绪');
  FakeImage.last!.finishLoad();
  ok(n3 === 0, '订阅合同：已就绪后的订阅不登记（不会被迟到通知误触发）');
  const imgB = loadRefImage('probe://b.png');
  ok(imgB !== imgA && !refImageReady(imgB as never), '订阅合同：不同 URL 独立条目、各自就绪状态');
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
