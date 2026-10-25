// 探针：编辑器角色 → Live2D 模型（走 generateRenderPlan 真实消费链）。
// 运行：bun scripts/probe-live2d-character.mts（退出码 0 = 全过）
import {
  createDefaultCharacter, createDefaultNode, pxToSub,
} from '../src/lib/unified-types';
import type { Character, Sprite } from '../src/lib/unified-types';
import { buildLive2dModelFromCharacter } from '../src/lib/live2d/build-from-character';
import { buildMoc3 } from '../src/lib/live2d/moc3';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra ?? ''); }
}

function gridSprite(w: number, h: number, color: string): Sprite {
  return {
    width: w, height: h,
    data: Array.from({ length: h }, () => Array.from({ length: w }, () => color)),
    plug: { x: pxToSub(w / 2), y: pxToSub(h / 2) },
  } as Sprite;
}

function fixture(angle: number): { character: Character; sprites: Record<string, Sprite> } {
  const torsoSprite = gridSprite(6, 2, '#FF0000');
  const headSprite = gridSprite(2, 2, '#0000FF');
  const allDirs = (s: Sprite) => ({ 0: s, 1: s, 2: s, 3: s, 4: s, 5: s, 6: s, 7: s });

  const torso = createDefaultNode('torso', '躯干');
  torso.slot = { slotKey: 'torso' } as typeof torso.slot;
  torso.transform.angle = angle;
  const head = createDefaultNode('head', '头');
  head.slot = { slotKey: 'head' } as typeof head.slot;
  head.parentId = 'torso';
  head.transform.y = pxToSub(-10);
  torso.children = ['head'];

  const character = createDefaultCharacter('char1', '测试角色');
  character.nodes = { torso, head };
  character.rootNodeId = 'torso';
  character.costumeSets = [{
    id: 'set1', name: '默认',
    pieces: {
      torso: { nodeId: 'torso', zIndex: 0, sprites: allDirs(torsoSprite) },
      head: { nodeId: 'head', zIndex: 1, sprites: allDirs(headSprite) },
    },
  } as unknown as Character['costumeSets'][number]];
  character.activeCostumeSetId = 'set1';
  return { character, sprites: {} };
}

function quadSize(d: { neutralPositions: Float32Array }) {
  const xs = [d.neutralPositions[0], d.neutralPositions[2], d.neutralPositions[4], d.neutralPositions[6]];
  const ys = [d.neutralPositions[1], d.neutralPositions[3], d.neutralPositions[5], d.neutralPositions[7]];
  return {
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
    cy: (Math.max(...ys) + Math.min(...ys)) / 2,
  };
}

// ---- 1. 基本构建：两节点两图元、纹理颜色对、上下关系对 ----
{
  const { character, sprites } = fixture(0);
  const model = buildLive2dModelFromCharacter(character, sprites, { viewportSize: 256 });
  check('两图元', model.drawables.length === 2, model.drawables.map((d) => d.id));
  const torso = model.drawables.find((d) => d.id === 'chr_torso')!;
  const head = model.drawables.find((d) => d.id === 'chr_head')!;
  check('躯干纹理 6×2 红', torso.texture.width === 6 && torso.texture.height === 2
    && torso.texture.rgba[0] === 255 && torso.texture.rgba[3] === 255);
  check('头纹理 2×2 蓝', head.texture.width === 2 && head.texture.rgba[2] === 255 && head.texture.rgba[3] === 255);
  const ts = quadSize(torso);
  const hs = quadSize(head);
  check('躯干横宽纵窄（6×2）', ts.w > ts.h * 2.5, ts);
  check('头在躯干上方（y 更小）', hs.cy < ts.cy, { headCy: hs.cy, torsoCy: ts.cy });
  check('画序：头在躯干之后（更靠前）', head.renderOrder > torso.renderOrder,
    { head: head.renderOrder, torso: torso.renderOrder });
  check('参数声明三件、无关键形族', model.params.length === 3 && Object.keys(model.families).length === 0);
  // 无族模型也能过写入器（AngleX 静态绑定追踪画序）
  const { moc3, keyformCounts } = buildMoc3(model);
  check('moc3 写入成功（魔数）', moc3.length > 0
    && String.fromCharCode(moc3[0], moc3[1], moc3[2], moc3[3]) === 'MOC3', moc3.length);
  check('静态绑定生效（每图元关键形数 >1，含 AngleX 三键）',
    keyformCounts.length === 2 && keyformCounts.every((n) => n >= 3), keyformCounts);
}

// ---- 2. 旋转：根节点 90° → 躯干四边形宽高互换 ----
{
  const { character, sprites } = fixture(90);
  const model = buildLive2dModelFromCharacter(character, sprites, { viewportSize: 256 });
  const torso = model.drawables.find((d) => d.id === 'chr_torso')!;
  const ts = quadSize(torso);
  check('旋转 90° 后躯干纵宽横窄', ts.h > ts.w * 2.5, ts);
}

// ---- 3. 空角色报错（不静默出空包）----
{
  const character = createDefaultCharacter('empty', '空');
  let threw = false;
  try { buildLive2dModelFromCharacter(character, {}); } catch { threw = true; }
  check('无精灵角色抛错', threw);
}

console.log(`\nprobe-live2d-character: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
