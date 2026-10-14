// ============================================================
// Blueprint IR — 程序化动画的中间表示
// 设计目标：
// - 图结构（节点+连边），节点图 UI 可直接可视化编辑
// - 积木 UI 的每个积木编译到同一个 IR
// - 文本 DSL 解析到同一个 IR
// - 可序列化（JSON），存档/分享/撤销都操作 IR
// ============================================================

/** 值类型：标量 | 向量2 | 布尔 | 字符串（枚举参数） */
export type BlueprintValueType = 'number' | 'vec2' | 'boolean' | 'string' | 'pixels' | 'array' | 'object';

/** IR 值（求值时的运行时值） */
export type BlueprintValue =
  | { type: 'number'; value: number }
  | { type: 'vec2'; x: number; y: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'string'; value: string }
  | { type: 'pixels'; grid: import('../types').PixelGrid }
  | { type: 'array'; value: unknown[] }
  | { type: 'object'; value: Record<string, unknown> };

/** 输入连接：连到另一个节点的输出 */
export interface BlueprintInputRef {
  nodeId: string;
  /** 输出端口名，默认 'out' */
  output?: string;
}

/** 节点输入：字面值 或 连边引用 */
export type BlueprintInput = BlueprintValue | BlueprintInputRef;

/** IR 节点 */
export interface BlueprintNode {
  id: string;
  /** 节点类型，如 'time' | 'const' | 'add' | 'sin' | 'pendulum' | 'transform' */
  type: string;
  /** 命名输入端口 */
  inputs: Record<string, BlueprintInput>;
  /** 静态参数（不随时间变，如 amplitude 默认值；也可被输入覆盖） */
  params: Record<string, import('../types').ModifierParamValue>;
  /** UI 布局信息（节点图坐标），不参与求值 */
  ui?: { x: number; y: number };
}

/** 整图 */
export interface BlueprintGraph {
  version: 1;
  nodes: BlueprintNode[];
  /** 输出节点 ID（类型必须为 'transform'） */
  outputId: string;
}

/** 求值上下文（每帧） */
export interface BlueprintEvalContext {
  frame: number;
  frameRate: number;
  /** 用户可调参数（积木 UI 的滑块/输入框绑到这里） */
  vars: Record<string, number | string | boolean>;
  /**
   * 跨节点引用（可选）。
   * key: PuppetNode.id，value: 该节点上一次求值的 transform 输出。
   * 不用 nodeRef 节点时为空，不影响现有蓝图。
   */
  nodeOutputs?: Map<string, { rotation: number; translateX: number; translateY: number; scaleX: number; scaleY: number }>;
  /**
   * 有状态节点的存储（可选，如 hold 节点）。
   * key: 蓝图节点 id，value: 该节点保存的状态。
   * 跨帧保持，由调用方维护。
   */
  nodeState?: Map<string, any>;
}

// ---- 类型辅助 ----

export function num(v: number): BlueprintValue {
  return { type: 'number', value: v };
}

export function pixels(grid: import('../types').PixelGrid): BlueprintValue {
  return { type: 'pixels', grid };
}

export function asPixels(v: BlueprintValue): import('../types').PixelGrid | null {
  if (v.type === 'pixels') return v.grid;
  return null;
}

export function isRef(input: BlueprintInput): input is BlueprintInputRef {
  return (input as BlueprintInputRef).nodeId !== undefined;
}

export function asNumber(v: BlueprintValue): number {
  if (v.type === 'number') return v.value;
  if (v.type === 'boolean') return v.value ? 1 : 0;
  return 0;
}
