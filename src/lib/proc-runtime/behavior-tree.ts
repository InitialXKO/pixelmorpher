// ============================================================
// BehaviorTreePanel 的纯函数层（可探针、无 DOM）+ 宿主侧 tick 求值：
// 行为树是"大脑"、状态机是"身体"——树每 tick 按世界状态决策，只输出
// 意图（intent）、移动（setMove）、变量（setVar），走 procRuntime 口子。
// 本层不进运行时包：convert 不读 behaviorTree；宿主 import tickBehaviorTree，
// 每 tick 喂 worldVars、把 firedIntents 调进 procRuntime。
//
// Tick 语义（2026-10-24 用户拍板：从根重跑，不做断点续跑）：
// - 每 tick 从根重跑；Running 只有 Wait 产生（进度记黑板内部区）；
// - Repeat 的遍数进度同样记黑板内部区（__bt_ 前缀，宿主世界变量不得用此前缀）；
// - 黑板只放数（与状态机 hostVars 同口径）；宿主每 tick 喂的世界变量覆盖同名键
//   （世界为准）；SetVar 写黑板，并转发 procRuntime.setVar；
// - 条件读不到变量（缺失/非数字）= 失败，与模板 smCondOk 同口径；
// - 空选择器恒失败、空顺序器恒成功；修饰节点无子节点恒失败；
// - spec 结构变化（删/加节点致 id 复用）后，黑板内部区的旧进度可能残留，
//   宿主应在结构变化后重置运行状态（createBTState）。
// 模板口径（2026-10-24 晚改包后）：setVar 的通用名存入变量表、每帧并入
// hostVars，状态机条件与行为图都能读到——SetVar 是脑到身体的桥；保留名
// t/phase/speed01/grounded 由模板逐帧计算，setVar 拒收（返回 false）。
// 试运行的 mock 按此口径实现。
// ============================================================

import type {
  BehaviorTreeNode,
  BehaviorTreeNodeType,
  BehaviorTreeSpec,
  StateMachineCondition,
} from '../unified-types';

export const BT_TYPE_LABELS: Record<BehaviorTreeNodeType, string> = {
  selector: '选择器',
  sequence: '顺序器',
  inverter: '取反',
  repeat: '重复',
  condition: '条件',
  intent: '意图',
  setMove: '移动',
  setVar: '写变量',
  wait: '等待',
};

const COMPOSITES: BehaviorTreeNodeType[] = ['selector', 'sequence'];
const DECORATORS: BehaviorTreeNodeType[] = ['inverter', 'repeat'];
export const BT_ALL_TYPES: BehaviorTreeNodeType[] = [
  'selector', 'sequence', 'inverter', 'repeat',
  'condition', 'intent', 'setMove', 'setVar', 'wait',
];
export const BT_INTERNAL_PREFIX = '__bt_';

export function isComposite(type: BehaviorTreeNodeType): boolean {
  return COMPOSITES.includes(type);
}
export function isDecorator(type: BehaviorTreeNodeType): boolean {
  return DECORATORS.includes(type);
}
export function canHaveChildren(type: BehaviorTreeNodeType): boolean {
  return isComposite(type) || isDecorator(type);
}

export function cloneBTNode(node: BehaviorTreeNode): BehaviorTreeNode {
  return {
    ...node,
    children: node.children ? node.children.map(cloneBTNode) : undefined,
  };
}

export function cloneBTSpec(spec: BehaviorTreeSpec): BehaviorTreeSpec {
  return { version: 1, root: spec.root ? cloneBTNode(spec.root) : null };
}

function collectIds(node: BehaviorTreeNode, out: Set<string>): void {
  out.add(node.id);
  for (const c of node.children ?? []) collectIds(c, out);
}

export function newBTNodeId(spec: BehaviorTreeSpec): string {
  const taken = new Set<string>();
  if (spec.root) collectIds(spec.root, taken);
  let i = 1;
  while (taken.has(`bt${i}`)) i++;
  return `bt${i}`;
}

