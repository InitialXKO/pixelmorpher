// ============================================================
// SAM 提取修复探针（审计 F-08 / DOMAIN-3 D6+D7）
//  1) 退役 API 全仓断言：addPart(/updatePart( 调用清零；store 层无
//     setPartPixels 定义/调用；editor-store 不再读 projectStore.parts。
//  2) 纯核心 buildSpriteFromCanvasMask 行为：双精灵重叠采样
//     （先入表者胜、透明穿透）、包围盒、像素逐格对、plug 按选区
//     提取同式回算；空掩码/全透明 → null。
//  3) 真实 store 端到端：editor-store.extractSAMMaskAsPart 喂合成
//     SAM 掩码 → 新精灵进全局精灵表（名/像素/plug 逐项对）、掩码
//     清空、选中新精灵；全零掩码/无掩码 → 返回 null 且不建精灵。
//  4) 非 ready 接线断言：smartSelectHandler 对非 ready 态走
//     notifySAMNotReady（toast+降级提示）；面板带降级文案、
//     提取按钮文案已改「提取为精灵」。
// ============================================================

// store 在模块级可能碰 localStorage/window：先垫内存桩再动态导入
{
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => { mem.clear(); },
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  };
  const g = globalThis as Record<string, unknown>;
  g.localStorage ??= storage;
  g.sessionStorage ??= storage;
}

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSpriteFromCanvasMask, samMaskToSelectionMask } from '../src/lib/inpainting';
import { pxToSub, type Sprite } from '../src/lib/unified-types';
import type { PixelGrid } from '../src/lib/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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
const deepEq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------- 1) 退役 API 全仓断言 ----------
{
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name)) files.push(p);
    }
  };
  walk(join(root, 'src'));
  const hits: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (/addPart\(/.test(src)) hits.push(`${f}: addPart(`);
    if (/updatePart\(/.test(src)) hits.push(`${f}: updatePart(`);
    if (/projectStore\.(parts|addPart|updatePart|setPartPixels)\b/.test(src)) hits.push(`${f}: projectStore.<退役名>`);
  }
  check('1a 全仓无 addPart(/updatePart(/projectStore 退役名引用', hits.length === 0, hits.join(' | '));

  const storeDir = join(root, 'src/lib/store');
  const storeHits: string[] = [];
  for (const name of readdirSync(storeDir)) {
    if (!/\.ts$/.test(name)) continue;
    const src = readFileSync(join(storeDir, name), 'utf8');
    if (src.includes('setPartPixels')) storeHits.push(name);
  }
  check('1b store 层无 setPartPixels 定义/调用', storeHits.length === 0, storeHits.join(' | '));

  const editorStore = readFileSync(join(storeDir, 'editor-store.ts'), 'utf8');
  const extractBlock = editorStore.slice(editorStore.indexOf('extractSAMMaskAsPart: () => {'));
  const extractBody = extractBlock.slice(0, extractBlock.indexOf('enterSpriteEditMode'));
  check('1c 提取走现行 addSprite/setSpritePixels', extractBody.includes('addSprite(') && extractBody.includes('setSpritePixels('));
  check('1d 提取采样走共用纯核心 buildSpriteFromCanvasMask', extractBody.includes('buildSpriteFromCanvasMask('));
  check('1e 提取后 selectPart 选中新精灵', extractBody.includes('selectPart('));
}

// ---------- 2) 纯核心行为 ----------
function mkSprite(id: string, data: PixelGrid, plugPx: number): Sprite {
  return {
    id, name: id, width: data[0]!.length, height: data.length, data,
    plug: { x: pxToSub(plugPx), y: pxToSub(plugPx) },
  } as Sprite;
}
const dataA: PixelGrid = [
  ['#aa0000', null, '#aa0002', '#aa0003'],
  ['#aa0010', '#aa0011', null, '#aa0013'],
  [null, null, null, null],
  ['#aa0030', '#aa0031', '#aa0032', '#aa0033'],
];
const dataB: PixelGrid = [
  ['#bb0000', '#bb0001', '#bb0002', '#bb0003'],
  ['#bb0010', '#bb0011', '#bb0012', '#bb0013'],
  ['#bb0020', '#bb0021', '#bb0022', '#bb0023'],
  ['#bb0030', '#bb0031', '#bb0032', '#bb0033'],
];
const sprA = mkSprite('A', dataA, 2);
const sprB = mkSprite('B', dataB, 2);
const mask = new Set(['8,8', '9,8', '10,8', '9,9', '11,11', '5,5']);
const expectedGrid: PixelGrid = [
  ['#aa0000', '#bb0001', '#aa0002', null],
  [null, '#aa0011', null, null],
  [null, null, null, null],
  [null, null, null, '#aa0033'],
];
{
  const built = buildSpriteFromCanvasMask([sprA, sprB], 20, 20, mask);
  check('2a 核心产出非空', built !== null);
  check('2b 包围盒 4x4', built?.width === 4 && built?.height === 4, `${built?.width}x${built?.height}`);
  check('2c 像素逐格对（A 先胜、A 透明处 B 补、掩码外不入）', deepEq(built?.pixels, expectedGrid),
    JSON.stringify(built?.pixels));
  // 质心 (1,1)、min=(8,8)、画布 20 → plug = 1 + (8-10+2-(2-1)) = 0
  check('2d plug 按选区提取同式回算 = (0,0)', built?.plugX === 0 && built?.plugY === 0,
    `${built?.plugX},${built?.plugY}`);
  check('2e 空掩码 → null', buildSpriteFromCanvasMask([sprA], 20, 20, new Set()) === null);
  check('2f 掩码只压透明/界外 → null',
    buildSpriteFromCanvasMask([sprA], 20, 20, new Set(['9,8', '5,5'])) === null);
  check('2g 无精灵 → null', buildSpriteFromCanvasMask([], 20, 20, mask) === null);
  const selMask = samMaskToSelectionMask(new Float32Array(400).fill(0), [20, 20], 20, 20);
  check('2h 全零 SAM 掩码 → 空选区集', selMask.size === 0);
}

