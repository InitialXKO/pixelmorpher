// 验证蓝图 vars 接通：变量值（AnimationVariable）经 buildBlueprintVars 注入各求值入口
// A) helper：mapStoreAnimationVariables / buildBlueprintVars
// B) 变换 pass：evaluateBlueprintTransforms 的 var 节点读注入值、无注入回退 default
// C) 主渲染全链：generateRenderPlan(animationVariables) → 节点 worldX 随变量变
// D) IK 目标蓝图：computeWorldTransforms 的 variableContext 驱动 targetBlueprint 的 var
// E) 状态蓝图：var → costume_state 的 gate 随 vars 开关
import { readFileSync } from 'fs';
import { buildBlueprintVars, mapStoreAnimationVariables, buildVariableContext } from '../src/lib/unified-animation-resolver';
import { evaluateBlueprintTransforms, generateRenderPlan, computeWorldTransforms, resolveEffectiveCostumeState } from '../src/lib/unified-render';
import { getIKChainJointIds } from '../src/lib/ik-tip';
import { resolveChainTarget3D, subToPx, frameYAxisWorld } from '../src/lib/unified-types';
import { useProjectStore } from '../src/lib/store';

let fail = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✓' : '✗'} ${label}: ${detail}`);
  if (!ok) fail++;
}
const clone = (o: any) => JSON.parse(JSON.stringify(o));

// ---------- A ----------
const mapped = mapStoreAnimationVariables([{ id: 'a', name: 'speed', defaultValue: 7 } as any]);
check('A1 store 映射', mapped?.[0]?.name === 'speed' && mapped[0].value === 7 && mapped[0].defaultValue === 7, JSON.stringify(mapped?.[0]));
check('A2 vars 按名取值（defaultValue 求值）', buildBlueprintVars([{ id: 'a', name: 'speed', value: 3, defaultValue: 7 } as any], 0).speed === 7, '');
check('A3 无变量 → 空对象', JSON.stringify(buildBlueprintVars(undefined, 0)) === '{}' && JSON.stringify(buildBlueprintVars([], 0)) === '{}', '');

// ---------- B ----------
const varGraph = (extra: any = {}): any => ({
  version: 1,
  nodes: [
    { id: 'v', type: 'var', inputs: {}, params: { name: 'push', default: 5 } },
    { id: 't', type: 'transform', inputs: { translateX: { nodeId: 'v', output: 'out' } }, params: {} },
  ],
  outputId: 't',
  ...extra,
});
const mkNode = (id: string, blueprint?: any): any => ({
  id, name: id, parentId: null, children: [],
  transform: { x: 0, y: 0, z: 0, angle: 0, stretch: 1, variantIndex: 6 },
  tracks: {}, modifiers: [], sockets: [],
  attachment: { type: 'root' },
  drawLayer: 'default', visible: true,
  ...(blueprint ? { blueprint } : {}),
});
const mkChar = (nodeBlueprint?: any, extra: any = {}): any => ({
  id: 'char1', name: 'T', rootNodeId: 'n1',
  nodes: { n1: mkNode('n1', nodeBlueprint) },
  costumeSets: [], directionDrawOrders: {}, latitude: 0, sprites: {},
  createdAt: 0, updatedAt: 0,
  ...extra,
});
const tX = (ch: any, vars?: any) => evaluateBlueprintTransforms(ch, 0, 12, vars).get('n1')?.translateX;
check('B1 注入 vars → var 节点输出注入值', tX(mkChar(varGraph()), { push: 42 }) === 42, `=${tX(mkChar(varGraph()), { push: 42 })}`);
check('B2 空 vars → 回退节点 default', tX(mkChar(varGraph()), {}) === 5 && tX(mkChar(varGraph())) === 5, '');

// ---------- C ----------
const sp = (id: string): any => ({ id, width: 2, height: 2, data: [[id]] });
const spriteTable: Record<string, any> = { sprA: sp('sprA') };
const charC = mkChar(varGraph(), {
  costumeSets: [{
    id: 'csA', name: 'A',
    pieces: { arm: { slotKey: 'arm', fillColor: '#888', sprites: { 6: { spriteId: 'sprA' } }, scaleVariants: {}, mirrorMap: {}, crossSections: [] } },
  }],
  activeCostumeSetId: 'csA',
});
charC.nodes.n1.slot = { slotKey: 'arm' };
const worldX = (ch: any, animVars?: any) => {
  const plan = generateRenderPlan(ch, 0, 256, 256, 'pixel-perfect', 12, animVars,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, spriteTable);
  return plan.nodeInstructions.find((i: any) => i.nodeId === 'n1')?.worldX ?? null;
};
const pushVar = [{ id: 'pv', name: 'push', value: 42, defaultValue: 42, min: 0, max: 100 }];
const pushVar5 = [{ id: 'pv', name: 'push', value: 5, defaultValue: 5, min: 0, max: 100 }];
// 指令 worldX 含画布中心与绘制偏移，按差值断言：var 42 vs default 5 → Δ=37px=592sub
check('C1 传变量 worldX 比 default 大 37px', (worldX(clone(charC), pushVar) ?? 0) - (worldX(clone(charC)) ?? 0) === 592,
  `Δ=${(worldX(clone(charC), pushVar) ?? 0) - (worldX(clone(charC)) ?? 0)}`);
