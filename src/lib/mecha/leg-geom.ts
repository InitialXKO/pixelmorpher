/**
 * 腿模板数据层：腿的构造图（LEG_GRAPH 步列）全住这里（与 ARM_GRAPH /
 * HEAD_GRAPH 同形）。步 = 一个部件步：id / pattern（算子名）/ anchors
 * （锚名列）/ when（入列条件，数据）/ params（步参数，字面量或规格
 * 槽）。展开器（engine 的 legIR）只按图走：求值 when、解析 params 槽、
 * 拼部件列——不存腿的装配决定；算子（LEG_OPS）只读步参数与帧，不
 * 再读规格旗作变体选择。
 *
 * 参数槽（LegParam）的解析口径（展开器实现）：
 * - 字面量：原值直用；
 * - { spec, dflt }：取规格字段、缺省 dflt；带 eq 时改为等值布尔；
 * - { flag }：规格旗的布尔值；带 on/off 时改为旗控数值；
 * - { present }：规格字段存在性布尔；
 * - { anySpec }：列内任一规格旗为真；
 * - { base, scl, mul, mulDflt }：base × 帧尺度（ws/wsS/dF）×
 *   （规格 mul 字段 ?? mulDflt）——段宽/收分这类「规格单位」量。
 */
export type LegWhen =
  | { path: string; eq?: string; neq?: string; truthy?: true; falsy?: true; present?: true }
  | { all: LegWhen[] }
  | { not: LegWhen };

export type LegParam =
  | number | string | boolean
  | { spec: string; dflt?: number | string | boolean; eq?: string | boolean }
  | { flag: string; on?: number; off?: number }
  | { present: string }
  | { anySpec: string[] }
  | { base: number; scl?: 'ws' | 'wsS' | 'dF'; mul?: string; mulDflt?: number };

export interface LegStep {
  id: string;
  pattern: string;
  /** 式选择（数据）：按规格字段查表得 pattern 名（足式五式） */
  patternFrom?: { path: string; map: Record<string, string>; dflt: string };
  anchors: string[];
  when?: LegWhen;
  params?: Record<string, LegParam>;
}

/** 腿模板（DAG 数据）：步列序 = 画序——入列与式选择全在 when /
 * patternFrom 数据里（与旧 legIR 的代码拼图逐项对应） */
export const LEG_GRAPH: LegStep[] = [
  { id: 'core', pattern: 'core', anchors: ['hip', 'knee', 'ankle'], params: {
    coreScale: { spec: 'coreScale', dflt: 1 },
    frameK: { flag: 'frameHeavy', on: 1.12, off: 1 },
    follow: { present: 'shinWRatio' },
  } },
  { id: 'backing', pattern: 'jointBacking', anchors: ['hip', 'knee', 'ankle'], params: {
    wide: { present: 'shinWRatio' },
  } },
  { id: 'frameBeam', pattern: 'frameBeam', anchors: ['hip', 'knee', 'ankle'], when: { path: 'frameHeavy', truthy: true } },
  { id: 'cables', pattern: 'cableRun', anchors: ['hip', 'knee', 'ankle'] },
  { id: 'thigh.plates', pattern: 'segPlates', anchors: ['hip', 'knee'], params: {
    seg: 'thigh',
    wA: { base: 110, scl: 'ws' },
    wB: { base: 110, scl: 'ws', mul: 'taperThigh', mulDflt: 84 / 110 },
    bulgeF: 0.16, bulgeB: 0.05, shroudTo: 1.07,
    panel: { flag: 'thighPanel' },
  } },
  { id: 'shin.plates', pattern: 'segPlates', anchors: ['knee', 'ankle'], params: {
    seg: 'shin',
    wA: { base: 100, scl: 'wsS' },
    wB: { base: 100, scl: 'wsS', mul: 'taperShin', mulDflt: 0.64 },
    bulgeF: { base: -0.38, mul: 'shinConcave', mulDflt: 1 },
    bulgeB: { base: 0.42, mul: 'calfScale', mulDflt: 1 },
    shellStripe: { flag: 'shellMode' },
    band: { flag: 'shinBand' },
    inset: { flag: 'shinInset' },
    panel: { flag: 'shinPanel' },
  } },
  { id: 'foot', pattern: '', patternFrom: { path: 'footType', map: { blocks: 'footBlocks', shoe: 'footShoe', claw: 'footClaw', pad: 'footPad', wheel: 'footWheel' }, dflt: 'footBlocks' }, anchors: ['ankle', 'toe'] },
  { id: 'guard', pattern: 'guard', anchors: ['knee', 'ankle'], when: { path: 'guardOff', falsy: true }, params: {
    heavy: { flag: 'frameHeavy' },
    panel: { flag: 'shinPanel' },
    chevrons: { spec: 'decalKind', dflt: 'num', eq: 'num' },
  } },
  { id: 'kneeCapBox', pattern: 'kneeCapBox', anchors: ['knee'] },
  { id: 'backBox', pattern: 'backBox', anchors: ['knee'], when: { path: 'mechSlim', falsy: true } },
  { id: 'detailSet', pattern: 'detailSet', anchors: ['hip', 'knee', 'ankle'], params: {
    level: { spec: 'detail', dflt: 1 },
  } },
  { id: 'backGear', pattern: 'backGear', anchors: ['hip', 'knee', 'ankle'], when: { path: 'mechSlim', falsy: true } },
  { id: 'detailTail', pattern: 'detailTail', anchors: ['hip', 'knee', 'ankle'] },
  { id: 'pistons', pattern: 'pistonPair', anchors: ['hip', 'knee', 'ankle'], when: { path: 'shinPiston', truthy: true }, params: { mode: 'piston' } },
  { id: 'pistons', pattern: 'pistonPair', anchors: ['hip', 'knee', 'ankle'], when: { all: [{ path: 'shinPiston', falsy: true }, { path: 'mechSlim', truthy: true }] }, params: { mode: 'slim' } },
  { id: 'pistons', pattern: 'pistonPair', anchors: ['hip', 'knee', 'ankle'], when: { all: [{ path: 'shinPiston', falsy: true }, { path: 'mechSlim', falsy: true }] }, params: { mode: 'full' } },
  { id: 'pistonExtra', pattern: 'pistonExtra', anchors: ['hip', 'knee', 'ankle'], when: { all: [{ path: 'shinPiston', falsy: true }, { path: 'mechSlim', falsy: true }, { path: 'guardOff', truthy: true }, { path: 'shellMode', falsy: true }] } },
  { id: 'calf', pattern: 'calfSleeve', anchors: ['knee', 'ankle'], when: { path: 'shellMode', falsy: true } },
  { id: 'joints', pattern: 'jointCluster', anchors: ['hip', 'knee', 'ankle'], params: {
    rHip: { base: 30, scl: 'dF' },
    rKnee: { base: 28, scl: 'dF' },
    rAnkle: { base: 18, scl: 'dF' },
    panel: { anySpec: ['thighPanel', 'shinPanel'] },
  } },
  { id: 'bellows', pattern: 'bellows', anchors: ['knee'] },
  { id: 'decals', pattern: 'decals', anchors: [], params: {
    decalKind: { spec: 'decalKind', dflt: 'num' },
    level: { spec: 'detail', dflt: 1 },
  } },
];
