// 审计修复·漂移批 B 探针（F-16/20/21/30/32/34 + 域1/域2 小项 + 附带项）
// 测法分两类并逐项标注：
// - 直接调真实函数/构造真实数据对象断言结果；
// - UI/画布类无头环境跑不起渲染，读源文件断言接线形态，
// 未覆盖面在每项尾注写明（须真机/浏览器复验的观感类不在此列）。
import { readFileSync, existsSync} from 'node:fs';
import { getActiveCostumeSet} from '../src/lib/sprite-resolve';
import { canvasKeyframeParamsFor, resolveCanvasModifierParams} from '../src/lib/engine/canvas-modifiers';
import {
remapMarksForCrop, transformMarksD4, transformMarksAffine,
type SpriteMark,
} from '../src/lib/sprite-marks';
import { mapBonesToNodes, type ProcessedBone, type ProcessedBoneDirection} from '../src/lib/bake/skeleton-mapper';
import { gridAlphaForZoom} from '../src/components/pixel-editor/canvas/canvas-render-helpers';
import { rgbaToHexOrNull} from '../src/lib/engine/utils';
import { numEffectParam} from '../src/lib/effect-track-params';
import { captureProjectThumbnail} from '../src/lib/project-thumbnail';
import { pxToSub} from '../src/lib/unified-types';

let passed = 0;
function check(name: string, cond: boolean) {
if (!cond) { console.error(`✗ ${name}`); process.exit(1);}
passed++;
console.log(`✓ ${name}`);
}
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ---------- F-16主渲染服装集回落 ----------
// getActiveCostumeSet：activeCostumeSetId 未设/失效 → 第一集（与 convert/面板同口径）
{
const sets = [{ id: 'setA'}, { id: 'setB'}] as any;
check('F-16 未设 activeCostumeSetId 回落第一集',
getActiveCostumeSet(sets, undefined)?.id === 'setA');
check('F-16 activeCostumeSetId 失效回落第一集',
getActiveCostumeSet(sets, 'gone')?.id === 'setA');
check('F-16 有效 id 命中对应集',
getActiveCostumeSet(sets, 'setB')?.id === 'setB');
// DressPanel 写路径走分层写函数、读路径走共享解析
const dress = src('src/components/pixel-editor/puppet/DressPanel.tsx');
check('F-16DressPanel 指派走 setUnifiedCostumeSpriteLayered',
dress.includes('setUnifiedCostumeSpriteLayered'));
check('F-16DressPanel 读走 readPieceLayerSpriteId/resolvePieceSprite',
dress.includes('readPieceLayerSpriteId') && dress.includes('resolvePieceSprite'));
const ur = src('src/lib/unified-render.ts');
check('F-16主渲染两处服装集解析都走 getActiveCostumeSet',
(ur.split('getActiveCostumeSet(').length - 1) >= 2);
}

// ---------- F-20覆盖层三上下文共用构造 ----------
// 未覆盖面：ctx 实际数值一致性须在浏览器内对同帧出图比对，本探针只断言
// 五个调用点全部改走共用 helper、且 helper 内的构造口径与主画布一致
{
const helper = src('src/lib/editor-world-transforms.ts');
check('F-20 共用 helper 存在且装配 clamp/sim/proc 三上下文',
helper.includes('editorClampContextFor') && helper.includes('editorSimContextFor')
&& helper.includes('computeFrameProcDeltas'));
const cpr = src('src/components/pixel-editor/canvas/canvas-puppet-render.ts');
check('F-20canvas-puppet-render 五处全走 computeEditorWorldTransforms',
(cpr.split('computeEditorWorldTransforms(').length - 1) >= 5
&&!cpr.includes('computeWorldTransforms('));
const ucs = src('src/components/pixel-editor/canvas/use-canvas-state.ts');
check('F-20枢轴读数走共用 helper', ucs.includes('computeEditorWorldTransforms('));
const np = src('src/lib/node-picking.ts');
check('F-20几何拾取走共用 helper', np.includes('computeEditorWorldTransforms('));
const ur = src('src/lib/unified-render.ts');
check('F-20主渲染 dirBlend/procDeltas 已抽共用函数',
ur.includes('export function facingDirBlendOf') && ur.includes('export function computeFrameProcDeltas'));
}