export function defaultBTNode(type: BehaviorTreeNodeType, id: string): BehaviorTreeNode {
  const base: BehaviorTreeNode = { id, type };
  switch (type) {
    case 'selector':
    case 'sequence':
    case 'inverter':
      return { ...base, children: [] };
    case 'repeat':
      return { ...base, repeatCount: 1, children: [] };
    case 'condition':
      return { ...base, var: '', op: 'gte', value: 0 };
    case 'intent':
      return { ...base, intentName: '' };
    case 'setMove':
      return { ...base, moveX: 0 };
    case 'setVar':
      return { ...base, setVarName: '', setVarValue: 0 };
    case 'wait':
      return { ...base, waitSeconds: 1 };
    default:
      return base;
  }
}

export interface BTFound {
  node: BehaviorTreeNode;
  parent: BehaviorTreeNode | null;
  index: number; // 在 parent.children 里的下标；根节点为 -1
}

export function findBTNode(root: BehaviorTreeNode | null, id: string): BTFound | null {
  if (!root) return null;
  if (root.id === id) return { node: root, parent: null, index: -1 };
  const visit = (node: BehaviorTreeNode): BTFound | null => {
    for (let i = 0; i < (node.children ?? []).length; i++) {
      const child = node.children![i];
      if (child.id === id) return { node: child, parent: node, index: i };
      const deeper = visit(child);
      if (deeper) return deeper;
    }
    return null;
  };
  return visit(root);
}

/** 给 parent 加子节点：叶子拒收；修饰节点已有子节点时拒收（返回 null）。 */
export function addChildToSpec(
  spec: BehaviorTreeSpec,
  parentId: string,
  type: BehaviorTreeNodeType,
): BehaviorTreeSpec | null {
  const next = cloneBTSpec(spec);
  if (!next.root) return null;
  const found = findBTNode(next.root, parentId);
  if (!found) return null;
  if (!canHaveChildren(found.node.type)) return null;
  if (isDecorator(found.node.type) && (found.node.children ?? []).length > 0) return null;
  const children = found.node.children ?? [];
  children.push(defaultBTNode(type, newBTNodeId(next)));
  found.node.children = children;
  return next;
}

/** 给某节点加兄弟（插在其后）：根节点无兄弟，返回 null。 */
export function addSiblingToSpec(
  spec: BehaviorTreeSpec,
  siblingId: string,
  type: BehaviorTreeNodeType,
): BehaviorTreeSpec | null {
  const next = cloneBTSpec(spec);
  if (!next.root) return null;
  const found = findBTNode(next.root, siblingId);
  if (!found || !found.parent) return null;
  const children = found.parent.children ?? [];
  children.splice(found.index + 1, 0, defaultBTNode(type, newBTNodeId(next)));
  return next;
}

/** 删节点（含子树）；删根则 root 置 null。 */
export function removeNodeFromSpec(spec: BehaviorTreeSpec, id: string): BehaviorTreeSpec {
  const next = cloneBTSpec(spec);
  if (!next.root) return next;
  if (next.root.id === id) { next.root = null; return next; }
  const found = findBTNode(next.root, id);
  if (!found || !found.parent) return next;
  found.parent.children = (found.parent.children ?? []).filter((c) => c.id !== id);
  return next;
}

/** 改节点字段（id 不可改；children 除非 patch 里显式给出，否则保留）。 */
export function updateNodeInSpec(
  spec: BehaviorTreeSpec,
  id: string,
  patch: Partial<BehaviorTreeNode>,
): BehaviorTreeSpec | null {
  const next = cloneBTSpec(spec);
  if (!next.root) return null;
  const found = findBTNode(next.root, id);
  if (!found) return null;
  const { id: _id, children, ...rest } = patch as Record<string, unknown>;
  void _id;
  Object.assign(found.node, rest);
  if (children !== undefined) found.node.children = children as BehaviorTreeNode[];
  return next;
}