check('C2 变量值 = default 时与不传变量一致', worldX(clone(charC), pushVar5) === worldX(clone(charC)), '');
check('C3 plan 携带 blueprintVars', (() => {
  const plan = generateRenderPlan(clone(charC), 0, 256, 256, 'pixel-perfect', 12, pushVar,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, spriteTable);
  return (plan as any).blueprintVars?.push === 42;
})(), '');

// ---------- D ----------
const raw = JSON.parse(readFileSync('/home/hatch/workspace/user/files/1_0_hzs0.pxm', 'utf-8'));
const proj = raw.project;
const W = proj.canvasWidth ?? 256;
const H = proj.canvasHeight ?? 256;
useProjectStore.setState({ canvasWidth: W, canvasHeight: H, currentFrame: 0 });
const charD: any = clone((Object.values(proj.unifiedCharacters) as any[])[0]);
charD.ikChains = charD.ikChains.map((c: any, i: number) => ({ ...c, enabled: i === 0 }));
const chain = charD.ikChains[0];
const jointIds = getIKChainJointIds(charD, chain.rootNodeId, chain.endNodeId);
const fk0 = computeWorldTransforms(charD, 0, W, H, 12);
const staticT = resolveChainTarget3D(chain, W, H, fk0.get(jointIds[0])!.variantIndex);
const jointPosWith = (varsRecord: Record<string, number> | null, withBlueprint: boolean) => {
  const ch = clone(charD);
  const c0 = ch.ikChains[0];
  if (withBlueprint) {
    c0.targetBlueprint = {
      version: 1,
      nodes: [
        { id: 'v', type: 'var', inputs: {}, params: { name: 'reach', default: 20 } },
        { id: 't', type: 'transform', inputs: { translateZ: { nodeId: 'v', output: 'out' } }, params: { translateX: staticT.x, translateY: staticT.y } },
      ],
      outputId: 't',
    };
  } else {
    delete c0.targetBlueprint;
  }
  const vc = varsRecord === null
    ? undefined
    : buildVariableContext([{ id: 'vr', name: 'reach', value: varsRecord.reach, defaultValue: varsRecord.reach, min: 0, max: 100 } as any], 0);
  const transforms = computeWorldTransforms(ch, 0, W, H, 12, vc);
  const end = transforms.get(jointIds[jointIds.length - 1])!;
  return { x: subToPx(end.worldX), y: subToPx(end.worldY), z: subToPx(end.worldZ) };
};
const pStatic = jointPosWith(null, false);
const pVarStatic = jointPosWith({ reach: staticT.z }, true);
check('D1 var 蓝图（reach=静态 z）与无蓝图静态目标同解', Math.hypot(pVarStatic.x - pStatic.x, pVarStatic.y - pStatic.y, pVarStatic.z - pStatic.z) < 0.5,
  `Δ=${Math.hypot(pVarStatic.x - pStatic.x, pVarStatic.y - pStatic.y, pVarStatic.z - pStatic.z).toFixed(3)}px`);
const pZero = jointPosWith({ reach: 0 }, true);
check('D2 reach=0 → 关节位置显著不同', Math.hypot(pZero.x - pVarStatic.x, pZero.y - pVarStatic.y, pZero.z - pVarStatic.z) > 5,
  `Δ=${Math.hypot(pZero.x - pVarStatic.x, pZero.y - pVarStatic.y, pZero.z - pVarStatic.z).toFixed(1)}px`);
const pDefault = jointPosWith(null, true);
const pTwenty = jointPosWith({ reach: 20 }, true);
check('D3 无 variableContext → var 回退 default 20（与显式 20 同解）', Math.hypot(pDefault.x - pTwenty.x, pDefault.y - pTwenty.y, pDefault.z - pTwenty.z) < 0.5,
  `Δ=${Math.hypot(pDefault.x - pTwenty.x, pDefault.y - pTwenty.y, pDefault.z - pTwenty.z).toFixed(3)}px`);

// ---------- E ----------
const stateGraph: any = {
  version: 1,
  nodes: [
    { id: 'v', type: 'var', inputs: {}, params: { name: 'dmg', default: 0 } },
    { id: 'cs', type: 'costume_state', inputs: { gate: { nodeId: 'v', output: 'out' } }, params: { setId: 'csB' } },
  ],
  outputId: 'cs',
};
const charE: any = {
  activeCostumeSetId: 'csA', slotVariants: {}, costumeSets: [], nodes: {},
  stateBlueprint: stateGraph,
};
check('E1 dmg=1 → gate 开 → 蓝图换集 csB', resolveEffectiveCostumeState(charE, 0, 12, undefined, { dmg: 1 }).costumeSetId === 'csB', '');
check('E2 dmg=0 → gate 关 → 保持静态 csA', resolveEffectiveCostumeState(charE, 0, 12, undefined, { dmg: 0 }).costumeSetId === 'csA', '');
check('E3 无 vars → var default 0 → csA', resolveEffectiveCostumeState(charE, 0, 12).costumeSetId === 'csA', '');

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
