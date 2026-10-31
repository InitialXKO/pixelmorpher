// 参考图装配·目标维度写路径探针：
// 以 store 层模拟向导会话的动作序列，断言四件事——
// 1) 目标为已有服装集：不新增服装集、写侧落进该集、放弃（快照还原）后 pieces 逐格一致；
// 2) 变体层：写入落 variantSprites、无指派槽位被顺带指派、已有指派不被覆盖；
// 3) 纬度层：写入键与 latitudeSprites 存储约定一致（纬度 0 走基础层、非 0 以纬度数为键），
//    且纬度层在变体层之外（组合时只落纬度层），并经 resolvePieceSprite 真实消费路径读回；
// 4) 上下文缺省口径：既有 setUnifiedCostumeSprite 仍落生效集基础层逐字不变；
//    editor store 的目标上下文缺省为 null、写入/清理可往返。
// UI 层落点以源码断言补。
import { readFileSync } from 'node:fs';
import { useProjectStore } from '../src/lib/store';
import { useEditorStore, refAssemblyComboKey, refImageSlotKey } from '../src/lib/store/editor-store';
import {
  applySpriteToPieceLayer,
  computeSlotVariantsAfterAssemblyDiscard,
  readPieceLayerSpriteId,
} from '../src/lib/store/character-slice';
import { createDefaultCostumePiece } from '../src/lib/unified-types';
import { resolvePieceSprite } from '../src/lib/sprite-resolve';

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

const ps = useProjectStore.getState();
const ch0 = ps.addUnifiedCharacter('装配探针角色');
const charId = ch0.id;
const rootId = ch0.rootNodeId;
const rootSlotKey = ch0.nodes[rootId]!.slot?.slotKey ?? rootId;

const getChar = () => useProjectStore.getState().unifiedCharacters[charId]!;
const getSet = (id: string) => getChar().costumeSets.find((cs) => cs.id === id)!;
const refAt = (piece: any, dir: number) => piece?.sprites?.[dir]?.spriteId;

// ---------- 1) 已有集会话：不新增集、落进该集、快照还原逐格一致 ----------
const setA = ps.addUnifiedCostumeSet(charId, '已有集A');
const setB = ps.addUnifiedCostumeSet(charId, '集合B');
const countAfterAdds = getChar().costumeSets.length;
// 先给集 A 一个基线格子（旧有数据），再拍会话快照（向导 startSession 的形态）
ps.setUnifiedCostumeSprite(charId, setA.id, rootId, 6, 'spr_base');
const snapshotPieces = structuredClone(getSet(setA.id).pieces);
// 本会话写入（向导/遮罩经分层动作写目标集，这里基础层）
ps.setUnifiedCostumeSpriteLayered(charId, setA.id, rootId, 6, 'spr_new1');
ok('1.1 选已有集会话不新增服装集', getChar().costumeSets.length === countAfterAdds);
ok('1.2 写入落进目标集 A 的基础层', refAt(getSet(setA.id).pieces[rootSlotKey], 6) === 'spr_new1');
ok('1.3 其它集 B 未被触碰', getSet(setB.id).pieces[rootSlotKey] === undefined);
// 放弃：pieces 整表还原为会话快照（向导 endAssemblySession 的形态）
ps.updateUnifiedCostumeSet(charId, setA.id, { pieces: structuredClone(snapshotPieces) });
ok(
  '1.4 放弃后 pieces 与会话快照逐格一致',
  JSON.stringify(getSet(setA.id).pieces) === JSON.stringify(snapshotPieces),
);

