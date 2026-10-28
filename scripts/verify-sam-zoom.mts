/**
 * 结构断言：分割步小图缩放/平移 + 遮罩层视图手势（源级）
 *
 * 一、参考图装配·分割步：两张点选图（参考图原图 / 抠图预览）统一
 * 走 SamPickImage：CSS transform 缩放（origin 左上）、滚轮原生非
 * 被动监听拦截、按下到抬起位移阈值区分平移与点选、点选仍走 rect
 * 归一化换算、视角模块级持久化且换图复位、带倍率显示与复位按钮。
 * 二、遮罩模式（MaskBrushOverlay）：主画布视图手势在本层复原——
 * 滚轮走主画布同一套缩放公式、空格/中键平移判定排在笔刷之前且
 * 笔划中不介入、普通按下路径与取点换算不动。
 * 三、遮罩工具条图标化：按钮全改 lucide 图标钮 + title、激活配色
 * 语义保留、滑杆/色块形态保留、disabled 条件与处理函数照旧。
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

// ---------- 遮罩层视图手势（MaskBrushOverlay） ----------
const mask = read('src/components/pixel-editor/MaskBrushOverlay.tsx');

// 滚轮：原生非被动监听 + 主画布同一套缩放公式（步进/取整/钳制/光标锚点）
ok(mask.includes("addEventListener('wheel'") && mask.includes('{ passive: false }'), '遮罩层滚轮走原生监听 + passive:false');
ok(mask.includes('e.deltaY < 0 ? 1.15 : 1 / 1.15'), '遮罩层缩放步进 ×1.15 与主画布一致');
ok(mask.includes('Math.max(1, Math.min(32, Math.round(zoom * zoomFactor * 10) / 10))'), '遮罩层缩放 0.1 取整 + 钳制 1–32 与主画布一致');
ok(mask.includes('e.clientX - rect.left + panX'), '遮罩层光标容器坐标 = 图内偏移 + panX（rect 左缘含 pan）');
ok(mask.includes('const worldX = (mouseX - panX) / zoom') && mask.includes('setPan(mouseX - worldX * newZoom, mouseY - worldY * newZoom)'), '遮罩层缩放按光标点世界坐标不变换算 setZoom/setPan');
// 笔划中滚轮只吞不缩放
ok(mask.includes('if (isDrawing.current) return;'), '笔划进行中滚轮被吞、不缩放（不毁笔划）');

// 平移：判定（中键 / 空格+左键）排在取色之前，且笔划中不介入
const panCondIdx = mask.indexOf('!isDrawing.current && (e.button === 1 || (spaceHeldRef.current && e.button === 0))');
ok(panCondIdx > -1, '遮罩层平移判定在位（中键/空格+左键 + 笔划中不介入）');
ok(panCondIdx > -1 && panCondIdx < mask.indexOf('if (isPicking)'), '平移判定排在取色/取点/笔刷之前（优先）');
ok(mask.includes("e.code === 'Space'") && mask.includes('spaceHeldRef'), '遮罩层自追空格键状态（主画布的 ref 够不着）');
ok(mask.includes('setPan(p.panX + (e.clientX - p.startClientX), p.panY + (e.clientY - p.startClientY))'), '平移按按下点快照推 pan');

// 普通路径与坐标换算未改
ok(mask.includes('isDrawing.current = true;'), '普通按下仍走原笔刷落笔路径');
ok(mask.includes('(rect.width / canvasWidth)') && mask.includes('(rect.height / canvasHeight)'), 'getPos 仍按 live rect 换算内部像素坐标（视图变化后成立）');
ok(mask.includes('width: canvasWidth * zoom') && mask.includes('left: panX'), '遮罩层仍按订阅的 zoom/pan 定位（缩放后自动跟随）');

// ---------- 遮罩工具条图标化（MaskBrushOverlay 工具条） ----------
// 图标钮 + title：每个原文字按钮都有对应图标与 title 文案
for (const [icon, title] of [
  ['Trash2', '清除线条'],
  ['Stamp', '应用到遮罩'],
  ['CircleX', '清除点'],
  ['Pipette', '取色'],
  ['Delete', '清除色键'],
  ['Check', '确认'],
  ['X', '取消'],
] as const) {
  ok(mask.includes(`<${icon} className=`), `工具条图标 ${icon} 在位`);
  ok(mask.includes(title), `工具条 title/文案「${title}」在位`);
}
// 模式组四图标经数据数组以 Icon 组件渲染（JSX 里是 <Icon />）
for (const [icon, title] of [
  ['Paintbrush', '绘制'],
  ['Eraser', '擦除'],
  ['Fence', '防溢出线'],
  ['WandSparkles', 'SAM提取'],
] as const) {
  ok(mask.includes(`Icon: ${icon}`), `模式组图标 ${icon} 在位`);
  ok(mask.includes(title), `模式组 title/文案「${title}」在位`);
}
ok(mask.includes('<Icon className="size-4" />'), '模式组以 Icon 组件渲染图标');
ok(mask.includes("from 'lucide-react'"), '图标走 lucide-react 引用');
// 工具条内不再有文字按钮：原文字不再作为按钮子节点出现
for (const textBtn of ['>绘制<', '>擦除<', '>\n              应用到遮罩', '清除线条\n', '{label}']) {
  ok(!mask.includes(textBtn), `文字按钮残留已除（${textBtn.trim()}）`);
}
ok(!mask.includes('{isPicking ? "取色中…" : "取色"}'), '取色钮不再用文字切换（改图标 + title）');
// 模式激活配色语义保留（红/蓝/绿落在图标钮激活背景上）
ok(mask.includes("'bg-blue-600 text-white'") && mask.includes("'bg-green-600 text-white'") && mask.includes("'bg-red-600 text-white'"), '模式激活配色（蓝/绿/红）保留');
// 非按钮控件形态保留：滑杆 + 像素读数 + 色块
ok(mask.includes('type="range"') && mask.includes('{brushSize}px'), '笔刷滑杆与像素读数保留');
ok(mask.includes('<Brush className="size-3.5" />'), '滑杆配笔刷图标');
ok(mask.includes('backgroundColor: `rgb(${keyColor.r},${keyColor.g},${keyColor.b})`'), '色键色块保留');
// disabled 条件逐个照旧
ok(mask.includes('disabled={!samUi.hasResult}'), '应用到遮罩 disabled 条件照旧');
ok(mask.includes('disabled={samUi.points === 0 && !samUi.hasResult}'), '清除点 disabled 条件照旧');
// 行为未动：处理函数挂载照旧
ok(mask.includes('onClick={applySamToMask}') && mask.includes('onClick={handleConfirm}') && mask.includes('onClick={handleCancel}'), '应用/确认/取消处理函数照旧');

if (failures > 0) {
  console.error(`\n${failures} 项断言失败`);
  process.exit(1);
}
console.log('SAM ZOOM/PAN + MASK VIEW GESTURES + ICON TOOLBAR PROBE PASS');
