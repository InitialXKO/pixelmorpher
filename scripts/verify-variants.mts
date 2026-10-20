// 验证通用自定义变体 P1：数据模型 + 分层解析
// A) resolvePieceSprite 分层链：变体直达 → 变体镜像 → 基础直达 → 基础镜像 → 空
// B) 生产路径 resolveNodeSpriteId：slotVariants 指派生效/不指派回基础/指派别的槽位不影响
// C) 无变体数据（旧项目形状）时行为与改前一致
import { resolvePieceSprite, resolvePreviewSprite } from '../src/lib/sprite-resolve';
import { resolveNodeSpriteId } from '../src/lib/unified-render';

let fail = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✓' : '✗'} ${label}: ${detail}`);
  if (!ok) fail++;
}

const sp = (id: string): any => ({ id, width: 2, height: 2, data: [[id]] });
const table: Record<string, any> = {};
for (const id of ['B0', 'B6', 'V0', 'V6']) table[id] = sp(id);
const ref = (id: string): any => ({ spriteId: id });

// piece：基础 东=B0 南=B6；镜像 西(4)←东(0)；变体 v1 只画南=V6；v2 只画东=V0
const piece: any = {
  slotKey: 'arm',
  fillColor: '#888',
  sprites: { 0: ref('B0'), 6: ref('B6') },
  variantSprites: {
    v1: { 6: ref('V6') },
    v2: { 0: ref('V0') },
  },
  scaleVariants: {},
  mirrorMap: { 4: 0 },
  crossSections: [],
};
const R = (dir: number, v?: string) => resolvePieceSprite(piece, dir as any, v, table);

// ---------- A ----------
check('A1 无变体 南 → 基础直达', R(6).spriteId === 'B6' && !R(6).mirror, `=${R(6).spriteId}`);
check('A2 无变体 西 → 基础镜像', R(4).spriteId === 'B0' && R(4).mirror === true, `=${R(4).spriteId} mirror=${R(4).mirror}`);
check('A3 v1 南 → 变体直达', R(6, 'v1').spriteId === 'V6' && !R(6, 'v1').mirror, `=${R(6, 'v1').spriteId}`);
check('A4 v1 东 → 变体未画回落基础直达', R(0, 'v1').spriteId === 'B0', `=${R(0, 'v1').spriteId}`);
check('A5 v1 西 → 变体镜像未命中再回落基础镜像', R(4, 'v1').spriteId === 'B0' && R(4, 'v1').mirror === true, `=${R(4, 'v1').spriteId} mirror=${R(4, 'v1').mirror}`);
check('A6 v2 西 → 变体镜像优先于基础', R(4, 'v2').spriteId === 'V0' && R(4, 'v2').mirror === true, `=${R(4, 'v2').spriteId} mirror=${R(4, 'v2').mirror}`);
check('A7 v2 南 → 变体未画回落基础', R(6, 'v2').spriteId === 'B6', `=${R(6, 'v2').spriteId}`);
check('A8 未知变体 id → 全回落基础', R(6, 'nope').spriteId === 'B6', `=${R(6, 'nope').spriteId}`);
check('A9 无 piece → 空', resolvePieceSprite(undefined, 6 as any, 'v1', table).sprite === null, '');

// ---------- B ----------
const cs: any = { id: 'cs1', name: '套装', pieces: { arm: piece } };
const mkChar = (slotVariants?: Record<string, string>): any => ({
  rootNodeId: 'n1',
  nodes: { n1: { id: 'n1', slot: { slotKey: 'arm' } } },
  costumeSets: [cs],
  activeCostumeSetId: 'cs1',
  ...(slotVariants ? { slotVariants } : {}),
});
check('B1 指派 arm=v1 → 南出变体图', resolveNodeSpriteId(mkChar({ arm: 'v1' }), 'n1', 6 as any, table) === 'V6', '');
check('B2 无指派 → 基础图', resolveNodeSpriteId(mkChar(), 'n1', 6 as any, table) === 'B6', '');
check('B3 指派别的槽位 → 不影响 arm', resolveNodeSpriteId(mkChar({ leg: 'v1' }), 'n1', 6 as any, table) === 'B6', '');
check('B4 预览口径一致（resolvePreviewSprite 同结果）',
  resolvePreviewSprite('arm', 6, cs, table, 'v1').spriteId === 'V6' && resolvePreviewSprite('arm', 6, cs, table).spriteId === 'B6', '');

// ---------- C ----------
const legacyPiece: any = { slotKey: 'arm', fillColor: '#888', sprites: { 6: ref('B6') }, scaleVariants: {}, mirrorMap: {}, crossSections: [] };
check('C1 旧形状 piece（无 variantSprites）解析不变', resolvePieceSprite(legacyPiece, 6 as any, undefined, table).spriteId === 'B6', '');
check('C2 旧形状 + 悬空 variantId 也不炸', resolvePieceSprite(legacyPiece, 6 as any, 'v1', table).spriteId === 'B6', '');

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
