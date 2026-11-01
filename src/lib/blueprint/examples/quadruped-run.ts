// ============================================================
// 蓝图模板：四足奔跑（通用）
// 不是绑死某个角色的节点，而是定义"奔跑"的动画逻辑。
// 使用时把模板的占位（slot）映射到实际节点的 ID。
//
// 占位：
// - frontLegs: string[]  前腿节点 ID 列表
// - backLegs: string[]   后腿节点 ID 列表
// - tail?: string        尾巴节点 ID（可选）
// - body?: string        身体节点 ID（可选）
// - head?: string        头节点 ID（可选）
// ============================================================

import type { BlueprintGraph, BlueprintNode } from '../ir';
import { generateDefaultCostumeSprite } from '@/lib/engine/default-costume-sprites';
import { DOG_TEMPLATE } from '@/components/pixel-editor/PuppetCreationWizard';
import type { TemplateNodeDef } from '@/components/pixel-editor/PuppetCreationWizard';
import { useProjectStore } from '@/lib/store';
import type { PuppetSessionState } from '@/lib/puppet-session-store';
import {
  pxToSub,
  createDefaultCostumeSet,
  createDefaultCostumePiece,
  createDefaultNode,
} from '@/lib/unified-types';
import type { Sprite, Socket, Attachment } from '@/lib/unified-types';

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
  /** 步态周期（秒） */
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
 * 生成四足奔跑蓝图：每个占位一个图。
 * 返回 Map<nodeId, BlueprintGraph>，直接赋给对应节点的 blueprint 字段。
 */
