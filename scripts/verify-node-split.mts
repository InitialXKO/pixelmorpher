// 节点拆分核心 lib 探针：结构不变量（E 静止位不变、M 落在 t 处、
// 插座偏移按 t 缩放）、精灵切分（像素守恒、逐向/变体条目、参数化两
// 档、整幅留/整幅改挂）、堆叠按层断 + 远摞原点回填、IK 链段数点名、
// 叶子拆分、过短拒绝。
import {
  createDefaultNode, createDefaultCostumePiece, pxToSub, subToPx,
  projectToView, applyFrameRotation,
} from '../src/lib/unified-types';
import type { Character, Node, Sprite, CostumeSet } from '../src/lib/unified-types';
import { computeWorldTransforms } from '../src/lib/unified-render';
import { splitNodeSegment } from '../src/lib/node-split';

let fails = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };

const mkGrid = (w: number, h: number, fill: (x: number, y: number) => string | null): (string | null)[][] => {
  const g: (string | null)[][] = [];
  for (let y = 0; y < h; y++) { const row: (string | null)[] = []; for (let x = 0; x < w; x++) row.push(fill(x, y)); g.push(row); }
  return g;
};
const solids = (s: Sprite) => s.data.flat().filter((c) => c !== null && c !== '').length;
const mkSprite = (id: string, name: string, data: (string | null)[][], plugX: number, plugY: number): Sprite => ({
  id, name, width: data[0].length, height: data.length, data,
  plug: { x: pxToSub(plugX), y: pxToSub(plugY) },
} as Sprite);

const barA = mkGrid(48, 14, (x, y) => (x >= 4 && x <= 44 && y >= 4 && y <= 10 && !((x === 20 && y === 7) || (x === 33 && y === 5))) ? '#c63' : null);
const barB = mkGrid(48, 14, (x, y) => (x >= 4 && x <= 44 && y >= 4 && y <= 10) ? '#36c' : null);
const barV = mkGrid(40, 10, (x, y) => (x >= 3 && x <= 36 && y >= 3 && y <= 7) ? '#3c6' : null);
const sprA = mkSprite('sprA', 'upper_arm', barA, 42, 7);
const sprB = mkSprite('sprB', 'upper_arm_se', barB, 42, 7);
const sprV = mkSprite('sprV', 'upper_arm_v1', barV, 35, 5);
const sprA2 = mkSprite('sprA2', 'upper_arm_sil', barA, 42, 7);
const sprA3 = mkSprite('sprA3', 'upper_arm_gen', barA, 42, 7);
const layerSprites: Record<string, Sprite> = {};
for (let i = 0; i < 8; i++) {
  layerSprites[`lay${i}`] = mkSprite(`lay${i}`, `layer${i}`, mkGrid(6, 6, () => '#999'), 3, 3);
}
const table: Record<string, Sprite> = { sprA, sprB, sprV, sprA2, sprA3, ...layerSprites };

const sock = (id: string, x: number, y: number) => ({
  id, name: id, basePosition: { x: 0, y: 0 }, directionOffsets: {},
  offset3D: { x: pxToSub(x), y: pxToSub(y), z: 0 },
});
const attach = (n: Node, sid: string) => { n.attachment = { type: 'socket', parentSocketId: sid, plug: { x: 0, y: 0 } } as never; };
const mkNode = (id: string, name: string, parentId?: string): Node => {
  const n = createDefaultNode(id, name);
  n.transform.variantIndex = 6;
  if (parentId) n.parentId = parentId;
  return n;
};

