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
  /** 前小腿节点 ID 列表（可选，两段式腿） */
  frontLowerLegs?: string[];
  /** 后小腿节点 ID 列表（可选，两段式腿） */
  backLowerLegs?: string[];
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

  // 前小腿：相位滞后 45°，幅度减半（跟随大腿摆动）
  for (const id of slots.frontLowerLegs ?? []) {
    result.set(id, makePendulumGraph(legAmplitude * 0.6, stridePeriod, 45));
  }

  // 后小腿：相位 225°，幅度减半
  for (const id of slots.backLowerLegs ?? []) {
    result.set(id, makePendulumGraph(legAmplitude * 0.6, stridePeriod, 225));
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
 * 节点布局（侧面/W 向，13 节点）：
 * - 头接身体左上，尾巴接身体右上
 * - 两段式腿：大腿接身体，小腿接大腿膝关节
 * - 耳朵接头顶
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
        { name: 'head_attach', localX: -8, localY: -3 },
        { name: 'tail_attach', localX: 7, localY: -1 },
        { name: 'front_upper_leg_l', localX: -7.5, localY: 3 },
        { name: 'front_upper_leg_r', localX: -4.5, localY: 3 },
        { name: 'back_upper_leg_l', localX: -0.5, localY: 3 },
        { name: 'back_upper_leg_r', localX: 3.5, localY: 3 },
      ],
      plug: null,
    },
    {
      name: 'head',
      sockets: [
        { name: 'ear_l', localX: -2, localY: -9 },
        { name: 'ear_r', localX: 3, localY: -9 },
      ],
      plug: { socketName: 'head_attach', localX: 0, localY: 0 },
    },
    {
      name: 'ear_l',
      sockets: [],
      plug: { socketName: 'ear_l', localX: 0, localY: 0 },
    },
    {
      name: 'ear_r',
      sockets: [],
      plug: { socketName: 'ear_r', localX: 0, localY: 0 },
    },
    {
      name: 'tail',
      sockets: [],
      plug: { socketName: 'tail_attach', localX: 0, localY: 0 },
    },
    {
      name: 'front_upper_leg_l',
      sockets: [{ name: 'knee', localX: 0, localY: 8 }],
      plug: { socketName: 'front_upper_leg_l', localX: 0, localY: 0 },
    },
    {
      name: 'front_lower_leg_l',
      sockets: [],
      plug: { socketName: 'knee', localX: 0, localY: 0 },
    },
    {
      name: 'front_upper_leg_r',
      sockets: [{ name: 'knee', localX: 0, localY: 8 }],
      plug: { socketName: 'front_upper_leg_r', localX: 0, localY: 0 },
    },
    {
      name: 'front_lower_leg_r',
      sockets: [],
      plug: { socketName: 'knee', localX: 0, localY: 0 },
    },
    {
      name: 'back_upper_leg_l',
      sockets: [{ name: 'knee', localX: 0, localY: 8 }],
      plug: { socketName: 'back_upper_leg_l', localX: 0, localY: 0 },
    },
    {
      name: 'back_lower_leg_l',
      sockets: [],
      plug: { socketName: 'knee', localX: 0, localY: 0 },
    },
    {
      name: 'back_upper_leg_r',
      sockets: [{ name: 'knee', localX: 0, localY: 8 }],
      plug: { socketName: 'back_upper_leg_r', localX: 0, localY: 0 },
    },
    {
      name: 'back_lower_leg_r',
      sockets: [],
      plug: { socketName: 'knee', localX: 0, localY: 0 },
    },
  ];

  const blueprints = createQuadrupedRunBlueprint({
    frontLegs: ['front_upper_leg_l', 'front_upper_leg_r'],
    backLegs: ['back_upper_leg_l', 'back_upper_leg_r'],
    frontLowerLegs: ['front_lower_leg_l', 'front_lower_leg_r'],
    backLowerLegs: ['back_lower_leg_l', 'back_lower_leg_r'],
    tail: 'tail',
    body: 'body',
    head: 'head',
  });

  return { nodes, blueprints };
}

/**
 * 一键创建小狗奔跑示例：建骨架 + 13 个节点 + 13 张精灵 + 建角色 + 挂蓝图。
 * 在没有角色时调用，用户点一下就能看到小狗跑。
 * 精灵来自 src/lib/engine/default-costume-sprites.ts 的狗模板。
 */
