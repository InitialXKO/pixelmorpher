// 蓝图方言划界：主系统蓝图节点类型 → 程序化运行时的相容性分类。
// - direct：结构同构，语义可直译（数值/时间/曲线/输出）
// - sample：程序运动与变换类——语义在主系统求值器里，导出时采样烘焙成曲线
// - unsupported：像素/渲染/状态/求解类——运行时 v1 不带（像素变形类待翻译层，
//   bump 的运行时对应物是层语言的 bump 形式层，不是主系统的 bump_light 像素后处理）
// 此表同时供蓝图编辑器的方言徽标与导出翻译器的报告使用。
export type DialectClass = 'direct' | 'sample' | 'unsupported';

export const BLUEPRINT_DIALECT: Record<string, DialectClass> = {
  // 数值与时间（直译）
  time: 'direct', const: 'direct', var: 'direct',
  add: 'direct', sub: 'direct', mul: 'direct', div: 'direct',
  sin: 'direct', cos: 'direct', keyframes: 'direct',
  switch: 'direct', step: 'direct', transform: 'direct',
  // 程序运动 / 缓动 / 变换链（采样烘焙）
  waveform: 'sample', ease: 'sample', timeRemap: 'sample',
  pendulum: 'sample', float: 'sample', breath: 'sample', shake: 'sample',
  wobble: 'sample', bounce: 'sample', elastic: 'sample', spring: 'sample',
  hold: 'sample', noise: 'sample', wave: 'sample', jitter: 'sample',
  gait: 'sample', wheel: 'sample', blend: 'sample', expression: 'sample',
  translate: 'sample', rotate: 'sample', uniform_scale: 'sample',
  skew: 'sample', non_uniform_stretch: 'sample',
  // 像素 / 状态 / 求解（不支持）
  sprite_source: 'unsupported', costume: 'unsupported',
  costume_state: 'unsupported', character_source: 'unsupported',
  texture_scroll: 'unsupported', wave_deform: 'unsupported',
  contour_scroll: 'unsupported', reveal_hide: 'unsupported',
  shatter_dissolve: 'unsupported', annihilate: 'unsupported',
  teleport: 'unsupported', crt_off: 'unsupported', bend: 'unsupported',
  elliptical_compress: 'unsupported', dumbbell_stretch: 'unsupported',
  pillow_stretch: 'unsupported', hyperbolic_stretch: 'unsupported',
  ring_ripple: 'unsupported', local_inflate: 'unsupported',
  path_follow: 'unsupported', path_move: 'unsupported',
  bump_light: 'unsupported', pixel_edit: 'unsupported',
  ik_2bone: 'unsupported', ik_fabrik: 'unsupported', nodeRef: 'unsupported',
};

/** 行为语境下可实时求值的节点集（运行时求值器 eval-src 的实现清单）。
 *  与表演语境的差别：行为是无限过程、不能采样——程序化运动节点必须实时
 *  求值（direct）；nodeRef 靠上一遍输出可达；gait（步态求解器）与
 *  expression（表达式引擎）未移植，仍不支持。 */
export const BEHAVIOR_LIVE_NODES = new Set([
  'time', 'timeGate', 'const', 'var',
  'add', 'sub', 'mul', 'div', 'blend', 'sin', 'cos', 'keyframes',
  'waveform', 'ease', 'timeRemap', 'switch', 'step', 'hold', 'nodeRef',
  'pendulum', 'breath', 'shake', 'float', 'wobble', 'bounce', 'elastic',
  'wheel', 'noise', 'wave', 'spring', 'jitter',
  'translate', 'rotate', 'uniform_scale', 'skew', 'non_uniform_stretch',
  'transform',
]);

export type DialectContext = 'performance' | 'behavior';

export function dialectOf(nodeType: string, context: DialectContext = 'performance'): DialectClass {
  if (context === 'behavior') {
    return BEHAVIOR_LIVE_NODES.has(nodeType) ? 'direct' : 'unsupported';
  }
  return BLUEPRINT_DIALECT[nodeType] ?? 'unsupported';
}

export const DIALECT_LABEL: Record<DialectClass, string> = {
  direct: '运行时可求值',
  sample: '导出时采样烘焙',
  unsupported: '运行时不支持',
};