function buildCharacter(): Character {
  const R = mkNode('R', 'torso');
  const S = mkNode('S', 'upper_arm_R', 'R');
  const E = mkNode('E', 'hand_R', 'S');
  const F = mkNode('F', 'finger_R', 'E');
  R.children = ['S']; S.children = ['E']; E.children = ['F'];
  R.sockets = [sock('sS', -30, 0)]; S.sockets = [sock('sE', -40, 0)]; E.sockets = [sock('sF', -25, 0)];
  attach(S, 'sS'); attach(E, 'sE'); attach(F, 'sF');

  const pieceMain = createDefaultCostumePiece('upper_arm_R');
  pieceMain.sprites = { 6: { spriteId: 'sprA' }, 7: { spriteId: 'sprB' } } as never;
  pieceMain.variantSprites = { v1: { 6: { spriteId: 'sprV' } } } as never;
  S.slot = pieceMain as never;

  const pieceStack = createDefaultCostumePiece('upper_arm_R');
  pieceStack.sprites = { 6: { spriteId: 'sprA' } } as never;
  pieceStack.stack = {
    layerSpriteIds: Object.keys(layerSprites), layerThickness: 5,
    origin: { x: 0, y: 0, z: 0 }, axis: { x: -1, y: 0, z: 0 },
    uAxis: { x: 0, y: 1, z: 0 }, vAxis: { x: 0, y: 0, z: 1 },
  };

  const paramBase = {
    shape: { kind: 'ellipse', size: [20, 10] }, centerOffset: [0, 0],
    surface: [], palette: 'skin', light: 0, outline: 0, rim: 0, glint: 0, rimI: 0, glintI: 0,
  } as never;
  const pieceSil = createDefaultCostumePiece('upper_arm_R');
  pieceSil.sprites = { 6: { spriteId: 'sprA2' } } as never;
  pieceSil.parametric = { ...(paramBase as object), composite: 'silhouette' } as never;
  const pieceGen = createDefaultCostumePiece('upper_arm_R');
  pieceGen.sprites = { 6: { spriteId: 'sprA3' } } as never;
  pieceGen.parametric = { ...(paramBase as object), composite: 'generate' } as never;

  const sets: CostumeSet[] = [
    { id: 'set1', name: '默认', pieces: { upper_arm_R: pieceMain } } as CostumeSet,
    { id: 'set2', name: '摞装', pieces: { upper_arm_R: pieceStack } } as CostumeSet,
    { id: 'set3', name: '剪影', pieces: { upper_arm_R: pieceSil } } as CostumeSet,
    { id: 'set4', name: '生成', pieces: { upper_arm_R: pieceGen } } as CostumeSet,
  ];
  return {
    id: 'ch1', name: 'ch1',
    nodes: { R, S, E, F },
    rootNodeId: 'R', sprites: {},
    costumeSets: sets, activeCostumeSetId: 'set1',
    direction: 6, latitude: 0,
    ikChains: [{
      id: 'ik1', name: '臂链', rootNodeId: 'S', endNodeId: 'F',
      target: { x: 0, y: 0 }, enabled: true, solver: '2bone',
    }],
  } as unknown as Character;
}

const restPos = (ch: Character, id: string) => {
  const nodes: Record<string, Node> = {};
  for (const n of Object.values(ch.nodes)) nodes[n.id] = { ...n, tracks: {}, transform: { ...n.transform, variantIndex: 6 } };
  const wt = computeWorldTransforms({ ...ch, nodes, ikChains: [] } as Character, 0, 512, 512, 12);
  const w = wt.get(id)!;
  const p = projectToView(w.worldX, w.worldY, w.worldZ, 6);
  return { x: subToPx(p.canvasX), y: subToPx(p.canvasY) };
};

