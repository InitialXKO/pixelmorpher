// ============================================================
// 蓝图模板：四足奔跑（通用）
// 不是绑死某个角色的节点，而是定义"奔跑"的动画逻辑。
// 使用时把模板的槽位（slot）映射到实际节点的 ID。
//
// 槽位：
// - frontLegs: string[]  前腿节点 ID 列表
// - backLegs: string[]   后腿节点 ID 列表
// - tail?: string        尾巴节点 ID（可选）
// - body?: string        身体节点 ID（可选）
// - head?: string        头节点 ID（可选）
// ============================================================

import type { BlueprintGraph, BlueprintNode } from '../ir';

export interface QuadrupedRunSlots {
  frontLegs: string[];
  backLegs: string[];
  tail?: string;
  body?: string;
  head?: string;
}

export interface QuadrupedRunParams {
  /** 腿摆动幅度（度） */
  legAmplitude?: number;
  /** 步态周期（帧） */
  stridePeriod?: number;
  /** 尾巴摇摆幅度 */
  tailAmplitude?: number;
  /** 身体起伏幅度 */
  bodyBob?: number;
}

let idc = 0;
function nid(p: string): string {
  return `run_${p}_${(idc++).toString(36)}`;
}

/**
 * 生成四足奔跑蓝图：每个槽位一个图。
 * 返回 Map<nodeId, BlueprintGraph>，直接赋给对应节点的 blueprint 字段。
 */
export function createQuadrupedRunBlueprint(
  slots: QuadrupedRunSlots,
  params: QuadrupedRunParams = {},
): Map<string, BlueprintGraph> {
  const {
    legAmplitude = 25,
    stridePeriod = 12,
    tailAmplitude = 15,
    bodyBob = 2,
  } = params;

  const result = new Map<string, BlueprintGraph>();

  function makePendulumGraph(
    amplitude: number,
    period: number,
    phase: number,
    outputPort: 'rotation' | 'translateY' = 'rotation',
  ): BlueprintGraph {
    const nodes: BlueprintNode[] = [];
    const timeId = nid('time');
    nodes.push({ id: timeId, type: 'time', inputs: {}, params: {} });
    const pendId = nid('pendulum');
    nodes.push({
      id: pendId,
      type: 'pendulum',
      inputs: { t: { nodeId: timeId } },
      params: { amplitude, period, phase },
    });
    const outId = nid('transform');
    nodes.push({
      id: outId,
      type: 'transform',
      inputs: { [outputPort]: { nodeId: pendId, output: 'out' } },
      params: {},
    });
    return { version: 1, nodes, outputId: outId };
  }

  function makeFloatGraph(amplitude: number, period: number): BlueprintGraph {
    const nodes: BlueprintNode[] = [];
    const timeId = nid('time');
    nodes.push({ id: timeId, type: 'time', inputs: {}, params: {} });
    const floatId = nid('float');
    nodes.push({
      id: floatId,
      type: 'float',
      inputs: { t: { nodeId: timeId } },
      params: { amplitude, period },
    });
    const outId = nid('transform');
    nodes.push({
      id: outId,
      type: 'transform',
      inputs: { translateY: { nodeId: floatId, output: 'out' } },
      params: {},
    });
    return { version: 1, nodes, outputId: outId };
  }

  // 前腿：相位 0°
  for (const id of slots.frontLegs) {
    result.set(id, makePendulumGraph(legAmplitude, stridePeriod, 0));
  }

  // 后腿：相位 180°（对角步态）
  for (const id of slots.backLegs) {
    result.set(id, makePendulumGraph(legAmplitude, stridePeriod, 180));
  }

  // 尾巴：快速摇摆
  if (slots.tail) {
    result.set(slots.tail, makePendulumGraph(tailAmplitude, stridePeriod * 0.66, 90));
  }

  // 身体：上下起伏
  if (slots.body) {
    result.set(slots.body, makeFloatGraph(bodyBob, stridePeriod));
  }

  // 头：轻微点动
  if (slots.head) {
    result.set(slots.head, makePendulumGraph(5, stridePeriod, 45));
  }

  return result;
}

// ---- 小狗专用预设（槽位映射示例） ----

/**
 * 小狗向西奔跑：把通用模板映射到小狗的节点名。
 * 节点布局（侧面/W 向）：
 * - 头接身体左上，尾巴接身体右上
 */