export function createQuadrupedRunBlueprint(
  slots: QuadrupedRunSlots,
  params: QuadrupedRunParams = {},
): Map<string, BlueprintGraph> {
  const {
    legAmplitude = 25,
    stridePeriod = 0.5,
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
      inputs: { [outputPort]: { nodeId: pendId, output: outputPort === 'rotation' ? 'outRotation' : 'outY' } },
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
      params: { height: amplitude, period },
    });
    const outId = nid('transform');
    nodes.push({
      id: outId,
      type: 'transform',
      inputs: { translateY: { nodeId: floatId, output: 'outY' } },
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

// ---- 小狗专用预设（占位映射示例） ----

/**
 * 侧向（朝西）小狗节点定义：复用 DOG_TEMPLATE 的 13 节点结构，
 * 只把身体插口调成侧面布局（头接左上、尾巴接右上、四腿横向排布）。
 * 其余属性（defaultAngle / crossSection / zIndex / plug 结构）全部沿用模板。
 * 单一可信源：createPuppyRunWestExample 与 createPuppyRunExampleCharacter 共用。
 */
export function getSideViewDogNodes(): TemplateNodeDef[] {
  const defs: TemplateNodeDef[] = DOG_TEMPLATE.nodes.map((n) => ({
    ...n,
    sockets: n.sockets.map((s) => ({ ...s })),
    plug: n.plug ? { ...n.plug } : null,
  }));
  // 身体 20x12，pivot 在 (10,5)
  const SIDE_VIEW_SOCKETS: Record<string, { localX: number; localY: number }> = {
    head_attach: { localX: -8, localY: -3 }, // 头接身体左上
    tail_attach: { localX: 7, localY: -1 },  // 尾巴接身体右上
    front_leg_L: { localX: -5, localY: 3 },
    front_leg_R: { localX: -3, localY: 3 },
    back_leg_L: { localX: 3, localY: 3 },
    back_leg_R: { localX: 5, localY: 3 },
  };
  const bodyDef = defs.find((d) => d.name === 'body');
  if (bodyDef) {
    for (const sock of bodyDef.sockets) {
      const override = SIDE_VIEW_SOCKETS[sock.name];
      if (override) {
        sock.localX = override.localX;
        sock.localY = override.localY;
      }
    }
  }
  return defs;
}

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
  const nodes = getSideViewDogNodes().map((d) => ({
    name: d.name,
    sockets: d.sockets,
    plug: d.plug,
  }));

  const blueprints = createQuadrupedRunBlueprint({
    frontLegs: ['front_upper_leg_L', 'front_upper_leg_R'],
    backLegs: ['back_upper_leg_L', 'back_upper_leg_R'],
    frontLowerLegs: ['front_lower_leg_L', 'front_lower_leg_R'],
    backLowerLegs: ['back_lower_leg_L', 'back_lower_leg_R'],
    tail: 'tail',
    body: 'body',
    head: 'head',
  });

  return { nodes, blueprints };
}

/**
 * 一键创建小狗奔跑示例：复用 DOG_TEMPLATE 的 13 节点结构（侧向/W），
 * 建 Character + 13 张精灵（sprites 表）+ 默认服装集 + 挂四足奔跑蓝图。
 * 在没有角色时调用，用户点一下就能看到小狗跑。
 * 精灵来自 src/lib/engine/default-costume-sprites.ts 的狗模板
 * （generateDefaultCostumeSprite 内部对节点名做 toLowerCase，
 *  模板的大写 L/R 命名可直接当精灵 key 用）。
 *
 * 新模型：直接写 unifiedCharacters，不再经 Part/PuppetSkeleton。
 */
export function createPuppyRunExampleCharacter(
  useProjectStoreHook: typeof useProjectStore,
  sessionStore: PuppetSessionState,
): string | null {
  try {
    const store = useProjectStoreHook.getState();

    // 1. 建 Character（新模型真相源），跳过占位 root（小狗的 body 才是真正的根）
    const character = store.addUnifiedCharacter('小狗（奔跑示例）', { skipPlaceholderRoot: true });
    const characterId = character.id;

    // 2. 节点定义：复用 DOG_TEMPLATE（侧向版），配置全部来自模板
    const defs = getSideViewDogNodes();

    // 3. 预生成节点 ID 与 socket ID（一次遍历确定父子关系，无需第二遍修正）
    const nodeIds: Record<string, string> = {};
    const socketIds: Record<string, string> = {};
    for (const def of defs) {
      nodeIds[def.name] = `dog_node_${def.name}`;
      for (const sock of def.sockets) {
        socketIds[`${def.name}:${sock.name}`] = `dog_socket_${def.name}_${sock.name}`;
      }
    }
    // 找父节点 def：谁的 sockets 里有名为 def.plug.socketName 的 socket
    const findParentDef = (def: TemplateNodeDef): TemplateNodeDef | undefined => {
      if (!def.plug) return undefined;
      return defs.find((d) => d.sockets.some((s) => s.name === def.plug!.socketName));
    };

    // 4. 为每个节点生成精灵 → 存 sprites 表 → 建 Node
    const spritesTable: Record<string, Sprite> = {};
    // Build nodes in memory (old way) — no store.addUnifiedNode loop
    const nodes: Record<string, any> = {};
    const childMap: Record<string, string[]> = {};
    const costumePieces: Record<string, any> = {};
    console.log('[一键小狗] 开始创建节点，共', defs.length, '个:', defs.map((d) => d.name));
    for (const def of defs) {
      const sprite = generateDefaultCostumeSprite(def.name, 'dog');
      const spriteId = `dog_sprite_${def.name}`;
      spritesTable[spriteId] = {
        width: sprite.width,
        height: sprite.height,
        data: sprite.pixels,
        plug: { x: pxToSub(sprite.pivotX), y: pxToSub(sprite.pivotY) },
      };

      // sockets：模板 localX/localY → basePosition（SubPixel）
      const sockets: Socket[] = def.sockets.map((s) => ({
        id: socketIds[`${def.name}:${s.name}`]!,
        name: s.name,
        basePosition: { x: pxToSub(s.localX), y: pxToSub(s.localY) },
        directionOffsets: {},
      }));

      // attachment：有 plug → socket 模式；无 plug（body）→ fixed 根节点
      const parentDef = findParentDef(def);
      let attachment: Attachment;
      let parentId: string | undefined;
      if (def.plug && parentDef) {
        const socketId = socketIds[`${parentDef.name}:${def.plug.socketName}`]!;
        parentId = nodeIds[parentDef.name];
        attachment = {
          type: 'socket',
          parentSocketId: socketId,
          plug: { x: pxToSub(def.plug.localX), y: pxToSub(def.plug.localY) },
        };
      } else {
        attachment = {
          type: 'fixed',
          fixedOffset: { x: 0, y: 0 },
          inheritRotation: true,
        };
      }

      // Build node in memory (old way: no store.addUnifiedNode loop + re-read)
      const nodeId = nodeIds[def.name];
      const node = createDefaultNode(nodeId, def.name);
      const costumePiece = {
        ...createDefaultCostumePiece(def.name),
        sprites: { 0: { spriteId } },
      };
      Object.assign(node, {
        sockets,
        attachment,
        parentId,
        transform: {
          x: pxToSub(def.defaultOffsetX),
          y: pxToSub(def.defaultOffsetY),
          angle: def.defaultAngle,
          stretch: def.defaultStretch,
          variantIndex: 0,
        },
        zIndex: def.zIndex,
        visible: true,
        children: [], // filled below
        slot: costumePiece,
      });
      nodes[nodeId] = node;
      if (parentId) {
        if (!childMap[parentId]) childMap[parentId] = [];
        childMap[parentId].push(nodeId);
      }
      costumePieces[def.name] = costumePiece;
    }

    // Build children arrays, find root, build costume set — all from local data
    for (const [pid, childIds] of Object.entries(childMap)) {
      if (nodes[pid]) {
        nodes[pid].children = childIds;
      }
    }
    const rootNode = Object.values(nodes).find((n: any) => !n.parentId) as any;
    const costumeSetId = crypto.randomUUID();
    const newCostumeSet = createDefaultCostumeSet(costumeSetId, '默认服装');
    newCostumeSet.pieces = { ...costumePieces };

    // Single atomic write (old way: build in memory, write once)
    // Note: blueprints are attached to in-memory nodes BEFORE this write (see below)

    // 7. 挂蓝图（大腿 + 小腿 + 尾巴 + 身体 + 头）— 直接写内存 nodes，不调 updateUnifiedNode
    const blueprints = createQuadrupedRunBlueprint({
      frontLegs: [nodeIds['front_upper_leg_L']!, nodeIds['front_upper_leg_R']!],
      backLegs: [nodeIds['back_upper_leg_L']!, nodeIds['back_upper_leg_R']!],
      frontLowerLegs: [nodeIds['front_lower_leg_L']!, nodeIds['front_lower_leg_R']!],
      backLowerLegs: [nodeIds['back_lower_leg_L']!, nodeIds['back_lower_leg_R']!],
      tail: nodeIds['tail'],
      body: nodeIds['body'],
      head: nodeIds['head'],
    });
    for (const [nodeId, graph] of blueprints) {
      if (nodes[nodeId]) {
        nodes[nodeId].blueprint = graph;
      }
    }
    console.log('[一键小狗] 蓝图已挂载:', blueprints.size, '个节点');

    useProjectStore.getState().updateUnifiedCharacter(characterId, {
      nodes,
      rootNodeId: rootNode?.id ?? '',
      sprites: spritesTable,
      costumeSets: [newCostumeSet],
      activeCostumeSetId: costumeSetId,
    });

    // 8. 切到 perform
    sessionStore.enterPerform(characterId);

    return characterId;
  } catch (e) {
    console.error('[一键小狗] 创建失败:', e);
    return null;
  }
}