/** 同父子节点内上/下移一位；根节点或已到边界返回 null。 */
export function moveNodeInSpec(
  spec: BehaviorTreeSpec,
  id: string,
  dir: -1 | 1,
): BehaviorTreeSpec | null {
  const next = cloneBTSpec(spec);
  if (!next.root) return null;
  const found = findBTNode(next.root, id);
  if (!found || !found.parent) return null;
  const children = found.parent.children ?? [];
  const j = found.index + dir;
  if (j < 0 || j >= children.length) return null;
  [children[found.index], children[j]] = [children[j], children[found.index]];
  return next;
}

export function collectBTVarNames(spec: BehaviorTreeSpec): string[] {
  const out = new Set<string>();
  const visit = (node: BehaviorTreeNode) => {
    if (node.type === 'condition' && node.var) out.add(node.var);
    if (node.type === 'setVar' && node.setVarName) out.add(node.setVarName);
    for (const c of node.children ?? []) visit(c);
  };
  if (spec.root) visit(spec.root);
  return [...out];
}

/** 面板只预警、不拦截：空树、悬空意图、无效数值都只列出来。 */
export function validateBehaviorTreeSpec(
  spec: BehaviorTreeSpec,
  offeredIntentIds: ReadonlySet<string>,
): string[] {
  const warnings: string[] = [];
  if (!spec.root) return ['树是空的：先加一个根节点。'];
  const visit = (node: BehaviorTreeNode, path: string) => {
    const here = `${path}/${node.id}(${BT_TYPE_LABELS[node.type]})`;
    const kids = node.children ?? [];
    if (isComposite(node.type) && kids.length === 0) {
      warnings.push(`${here} 没有子节点（空选择器恒失败、空顺序器恒成功）。`);
    }
    if (isDecorator(node.type)) {
      if (kids.length === 0) warnings.push(`${here} 没有子节点（恒失败）。`);
      if (kids.length > 1) warnings.push(`${here} 只能有 1 个子节点（多余的会被忽略）。`);
    }
    if (node.type === 'condition') {
      if (!node.var) warnings.push(`${here} 变量名为空。`);
      if (typeof node.value !== 'number' || Number.isNaN(node.value)) warnings.push(`${here} 比较值不是数字。`);
    }
    if (node.type === 'intent') {
      if (!node.intentName) warnings.push(`${here} 意图名为空。`);
      else if (!offeredIntentIds.has(node.intentName)) {
        warnings.push(`${here} 意图「${node.intentName}」不在可选表演里（运行时调 intent 会失败，树会继续试下一个）。`);
      }
    }
    if (node.type === 'setVar') {
      if (!node.setVarName) warnings.push(`${here} 写变量名为空。`);
      if (typeof node.setVarValue !== 'number' || Number.isNaN(node.setVarValue)) warnings.push(`${here} 写变量值不是数字。`);
    }
    if (node.type === 'setMove' && (typeof node.moveX !== 'number' || Number.isNaN(node.moveX))) {
      warnings.push(`${here} 移动值不是数字。`);
    }
    if (node.type === 'repeat' && (typeof node.repeatCount !== 'number' || Number.isNaN(node.repeatCount) || (node.repeatCount ?? 0) < 0)) {
      warnings.push(`${here} 重复遍数无效（0=一直跑）。`);
    }
    if (node.type === 'wait' && (typeof node.waitSeconds !== 'number' || Number.isNaN(node.waitSeconds) || (node.waitSeconds ?? 0) < 0)) {
      warnings.push(`${here} 等待秒数无效（0=立即成功）。`);
    }
    for (const c of kids) visit(c, here);
  };
  visit(spec.root, '根');
  return warnings;
}

// ============================================================
// Tick 求值
// ============================================================