export function createPuppyRunWestExample(): {
  nodes: { name: string; sockets: { name: string; localX: number; localY: number }[]; plug: { socketName: string; localX: number; localY: number } | null }[];
  blueprints: Map<string, BlueprintGraph>;
} {
  // 节点定义（名称即 ID，实际使用时换成真实 node.id）
  const nodes = [
    {
      name: 'body',
      sockets: [
        { name: 'head_attach', localX: -8, localY: -4 },
        { name: 'tail_attach', localX: 8, localY: -3 },
        { name: 'front_leg', localX: -5, localY: 4 },
        { name: 'back_leg', localX: 5, localY: 4 },
      ],
      plug: null,
    },
    {
      name: 'head',
      sockets: [],
      plug: { socketName: 'head_attach', localX: 0, localY: 2 },
    },
    {
      name: 'tail',
      sockets: [],
      plug: { socketName: 'tail_attach', localX: 0, localY: 0 },
    },
    {
      name: 'front_leg',
      sockets: [],
      plug: { socketName: 'front_leg', localX: 0, localY: 0 },
    },
    {
      name: 'back_leg',
      sockets: [],
      plug: { socketName: 'back_leg', localX: 0, localY: 0 },
    },
  ];

  const blueprints = createQuadrupedRunBlueprint({
    frontLegs: ['front_leg'],
    backLegs: ['back_leg'],
    tail: 'tail',
    body: 'body',
    head: 'head',
  });

  return { nodes, blueprints };
}

/**
 * 一键创建小狗奔跑示例：建骨架 + 建角色 + 挂蓝图。
 * 在没有角色时调用，用户点一下就能跑。
 */
export function createPuppyRunExampleCharacter(): string | null {
  // 动态 import 避免循环依赖
  const storeModule = require('@/lib/store') as { useProjectStore: { getState: () => any } };
  const sessionModule = require('@/lib/puppet-session-store') as { usePuppetSessionStore: { getState: () => any } };
  const store = storeModule.useProjectStore.getState();

  // 1. 建骨架
  const skeleton = store.addPuppetSkeleton('小狗（奔跑示例）');

  // 2. 建节点（按 PUPPY_RUN_WEST_NODES 布局）
  const nodeIds: Record<string, string> = {};
  const defs = [
    {
      name: 'body',
      sockets: [
        { name: 'head_attach', localX: -8, localY: -4 },
        { name: 'tail_attach', localX: 8, localY: -3 },
        { name: 'front_leg', localX: -5, localY: 4 },
        { name: 'back_leg', localX: 5, localY: 4 },
      ],
      plug: null,
      zIndex: 5,
    },
    {
      name: 'head',
      sockets: [],
      plug: { socketName: 'head_attach', socketId: '', localX: 0, localY: 2, jointWidth: null as number | null },
      zIndex: 10,
    },
    {
      name: 'tail',
      sockets: [],
      plug: { socketName: 'tail_attach', socketId: '', localX: 0, localY: 0, jointWidth: null as number | null },
      zIndex: 4,
    },
    {
      name: 'front_leg',
      sockets: [],
      plug: { socketName: 'front_leg', socketId: '', localX: 0, localY: 0, jointWidth: null as number | null },
      zIndex: 3,
    },
    {
      name: 'back_leg',
      sockets: [],
      plug: { socketName: 'back_leg', socketId: '', localX: 0, localY: 0, jointWidth: null as number | null },
      zIndex: 3,
    },
  ];

  for (const def of defs) {
    const node = store.addPuppetNode(skeleton.id, def.name, {
      sockets: def.sockets.map((s) => ({
        id: `socket_${Math.random().toString(36).slice(2)}`,
        ...s,
      })),
      plug: def.plug as any,
      zIndex: def.zIndex,
    });
    nodeIds[def.name] = node.id;
  }

  // 3. 修正 plug 的 socketId（指向 body 上对应的 socket）
  const bodyNode = store.getState().puppetSkeletons
    .find((sk: any) => sk.id === skeleton.id)?.nodes
    .find((n: any) => n.name === 'body');
  if (bodyNode) {
    for (const [name, id] of Object.entries(nodeIds)) {
      if (name === 'body') continue;
      const socketName = defs.find((d) => d.name === name)?.plug?.socketName;
      const socket = bodyNode.sockets.find((s: any) => s.name === socketName);
      if (socket) {
        store.updatePuppetNode(skeleton.id, id as string, {
          plug: { socketName, socketId: socket.id, localX: 0, localY: 2, jointWidth: null },
        } as any);
      }
    }
  }

  // 4. 建角色
  const character = store.addPuppetCharacter('小狗', skeleton.id);

  // 5. 挂蓝图
  const blueprints = createQuadrupedRunBlueprint({
    frontLegs: [nodeIds['front_leg']!],
    backLegs: [nodeIds['back_leg']!],
    tail: nodeIds['tail'],
    body: nodeIds['body'],
    head: nodeIds['head'],
  });
  for (const [nodeId, graph] of blueprints) {
    store.updatePuppetNode(skeleton.id, nodeId, { blueprint: graph });
  }

  // 6. 切到 perform
  sessionModule.usePuppetSessionStore.getState().enterPerform(character.id);

  return character.id;
}