// ---------- 主拆分 ----------
{
  const ch = buildCharacter();
  const eBefore = restPos(ch, 'E');
  const fBefore = restPos(ch, 'F');
  const solidsA = solids(sprA), solidsB = solids(sprB), solidsV = solids(sprV);
  const out = splitNodeSegment({ character: ch, sprites: table, nodeId: 'S', childId: 'E', t: 0.5, direction: 6 });
  ok(out.ok, `拆分成功${out.ok ? '' : '：' + out.error}`);
  if (out.ok && out.character && out.midNodeId) {
    const nc = out.character;
    const M = nc.nodes[out.midNodeId];
    const S2 = nc.nodes['S'], E2 = nc.nodes['E'];
    ok(M.parentId === 'S' && E2.parentId === out.midNodeId, '结构：M 挂 S、E 改挂 M');
    ok(S2.children.includes(out.midNodeId) && !S2.children.includes('E'), '结构：S 的孩子 E 换成 M');
    ok(M.name === 'upper_arm_R_mid', `新节点名 ${M.name}`);
    const sockM = S2.sockets.find((s) => s.id === M.attachment.parentSocketId);
    ok(!!sockM && subToPx(sockM!.offset3D!.x) === -20, 'M 插座 offset3D = 原偏移 × t（−20）');
    const sockE = M.sockets.find((s) => s.id === E2.attachment.parentSocketId);
    ok(!!sockE && subToPx(sockE!.offset3D!.x) === -20, 'E 插座 offset3D = 原偏移 × (1−t)（−20）');
    const mPos = restPos(nc, out.midNodeId);
    ok(Math.hypot(mPos.x - -50, mPos.y - 0) < 1.5, `M 静止位落 t 处（${mPos.x.toFixed(1)},${mPos.y.toFixed(1)}）`);
    const eAfter = restPos(nc, 'E');
    const fAfter = restPos(nc, 'F');
    ok(Math.hypot(eAfter.x - eBefore.x, eAfter.y - eBefore.y) < 1.0, 'E 静止位不变');
    ok(Math.hypot(fAfter.x - fBefore.x, fAfter.y - fBefore.y) < 1.0, 'F 静止位不变');

    const byId = new Map((out.newSprites ?? []).map((s) => [s.id, s]));
    const set1 = nc.costumeSets.find((s) => s.id === 'set1')!;
    const pS = set1.pieces['upper_arm_R'], pM = set1.pieces['upper_arm_R_mid'];
    ok(!!pM, '生效集有 M 的件');
    const nearA = byId.get((pS.sprites[6] as { spriteId: string }).spriteId)!;
    const farA = byId.get((pM.sprites[6] as { spriteId: string }).spriteId)!;
    ok(!!nearA && !!farA && solids(nearA) + solids(farA) === solidsA, `方向 6 像素守恒（${solids(nearA)}+${solids(farA)}=${solidsA}）`);
    const nearB = byId.get((pS.sprites[7] as { spriteId: string }).spriteId)!;
    const farB = byId.get((pM.sprites[7] as { spriteId: string }).spriteId)!;
    ok(!!nearB && !!farB && solids(nearB) + solids(farB) === solidsB, '方向 7 像素守恒（逐向全切）');
    const nearV = byId.get((pS.variantSprites!.v1[6] as { spriteId: string }).spriteId)!;
    const farV = byId.get((pM.variantSprites!.v1[6] as { spriteId: string }).spriteId)!;
    ok(!!nearV && !!farV && solids(nearV) + solids(farV) === solidsV, '变体图同样切分守恒');
    // far.plug 对位：独立重算远段裁剪原点（实心包围盒 −2 边距），
    // far.plug 应 = 切点 C(22,7) − 裁剪原点（方向 6 轴为图内 −x）
    {
      let minX = 1e9, minY = 1e9;
      for (let y = 0; y < sprA.height; y++) for (let x = 0; x < sprA.width; x++) {
        const c = sprA.data[y][x];
        if (c !== null && c !== '' && x + 0.5 < 22) { if (x < minX) minX = x; if (y < minY) minY = y; }
      }
      const cropX = Math.max(0, minX - 2), cropY = Math.max(0, minY - 2);
      const plugPx = { x: subToPx(farA.plug!.x), y: subToPx(farA.plug!.y) };
      ok(Math.abs(plugPx.x - (22 - cropX)) < 0.51 && Math.abs(plugPx.y - (7 - cropY)) < 0.51,
        `远段 plug 落切点（plug ${plugPx.x},${plugPx.y} vs 期望 ${22 - cropX},${7 - cropY}）`);
      const nearPlug = { x: subToPx(nearA.plug!.x), y: subToPx(nearA.plug!.y) };
      // 近段实心 x∈[22,44]、y∈[4,10] → 裁剪原点 (20,2)，plug 应 = (42,7)−(20,2)
      ok(nearPlug.x === 22 && nearPlug.y === 5, `近段 plug = 原 plug − 裁剪原点（${nearPlug.x},${nearPlug.y} vs 期望 22,5）`);
    }
    ok(typeof M.attachment.jointWidth === 'number' && (M.attachment.jointWidth as number) > 0, `M 关节盘径来自切口宽（${M.attachment.jointWidth}）`);

    // 堆叠集
    const set2 = nc.costumeSets.find((s) => s.id === 'set2')!;
    const stS = set2.pieces['upper_arm_R'].stack!;
    const stM = set2.pieces['upper_arm_R_mid']?.stack;
    ok(stS.layerSpriteIds.length === 4 && !!stM && stM.layerSpriteIds.length === 4, '堆叠按层断 4/4');
    ok(!!stM && stS.layerSpriteIds.concat(stM.layerSpriteIds).join() === Object.keys(layerSprites).join(), '层序拼接 = 原摞');
    if (stM) {
      // 远摞原点回填校验：M 世界帧 ∘ origin 应等于 S 帧下 origin + axis·20
      const nodes: Record<string, Node> = {};
      for (const n of Object.values(nc.nodes)) nodes[n.id] = { ...n, tracks: {}, transform: { ...n.transform, variantIndex: 6 } };
      const wt = computeWorldTransforms({ ...nc, nodes, ikChains: [] } as Character, 0, 512, 512, 12);
      const wS = wt.get('S')!, wM = wt.get(out.midNodeId)!;
      const lhs = applyFrameRotation(wM.worldFrame, stM.origin.x, stM.origin.y, stM.origin.z, 6);
      const mPx = { x: subToPx(wM.worldX), y: subToPx(wM.worldY), z: subToPx(wM.worldZ) };
      const sPx = { x: subToPx(wS.worldX), y: subToPx(wS.worldY), z: subToPx(wS.worldZ) };
      const worldFromM = { x: mPx.x + lhs.x, y: mPx.y + lhs.y, z: mPx.z + lhs.z };
      const rhs = applyFrameRotation(wS.worldFrame, -20, 0, 0, 6);
      const worldFromS = { x: sPx.x + rhs.x, y: sPx.y + rhs.y, z: sPx.z + rhs.z };
      const d = Math.hypot(worldFromM.x - worldFromS.x, worldFromM.y - worldFromS.y, worldFromM.z - worldFromS.z);
      ok(d < 1.5, `远摞原点回填对位（偏差 ${d.toFixed(2)}px）`);
    }

    // 参数化两档
    const set3 = nc.costumeSets.find((s) => s.id === 'set3')!;
    const pM3 = set3.pieces['upper_arm_R_mid'];
    ok(!!pM3 && !!pM3.parametric && (pM3.parametric as never as { composite: string }).composite === 'silhouette', '借剪影档：定义复制给 M');
    const set4 = nc.costumeSets.find((s) => s.id === 'set4')!;
    ok(!set4.pieces['upper_arm_R_mid'], '独立生成档：M 无件（整件留原节点）');
    ok((set4.pieces['upper_arm_R'].sprites[6] as { spriteId: string }).spriteId === 'sprA3', '独立生成档：原图未切');

    // IK 点名
    ok(out.report.some((r) => r.includes('IK 链「臂链」') && r.includes('2→3')), 'IK 链段数 2→3 点名');
    console.log('  报告：\n    ' + out.report.join('\n    '));
  }
}

