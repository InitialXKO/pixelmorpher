/**
 * 结构断言：参考图装配·分割步小图缩放/平移（源级）
 *
 * 两张点选图（参考图原图 / 抠图预览）统一走 SamPickImage：CSS
 * transform 缩放（origin 左上）、滚轮原生非被动监听拦截、按下到
 * 抬起位移阈值区分平移与点选、点选仍走 rect 归一化换算、视角
 * 模块级持久化且换图复位、带倍率显示与复位按钮。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
const ok = (cond: boolean, label: string) => {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
};

const wiz = read('src/components/pixel-editor/puppet/RefAssemblyWizard.tsx');

// ---------- 两图共用组件 ----------
ok((wiz.match(/<SamPickImage/g) ?? []).length === 2, 'SamPickImage 恰两处使用（原图 + 预览图）');
ok(!wiz.includes('onContextMenu={async'), '旧 img 直挂 onContextMenu 点选已除');
ok(!wiz.includes("alt=\"参考图\"") || wiz.includes('frameClassName="border-white/10"'), '原图改走 SamPickImage（白框）');
ok(wiz.includes('frameClassName="border-green-500/30"'), '预览图改走 SamPickImage（绿框）');
ok((wiz.match(/onPick=\{\(x, y, label\)/g) ?? []).length === 2, '两图 onPick 都转 handleSamClick(x, y, label)');

// ---------- 缩放机制 ----------
ok(wiz.includes("addEventListener('wheel'") && wiz.includes('{ passive: false }'), '滚轮走原生监听 + passive:false（能 preventDefault 拦截外层滚动）');
ok(wiz.includes('transformOrigin:'), '缩放 transform 有 transformOrigin');
ok(wiz.includes('translate(${view.x}px') && wiz.includes('scale(${view.scale})'), 'img 变换 = translate + scale');
ok(wiz.includes('SAM_VIEW_MIN_SCALE = 1') && wiz.includes('SAM_VIEW_MAX_SCALE = 8'), '倍率钳制常量 1×–8× 在位');
ok(wiz.includes('clampSamView'), '视角钳制 clampSamView 在位（倍率 + 平移盖满不露边）');
ok(wiz.includes('getBoundingClientRect'), '滚轮中心与点选都按 rect 计算');
ok(wiz.includes('Math.exp(-delta * 0.002)'), '滚轮缩放按 delta 指数步进（与光标中心换算配套）');

// ---------- 平移与点选的冲突判定 ----------
ok(wiz.includes('SAM_PICK_DRAG_THRESHOLD = 4'), '点选/平移位移阈值 4px 在位');
ok(wiz.includes('Math.hypot(dx, dy) > SAM_PICK_DRAG_THRESHOLD'), '超阈值判平移在位');
ok(wiz.includes('setPointerCapture'), '手势走指针捕获（拖出图外不断）');
ok(wiz.includes('onPointerUp') && wiz.includes('drag.button === 2 ? 0 : 1'), '点选统一收在 pointerup 按按下键分 label（右键=0 不经 contextmenu）');
ok(wiz.includes('onContextMenu={(e) => e.preventDefault()}'), 'contextmenu 只压菜单、不加点（右键拖动不误触抠除点）');
ok(wiz.includes('(e.clientX - rect.left) / rect.width'), '点选坐标仍是 rect 0–1 归一化（变换后可视 rect，比例不变）');
ok(wiz.includes('draggable={false}'), 'img 禁原生拖拽（不与平移手势打架）');
ok(wiz.includes('touch-none'), '触摸手势不被浏览器接管（touch-action:none）');

// ---------- 视角状态 ----------
ok(wiz.includes('let persistedSamView'), '视角模块级持久化在位（切步/重挂/两图交替不丢）');
ok(wiz.includes('persistedSamView = { scale: 1, x: 0, y: 0 };'), 'resetRefWizardStep 复位视角');
ok(wiz.includes('prevReferenceUrlRef'), '参考图换人时视角复位 effect 在位');
ok(wiz.includes('samView.scale.toFixed(1)') && wiz.includes('复位'), '倍率显示 + 复位按钮在位');

if (failures > 0) {
  console.error(`\n${failures} 项断言失败`);
  process.exit(1);
}
console.log('SAM ZOOM/PAN PROBE PASS');
