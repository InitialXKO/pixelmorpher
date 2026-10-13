// ============================================================
// Blueprint Node Specs — 蓝图节点类型注册表
// 统一定义每个节点类型的输入端口、输出端口、参数
// UI、转换器、模板都从这里取定义，保证一致
// ============================================================

export interface BlueprintNodeSpec {
  /** 输入端口名列表 */
  inputs: string[];
  /** 输出端口名列表 */
  outputs: string[];
  /** 参数名列表（用于 UI 显示，实际默认值在 eval 里） */
  params: string[];
}

export const BLUEPRINT_NODE_SPECS: Record<string, BlueprintNodeSpec> = {
  // ---- 源 ----
  time: { inputs: [], outputs: ['out'], params: [] },
  const: { inputs: [], outputs: ['out'], params: ['value'] },
  var: { inputs: [], outputs: ['out'], params: ['name', 'default'] },
  // 精灵源：输出原始像素图（管线起点）
  sprite_source: { inputs: [], outputs: ['pixels'], params: ['spriteId'] },

  // ---- 数学 ----
  add: { inputs: ['a', 'b'], outputs: ['out'], params: [] },
  sub: { inputs: ['a', 'b'], outputs: ['out'], params: [] },
  mul: { inputs: ['a', 'b'], outputs: ['out'], params: [] },
  div: { inputs: ['a', 'b'], outputs: ['out'], params: [] },
  sin: { inputs: ['x'], outputs: ['out'], params: [] },
  cos: { inputs: ['x'], outputs: ['out'], params: [] },

  // ---- 程序化动画 ----
  // pendulum: 输出 outRotation（主）+ out（兼容）
  pendulum: {
    inputs: ['t', 'pixels'],
    outputs: ['out', 'outRotation', 'pixels'],
    params: ['amplitude', 'period', 'phase'],
  },
  // float: 输出 outY + outRotation
  float: {
    inputs: ['t', 'pixels'],
    outputs: ['outY', 'outRotation', 'pixels'],
    params: ['height', 'period', 'tilt'],
  },
  // breath: 输出 out（scale 系数）
  breath: {
    inputs: ['t', 'pixels'],
    outputs: ['out', 'pixels'],
    params: ['amplitude', 'period'],
  },
  // shake: 输出 outX + outY
  shake: {
    inputs: ['t'],
    outputs: ['outX', 'outY'],
    params: ['amplitude'],
  },
  // wobble: 输出 outRotation + outX + outY
  wobble: {
    inputs: ['t', 'pixels'],
    outputs: ['outRotation', 'outX', 'outY', 'pixels'],
    params: ['angleAmplitude', 'moveAmplitude', 'damping', 'period'],
  },
  // bounce: 输出 outY
  bounce: {
    inputs: ['t', 'pixels'],
    outputs: ['outY', 'pixels'],
    params: ['height', 'period', 'bounces', 'damping'],
  },
  // elastic: 输出取决于 axis 参数
  elastic: {
    inputs: ['t'],
    outputs: ['outX', 'outY', 'outRotation', 'outScaleX', 'outScaleY'],
    params: ['period', 'axis', 'offset', 'overshoot', 'damping'],
  },
  // wheel: 输出 outX + outY + outRotation
  wheel: {
    inputs: ['t'],
    outputs: ['outX', 'outY', 'outRotation'],
    params: ['period', 'radiusX', 'radiusY', 'phase', 'direction'],
  },

  // ---- 输出 ----
  transform: {
    inputs: ['translateX', 'translateY', 'rotation', 'scaleX', 'scaleY', 'zIndex'],
    outputs: ['outX', 'outY', 'outRotation', 'outScaleX', 'outScaleY', 'outZIndex'],
    params: [],
  },

  // ---- 缓动 ----
  ease: {
    inputs: ['x', 'x1', 'y1', 'x2', 'y2'],
    outputs: ['out'],
    params: ['x1', 'y1', 'x2', 'y2'],
  },
  // ---- 时间 ----
  timeRemap: {
    inputs: ['t', 'speed', 'offset'],
    outputs: ['out'],
    params: ['speed', 'offset', 'loop', 'period', 'pingpong'],
  },
  // ---- 跨节点 ----
  nodeRef: {
    inputs: [],
    outputs: ['out'],
    params: ['nodeId', 'output'],
  },
  // ---- 条件与状态 ----
  switch: {
    inputs: ['condition', 'a', 'b'],
    outputs: ['out'],
    params: [],
  },
  step: {
    inputs: ['x', 'edge'],
    outputs: ['out'],
    params: ['edge'],
  },
  hold: {
    inputs: ['input', 'trigger'],
    outputs: ['out'],
    params: [],
  },
  // ---- 程序化动画（续） ----
  noise: {
    inputs: ['t', 'amplitude'],
    outputs: ['outX', 'outY', 'outRotation', 'outScale'],
    params: ['amplitude', 'targetProperty'],
  },
  wave: {
    inputs: ['t', 'amplitude', 'frequency'],
    outputs: ['outX', 'outY', 'outRotation'],
    params: ['amplitude', 'frequency', 'phase', 'waveType', 'targetProperty'],
  },
  spring: {
    inputs: ['t', 'stiffness', 'damping', 'mass', 'restLength', 'amplitude'],
    outputs: ['outX', 'outY', 'outRotation'],
    params: ['stiffness', 'damping', 'mass', 'restLength', 'amplitude', 'targetProperty'],
  },
  jitter: {
    inputs: ['t', 'amplitudeX', 'amplitudeY'],
    outputs: ['outX', 'outY'],
    params: ['amplitudeX', 'amplitudeY', 'seed'],
  },
  gait: {
    inputs: ['t', 'period'],
    outputs: ['outX', 'outY', 'outRotation', 'outScaleX', 'outScaleY'],
    params: ['period', 'strideLength', 'liftHeight', 'stanceRatio', 'direction', 'gaitStyle', 'aerialRatio', 'teardropAsymmetry', 'liftoffAngle', 'peakAngle', 'contactAngle', 'angleEasing', 'landBend', 'landBendDuration', 'liftoffBend', 'liftoffBendDuration'],
  },
  expression: {
    inputs: ['t'],
    outputs: ['outX', 'outY', 'outRotation', 'outScaleX', 'outScaleY'],
    params: ['amplitude', 'period', 'phase', 'expressionX', 'expressionY', 'expressionRotation', 'expressionScale'],
  },

  // ---- 像素修改器（汇点：只接受数值输入，不输出） ----
  // 这些节点直接作用于像素，params 可由其他节点驱动
  texture_scroll: {
    inputs: ['pixels', 't', 'scrollSpeed'],
    outputs: ['pixels'],
    params: ['scrollDirection', 'scrollSpeed', 'scrollMode'],
  },
  wave_deform: {
    inputs: ['pixels', 't', 'amplitude', 'frequency'],
    outputs: ['pixels'],
    params: ['amplitude', 'frequency', 'phase', 'waveType'],
  },
  contour_scroll: {
    inputs: ['pixels', 't', 'scrollSpeed'],
    outputs: ['pixels'],
    params: ['scrollSpeed', 'scrollDirection'],
  },
  reveal_hide: {
    inputs: ['pixels', 't', 'progress'],
    outputs: ['pixels'],
    params: ['revealDirection', 'progress'],
  },
  shatter_dissolve: {
    inputs: ['pixels', 't', 'progress'],
    outputs: ['pixels'],
    params: ['shatterSize', 'progress'],
  },
  annihilate: {
    inputs: ['pixels', 't', 'progress'],
    outputs: ['pixels'],
    params: ['progress', 'direction'],
  },
  teleport: {
    inputs: ['pixels', 't', 'progress'],
    outputs: ['pixels'],
    params: ['progress'],
  },
  crt_off: {
    inputs: ['pixels', 't', 'progress'],
    outputs: ['pixels'],
    params: ['progress'],
  },
  bend: {
    inputs: ['pixels', 't', 'bendAmount'],
    outputs: ['pixels'],
    params: ['bendAmount', 'bendDirection'],
  },
  elliptical_compress: {
    inputs: ['pixels', 't', 'compressAmount'],
    outputs: ['pixels'],
    params: ['compressAmount'],
  },
  dumbbell_stretch: {
    inputs: ['pixels', 't', 'stretchAmount'],
    outputs: ['pixels'],
    params: ['stretchAmount'],
  },
  pillow_stretch: {
    inputs: ['pixels', 't', 'stretchAmount'],
    outputs: ['pixels'],
    params: ['stretchAmount'],
  },
  hyperbolic_stretch: {
    inputs: ['pixels', 't', 'stretchAmount'],
    outputs: ['pixels'],
    params: ['stretchAmount'],
  },
  ring_ripple: {
    inputs: ['pixels', 't', 'amplitude', 'progress'],
    outputs: ['pixels'],
    params: ['amplitude', 'frequency', 'progress'],
  },
  pixel_edit: {
    inputs: ['pixels'],
    outputs: ['pixels'],
    params: ['brushCommands', 'opacity'],
  },
  // 上屏终点：接收像素图和变换，渲染到画布（管线终点）
  screen: {
    inputs: ['pixels', 'translateX', 'translateY', 'rotation', 'scaleX', 'scaleY'],
    outputs: [],
    params: [],
  },
};