// ---------- F-21SocketEditor 方向种子与 3D 明示 ----------
// 未覆盖面：面板实际点按/禁用观感须真机复验
{
const se = src('src/components/pixel-editor/SocketEditor.tsx');
check('F-21 点方向格以 base 为种子（不再写 {0,0}）',
se.includes('[dir]: { x: socket.x, y: socket.y }') && !se.includes('[dir]: { x: 0, y: 0 }'));
check('F-21 方向格显示回落 base（?? socket.x）', se.includes('?? socket.x'));
check('F-21 offset3D 生效时 base 编辑禁用并明示',
se.includes('disabled={disabled || !!socket.offset3D}') && se.includes('3D 生效中'));
const rig = src('src/components/pixel-editor/puppet/RigPanel.tsx');
check('F-21 RigPanel base 编辑同步禁用/明示', rig.includes('3D 生效中'));
}

// ---------- F-30画布轨关键帧参数按 modifierId 分键 ----------
{
const track: any = {
id: 't1',
modifiers: [
{ id: 'mA', type: 'vignette', enabled: true, params: { amount: 1}},
{ id: 'mB', type: 'chromatic', enabled: true, params: { amount: 2}},
],
keyframes: [{
id: 'k1', frame: 5,
// 存量扁平袋：无分键时两修改器都回落读它（不丢参）
params: { amount: 7},
// 分键：mA 在此帧有自己的值，mB 没有
paramsByModifier: { mA: { amount: 42}},
}],
};
const kf = track.keyframes[0];
check('F-30 分键命中读分键值', (canvasKeyframeParamsFor(kf, 'mA') as any).amount === 42);
check('F-30 无分键修改器回落扁平袋', (canvasKeyframeParamsFor(kf, 'mB') as any).amount === 7);
const byId = {
mA: (resolveCanvasModifierParams(track, track.modifiers[0], 5) as any).amount,
mB: (resolveCanvasModifierParams(track, track.modifiers[1], 5) as any).amount,
};
check('F-30 渲染解析逐修改器分键（A=42、B=7 不再同值）', byId.mA === 42 && byId.mB === 7);
// slice 写入形态 + 包内模板同口径
const es = src('src/lib/store/effect-slice.ts');
check('F-30slice add 写 paramsByModifier、update 只写目标分键',
es.includes('paramsByModifier') && es.includes('modifierId'));
const rt = src('src/lib/proc-runtime/runtime-template.ts');
check('F-30包内 fxResolveCanvasParams 同走分键+扁平回落',
rt.includes('paramsByModifier') && rt.includes('fxResolveCanvasParams'));
}