// ---------- 叶子拆分 ----------
{
  const ch = buildCharacter();
  // 给 F 挂一幅图作叶子（F 无子）
  const sprF = mkSprite('sprF', 'finger', mkGrid(30, 8, (x, y) => (x >= 2 && x <= 27 && y >= 2 && y <= 6) ? '#963' : null), 4, 4);
  const tableF = { ...table, sprF };
  const pieceF = createDefaultCostumePiece('finger_R');
  pieceF.sprites = { 6: { spriteId: 'sprF' } } as never;
  ch.nodes['F'].slot = pieceF as never;
  ch.costumeSets[0].pieces['finger_R'] = pieceF;
  const out = splitNodeSegment({ character: ch, sprites: tableF, nodeId: 'F', childId: null, t: 0.5, direction: 6 });
  ok(out.ok, `叶子拆分成功${out.ok ? '' : '：' + out.error}`);
  if (out.ok && out.character && out.midNodeId) {
    const nc = out.character;
    ok(nc.nodes['F'].children.includes(out.midNodeId), '叶子：M 成 F 的孩子');
    const pM = nc.costumeSets[0].pieces['finger_R_mid'];
    ok(!!pM && !!pM.sprites[6], '叶子：远段图挂 M');
    const byId = new Map((out.newSprites ?? []).map((s) => [s.id, s]));
    const near = byId.get((nc.costumeSets[0].pieces['finger_R'].sprites[6] as { spriteId: string }).spriteId)!;
    const far = byId.get((pM.sprites[6] as { spriteId: string }).spriteId)!;
    ok(solids(near) + solids(far) === solids(sprF), '叶子：像素守恒');
  }
}

// ---------- 过短拒绝 ----------
{
  const ch = buildCharacter();
  ch.nodes['S'].sockets = [sock('sE', -10, 0)];
  const out = splitNodeSegment({ character: ch, sprites: table, nodeId: 'S', childId: 'E', t: 0.5, direction: 6 });
  ok(!out.ok, '段太短拒绝');
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