// ---------- 2) 变体层：落 variantSprites + 顺带指派口径 ----------
ps.updateUnifiedCharacter(charId, {
  variantDefs: [
    { id: 'var_a', name: '变体甲' },
    { id: 'var_b', name: '变体乙' },
  ] as any,
});
const r1 = ps.setUnifiedCostumeSpriteLayered(charId, setA.id, rootId, 2, 'spr_var', {
  variantId: 'var_a',
});
const pieceAfterVar = getSet(setA.id).pieces[rootSlotKey]!;
ok('2.1 变体写落 variantSprites[var_a][2]', pieceAfterVar.variantSprites?.['var_a']?.[2]?.spriteId === 'spr_var');
ok('2.2 变体写不动基础层同格', refAt(pieceAfterVar, 2) === undefined);
ok('2.3 无指派槽位被顺带指派且返回标记', r1.autoAssignedVariant === true && getChar().slotVariants?.[rootSlotKey] === 'var_a');
const r2 = ps.setUnifiedCostumeSpriteLayered(charId, setA.id, rootId, 4, 'spr_var_b', {
  variantId: 'var_b',
});
ok('2.4 第二变体照常落层', getSet(setA.id).pieces[rootSlotKey]!.variantSprites?.['var_b']?.[4]?.spriteId === 'spr_var_b');
ok('2.5 已有指派不被覆盖且无顺带标记', r2.autoAssignedVariant === false && getChar().slotVariants?.[rootSlotKey] === 'var_a');
// 消费路径读回：变体指派 var_a + 方向 2 → 变体层精灵
const stubTable = Object.fromEntries(
  ['spr_var', 'spr_var_b', 'spr_lat', 'spr_lat2', 'spr_base', 'spr_b'].map((id) => [id, { id }]),
) as any;
ok(
  '2.6 resolvePieceSprite 按指派变体读回变体层',
  resolvePieceSprite(getSet(setA.id).pieces[rootSlotKey], 2, 'var_a', stubTable, 0).spriteId === 'spr_var',
);

// ---------- 3) 纬度层：键约定 + 层序（纬度在变体之外）+ 消费读回 ----------
const r3 = ps.setUnifiedCostumeSpriteLayered(charId, setA.id, rootId, 6, 'spr_lat', {
  latitude: 45,
});
const pieceAfterLat = getSet(setA.id).pieces[rootSlotKey]!;
ok('3.1 纬度写落 latitudeSprites 且键为纬度数', pieceAfterLat.latitudeSprites?.[45]?.[6]?.spriteId === 'spr_lat');
ok('3.2 纬度写不动基础层（基线格仍在）', refAt(pieceAfterLat, 6) === 'spr_base');
ok('3.3 纬度写不触发顺带指派', r3.autoAssignedVariant === false);
// 组合（纬度 + 变体）：按解析层序只落纬度层，变体层不落
const slotVariantsBefore = JSON.stringify(getChar().slotVariants ?? {});
ps.setUnifiedCostumeSpriteLayered(charId, setA.id, rootId, 0, 'spr_lat2', {
  latitude: 45,
  variantId: 'var_b',
});
const pieceAfterCombo = getSet(setA.id).pieces[rootSlotKey]!;
ok('3.4 组合写落纬度层', pieceAfterCombo.latitudeSprites?.[45]?.[0]?.spriteId === 'spr_lat2');
ok('3.5 组合写不落变体层同格', pieceAfterCombo.variantSprites?.['var_b']?.[0] === undefined);
ok('3.6 组合写不动槽位指派', JSON.stringify(getChar().slotVariants ?? {}) === slotVariantsBefore);
// 消费路径读回：角色纬度 45 → 纬度层整套优先于变体/基础
ok(
  '3.7 resolvePieceSprite 在纬度 45 读回纬度层',
  resolvePieceSprite(pieceAfterCombo, 6, 'var_a', stubTable, 45).spriteId === 'spr_lat',
);
ok(
  '3.8 resolvePieceSprite 在纬度 0 不读纬度层（回基础层）',
  resolvePieceSprite(pieceAfterCombo, 6, undefined, stubTable, 0).spriteId === 'spr_base',
);

