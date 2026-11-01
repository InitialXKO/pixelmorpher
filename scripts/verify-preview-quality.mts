// 预览画质接线探针（F-06）：editor-store.previewQuality（顶栏高/中/低）
// 必须一路到达 renderNodeSprite 的门控字段 instruction.previewQuality。
//  1) 行为级：走 generateRenderPlan 真路径构造渲染计划，断言
//     quality='low'/'medium'/'high' 时计划与每条节点指令都带上该值
//     （门控实际消费的字段就是 instruction.previewQuality，见源码
//     见证断言）；不传时指令不带戳、计划为 undefined（消费端
//     `?? 'high'` 兜底语义不变，导出/捕获路径行为不变）。
//  2) 源码接线：调用方不再写死 'high'（PixelCanvas 读 store、
//     SketchPoseDialog 读 est）、编排层逐环下传（renderUnified →
//     renderPuppetViaUnifiedPipeline → generateRenderPlan 形参槽、
//     renderUnifiedToCanvas 同、洋葱皮 onionQuality 接通）。
// 还原自查：摘掉 generateRenderPlan 的盖戳、任一调用方改回 'high'、
// 任一编排环改回 undefined，本探针对应断言应转红。

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateRenderPlan } from '../src/lib/unified-render';
import { useProjectStore } from '../src/lib/store';
import {
  createDefaultCharacter, createDefaultCostumePiece, createDefaultNode, pxToSub,
  type Character, type Node, type Sprite,
} from '../src/lib/unified-types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`); }
}

useProjectStore.setState({ canvasWidth: 256, canvasHeight: 256, currentFrame: 0, frameRate: 12 } as never);

// ---------- 夹具：根 + 一个带精灵的子节点 ----------
const grid = (w: number, h: number) => Array.from({ length: h }, () => Array(w).fill('#c63'));
const sprA: Sprite = {
  id: 'sprA', name: 'sprA', width: 48, height: 14, data: grid(48, 14),
  plug: { x: pxToSub(42), y: pxToSub(7) },
} as Sprite;

function fixture(): Character {
  const R: Node = createDefaultNode('R', 'torso');
  const S: Node = createDefaultNode('S', 'upper_arm_R'); S.parentId = 'R';
  for (const n of [R, S]) n.transform.variantIndex = 6;
  R.children = ['S'];
  R.sockets = [{
    id: 'sS', name: 'sS', basePosition: { x: 0, y: 0 }, directionOffsets: {},
    offset3D: { x: pxToSub(-30), y: 0, z: 0 },
  }];
  S.attachment = { type: 'socket', parentSocketId: 'sS', plug: { x: 0, y: 0 } } as never;
  const piece = createDefaultCostumePiece('S');
  piece.sprites = { 6: { spriteId: 'sprA' } } as never;
  const ch = createDefaultCharacter('pq1', '画质探针角色');
  return {
    ...ch,
    nodes: { R, S }, rootNodeId: 'R', sprites: {},
    costumeSets: [{ id: 'set1', name: '默认', pieces: { S: piece } }],
    activeCostumeSetId: 'set1', direction: 6, latitude: 0,
  } as unknown as Character;
}

const planOf = (quality?: 'low' | 'medium' | 'high') => generateRenderPlan(
  fixture(), 0, 256, 256, 'pixel-perfect', 12,
  undefined, undefined, quality,
  undefined, undefined, undefined, undefined, undefined, undefined,
  { sprA },
);

// ---------- 1) 行为级：计划/指令带上画质 ----------
{
  const low = planOf('low');
  check('1a low：计划生成出节点指令', low.nodeInstructions.length > 0, `n=${low.nodeInstructions.length}`);
  check('1b low：plan.previewQuality === low', low.previewQuality === 'low', `${low.previewQuality}`);
  check('1c low：每条节点指令 previewQuality === low（门控消费字段）',
    low.nodeInstructions.every((i) => i.previewQuality === 'low'),
    JSON.stringify(low.nodeInstructions.map((i) => i.previewQuality)));
  check('1d low：排序后指令同带 low（同一对象）',
    low.sortedInstructions.every((i) => i.previewQuality === 'low'));

  const med = planOf('medium');
  check('1e medium：每条节点指令 previewQuality === medium',
    med.nodeInstructions.length > 0 && med.nodeInstructions.every((i) => i.previewQuality === 'medium'));

  const high = planOf('high');
  check('1f high：每条节点指令 previewQuality === high（高画质行为不变）',
    high.nodeInstructions.length > 0 && high.nodeInstructions.every((i) => i.previewQuality === 'high'));

  const unset = planOf(undefined);
  check('1g 不传：plan.previewQuality === undefined', unset.previewQuality === undefined);
  check('1h 不传：指令不带戳（消费端 ?? high 兜底，导出/捕获路径不变）',
    unset.nodeInstructions.every((i) => i.previewQuality === undefined));
}

// ---------- 2) 源码见证：门控消费的正是该字段 ----------
{
  const src = readFileSync(join(root, 'src/lib/unified-render.ts'), 'utf8');
  check('2a renderNodeSprite 读 instruction.previewQuality ?? high',
    src.includes("const previewQuality = instruction.previewQuality ?? 'high';"));
  const gates = (src.match(/previewQuality (!==|===) 'low'/g) ?? []).length;
  check('2b low 门控点齐备（置换/宿主/发光/残影/身后/身前/粒子，≥7 处）', gates >= 7, `gates=${gates}`);
  check('2c generateRenderPlan 盖戳下传到指令', src.includes('inst.previewQuality = previewQuality'));
  check('2d 编排层与洋葱皮两处计划调用槽都传入 previewQuality（摘任一处计数即少）',
    src.includes("previewQuality?: 'low' | 'medium' | 'high',")
    && (src.match(/undefined, previewQuality, undefined, undefined, undefined,/g) ?? []).length === 2,
    `count=${(src.match(/undefined, previewQuality, undefined, undefined, undefined,/g) ?? []).length}`);
  check('2e renderUnified 把自身画质实参下传编排层', src.includes('simCtxFor, previewQuality,'));
  check('2f renderUnifiedToCanvas 把自身画质形参下传编排层',
    src.includes('undefined, undefined, undefined, previewQuality,'));
  check('2g 洋葱皮渲染入口形参带 previewQuality', (src.match(/previewQuality\?: 'low' \| 'medium' \| 'high',/g) ?? []).length >= 2);
}

// ---------- 3) 源码接线：调用方读 store、不再写死 ----------
{
  const canvas = readFileSync(join(root, 'src/components/pixel-editor/PixelCanvas.tsx'), 'utf8');
  check('3a PixelCanvas 主渲染读 editor-store 的 previewQuality',
    canvas.includes('useEditorStore.getState().previewQuality'));
  check('3b PixelCanvas 不再写死 high', !canvas.includes("s.frameRate, 'high'"));
  check('3c PixelCanvas 洋葱皮把 onionQuality 传入渲染（死变量接通）',
    (canvas.match(/onionQuality/g) ?? []).length >= 2 && canvas.includes('onionQuality,'));
  const sketch = readFileSync(join(root, 'src/components/pixel-editor/puppet/SketchPoseDialog.tsx'), 'utf8');
  check('3d SketchPoseDialog 读 est.previewQuality', sketch.includes('est.previewQuality'));
  check('3e SketchPoseDialog 不再写死 high', !sketch.includes("frameRate, 'high'"));
}

console.log(`\nverify-preview-quality: ${passed} 过 / ${failed} 败`);
if (failed > 0) process.exit(1);