/**
 * 获取节点类型的输出端口列表
 */
export function getNodeOutputs(type: string): string[] {
  return BLUEPRINT_NODE_SPECS[type]?.outputs ?? ['out'];
}

/**
 * 获取节点类型的输入端口列表
 */
export function getNodeInputs(type: string): string[] {
  return BLUEPRINT_NODE_SPECS[type]?.inputs ?? [];
}

/**
 * 根据目标端口选择源节点的默认输出
 * 例如：目标是 rotation → 优先选 outRotation
 */
export function getDefaultOutputForPort(
  sourceType: string,
  targetPort: string
): string {
  const outputs = getNodeOutputs(sourceType);
  const portLower = targetPort.toLowerCase();

  // 精确匹配优先
  // rotation -> outRotation, translateX -> outX, 等
  const candidates: string[] = [];
  if (portLower.includes('rotation')) candidates.push('outRotation');
  if (portLower.includes('translatex') || portLower === 'x') candidates.push('outX');
  if (portLower.includes('translatey') || portLower === 'y') candidates.push('outY');
  if (portLower.includes('scalex')) candidates.push('outScaleX', 'outScale', 'out');
  if (portLower.includes('scaley')) candidates.push('outScaleY', 'outScale', 'out');
  // 通用回退
  candidates.push('out', ...outputs);

  for (const c of candidates) {
    if (outputs.includes(c)) return c;
  }
  return outputs[0] ?? 'out';
}