export function createPuppyRunExampleCharacter(): string | null {
  // 动态 import 避免循环依赖
  const storeModule = require('@/lib/store') as { useProjectStore: { getState: () => any } };
  const sessionModule = require('@/lib/puppet-session-store') as { usePuppetSessionStore: { getState: () => any } };
  const spriteModule = require('@/lib/engine/default-costume-sprites') as {
    generateDefaultCostumeSprite: (nodeName: string, templateName: string) => {
      pixels: (string | null)[][]; width: number; height: number;
      pivotX: number; pivotY: number; partName: string;
    };
  };
  const store = storeModule.useProjectStore.getState();

  // 1. 建骨架
  const skeleton = store.addPuppetSkeleton('小狗（奔跑示例）');

  // 2. 节点定义：name / 精灵 key / 父节点 / 接入的 socket / 自有 sockets / zIndex
  interface Def {
    name: string;
    spriteKey: string;
    parent: string | null;
    socketName: string | null;
    sockets: { name: string; localX: number; localY: number }[];
    zIndex: number;
  }
  const defs: Def[] = [
    {
      name: 'body', spriteKey: 'body', parent: null, socketName: null,
      sockets: [
        { name: 'head_attach', localX: -8, localY: -3 },
        { name: 'tail_attach', localX: 7, localY: -1 },
        { name: 'front_upper_leg_l', localX: -7.5, localY: 3 },
        { name: 'front_upper_leg_r', localX: -4.5, localY: 3 },
        { name: 'back_upper_leg_l', localX: -0.5, localY: 3 },
        { name: 'back_upper_leg_r', localX: 3.5, localY: 3 },
      ],
      zIndex: 5,
    },
    {
      name: 'head', spriteKey: 'head', parent: 'body', socketName: 'head_attach',
      sockets: [
        { name: 'ear_l', localX: -2, localY: -9 },
        { name: 'ear_r', localX: 3, localY: -9 },
      ],
      zIndex: 10,
    },
    { name: 'ear_l', spriteKey: 'ear_l', parent: 'head', socketName: 'ear_l', sockets: [], zIndex: 11 },
    { name: 'ear_r', spriteKey: 'ear_r', parent: 'head', socketName: 'ear_r', sockets: [], zIndex: 11 },
    { name: 'tail', spriteKey: 'tail', parent: 'body', socketName: 'tail_attach', sockets: [], zIndex: 4 },
    {
      name: 'front_upper_leg_l', spriteKey: 'front_upper_leg_l',
      parent: 'body', socketName: 'front_upper_leg_l',
      sockets: [{ name: 'knee', localX: 0, localY: 8 }], zIndex: 3,
    },
    {
      name: 'front_lower_leg_l', spriteKey: 'front_lower_leg_l',
      parent: 'front_upper_leg_l', socketName: 'knee', sockets: [], zIndex: 2,
    },
    {
      name: 'front_upper_leg_r', spriteKey: 'front_upper_leg_r',
      parent: 'body', socketName: 'front_upper_leg_r',
      sockets: [{ name: 'knee', localX: 0, localY: 8 }], zIndex: 3,
    },
    {
      name: 'front_lower_leg_r', spriteKey: 'front_lower_leg_r',
      parent: 'front_upper_leg_r', socketName: 'knee', sockets: [], zIndex: 2,
    },
    {
      name: 'back_upper_leg_l', spriteKey: 'back_upper_leg_l',
      parent: 'body', socketName: 'back_upper_leg_l',
      sockets: [{ name: 'knee', localX: 0, localY: 8 }], zIndex: 3,
    },
    {
      name: 'back_lower_leg_l', spriteKey: 'back_lower_leg_l',
      parent: 'back_upper_leg_l', socketName: 'knee', sockets: [], zIndex: 2,
    },
    {
      name: 'back_upper_leg_r', spriteKey: 'back_upper_leg_r',
      parent: 'body', socketName: 'back_upper_leg_r',
      sockets: [{ name: 'knee', localX: 0, localY: 8 }], zIndex: 3,
    },
    {
      name: 'back_lower_leg_r', spriteKey: 'back_lower_leg_r',
      parent: 'back_upper_leg_r', socketName: 'knee', sockets: [], zIndex: 2,
    },
  ];

  // 3. 为每个节点生成精灵 → 建 Part → 建节点（spritePartId 直接写入）
  const nodeIds: Record<string, string> = {};
  for (const def of defs) {
    const sprite = spriteModule.generateDefaultCostumeSprite(def.spriteKey, 'dog');
    const part = store.addPart(sprite.partName, sprite.width, sprite.height, {
      pivotX: sprite.pivotX,
      pivotY: sprite.pivotY,
    });
    store.setPartPixels(part.id, sprite.pixels);

    const node = store.addPuppetNode(skeleton.id, def.name, {
      sockets: def.sockets.map((s) => ({
        id: `socket_${Math.random().toString(36).slice(2)}`,
        ...s,
      })),
      // plug 先占位，socketId 在第 4 步修正
      plug: def.parent
        ? { socketName: def.socketName, socketId: '', localX: 0, localY: 0, jointWidth: null } as any
        : null,
      zIndex: def.zIndex,
      spritePartId: part.id,
    });
    nodeIds[def.name] = node.id;
  }

  // 4. 修正 plug 的 socketId（指向父节点上对应的 socket）
  const allNodes: any[] = store.getState().puppetSkeletons
    .find((sk: any) => sk.id === skeleton.id)?.nodes ?? [];
  for (const def of defs) {
    if (!def.parent || !def.socketName) continue;
    const parentNode = allNodes.find((n: any) => n.name === def.parent);
    const socket = parentNode?.sockets.find((s: any) => s.name === def.socketName);
    if (socket) {
      store.updatePuppetNode(skeleton.id, nodeIds[def.name], {
        plug: { socketId: socket.id, localX: 0, localY: 0, jointWidth: null },
      } as any);
    }
  }

  // 5. 建角色
  const character = store.addPuppetCharacter('小狗', skeleton.id);

  // 6. 挂蓝图（大腿 + 小腿 + 尾巴 + 身体 + 头）
  const blueprints = createQuadrupedRunBlueprint({
    frontLegs: [nodeIds['front_upper_leg_l']!, nodeIds['front_upper_leg_r']!],
    backLegs: [nodeIds['back_upper_leg_l']!, nodeIds['back_upper_leg_r']!],
    frontLowerLegs: [nodeIds['front_lower_leg_l']!, nodeIds['front_lower_leg_r']!],
    backLowerLegs: [nodeIds['back_lower_leg_l']!, nodeIds['back_lower_leg_r']!],
    tail: nodeIds['tail'],
    body: nodeIds['body'],
    head: nodeIds['head'],
  });
  for (const [nodeId, graph] of blueprints) {
    store.updatePuppetNode(skeleton.id, nodeId, { blueprint: graph });
  }

  // 7. 切到 perform
  sessionModule.usePuppetSessionStore.getState().enterPerform(character.id);

  return character.id;
}