// ---------- 4) 缺省口径：旧动作与空层参数都落基础层 ----------
ps.setUnifiedCostumeSprite(charId, setB.id, rootId, 6, 'spr_b');
ok('4.1 既有 setUnifiedCostumeSprite 落基础层不变', refAt(getSet(setB.id).pieces[rootId], 6) === 'spr_b');
ps.setUnifiedCostumeSpriteLayered(charId, setB.id, rootId, 2, 'spr_b2', {});
ok('4.2 分层动作空 layer 等同基础层', refAt(getSet(setB.id).pieces[rootSlotKey], 2) === 'spr_b2');
ps.setUnifiedCostumeSpriteLayered(charId, setB.id, rootId, 2, null, {});
ok('4.3 分层动作 spriteId=null 清格', refAt(getSet(setB.id).pieces[rootSlotKey], 2) === undefined);

// ---------- 5) 目标上下文承载（editor store）：缺省 null、可往返 ----------
const es = useEditorStore.getState();
ok('5.1 上下文缺省为 null（向导外口径）', es.refAssemblyTarget === null);
es.setRefAssemblyTarget({
  characterId: charId,
  costumeSetId: setA.id,
  isNewCostumeSet: false,
  variantId: 'var_a',
  latitude: 45,
  writes: [],
});
const ctx = useEditorStore.getState().refAssemblyTarget;
ok(
  '5.2 上下文字段可读回（集/新建标记/变体/纬度）',
  !!ctx && ctx.costumeSetId === setA.id && ctx.isNewCostumeSet === false && ctx.variantId === 'var_a' && ctx.latitude === 45,
);
useEditorStore.getState().setRefAssemblyTarget(null);
ok('5.3 退出清理后回到 null', useEditorStore.getState().refAssemblyTarget === null);

// ---------- 6) 源码断言：UI 与写侧接线 ----------
const wizardSrc = readFileSync(new URL('../src/components/pixel-editor/puppet/RefAssemblyWizard.tsx', import.meta.url), 'utf8');
const overlaySrc = readFileSync(new URL('../src/components/pixel-editor/MaskBrushOverlay.tsx', import.meta.url), 'utf8');
const editorStoreSrc = readFileSync(new URL('../src/lib/store/editor-store.ts', import.meta.url), 'utf8');
ok('6.1 向导含「目标服装」选择（新建/已有）', wizardSrc.includes('目标服装') && wizardSrc.includes('新建一套（装配）'));
ok('6.2 向导含「写入层」与「目标纬度」选择', wizardSrc.includes('写入层') && wizardSrc.includes('目标纬度'));
ok('6.3 向导会话开始写目标上下文、结束清理', wizardSrc.includes('setRefAssemblyTarget({') && wizardSrc.includes('setRefAssemblyTarget(null)'));
ok('6.4 向导已有集快照与还原接线', wizardSrc.includes('persistedTargetSnapshot') && wizardSrc.includes('structuredClone(wantExisting.pieces)'));
ok('6.5 向导派生写走分层动作', wizardSrc.includes('setUnifiedCostumeSpriteLayered'));
ok('6.6 遮罩完成写读上下文并走分层动作', overlaySrc.includes('refAssemblyTarget') && overlaySrc.includes('setUnifiedCostumeSpriteLayered'));
ok('6.7 editor store 声明目标上下文字段', editorStoreSrc.includes('refAssemblyTarget') && editorStoreSrc.includes('RefAssemblyTarget'));