// ---------- 3) 真实 store 端到端 ----------
{
  const { useProjectStore } = await import('../src/lib/store/index');
  const { useEditorStore } = await import('../src/lib/store/editor-store');

  const pst = useProjectStore;
  pst.setState({ canvasWidth: 20, canvasHeight: 20, sprites: {} });
  const src = pst.getState().addSprite('源图', 4, 4, { plugX: 2, plugY: 2 });
  pst.getState().setSpritePixels(src.id!, dataA);
  const srcB = pst.getState().addSprite('底层', 4, 4, { plugX: 2, plugY: 2 });
  pst.getState().setSpritePixels(srcB.id!, dataB);
  const countBefore = Object.keys(pst.getState().sprites).length;

  const maskData = new Float32Array(400);
  for (const key of mask) {
    const [x, y] = key.split(',').map(Number);
    maskData[y * 20 + x] = 1;
  }
  const prevSam = useEditorStore.getState().samState;
  useEditorStore.setState({
    samState: { ...prevSam, status: 'ready', currentMask: maskData, maskShape: [20, 20], maskBounds: null },
  });

  const newId = useEditorStore.getState().extractSAMMaskAsPart();
  check('3a 提取返回新精灵 id', typeof newId === 'string' && !!newId, String(newId));
  const spr = newId ? pst.getState().sprites[newId] : undefined;
  check('3b 新精灵进全局精灵表', !!spr && spr.name === 'SAM选区', spr?.name);
  check('3c 新精灵像素逐格对', deepEq(spr?.data, expectedGrid), JSON.stringify(spr?.data));
  check('3d 新精灵 plug 对（SubPixel (0,0)）', spr?.plug?.x === 0 && spr?.plug?.y === 0,
    JSON.stringify(spr?.plug));
  check('3e 精灵总数 +1', Object.keys(pst.getState().sprites).length === countBefore + 1);
  check('3f 提取后 SAM 掩码清空', useEditorStore.getState().samState.currentMask === null);
  check('3g 编辑器选中新精灵', useEditorStore.getState().selectedSpriteId === newId);

  // 全零掩码：返回 null、不建精灵
  useEditorStore.setState({
    samState: { ...useEditorStore.getState().samState, status: 'ready', currentMask: new Float32Array(400), maskShape: [20, 20] },
  });
  const countMid = Object.keys(pst.getState().sprites).length;
  check('3h 全零掩码提取返回 null', useEditorStore.getState().extractSAMMaskAsPart() === null);
  check('3i 全零掩码不建精灵', Object.keys(pst.getState().sprites).length === countMid);

  // 无掩码：返回 null
  useEditorStore.setState({
    samState: { ...useEditorStore.getState().samState, currentMask: null, maskShape: null },
  });
  check('3j 无掩码提取返回 null', useEditorStore.getState().extractSAMMaskAsPart() === null);
}

// ---------- 4) 非 ready 接线断言 ----------
{
  const handlers = readFileSync(join(root, 'src/components/pixel-editor/canvas/tool-handlers.ts'), 'utf8');
  const block = handlers.slice(
    handlers.indexOf('export const smartSelectHandler'),
    handlers.indexOf('// Inpaint Tool Handler'),
  );
  check('4a smartSelectHandler 非 ready 态走 notifySAMNotReady',
    block.includes("status !== 'ready'") && block.includes('notifySAMNotReady'));
  check('4b 反馈走 toast 且点名降级路径（套索/魔棒）',
    handlers.includes('notifySAMNotReady') && handlers.includes('改用套索/魔棒手动选区'));
  check('4c error 态与未就绪态分别给话', handlers.includes('AI 选区不可用') && handlers.includes('AI 选区未就绪'));

  const panels = readFileSync(join(root, 'src/components/pixel-editor/toolbar/ToolOptionPanels.tsx'), 'utf8');
  check('4d 面板带降级提示文案', panels.includes('改用套索/魔棒手动选区'));
  check('4e 提取按钮文案为「提取为精灵」且无「提取为Part」残留',
    panels.includes('提取为精灵') && !panels.includes('提取为Part'));
}

console.log(`\nverify-sam-extract: ${passed} 过 / ${failed} 败`);
if (failed > 0) process.exit(1);