// ---------- F-32marks 裁剪/D4/仿射重映射 ----------
{
// 精灵 20×10，裁剪框 (5,2) 起 10×6
const marks: SpriteMark[] = [
{ id: 'p', name: '枪口', kind: 'point', x: 0.5, y: 0.5}, // 像素 (10,5) → 裁后 (5,3) → 归一 (0.5,0.5)
{ id: 'v', name: '冲量', kind: 'vector', x: 0.25, y: 0.5, dx: 0.2, dy: 0}, // 原点 (5,5)→(0,3)；dx 像素 4 → 4/10=0.4
{ id: 'val', name: '硬度', kind: 'value', value: 0.8},
];
const cropped = remapMarksForCrop(marks, 20, 10, -5, -2, 10, 6)!;
const cp = cropped.find((m) => m.id === 'p')!;
check('F-32 裁剪后点标记坐标平移重归一', Math.abs((cp.x?? -1) - 0.5) < 1e-9 && Math.abs((cp.y?? -1) - 0.5) < 1e-9);
const cv = cropped.find((m) => m.id === 'v')!;
check('F-32 裁剪后矢量原点与增量各按新尺寸归一',
Math.abs((cv.x?? -1) - 0) < 1e-9 && Math.abs((cv.dx?? -1) - 0.4) < 1e-9);
check('F-32 value 标记裁剪不动', (cropped.find((m) => m.id === 'val') as any).value === 0.8);

const flipped = transformMarksD4(marks, 'flipH', 20, 10);
const fp = flipped.find((m) => m.id === 'p')!;
check('F-32 flipH 点 x 镜像', Math.abs((fp.x?? -1) - 0.5) < 1e-9); // 0.5 镜像仍 0.5
const fv = flipped.find((m) => m.id === 'v')!;
check('F-32 flipH 矢量 dx 变号、原点镜像',
Math.abs((fv.dx?? 0) + 0.2) < 1e-9 && Math.abs((fv.x?? -1) - 0.75) < 1e-9);

const dirMark: SpriteMark[] = [{ id: 'd', name: '刃向', kind: 'direction', angleDeg: 30}];
const rot = transformMarksD4(dirMark, 'rot90', 20, 10);
check('F-32 rot90 方向角 +90', (rot[0] as any).angleDeg === 120);
const fh = transformMarksD4(dirMark, 'flipH', 20, 10);
check('F-32 flipH 方向角 180-θ', (fh[0] as any).angleDeg === 150);

// 仿射：等比放大 2 倍（尺寸 20×10 → 40×20），矢量增量归一值不变、点归一值不变
const scaled = transformMarksAffine(marks, { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0}, 0, 0, 40, 20, 20, 10)!;
const sv = scaled.find((m) => m.id === 'v')!;
check('F-32 仿射等比放大后归一坐标不变', Math.abs((sv.dx?? -1) - 0.2) < 1e-9 && Math.abs((sv.x?? -1) - 0.25) < 1e-9);
// 仿射下 circle 无法精确表达 → 烘成 painted（有选区格保留）
const circle: SpriteMark[] = [{ id: 'c', name: '光圈', kind: 'region', region: { by: 'circle', cx: 0.5, cy: 0.5, r: 0.2}}];
const circ = transformMarksAffine(circle, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0}, 0, 0, 20, 10, 20, 10)!;
check('F-32 仿射 circle 烘成 painted 且选区非空', (circ[0] as any).region?.by === 'painted' && ((circ[0] as any).region?.mask?.bits?.length ?? 0) > 0);
// slice 三条派生路径都带 marks；包内解析种类优先
const ss = src('src/lib/store/sprite-slice.ts');
check('F-32resize/transform/derive 三路接重映射',
ss.includes('remapMarksForCrop') && ss.includes('transformMarksD4') && ss.includes('transformMarksAffine'));
const rt = src('src/lib/proc-runtime/runtime-template.ts');
check('F-32包内方向绑定改两遍扫（种类优先）',
rt.includes('vector 只补空名'));
}

// ---------- F-33导入补 normalize；value 判后不动 ----------
// value 不动的证据（人工核定，报告正文复述）：markValue 全仓生产代码零
// 调用（仅定义+本研究探针）；设计文档消费端清单无 value 消费设计
{
const ps = src('src/lib/store/project-slice.ts');
check('F-33导入与快照恢复两路都调 normalizeSpriteMarks',
(ps.split('normalizeSpriteMarks(').length - 1) >= 2); // import 行之外 ≥2 处调用 + 定义引用
}

// ---------- F-34Socket 2D 偏移 = 全帧关节差 ----------
{
const dir = (jointX: number, jointY: number, cameraHalf: number): ProcessedBoneDirection => ({
direction: 6, grid: [['#ff0000']], width: 1, height: 1,
cropX: 0, cropY: 0, jointX, jointY, plugX: 0, plugY: 0, cameraHalf, globalCameraHalf: cameraHalf,
} as ProcessedBoneDirection);
const bones = new Map<number, ProcessedBone>();
// 全局像素关节 = jointX × cameraHalf：父 (10,10)×2=(20,20)，子 (14,18)×2=(28,36)
bones.set(0, { boneIndex: 0, boneName: 'hips', parentIndex: null, directions: [dir(10, 10, 2)]});
bones.set(1, { boneIndex: 1, boneName: 'chest', parentIndex: 0, directions: [dir(14, 18, 2)]});
const mapped = mapBonesToNodes(bones, 'fx34', 'T');
const parent = Object.values(mapped.character.nodes).find((n) => n.name === 'hips')!;
const sock = parent.sockets?.[0];
check('F-34 父节点 socket 存在',!!sock);
// 期望偏移 =(28−20, 36−20) px =(8,16) px → 亚像素 ×16
check('F-34 basePosition = 全帧关节差（非零）',
sock?.basePosition.x === pxToSub(8) && sock?.basePosition.y === pxToSub(16));
check('F-34 directionOffsets[6] 同值',
sock?.directionOffsets?.[6]?.x === pxToSub(8) && sock?.directionOffsets?.[6]?.y === pxToSub(16));
check('F-34 无 joint3D 时不写 offset3D', sock?.offset3D === undefined);
}

