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
  // timeGate: 时间范围门控，输出 0~1 权重
  // params: start, end, fadeIn, fadeOut（帧数）
  timeGate: { inputs: ['t'], outputs: ['out'], params: ['start', 'end', 'fadeIn', 'fadeOut'] },
  const: { inputs: [], outputs: ['out'], params: ['value'] },
  var: { inputs: [], outputs: ['out'], params: ['name', 'default'] },
  // 精灵源：输出原始像素图（管线起点）
  sprite_source: { inputs: [], outputs: ['pixels'], params: ['spriteId'] },
  // 服装源：从角色服装集取指定槽位精灵（与 sprite_source 二选一）
  // setId 可接线（string），slot 为空时用节点所在槽位
  costume: { inputs: ['t', 'setId'], outputs: ['pixels'], params: ['setId', 'slot'] },
  // 角色源：输出整角色合成后的像素（管线预渲染，由 ctx.characterPixels 提供）
  // 角色蓝图专用：character_source → 后处理链 → screen
  character_source: { inputs: [], outputs: ['pixels'], params: [] },

  // ---- 数学 ----
  add: { inputs: ['a', 'b'], outputs: ['out'], params: [] },
  sub: { inputs: ['a', 'b'], outputs: ['out'], params: [] },
  mul: { inputs: ['a', 'b'], outputs: ['out'], params: [] },
  div: { inputs: ['a', 'b'], outputs: ['out'], params: [] },
  // blend: 按 mode 混合（add/multiply/converge）
  blend: { inputs: ['a', 'b', 't'], outputs: ['out'], params: ['mode', 'convergeSpeed'] },
  sin: { inputs: ['x'], outputs: ['out'], params: [] },
  // waveform: 参数驱动波形发生器
  waveform: { inputs: ['t'], outputs: ['out'], params: ['waveform', 'amplitude', 'baseValue', 'endValue', 'period', 'phase', 'damping'] },
  // keyframes: 参数关键帧插值
  keyframes: { inputs: ['t'], outputs: ['out'], params: ['frames', 'values', 'interpolation'] },
  cos: { inputs: ['x'], outputs: ['out'], params: [] },

  // ---- 程序化动画 ----
  // 基础变换
  translate: {
    inputs: ['t', 'pixels', 'gate'],
    outputs: ['outX', 'outY', 'translateX', 'translateY', 'pixels'],
    params: ['offsetX', 'offsetY'],
  },
  rotate: {
    inputs: ['t', 'pixels', 'gate'],
    outputs: ['out', 'outRotation', 'rotation', 'pixels'],
    params: ['angle', 'pivotOffsetX', 'pivotOffsetY'],
  },
  pseudo3d_rotate: {
    inputs: ['x', 'y', 'z', 'angle', 'direction'],
    outputs: ['outX', 'outY', 'outZ'],
    params: ['angle', 'direction'],
  },
  uniform_scale: {
    inputs: ['t', 'pixels', 'gate'],
    outputs: ['out', 'outScaleX', 'outScaleY', 'scaleX', 'scaleY', 'pixels'],
    params: ['scale', 'pivotOffsetX', 'pivotOffsetY'],
  },
  skew: {
    inputs: ['t', 'pixels', 'gate'],
    outputs: ['outX', 'outY', 'skewX', 'skewY', 'pixels'],
    params: ['skewX', 'skewY'],
  },
  non_uniform_stretch: {
    inputs: ['t', 'pixels', 'gate'],
    outputs: ['outScaleX', 'outScaleY', 'scaleX', 'scaleY', 'pixels'],
    params: ['scaleX', 'scaleY'],
  },
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
    params: ['amplitude', 'period', 'tilt'],
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
    params: ['amplitude', 'moveAmplitude', 'damping', 'period'],
  },
  // bounce: 输出 outY
  bounce: {
    inputs: ['t', 'pixels'],
    outputs: ['outY', 'pixels'],
    params: ['amplitude', 'period', 'bounces', 'damping'],
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
    inputs: ['translateX', 'translateY', 'translateZ', 'rotation', 'tilt', 'scaleX', 'scaleY', 'zIndex'],
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
  // ---- IK（逆运动学） ----
  ik_2bone: {
    inputs: ['targetX', 'targetY', 'len1', 'len2', 'baseX', 'baseY', 'bendDir'],
    outputs: ['angle1', 'angle2', 'reachable'],
    params: ['targetX', 'targetY', 'len1', 'len2', 'baseX', 'baseY', 'bendDir'],
  },
  ik_fabrik: {
    inputs: ['targetX', 'targetY', 'lengths', 'baseX', 'baseY', 'iterations', 'tolerance'],
    outputs: ['angles', 'converged'],
    params: ['targetX', 'targetY', 'lengths', 'baseX', 'baseY', 'iterations', 'tolerance'],
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
  local_inflate: {
    inputs: ['pixels', 't', 'centerX', 'centerY', 'radius', 'strength'],
    outputs: ['pixels'],
    params: ['centerX', 'centerY', 'radius', 'strength', 'falloff'],
  },
  path_follow: {
    inputs: ['pixels', 't', 'path', 'startT', 'endT'],
    outputs: ['pixels'],
    params: ['path', 'pathType', 'axis', 'startT', 'endT', 'preserveLength', 'samples'],
  },
  path_move: {
    inputs: ['t', 'path', 'progress'],
    outputs: ['outX', 'outY', 'outRotation'],
    params: ['path', 'pathType', 'progress', 'mode', 'loop'],
  },
  bump_light: {
    inputs: ['pixels', 't', 'lightAngle', 'intensity', 'path', 'heightmap'],
    outputs: ['pixels'],
    params: ['shape', 'height', 'bevelSize', 'lightAngle', 'lightElevation', 'intensity', 'ambient', 'specular', 'ridgeSource', 'ridgeOffset', 'ridgeWidth', 'falloff', 'path', 'invert'],
  },
  pixel_edit: {
    inputs: ['pixels', 'brushCommands'],
    outputs: ['pixels'],
    params: ['brushCommands', 'opacity'],
  },
  // 像素修改器（registry 委托）
  color_replace: { inputs: ['t', 'pixels', 'gate'], outputs: ['pixels'], params: [] },
  cylinder_rotate: { inputs: ['t', 'pixels', 'gate'], outputs: ['pixels'], params: [] },
  dither: { inputs: ['t', 'pixels', 'gate'], outputs: ['pixels'], params: [] },
  flip: { inputs: ['t', 'pixels', 'gate'], outputs: ['pixels'], params: [] },
  mirror: { inputs: ['t', 'pixels', 'gate'], outputs: ['pixels'], params: [] },
  outline: { inputs: ['t', 'pixels', 'gate'], outputs: ['pixels'], params: [] },
  pixel_displace: { inputs: ['t', 'pixels', 'gate'], outputs: ['pixels'], params: [] },
  sphere_rotate: { inputs: ['t', 'pixels', 'gate'], outputs: ['pixels'], params: [] },
  // 像素特效（直通桩）
  afterimage: { inputs: ['t', 'pixels', 'gate'], outputs: ['pixels'], params: ['count', 'opacity', 'spacing', 'angle'] },
  bloom: { inputs: ['t', 'pixels', 'gate'], outputs: ['pixels'], params: [] },
  glow: { inputs: ['t', 'pixels', 'gate'], outputs: ['pixels'], params: [] },
  motion_blur: { inputs: ['t', 'pixels', 'gate'], outputs: ['pixels'], params: ['length', 'decay', 'angle'] },
  outline_emphasis: { inputs: ['t', 'pixels', 'gate'], outputs: ['pixels'], params: [] },
  scanlines: { inputs: ['t', 'pixels', 'gate'], outputs: ['pixels'], params: [] },
  color_lut: { inputs: ['t', 'pixels', 'gate'], outputs: ['pixels'], params: [] },
  canvas_mask: { inputs: ['t', 'pixels', 'gate'], outputs: ['pixels'], params: [] },
  pixel_zoom: { inputs: ['t', 'pixels', 'gate'], outputs: ['pixels'], params: [] },
  // 复杂系统（直通桩）
  particle: { inputs: ['t', 'pixels', 'gate'], outputs: ['pixels'], params: ['rate', 'speed', 'angle', 'life', 'color', 'gravity'] },
  simple_physics: { inputs: ['t', 'pixels', 'gate'], outputs: ['pixels'], params: [] },
  // 上屏终点：接收像素图和变换，渲染到画布（管线终点）
  screen: {
    inputs: ['pixels', 'translateX', 'translateY', 'rotation', 'scaleX', 'scaleY', 'skewX', 'skewY'],
    outputs: [],
    params: [],
  },

  // ---- 笔触/轨迹发射器（全局蓝图用，帧级特效层） ----
  // stroke_emitter: 按形状动态生成笔触路径，每帧求值
  // 输出 path（{x,y}[] 可连线）+ 笔触参数；渲染层合并为动态笔触
  stroke_emitter: {
    inputs: ['t'],
    outputs: ['path', 'intensity', 'outX', 'outY'],
    params: ['type', 'shape', 'pointCount', 'radiusX', 'radiusY', 'centerX', 'centerY', 'intensity', 'color', 'direction', 'density', 'spread', 'blendMode', 'frame'],
  },
  // stroke_source: 引用已手绘笔触（strokeId 下拉选，不许手输）
  // 输出该笔触的 path + 全部参数；蓝图可覆盖参数（如 intensity）
  stroke_source: {
    inputs: [],
    outputs: ['path', 'intensity', 'color', 'radius', 'direction'],
    params: ['strokeId'],
  },
  // trajectory_emitter: 动态生成轨迹点集（如圆周、波浪）
  trajectory_emitter: {
    inputs: ['t'],
    outputs: ['path'],
    params: ['shape', 'pointCount', 'radiusX', 'radiusY', 'centerX', 'centerY', 'period', 'phase'],
  },
  // trajectory_source: 引用已烘焙轨迹（nodeId 下拉选，不许手输）
  // 输出 path（{frame,x,y}[] 转 {x,y}[]，按帧排序）
  trajectory_source: {
    inputs: [],
    outputs: ['path'],
    params: ['nodeId'],
  },
  // face_turn: Spine 式伪 3D 转头（蒙皮转面）
  // 输入 t/yaw/pitch，输出变形后像素；用单张静态图模拟转头，不用多角度差分
  face_turn: {
    inputs: ['t', 'yaw', 'pitch', 'pixels'],
    outputs: ['pixels'],
    params: ['yaw', 'pitch', 'centerX', 'centerY', 'perspective', 'depthBoost'],
  },
};

/**
 * 获取节点类型的输出端口列表
 */
export function getNodeOutputs(type: string): string[] {
  return BLUEPRINT_NODE_SPECS[type]?.outputs ?? ['out'];
}

/**
 * 推断端口的数据类型（用于颜色区分与连接校验）
 * 约定：含 'pixel' → pixels；端口名 == 'path' → path；其余 → number
 */
export function getPortDataType(portName: string): 'pixels' | 'number' | 'path' {
  const lower = portName.toLowerCase();
  if (lower.includes('pixel')) return 'pixels';
  if (lower === 'path') return 'path';
  return 'number';
}

/**
 * 端口颜色：pixels 用青色，number 用绿色，path 用紫色
 */
export function getPortColor(portName: string): string {
  const t = getPortDataType(portName);
  if (t === 'pixels') return '#22d3ee'; // cyan-400
  if (t === 'path') return '#c084fc'; // purple-400
  return '#4ade80'; // green-400
}

/**
 * 检查输出端口是否可连接到输入端口（类型必须匹配）
 */
export function canConnectPorts(fromPort: string, toPort: string): boolean {
  return getPortDataType(fromPort) === getPortDataType(toPort);
}

/**
 * 获取节点类型的输入端口列表
 */
export function getNodeInputs(type: string): string[] {
  return BLUEPRINT_NODE_SPECS[type]?.inputs ?? [];
}

/**
 * 获取节点类型的可连线参数列表（params 中可被输入覆盖的）
 */
export function getNodeParamPorts(type: string): string[] {
  return BLUEPRINT_NODE_SPECS[type]?.params ?? [];
}

/**
 * 动态注册节点规格（实验性/插件用）。
 * 与 registerEvaluator() 配合：先注册求值器，再注册规格，UI 才能显示。
 */
export function registerNodeSpec(type: string, spec: BlueprintNodeSpec): void {
  if (BLUEPRINT_NODE_SPECS[type]) {
    console.warn(`[blueprint] 节点规格 "${type}" 已存在，将被覆盖`);
  }
  BLUEPRINT_NODE_SPECS[type] = spec;
}

/**
 * 获取所有已注册的节点类型（含动态注册的）。
 * UI 节点面板从这里取列表。
 */
export function getAllNodeTypes(): string[] {
  return Object.keys(BLUEPRINT_NODE_SPECS);
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