export type BTStatus = 'success' | 'failure' | 'running';

export interface BTTraceEntry {
  id: string;
  type: BehaviorTreeNodeType;
  depth: number;
  status: BTStatus;
  detail: string;
}

/** 运行时适配器：宿主把 procRuntime 包一层传进来；试运行传 mock。
 *  intent 返回布尔（模板 intent 同口径：命中表演/jump 为 true，否则 false）；
 *  setVar 返回布尔（模板口径：moveX/autoWalk 旧通道、通用名进变量表为 true；
 *  保留名 t/phase/speed01/grounded 与非数字值为 false）。 */
export interface BTRuntimeAdapter {
  intent?: (name: string) => boolean;
  setMove?: (x: number) => void;
  setVar?: (name: string, value: number) => boolean | void;
}

export interface BTState {
  /** 累计 tick 时间（秒），Wait 的起点记在这里的读数上 */
  clock: number;
  /** 黑板：世界变量 + SetVar 写入 + __bt_ 内部进度 */
  vars: Record<string, number>;
}

export function createBTState(): BTState {
  return { clock: 0, vars: {} };
}

export interface BTTickResult {
  status: BTStatus;
  trace: BTTraceEntry[];
  firedIntents: string[];
}

function condOk(op: StateMachineCondition['op'] | undefined, v: number, target: number): boolean {
  switch (op) {
    case 'lt': return v < target;
    case 'lte': return v <= target;
    case 'gt': return v > target;
    case 'gte': return v >= target;
    case 'eq': return v === target;
    case 'neq': return v !== target;
    default: return false;
  }
}

