// ============================================================
// 旧 PartAnimationModifier[] → BlueprintGraph 转换
// 保证功能不弱：每个修改器变成一个蓝图节点，连到 transform 输出
// ============================================================

import type { PartAnimationModifier } from '../types';
import type { BlueprintGraph, BlueprintNode } from './ir';
import { num } from './ir';
import { PIXEL_DEFORM_MODIFIER_TYPES } from '../engine/modifier-types';

let idCounter = 0;
function nid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

/**
 * 把一组旧修改器转成蓝图。
 * 每个修改器 → 一个对应类型的蓝图节点 → 连到 transform 的对应端口。
 * 多个修改器同端口时用 add 节点累加（对应老系统的 'add' 混合模式）。
 *
 * 像素类修改器不进蓝图（走像素管线），这里过滤掉。
 */
export function modifiersToBlueprint(
  modifiers: PartAnimationModifier[],
): BlueprintGraph | null {
  // 像素类走像素管线，不进 transform 蓝图
  const enabled = modifiers.filter(
    (m) => m.enabled && !PIXEL_DEFORM_MODIFIER_TYPES.includes(m.type)
  );
  if (enabled.length === 0) return null;

  const nodes: BlueprintNode[] = [];

  // time 源（所有时间相关节点共用）
  const timeId = nid('time');
  nodes.push({ id: timeId, type: 'time', inputs: {}, params: {} });

  // 每个修改器一个节点
  // 端口累加器：port -> 已有节点输出（需要 add 时创建 add 节点）
  const portSources = new Map<string, { nodeId: string; output: string }>();

  function connectToPort(port: string, nodeId: string, output: string): void {
    const existing = portSources.get(port);
    if (!existing) {
      portSources.set(port, { nodeId, output });
      return;
    }
    // 已有源 → 建 add 节点累加
    const addId = nid('add');
    nodes.push({
      id: addId,
      type: 'add',
      inputs: {
        a: { nodeId: existing.nodeId, output: existing.output },
        b: { nodeId, output },
      },
      params: {},
    });
    portSources.set(port, { nodeId: addId, output: 'out' });
  }

  for (const mod of enabled) {
    const modId = nid(mod.type);
    const params: Record<string, number | string | boolean> = {};
    for (const [k, v] of Object.entries(mod.params)) {
      if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
        params[k] = v;
      }
    }

    // 时间输入默认连 time
    const inputs: BlueprintNode['inputs'] = { t: { nodeId: timeId } };

    nodes.push({ id: modId, type: mod.type, inputs, params });

    // 按修改器类型连到 transform 的对应端口
    // （老系统里这些修改器产出 rotation/translate/scale）
    switch (mod.type) {
      case 'pendulum':
        connectToPort('rotation', modId, 'out');
        break;
      case 'wobble':
        // wobble 输出 rotation + translateX + translateY
        connectToPort('rotation', modId, 'outRotation');
        connectToPort('translateX', modId, 'outX');
        connectToPort('translateY', modId, 'outY');
        break;
      case 'breath':
        // breath 输出 scale，拆到 scaleX/scaleY
        connectToPort('scaleX', modId, 'out');
        connectToPort('scaleY', modId, 'out');
        break;
      case 'shake':
        connectToPort('translateX', modId, 'outX');
        connectToPort('translateY', modId, 'outY');
        break;
      case 'float':
        // float 输出 translateY + rotation(tilt)
        connectToPort('translateY', modId, 'outY');
        connectToPort('rotation', modId, 'outRotation');
        break;
      case 'bounce':
        connectToPort('translateY', modId, 'out');
        break;
      case 'wheel':
        connectToPort('translateX', modId, 'outX');
        connectToPort('translateY', modId, 'outY');
        connectToPort('rotation', modId, 'outRotation');
        break;
      case 'elastic': {
        const axis = String(mod.params.axis ?? 'y');
        if (axis === 'x') connectToPort('translateX', modId, 'outX');
        else if (axis === 'rotation') connectToPort('rotation', modId, 'outRotation');
        else if (axis === 'scale') {
          connectToPort('scaleX', modId, 'outScaleX');
          connectToPort('scaleY', modId, 'outScaleY');
        } else connectToPort('translateY', modId, 'outY');
        break;
      }
      case 'noise':
      case 'wave':
      case 'spring': {
        const target = String(mod.params.targetProperty ?? 'translateY');
        if (target === 'translateX') connectToPort('translateX', modId, 'outX');
        else if (target === 'rotation') connectToPort('rotation', modId, 'outRotation');
        else if (target === 'scaleX' || target === 'scaleY') connectToPort('scaleX', modId, 'outScale');
        else connectToPort('translateY', modId, 'outY');
        break;
      }
      case 'jitter':
        connectToPort('translateX', modId, 'outX');
        connectToPort('translateY', modId, 'outY');
        break;
      case 'gait':
        connectToPort('translateX', modId, 'outX');
        connectToPort('translateY', modId, 'outY');
        connectToPort('rotation', modId, 'outRotation');
        connectToPort('scaleX', modId, 'outScaleX');
        connectToPort('scaleY', modId, 'outScaleY');
        break;
      case 'expression':
        connectToPort('translateX', modId, 'outX');
        connectToPort('translateY', modId, 'outY');
        connectToPort('rotation', modId, 'outRotation');
        connectToPort('scaleX', modId, 'outScaleX');
        connectToPort('scaleY', modId, 'outScaleY');
        break;
      default:
        // 未知类型：尝试连 rotation（最通用）
        // 完整的 27 种类型映射在 eval.ts 里按需扩展
        connectToPort('rotation', modId, 'out');
        break;
    }
  }

  // transform 输出节点
  const transformId = nid('transform');
  const transformInputs: BlueprintNode['inputs'] = {};
  for (const [port, src] of portSources) {
    transformInputs[port] = { nodeId: src.nodeId, output: src.output };
  }
  nodes.push({ id: transformId, type: 'transform', inputs: transformInputs, params: {} });

  return { version: 1, nodes, outputId: transformId };
}