// ---------- 域2网格透明度公式单调不负 ----------
{
check('网格 alpha(4)=0、alpha(8)=1', gridAlphaForZoom(4) === 0 && gridAlphaForZoom(8) === 1);
let mono = true; let prev = -1;
for (let z = 4; z <= 16; z += 0.5) {
const a = gridAlphaForZoom(z);
if (a < 0 || a > 1 || a < prev) mono = false;
prev = a;
}
check('网格 alpha 在 [4,16] 单调不减且恒 ∈[0,1]', mono);
check('网格 alpha(5)>0（旧公式为负被画布忽略成满格）', gridAlphaForZoom(5) > 0);
}

// ---------- 域2洋葱皮两修 + sprite_edit 清单 ----------
{
const pc = src('src/components/pixel-editor/PixelCanvas.tsx');
check('洋葱皮暂停第二遍叠加已删',!pc.includes('Onion skin overlay on main canvas'));
check('洋葱皮离屏染色走临时画布 drawOnionGhost', pc.includes('drawOnionGhost'));
const ur = src('src/lib/unified-render.ts');
check("sprite_edit本地清单已删、共用 PIXEL_MOD_TYPES（含 cleanup）",!ur.includes('const pixelModTypes'));
}

// ---------- 域1小项 ----------
{
const rail = src('src/components/pixel-editor/toolbar/CanvasToolRail.tsx');
check("F-24mark 工具补进自动进 sprite_edit 枚举", rail.includes("val === 'mark'"));
const bp = src('src/components/pixel-editor/puppet/BehaviorPanel.tsx');
const it = src('src/components/pixel-editor/timeline/InputTracksStrip.tsx');
const ct = src('src/components/pixel-editor/timeline/CueTrackStrip.tsx');
check("coalesceKey三功能各用各的 key",
bp.includes("'behaviorGraph'") && it.includes("'inputTrack'") && ct.includes("'cueTrack'")
&&!bp.includes("pushUndo(undoLabel, 'behavior')") &&!it.includes("pushUndo(undoLabel, 'behavior')") &&!ct.includes("pushUndo(undoLabel, 'behavior')"));
check('缩略图无抓图源时返回空串不抛', captureProjectThumbnail() === '');
const as = src('src/lib/asset-store.ts');
check('缩略图updateCurrentProjectMeta 经 captureProjectThumbnail 生产且回落旧值',
as.includes('captureProjectThumbnail()') && as.includes('existing?.thumbnail'));
const rpd = src('src/components/pixel-editor/ResizePreviewDialog.tsx');
check('ResizePreview无 plug 锚点改中心（与落库一致）',
rpd.includes('sprite.width / 2') && rpd.includes('sprite.height / 2'));
// NaN 钳制：越界读出的 undefined/NaN 通道 → null，不产 NaN 颜色串
check('atlasrgbaToHexOrNull(undefined 通道) = null',
rgbaToHexOrNull(undefined as any, 0, 0, 255) === null);
check('atlasrgbaToHexOrNull(NaN 通道) = null', rgbaToHexOrNull(NaN, 0, 0, 255) === null);
check('atlas正常像素照常出色', rgbaToHexOrNull(255, 0, 16, 255) === '#ff0010');
const sid = src('src/components/pixel-editor/SpritesheetImportDialog.tsx');
check('atlas提取点先钳图界再读像素', sid.includes('srcX >= imageData.width'));
}

// ---------- 附带项 ----------
{
check('effect-rendernumEffectParam 保 0、缺省回落',
numEffectParam({ radius: 0}, 'radius', 3) === 0 && numEffectParam({}, 'radius', 3) === 3);
const er = src('src/lib/engine/effect-render.ts');
check('effect-renderNumber(mod.params.x) || 缺省 已清零',!er.includes('Number(mod.params.'));
const wiz = src('src/components/pixel-editor/puppet/RefAssemblyWizard.tsx');
check('RefAssemblyWizardsamState 改经 setState 写入',
!wiz.includes('store.samState.currentMask =') && wiz.includes('useEditorStore.setState'));
check('死代码SplitImageDialog 已删',!existsSync(new URL('../src/components/pixel-editor/SplitImageDialog.tsx', import.meta.url)));
check('死代码PlugConnectionEditor 已删',!existsSync(new URL('../src/components/pixel-editor/puppet/PlugConnectionEditor.tsx', import.meta.url)));
}

console.log(`\n全部 ${passed} 项通过`);
