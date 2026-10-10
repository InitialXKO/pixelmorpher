// ============================================================
// 蓝图示例：小狗向西（左）奔跑
// 规格：
// - 侧面精灵，方向西（W）
// - 头接在身体左上（head_attach: localX=-8, localY=-4）
// - 尾巴接在身体右上（tail_attach: localX=8, localY=-3）
// - 四腿交替摆动 + 尾巴摇摆 + 身体起伏
// ============================================================

import type { BlueprintGraph, BlueprintNode } from '../ir';
import { num } from '../ir';

let idc = 0;
function nid(p: string): string {
  return `puppy_${p}_${(idc++).toString(36)}`;
}

/** 小狗骨架节点定义（侧面/W 向） */
export interface PuppyNodeDef {
  name: string;
  sockets: { name: string; localX: number; localY: number }[];
  plug: { socketName: string; localX: number; localY: number } | null;
  defaultAngle: number;
  zIndex: number;
}

export const PUPPY_RUN_WEST_NODES: PuppyNodeDef[] = [
  {
    name: 'body',
    sockets: [
      { name: 'head_attach', localX: -8, localY: -4 },  // 左上：头
      { name: 'tail_attach', localX: 8, localY: -3 },   // 右上：尾巴
      { name: 'front_leg', localX: -5, localY: 4 },     // 左下前腿
      { name: 'back_leg', localX: 5, localY: 4 },       // 右下后腿
    ],
    plug: null,
    defaultAngle: 0,
    zIndex: 5,
  },
  {
    name: 'head',
    sockets: [],
    plug: { socketName: 'head_attach', localX: 0, localY: 2 },
    defaultAngle: 0,
    zIndex: 10,
  },
  {
    name: 'tail',
    sockets: [],
    plug: { socketName: 'tail_attach', localX: 0, localY: 0 },
    defaultAngle: 25,  // 尾巴上翘
    zIndex: 4,
  },
  {
    name: 'front_leg',
    sockets: [],
    plug: { socketName: 'front_leg', localX: 0, localY: 0 },
    defaultAngle: 0,
    zIndex: 3,
  },
  {
    name: 'back_leg',
    sockets: [],
    plug: { socketName: 'back_leg', localX: 0, localY: 0 },
    defaultAngle: 0,
    zIndex: 3,
  },
];

/**
 * 奔跑蓝图：每条腿一个 pendulum，头尾身体各一个。
 * 相位：
 * - 前腿：0°
 * - 后腿：180°（对角步态）
 * - 尾巴：90°（摇摆）
 * - 身体：上下起伏（float）
 */
export function createPuppyRunBlueprint(): Record<string, BlueprintGraph> {
  const graphs: Record<string, BlueprintGraph> = {};

  // 通用：time 节点
  function makeTime(nodes: BlueprintNode[]): string {
    const id = nid('time');
    nodes.push({ id, type: 'time', inputs: {}, params: {} });
    return id;
  }

  // 前腿：pendulum, amplitude=25, period=12, phase=0
  {
    const nodes: BlueprintNode[] = [];
    const timeId = makeTime(nodes);
    const pendId = nid('pendulum');
    nodes.push({
      id: pendId,
      type: 'pendulum',
      inputs: { t: { nodeId: timeId } },
      params: { amplitude: 25, period: 12, phase: 0 },
    });
    const outId = nid('transform');
    nodes.push({
      id: outId,
      type: 'transform',
      inputs: { rotation: { nodeId: pendId, output: 'out' } },
      params: {},
    });
    graphs['front_leg'] = { version: 1, nodes, outputId: outId };
  }

  // 后腿：pendulum, amplitude=25, period=12, phase=180（反相）
  {
    const nodes: BlueprintNode[] = [];
    const timeId = makeTime(nodes);
    const pendId = nid('pendulum');
    nodes.push({
      id: pendId,
      type: 'pendulum',
      inputs: { t: { nodeId: timeId } },
      params: { amplitude: 25, period: 12, phase: 180 },
    });
    const outId = nid('transform');
    nodes.push({
      id: outId,
      type: 'transform',
      inputs: { rotation: { nodeId: pendId, output: 'out' } },
      params: {},
    });
    graphs['back_leg'] = { version: 1, nodes, outputId: outId };
  }

  // 尾巴：pendulum, amplitude=15, period=8, phase=90（快速摇摆）
  {
    const nodes: BlueprintNode[] = [];
    const timeId = makeTime(nodes);
    const pendId = nid('pendulum');
    nodes.push({
      id: pendId,
      type: 'pendulum',
      inputs: { t: { nodeId: timeId } },
      params: { amplitude: 15, period: 8, phase: 90 },
    });
    const outId = nid('transform');
    nodes.push({
      id: outId,
      type: 'transform',
      inputs: { rotation: { nodeId: pendId, output: 'out' } },
      params: {},
    });
    graphs['tail'] = { version: 1, nodes, outputId: outId };
  }

  // 身体：float, amplitude=2, period=12（上下起伏）
  {
    const nodes: BlueprintNode[] = [];
    const timeId = makeTime(nodes);
    const floatId = nid('float');
    nodes.push({
      id: floatId,
      type: 'float',
      inputs: { t: { nodeId: timeId } },
      params: { amplitude: 2, period: 12 },
    });
    const outId = nid('transform');
    nodes.push({
      id: outId,
      type: 'transform',
      inputs: { translateY: { nodeId: floatId, output: 'out' } },
      params: {},
    });
    graphs['body'] = { version: 1, nodes, outputId: outId };
  }

  // 头：轻微点动，pendulum amplitude=5, period=12, phase=45
  {
    const nodes: BlueprintNode[] = [];
    const timeId = makeTime(nodes);
    const pendId = nid('pendulum');
    nodes.push({
      id: pendId,
      type: 'pendulum',
      inputs: { t: { nodeId: timeId } },
      params: { amplitude: 5, period: 12, phase: 45 },
    });
    const outId = nid('transform');
    nodes.push({
      id: outId,
      type: 'transform',
      inputs: { rotation: { nodeId: pendId, output: 'out' } },
      params: {},
    });
    graphs['head'] = { version: 1, nodes, outputId: outId };
  }

  return graphs;
}