// ---------- 7) 覆盖门查格：readPieceLayerSpriteId 与写侧同层序 ----------
const pieceNow = getSet(setA.id).pieces[rootSlotKey]!;
ok('7.1 读基础层命中格', readPieceLayerSpriteId(pieceNow, 6) === 'spr_base');
ok('7.2 读基础层空格为 null（变体层有图不算基础层占用）', readPieceLayerSpriteId(pieceNow, 2) === null);
ok('7.3 读变体层命中格', readPieceLayerSpriteId(pieceNow, 2, { variantId: 'var_a' }) === 'spr_var');
ok('7.4 读纬度层命中格', readPieceLayerSpriteId(pieceNow, 6, { latitude: 45 }) === 'spr_lat');
ok('7.5 读侧层序同写侧：纬度参数在时变体参数被忽略', readPieceLayerSpriteId(pieceNow, 6, { latitude: 45, variantId: 'var_b' }) === 'spr_lat');
ok('7.6 读未写纬度为 null', readPieceLayerSpriteId(pieceNow, 6, { latitude: -45 }) === null);
// 纯函数往返：apply 写哪格、read 就读哪格
const freshPiece = createDefaultCostumePiece('slot_x');
const written = applySpriteToPieceLayer(freshPiece, 3, 'spr_w', { variantId: 'var_a' });
ok(
  '7.7 apply/read 纯函数往返一致',
  readPieceLayerSpriteId(written, 3, { variantId: 'var_a' }) === 'spr_w' &&
    readPieceLayerSpriteId(written, 3) === null,
);

// ---------- 8) 顺带指派放弃回滚：纯函数 + store 真跑 ----------
const fact = (slotKey: string, variantId: string | null, autoAssignedVariant: boolean) => ({
  slotKey,
  variantId,
  autoAssignedVariant,
});
const sv1: Record<string, string> = { a: 'v1', b: 'v2' };
ok(
  '8.1 顺带指派且仍为原值 → 删除该指派、其它不动',
  JSON.stringify(computeSlotVariantsAfterAssemblyDiscard(sv1, [fact('a', 'v1', true)])) ===
    JSON.stringify({ b: 'v2' }),
);
ok(
  '8.2 指派已被别处改过 → 不动（原引用返回）',
  computeSlotVariantsAfterAssemblyDiscard(sv1, [fact('a', 'vX', true)]) === sv1,
);
ok(
  '8.3 非顺带设的写入记录 → 不动',
  computeSlotVariantsAfterAssemblyDiscard(sv1, [fact('a', 'v1', false)]) === sv1,
);
ok(
  '8.4 纬度层记录（无变体）→ 不动',
  computeSlotVariantsAfterAssemblyDiscard(sv1, [fact('a', null, true)]) === sv1,
);
ok(
  '8.5 删空后返回 undefined（回到从未指派的缺省形态）',
  computeSlotVariantsAfterAssemblyDiscard({ a: 'v1' }, [fact('a', 'v1', true)]) === undefined,
);
ok(
  '8.6 无指派表时原样返回 undefined',
  computeSlotVariantsAfterAssemblyDiscard(undefined, [fact('a', 'v1', true)]) === undefined,
);
// store 真跑：装配顺带指派 → 放弃回滚后指派消失；被改过的保留
const ch2 = ps.addUnifiedCharacter('回滚探针角色');
const ch2Id = ch2.id;
const ch2Root = ch2.rootNodeId;
const ch2SlotKey = ch2.nodes[ch2Root]!.slot?.slotKey ?? ch2Root;
const ch2Set = ps.addUnifiedCostumeSet(ch2Id, '回滚集');
const getChar2 = () => useProjectStore.getState().unifiedCharacters[ch2Id]!;
const rw = ps.setUnifiedCostumeSpriteLayered(ch2Id, ch2Set.id, ch2Root, 6, 'spr_x', {
  variantId: 'var_x',
});
ok('8.7 会话写入顺带指派成立', rw.autoAssignedVariant === true && getChar2().slotVariants?.[ch2SlotKey] === 'var_x');
// 放弃：按向导 endAssemblySession 的形态——算回滚结果并写回角色
const rolledBack = computeSlotVariantsAfterAssemblyDiscard(getChar2().slotVariants, [
  fact(ch2SlotKey, 'var_x', true),
]);
ps.updateUnifiedCharacter(ch2Id, { slotVariants: rolledBack });
ok('8.8 放弃后顺带指派被清除', getChar2().slotVariants?.[ch2SlotKey] === undefined);
// 再顺带指派一次，随后被别处改掉 → 回滚计算不动它
ps.setUnifiedCostumeSpriteLayered(ch2Id, ch2Set.id, ch2Root, 2, 'spr_y', { variantId: 'var_x' });
ps.updateUnifiedCharacter(ch2Id, { slotVariants: { [ch2SlotKey]: 'var_manual' } });
const keptAfterChange = computeSlotVariantsAfterAssemblyDiscard(getChar2().slotVariants, [
  fact(ch2SlotKey, 'var_x', true),
]);
ok('8.9 指派已被改过时回滚不动', keptAfterChange?.[ch2SlotKey] === 'var_manual');
// 完成（不放弃）语义：空写入集回滚计算恒为无变更——完成路径不调用回滚即保留指派
ok(
  '8.10 空写入集回滚为无变更（完成保留指派的口径）',
  computeSlotVariantsAfterAssemblyDiscard(getChar2().slotVariants, []) === getChar2().slotVariants &&
    getChar2().slotVariants?.[ch2SlotKey] === 'var_manual',
);