export function tickBehaviorTree(
  spec: BehaviorTreeSpec,
  state: BTState,
  opts: {
    dt: number;
    worldVars: Record<string, number>;
    runtime?: BTRuntimeAdapter;
    knownIntents?: ReadonlySet<string>;
  },
): BTTickResult {
  const dt = Math.max(0, opts.dt || 0);
  state.clock += dt;
  // 世界为准：同名键覆盖黑板；__bt_ 前缀是内部进度区，世界变量不得写入。
  for (const [k, v] of Object.entries(opts.worldVars)) {
    if (k.startsWith(BT_INTERNAL_PREFIX)) continue;
    if (typeof v === 'number' && !Number.isNaN(v)) state.vars[k] = v;
  }
  const trace: BTTraceEntry[] = [];
  const firedIntents: string[] = [];

  const evaluate = (node: BehaviorTreeNode, depth: number): BTStatus => {
    const entry: BTTraceEntry = { id: node.id, type: node.type, depth, status: 'running', detail: '' };
    trace.push(entry);
    const kids = node.children ?? [];
    let status: BTStatus;
    switch (node.type) {
      case 'selector': {
        status = 'failure';
        for (const c of kids) {
          const s = evaluate(c, depth + 1);
          if (s === 'success') { status = 'success'; break; }
          if (s === 'running') { status = 'running'; break; }
        }
        entry.detail = kids.length === 0 ? '空选择器' : '';
        break;
      }
      case 'sequence': {
        status = 'success';
        for (const c of kids) {
          const s = evaluate(c, depth + 1);
          if (s === 'failure') { status = 'failure'; break; }
          if (s === 'running') { status = 'running'; break; }
        }
        entry.detail = kids.length === 0 ? '空顺序器' : '';
        break;
      }
      case 'inverter': {
        const child = kids[0];
        if (!child) { status = 'failure'; entry.detail = '无子节点'; break; }
        const s = evaluate(child, depth + 1);
        status = s === 'success' ? 'failure' : s === 'failure' ? 'success' : 'running';
        break;
      }
      case 'repeat': {
        const child = kids[0];
        if (!child) { status = 'failure'; entry.detail = '无子节点'; break; }
        const raw = node.repeatCount ?? 1;
        const count = typeof raw === 'number' && !Number.isNaN(raw) && raw >= 0 ? raw : 1;
        const key = `${BT_INTERNAL_PREFIX}repeat_${node.id}`;
        const s = evaluate(child, depth + 1);
        if (s === 'failure') {
          delete state.vars[key];
          status = 'failure';
        } else if (s === 'running') {
          status = 'running';
        } else if (count === 0) {
          status = 'running'; // 一直跑：成功一遍即下一遍
          entry.detail = '一直跑';
        } else {
          const done = (state.vars[key] ?? 0) + 1;
          if (done >= count) { delete state.vars[key]; status = 'success'; }
          else { state.vars[key] = done; status = 'running'; }
          entry.detail = `${Math.min(done, count)}/${count} 遍`;
        }
        break;
      }
      case 'condition': {
        const v = node.var ? state.vars[node.var] : undefined;
        const target = node.value ?? 0;
        if (typeof v !== 'number') {
          status = 'failure';
          entry.detail = `${node.var ?? ''} 缺失`;
        } else {
          status = condOk(node.op, v, target) ? 'success' : 'failure';
          entry.detail = `${node.var} ${node.op ?? '?'} ${target}（当前 ${v}）`;
        }
        break;
      }
      case 'intent': {
        const name = node.intentName ?? '';
        if (!name) { status = 'failure'; entry.detail = '意图名为空'; break; }
        let ok: boolean;
        if (opts.runtime?.intent) ok = opts.runtime.intent(name);
        else if (opts.knownIntents) ok = opts.knownIntents.has(name);
        else ok = false;
        status = ok ? 'success' : 'failure';
        if (ok) firedIntents.push(name);
        entry.detail = ok ? `意图 ${name} 命中` : `意图 ${name} 未命中`;
        break;
      }
      case 'setMove': {
        const x = typeof node.moveX === 'number' && !Number.isNaN(node.moveX) ? node.moveX : 0;
        opts.runtime?.setMove?.(x);
        status = 'success';
        entry.detail = opts.runtime?.setMove ? `setMove(${x})` : `setMove(${x})（未接运行时）`;
        break;
      }
      case 'setVar': {
        const name = node.setVarName ?? '';
        if (!name) { status = 'failure'; entry.detail = '变量名为空'; break; }
        const value = typeof node.setVarValue === 'number' && !Number.isNaN(node.setVarValue) ? node.setVarValue : 0;
        state.vars[name] = value;
        const forwarded = opts.runtime?.setVar?.(name, value);
        status = 'success';
        entry.detail = forwarded === true ? `${name}=${value}（已转发）`
          : forwarded === false ? `${name}=${value}（运行时拒收）`
          : `${name}=${value}（未接运行时）`;
        break;
      }
      case 'wait': {
        const seconds = typeof node.waitSeconds === 'number' && !Number.isNaN(node.waitSeconds) ? node.waitSeconds : 0;
        if (seconds <= 0) { status = 'success'; entry.detail = '0 秒，立即成功'; break; }
        const key = `${BT_INTERNAL_PREFIX}wait_${node.id}`;
        const start = state.vars[key];
        if (start === undefined) {
          state.vars[key] = state.clock;
          status = 'running';
          entry.detail = `等待 0/${seconds} 秒`;
        } else {
          const elapsed = state.clock - start;
          if (elapsed >= seconds) { delete state.vars[key]; status = 'success'; entry.detail = `等待 ${seconds}/${seconds} 秒`; }
          else { status = 'running'; entry.detail = `等待 ${elapsed.toFixed(2)}/${seconds} 秒`; }
        }
        break;
      }
      default: {
        status = 'failure';
        entry.detail = '未知节点类型';
        break;
      }
    }
    entry.status = status;
    return status;
  };

  if (!spec.root) return { status: 'failure', trace, firedIntents };
  const status = evaluate(spec.root, 0);
  return { status, trace, firedIntents };
}