// ---------- 9) 槽键 / 组合键构造 ----------
ok('9.1 槽键随方向变化', refImageSlotKey(6, 0) !== refImageSlotKey(0, 0));
ok('9.2 槽键随纬度变化', refImageSlotKey(6, 0) !== refImageSlotKey(6, 45));
ok('9.3 槽键同输入同键', refImageSlotKey(6, 45) === refImageSlotKey(6, 45));
const comboBase = refAssemblyComboKey('n1', { direction: 6 as any, latitude: 0, variantId: null });
ok(
  '9.4 组合键随层变化（基础 vs 变体）',
  comboBase !== refAssemblyComboKey('n1', { direction: 6 as any, latitude: 0, variantId: 'v' }),
);
ok(
  '9.5 组合键随方向/节点变化',
  comboBase !== refAssemblyComboKey('n1', { direction: 0 as any, latitude: 0, variantId: null }) &&
    comboBase !== refAssemblyComboKey('n2', { direction: 6 as any, latitude: 0, variantId: null }),
);
ok(
  '9.6 纬度非 0 时变体部分归一（与写侧层序一致）',
  refAssemblyComboKey('n1', { direction: 6 as any, latitude: 45, variantId: 'v' }) ===
    refAssemblyComboKey('n1', { direction: 6 as any, latitude: 45, variantId: null }),
);

// ---------- 10) 源码断言：第二棒 UI 接线 ----------
ok('10.1 向导含参考图槽表与清表函数', wizardSrc.includes('persistedRefImageSlots') && wizardSrc.includes('function clearRefImageSlots'));
ok('10.2 reset 时清槽、换模板时连显示图一并清', wizardSrc.includes('clearRefImageSlots(false)') && wizardSrc.includes('clearRefImageSlots(true)'));
ok(
  '10.3 选图三入口（导入/内置/SAM 产出）都写当前槽',
  (wizardSrc.match(/setRefImageForCurrentSlot\(/g) ?? []).length === 3,
);
ok('10.4 槽位同步 effect 按当前槽键换图', wizardSrc.includes('refImageSlotKey(wizardDirIndex, targetLatitude)') && wizardSrc.includes('persistedRefImageSlotKey'));
ok('10.5 覆盖门：定义 + 派生与遮罩两处发起端调用', (wizardSrc.match(/confirmOverwriteIfOccupied/g) ?? []).length >= 3 && wizardSrc.includes('readPieceLayerSpriteId'));
ok('10.6 放弃回滚接线在结束会话内', wizardSrc.includes('computeSlotVariantsAfterAssemblyDiscard'));
ok('10.7 确认步消费会话写入记录', wizardSrc.includes('refAssemblyTarget?.writes'));
ok('10.8 进度按组合键记', wizardSrc.includes('refAssemblyComboKey'));
ok('10.9 步 1 有槽位总览', wizardSrc.includes('refSlotRows') && wizardSrc.includes('当前槽'));

console.log(`合计：${pass} 过 / ${fail} 败`);
if (fail > 0) process.exit(1);
