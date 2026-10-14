// ============================================================
// 旧 PartAnimationModifier[] → BlueprintGraph 转换
// 保证功能不弱：每个修改器变成一个蓝图节点，连到 screen 输出
// 动画修改器 → 变换端口；像素修改器 → 像素链
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
  // 设计已改：像素形变也进蓝图（specs.ts 有定义），由像素管线执行
  const enabled = modifiers.filter((m) => m.enabled);
  if (enabled.length === 0) return null;

  const nodes: BlueprintNode[] = [];

  // time 源（所有时间相关节点共用）
  const timeId = nid('time');
  nodes.push({ id: timeId, type: 'time', inputs: {}, params: {} });

  // 像素源（统一：所有蓝图都有 sprite_source，screen 统一绘制）
  const sourceId = nid('sprite_source');
  nodes.push({ id: sourceId, type: 'sprite_source', inputs: {}, params: {} });
  let prevPixelsNodeId: string | null = sourceId;

  // 每个修改器一个节点
  // 端口累加器：port -> 已有节点输出（需要 add 时创建 add 节点）
  const portSources = new Map<string, { nodeId: string; output: string }>();

  function connectToPort(port: string, nodeId: string, output: string, blendMode: string = 'add', modParams: Record<string, any> = {}, gateId?: string): void {
    // 如果有时间门控，先用 mul 节点把输出乘以门控权重
    let srcNodeId = nodeId;
    let srcOutput = output;
    if (gateId) {
      const mulId = nid('mul');
      nodes.push({
        id: mulId,
        type: 'mul',
        inputs: {
          a: { nodeId, output },
          b: { nodeId: gateId, output: 'out' },
        },
        params: {},
      });
      srcNodeId = mulId;
      srcOutput = 'out';
    }
    
    const existing = portSources.get(port);
    if (!existing) {
      portSources.set(port, { nodeId: srcNodeId, output: srcOutput });
      return;
    }
    // 已有源 → 按 blendMode 建混合节点
    const blendId = nid('blend');
    const blendParams: Record<string, number | string | boolean> = { mode: blendMode };
    const blendInputs: import('./ir').BlueprintNode['inputs'] = {
      a: { nodeId: existing.nodeId, output: existing.output },
      b: { nodeId: srcNodeId, output: srcOutput },
    };
    if (blendMode === 'converge') {
      // converge 需要时间输入
      blendInputs.t = { nodeId: timeId };
      blendParams.convergeSpeed = Number(modParams.convergeSpeed ?? 0.5);
    }
    nodes.push({
      id: blendId,
      type: 'blend',
      inputs: blendInputs,
      params: blendParams,
    });
    portSources.set(port, { nodeId: blendId, output: 'out' });
  }

  for (const mod of enabled) {
    // 用 modifier.id 生成确定性节点 ID，方便参数同步时定位
    const modId = `mod_${mod.id.replace(/-/g, '').slice(0, 12)}`;
    const params: Record<string, import('../types').ModifierParamValue> = {};
    for (const [k, v] of Object.entries(mod.params)) {
      params[k] = v as import('../types').ModifierParamValue;
    }

    // 时间输入默认连 time
    const inputs: BlueprintNode['inputs'] = { t: { nodeId: timeId } };

    // 时间范围门控：如果有 startFrame/endFrame，建 timeGate 节点
    let gateId: string | undefined;
    const startF = (mod as any).startFrame;
    const endF = (mod as any).endFrame;
    if ((startF !== undefined && startF >= 0) || (endF !== undefined && endF >= 0)) {
      gateId = `gate_${modId}`;
      nodes.push({
        id: gateId,
        type: 'timeGate',
        inputs: { t: { nodeId: timeId } },
        params: {
          start: startF ?? -1,
          end: endF ?? -1,
          fadeIn: (mod as any).fadeInFrames ?? 0,
          fadeOut: (mod as any).fadeOutFrames ?? 0,
        },
      });
    }

    // 像素修改器：连 pixels 输入，形成像素链
    const isPixelMod = (PIXEL_DEFORM_MODIFIER_TYPES as string[]).includes(mod.type);
    if (isPixelMod && prevPixelsNodeId) {
      inputs.pixels = { nodeId: prevPixelsNodeId, output: 'pixels' };
    }
    // 像素修改器有时间范围 → 接 gate 输入，求值时按门控 bypass
    if (isPixelMod && gateId) {
      inputs.gate = { nodeId: gateId, output: 'out' };
    }

    // 参数驱动 → 波形节点：每个 paramDriver 生成一个 waveform 节点，连到对应参数输入
    // （蓝图原生：驱动是节点，不是字段）
    const paramDrivers = (mod as any).paramDrivers;
    if (paramDrivers && paramDrivers.length > 0) {
      for (const driver of paramDrivers) {
        if (!driver.enabled) continue;
        const driverId = `drv_${modId}_${driver.paramName}`;
        nodes.push({
          id: driverId,
          type: 'waveform',
          inputs: { t: { nodeId: timeId } },
          params: {
            waveform: driver.waveform ?? 'sine',
            amplitude: Number(driver.amplitude ?? 1),
            baseValue: Number(driver.baseValue ?? 0),
            endValue: Number(driver.endValue ?? 1),
            period: Number(driver.period ?? 30),
            phase: Number(driver.phase ?? 0),
            damping: Number(driver.damping ?? 0.1),
          },
        });
        // 连到修改器节点的参数输入（覆盖静态 params）
        inputs[driver.paramName] = { nodeId: driverId, output: 'out' };
        // 从静态 params 删除（避免混淆）
        delete params[driver.paramName];
      }
    }
    // paramKeyframes → keyframes 节点：每个有关键帧的参数生成一个节点
    const paramKeyframes = (mod as any).paramKeyframes;
    if (paramKeyframes && paramKeyframes.length > 0) {
      // 收集每个参数的关键帧轨道
      const tracks = new Map<string, { frame: number; value: number }[]>();
      for (const kf of paramKeyframes) {
        for (const [paramName, value] of Object.entries(kf.params as Record<string, unknown>)) {
          const numVal = Number(value);
          if (Number.isNaN(numVal)) continue; // 只处理数值参数
          if (!tracks.has(paramName)) tracks.set(paramName, []);
          tracks.get(paramName)!.push({ frame: kf.frame, value: numVal });
        }
      }
      for (const [paramName, track] of tracks) {
        const kfId = `kf_${modId}_${paramName}`;
        const frames = track.map(t => t.frame);
        const values = track.map(t => t.value);
        nodes.push({
          id: kfId,
          type: 'keyframes',
          inputs: { t: { nodeId: timeId } },
          params: {
            frames: JSON.stringify(frames),
            values: JSON.stringify(values),
            interpolation: 'linear',
          },
        });
        inputs[paramName] = { nodeId: kfId, output: 'out' };
        delete params[paramName];
      }
    }
    nodes.push({ id: modId, type: mod.type, inputs, params });

    // 像素修改器：更新像素链
    if (isPixelMod) {
      prevPixelsNodeId = modId;
      continue; // 不连到 transform 端口
    }

    // 按修改器类型连到 transform 的对应端口
    // （老系统里这些修改器产出 rotation/translate/scale）
    switch (mod.type) {
      case 'translate':
        connectToPort('translateX', modId, 'outX', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('translateY', modId, 'outY', mod.blendMode ?? 'add', mod.params, gateId);
        break;
      case 'rotate':
        connectToPort('rotation', modId, 'outRotation', mod.blendMode ?? 'add', mod.params, gateId);
        break;
      case 'uniform_scale':
        connectToPort('scaleX', modId, 'outScaleX', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('scaleY', modId, 'outScaleY', mod.blendMode ?? 'add', mod.params, gateId);
        break;
      case 'non_uniform_stretch':
        connectToPort('scaleX', modId, 'outScaleX', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('scaleY', modId, 'outScaleY', mod.blendMode ?? 'add', mod.params, gateId);
        break;
      case 'skew':
        connectToPort('skewX', modId, 'skewX', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('skewY', modId, 'skewY', mod.blendMode ?? 'add', mod.params, gateId);
        break;
      case 'pendulum':
        connectToPort('rotation', modId, 'out', mod.blendMode ?? 'add', mod.params, gateId);
        break;
      case 'wobble':
        // wobble 输出 rotation + translateX + translateY
        connectToPort('rotation', modId, 'outRotation', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('translateX', modId, 'outX', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('translateY', modId, 'outY', mod.blendMode ?? 'add', mod.params, gateId);
        break;
      case 'breath':
        // breath 输出 scale，拆到 scaleX/scaleY
        connectToPort('scaleX', modId, 'out', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('scaleY', modId, 'out', mod.blendMode ?? 'add', mod.params, gateId);
        break;
      case 'shake':
        connectToPort('translateX', modId, 'outX', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('translateY', modId, 'outY', mod.blendMode ?? 'add', mod.params, gateId);
        break;
      case 'float':
        // float 输出 translateY + rotation(tilt)
        connectToPort('translateY', modId, 'outY', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('rotation', modId, 'outRotation', mod.blendMode ?? 'add', mod.params, gateId);
        break;
      case 'bounce':
        connectToPort('translateY', modId, 'outY', mod.blendMode ?? 'add', mod.params, gateId);
        break;
      case 'wheel':
        connectToPort('translateX', modId, 'outX', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('translateY', modId, 'outY', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('rotation', modId, 'outRotation', mod.blendMode ?? 'add', mod.params, gateId);
        break;
      case 'elastic': {
        const axis = String(mod.params.axis ?? 'y');
        if (axis === 'x') connectToPort('translateX', modId, 'outX', mod.blendMode ?? 'add', mod.params, gateId);
        else if (axis === 'rotation') connectToPort('rotation', modId, 'outRotation', mod.blendMode ?? 'add', mod.params, gateId);
        else if (axis === 'scale') {
          connectToPort('scaleX', modId, 'outScaleX', mod.blendMode ?? 'add', mod.params, gateId);
          connectToPort('scaleY', modId, 'outScaleY', mod.blendMode ?? 'add', mod.params, gateId);
        } else connectToPort('translateY', modId, 'outY', mod.blendMode ?? 'add', mod.params, gateId);
        break;
      }
      case 'noise':
      case 'wave':
      case 'spring': {
        const target = String(mod.params.targetProperty ?? 'translateY');
        if (target === 'translateX') connectToPort('translateX', modId, 'outX', mod.blendMode ?? 'add', mod.params, gateId);
        else if (target === 'rotation') connectToPort('rotation', modId, 'outRotation', mod.blendMode ?? 'add', mod.params, gateId);
        else if (target === 'scaleX' || target === 'scaleY') connectToPort('scaleX', modId, 'outScale', mod.blendMode ?? 'add', mod.params, gateId);
        else connectToPort('translateY', modId, 'outY', mod.blendMode ?? 'add', mod.params, gateId);
        break;
      }
      case 'jitter':
        connectToPort('translateX', modId, 'outX', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('translateY', modId, 'outY', mod.blendMode ?? 'add', mod.params, gateId);
        break;
      case 'gait':
        connectToPort('translateX', modId, 'outX', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('translateY', modId, 'outY', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('rotation', modId, 'outRotation', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('scaleX', modId, 'outScaleX', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('scaleY', modId, 'outScaleY', mod.blendMode ?? 'add', mod.params, gateId);
        break;
      case 'path_move':
        connectToPort('translateX', modId, 'outX', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('translateY', modId, 'outY', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('rotation', modId, 'outRotation', mod.blendMode ?? 'add', mod.params, gateId);
        break;
      case 'expression':
        connectToPort('translateX', modId, 'outX', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('translateY', modId, 'outY', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('rotation', modId, 'outRotation', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('scaleX', modId, 'outScaleX', mod.blendMode ?? 'add', mod.params, gateId);
        connectToPort('scaleY', modId, 'outScaleY', mod.blendMode ?? 'add', mod.params, gateId);
        break;
      default:
        // 未知类型：尝试连 rotation（最通用）
        // 完整的 27 种类型映射在 eval.ts 里按需扩展
        connectToPort('rotation', modId, 'out', mod.blendMode ?? 'add', mod.params, gateId);
        break;
    }
  }

  // screen 输出节点（统一终点，返回变换数值）
  const screenId = nid('screen');
  const screenInputs: BlueprintNode['inputs'] = {};
  for (const [port, src] of portSources) {
    screenInputs[port] = { nodeId: src.nodeId, output: src.output };
  }
  // 像素链：screen 接收最终像素
  if (prevPixelsNodeId) {
    screenInputs.pixels = { nodeId: prevPixelsNodeId, output: 'pixels' };
  }
  nodes.push({ id: screenId, type: 'screen', inputs: screenInputs, params: {} });

  return { version: 1, nodes, outputId: screenId };
}

/**
 * 手术式：在已有蓝图中插入一个修改器节点（新节点串在 screen 之前）。
 * 保留现有图结构，只增量修改。
 */
function isInputRef(inp: import('./ir').BlueprintInput): inp is import('./ir').BlueprintInputRef {
  return typeof inp === 'object' && inp !== null && 'nodeId' in inp;
}

export function addModifierNodeToBlueprint(
  bp: import('./ir').BlueprintGraph,
  mod: import('../types').PartAnimationModifier,
): import('./ir').BlueprintGraph {
  const nodes = [...bp.nodes];
  const modId = `mod_${mod.id.replace(/-/g, '').slice(0, 12)}`;
  
  // 已存在则先删除（避免重复）
  const existingIdx = nodes.findIndex(n => n.id === modId);
  if (existingIdx >= 0) nodes.splice(existingIdx, 1);
  
  // 找 time 和 screen 节点
  const timeNode = nodes.find(n => n.type === 'time');
  const screenNode = nodes.find(n => n.type === 'screen');
  if (!timeNode || !screenNode) return bp;
  
  const timeId = timeNode.id;
  const params: Record<string, import('../types').ModifierParamValue> = { enabled: mod.enabled !== false };
  for (const [k, v] of Object.entries(mod.params)) {
    params[k] = v as import('../types').ModifierParamValue;
  }

  // 时间范围门控
  let gateId: string | undefined;
  const startF = (mod as any).startFrame;
  const endF = (mod as any).endFrame;
  if ((startF !== undefined && startF >= 0) || (endF !== undefined && endF >= 0)) {
    gateId = `gate_${modId}`;
    // 避免重复
    if (!nodes.find(n => n.id === gateId)) {
      nodes.push({
        id: gateId,
        type: 'timeGate',
        inputs: { t: { nodeId: timeId } },
        params: {
          start: startF ?? -1,
          end: endF ?? -1,
          fadeIn: (mod as any).fadeInFrames ?? 0,
          fadeOut: (mod as any).fadeOutFrames ?? 0,
        },
      });
    }
  }
  
  const inputs: import('./ir').BlueprintNode['inputs'] = { t: { nodeId: timeId } };
  const isPixelMod = (PIXEL_DEFORM_MODIFIER_TYPES as string[]).includes(mod.type);
  // 像素修改器有时间范围 → 接 gate 输入
  if (isPixelMod && gateId) {
    inputs.gate = { nodeId: gateId, output: 'out' };
  }
  
  if (isPixelMod) {
    // 像素链：找到当前连到 screen.pixels 的节点，插到它和 screen 之间
    const screenPixelsInput = screenNode.inputs.pixels;
    const prevId = (screenPixelsInput && isInputRef(screenPixelsInput)) ? screenPixelsInput.nodeId : null;
    // 找到 sprite_source 或上一个像素节点
    const prevNode = prevId ? nodes.find(n => n.id === prevId) : nodes.find(n => n.type === 'sprite_source');
    if (prevNode) {
      inputs.pixels = { nodeId: prevNode.id, output: 'pixels' };
    }
    // 参数驱动 → 波形节点
    const pdr1 = (mod as any).paramDrivers;
    if (pdr1 && pdr1.length > 0) {
      for (const driver of pdr1) {
        if (!driver.enabled) continue;
        const driverId = `drv_${modId}_${driver.paramName}`;
        if (!nodes.find(n => n.id === driverId)) {
          nodes.push({
            id: driverId,
            type: 'waveform',
            inputs: { t: { nodeId: timeId } },
            params: {
              waveform: driver.waveform ?? 'sine',
              amplitude: Number(driver.amplitude ?? 1),
              baseValue: Number(driver.baseValue ?? 0),
              endValue: Number(driver.endValue ?? 1),
              period: Number(driver.period ?? 30),
              phase: Number(driver.phase ?? 0),
              damping: Number(driver.damping ?? 0.1),
            },
          });
        }
        inputs[driver.paramName] = { nodeId: driverId, output: 'out' };
        delete params[driver.paramName];
      }
    }
    // paramKeyframes → keyframes 节点
    const pkf1 = (mod as any).paramKeyframes;
    if (pkf1 && pkf1.length > 0) {
      const tracks = new Map<string, { frame: number; value: number }[]>();
      for (const kf of pkf1) {
        for (const [paramName, value] of Object.entries(kf.params as Record<string, unknown>)) {
          const numVal = Number(value);
          if (Number.isNaN(numVal)) continue;
          if (!tracks.has(paramName)) tracks.set(paramName, []);
          tracks.get(paramName)!.push({ frame: kf.frame, value: numVal });
        }
      }
      for (const [paramName, track] of tracks) {
        const kfId = `kf_${modId}_${paramName}`;
        if (!nodes.find(n => n.id === kfId)) {
          nodes.push({
            id: kfId,
            type: 'keyframes',
            inputs: { t: { nodeId: timeId } },
            params: {
              frames: JSON.stringify(track.map(t => t.frame)),
              values: JSON.stringify(track.map(t => t.value)),
              interpolation: 'linear',
            },
          });
        }
        inputs[paramName] = { nodeId: kfId, output: 'out' };
        delete params[paramName];
      }
    }
    const pixelNodeDef: import('./ir').BlueprintNode = { id: modId, type: mod.type, inputs, params };
    nodes.push(pixelNodeDef);
    // 更新 screen.pixels 指向新节点
    const newScreen = {
      ...screenNode,
      inputs: { ...screenNode.inputs, pixels: { nodeId: modId, output: 'pixels' } },
    };
    const si = nodes.findIndex(n => n.id === screenNode.id);
    nodes[si] = newScreen;
  } else {
    // 变换类：连到 screen 的对应端口（端口已有源则按 blendMode 建混合节点）
    // 参数驱动 → 波形节点
    const pdr2 = (mod as any).paramDrivers;
    if (pdr2 && pdr2.length > 0) {
      for (const driver of pdr2) {
        if (!driver.enabled) continue;
        const driverId = `drv_${modId}_${driver.paramName}`;
        if (!nodes.find(n => n.id === driverId)) {
          nodes.push({
            id: driverId,
            type: 'waveform',
            inputs: { t: { nodeId: timeId } },
            params: {
              waveform: driver.waveform ?? 'sine',
              amplitude: Number(driver.amplitude ?? 1),
              baseValue: Number(driver.baseValue ?? 0),
              endValue: Number(driver.endValue ?? 1),
              period: Number(driver.period ?? 30),
              phase: Number(driver.phase ?? 0),
              damping: Number(driver.damping ?? 0.1),
            },
          });
        }
        inputs[driver.paramName] = { nodeId: driverId, output: 'out' };
        delete params[driver.paramName];
      }
    }
    // paramKeyframes → keyframes 节点
    const pkf2 = (mod as any).paramKeyframes;
    if (pkf2 && pkf2.length > 0) {
      const tracks = new Map<string, { frame: number; value: number }[]>();
      for (const kf of pkf2) {
        for (const [paramName, value] of Object.entries(kf.params as Record<string, unknown>)) {
          const numVal = Number(value);
          if (Number.isNaN(numVal)) continue;
          if (!tracks.has(paramName)) tracks.set(paramName, []);
          tracks.get(paramName)!.push({ frame: kf.frame, value: numVal });
        }
      }
      for (const [paramName, track] of tracks) {
        const kfId = `kf_${modId}_${paramName}`;
        if (!nodes.find(n => n.id === kfId)) {
          nodes.push({
            id: kfId,
            type: 'keyframes',
            inputs: { t: { nodeId: timeId } },
            params: {
              frames: JSON.stringify(track.map(t => t.frame)),
              values: JSON.stringify(track.map(t => t.value)),
              interpolation: 'linear',
            },
          });
        }
        inputs[paramName] = { nodeId: kfId, output: 'out' };
        delete params[paramName];
      }
    }
    const xformNodeDef: import('./ir').BlueprintNode = { id: modId, type: mod.type, inputs, params };
    nodes.push(xformNodeDef);
    const newScreenInputs = { ...screenNode.inputs };
    const blendMode = (mod as any).blendMode ?? 'add';
    
    const connectPort = (port: string, output: string) => {
      // 有时间门控 → 先用 mul 把输出乘以门控权重
      let srcNodeId = modId;
      let srcOutput = output;
      if (gateId) {
        const mulId = `mul_${modId}_${port}`;
        if (!nodes.find(n => n.id === mulId)) {
          nodes.push({
            id: mulId,
            type: 'mul',
            inputs: {
              a: { nodeId: modId, output },
              b: { nodeId: gateId, output: 'out' },
            },
            params: {},
          });
        }
        srcNodeId = mulId;
        srcOutput = 'out';
      }
      
      const existing = newScreenInputs[port];
      if (!existing || !isInputRef(existing)) {
        newScreenInputs[port] = { nodeId: srcNodeId, output: srcOutput };
      } else {
        // 已有源 → 按 blendMode 建混合节点
        const blendId = `blend_${modId}_${port}`;
        const blendParams: Record<string, number | string | boolean> = { mode: blendMode };
        const blendInputs: import('./ir').BlueprintNode['inputs'] = {
          a: { nodeId: existing.nodeId, output: existing.output ?? 'out' },
          b: { nodeId: srcNodeId, output: srcOutput },
        };
        if (blendMode === 'converge') {
          const timeN = nodes.find(n => n.type === 'time');
          if (timeN) blendInputs.t = { nodeId: timeN.id };
          blendParams.convergeSpeed = Number((mod.params as any)?.convergeSpeed ?? 0.5);
        }
        nodes.push({
          id: blendId,
          type: 'blend',
          inputs: blendInputs,
          params: blendParams,
        });
        newScreenInputs[port] = { nodeId: blendId, output: 'out' };
      }
    };
    
    // 按类型连端口（与 modifiersToBlueprint 的 switch 一致）
    switch (mod.type) {
      case 'translate':
        connectPort('translateX', 'outX');
        connectPort('translateY', 'outY');
        break;
      case 'rotate':
        connectPort('rotation', 'outRotation');
        break;
      case 'uniform_scale':
      case 'non_uniform_stretch':
        connectPort('scaleX', 'outScaleX');
        connectPort('scaleY', 'outScaleY');
        break;
      case 'skew':
        connectPort('skewX', 'skewX');
        connectPort('skewY', 'skewY');
        break;
      case 'pendulum': connectPort('rotation', 'out'); break;
      case 'wobble':
        connectPort('rotation', 'outRotation');
        connectPort('translateX', 'outX');
        connectPort('translateY', 'outY');
        break;
      case 'breath':
        connectPort('scaleX', 'out');
        connectPort('scaleY', 'out');
        break;
      case 'shake':
        connectPort('translateX', 'outX');
        connectPort('translateY', 'outY');
        break;
      case 'float':
        connectPort('translateY', 'outY');
        connectPort('rotation', 'outRotation');
        break;
      case 'bounce': connectPort('translateY', 'outY'); break;
      case 'wheel':
        connectPort('translateX', 'outX');
        connectPort('translateY', 'outY');
        connectPort('rotation', 'outRotation');
        break;
      default: connectPort('rotation', 'out'); break;
    }
    
    const si = nodes.findIndex(n => n.id === screenNode.id);
    nodes[si] = { ...screenNode, inputs: newScreenInputs };
  }
  
  return { ...bp, nodes };
}

/**
 * 手术式：从蓝图中删除一个修改器节点，修复连接链。
 */
export function removeModifierNodeFromBlueprint(
  bp: import('./ir').BlueprintGraph,
  modifierId: string,
): import('./ir').BlueprintGraph {
  const targetId = `mod_${modifierId.replace(/-/g, '').slice(0, 12)}`;
  let nodes = bp.nodes.filter(n => n.id !== targetId);
  // 删除相关的辅助节点（blend/mul/gate，加 add_ 兼容旧数据）
  nodes = nodes.filter(n => {
    const isAux = n.type === 'blend' || n.type === 'add' || n.type === 'mul' || n.type === 'timeGate' || n.type === 'waveform' || n.type === 'keyframes';
    const matches = n.id.startsWith(`blend_${targetId}`) || n.id.startsWith(`add_${targetId}`) ||
                    n.id.startsWith(`mul_${targetId}`) || n.id === `gate_${targetId}` ||
                    n.id.startsWith(`drv_${targetId}_`) || n.id.startsWith(`kf_${targetId}_`);
    return !(isAux && matches);
  });
  
  const screenNode = nodes.find(n => n.type === 'screen');
  if (!screenNode) return { ...bp, nodes };
  
  const newScreenInputs = { ...screenNode.inputs };
  let changed = false;
  
  // 修复 pixels 链：如果 screen.pixels 指向被删节点，找到它的上游
  const pixelsInput = newScreenInputs.pixels;
  if (pixelsInput && isInputRef(pixelsInput) && pixelsInput.nodeId === targetId) {
    // 被删节点的 pixels 输入源
    const deletedNode = bp.nodes.find(n => n.id === targetId);
    const upstream = deletedNode?.inputs?.pixels;
    if (upstream && isInputRef(upstream)) {
      newScreenInputs.pixels = { nodeId: upstream.nodeId, output: 'pixels' };
    } else {
      // 没有上游，找 sprite_source
      const src = nodes.find(n => n.type === 'sprite_source');
      if (src) {
        newScreenInputs.pixels = { nodeId: src.id, output: 'pixels' };
      } else {
        delete newScreenInputs.pixels;
      }
    }
    changed = true;
  }
  
  // 修复 transform 端口：如果某端口指向被删节点或其 add 节点，尝试找替代
  // 简化处理：删除指向被删节点的连接（add 节点已删，残留的单输入 add 需要清理）
  for (const [port, input] of Object.entries(newScreenInputs)) {
    if (port === 'pixels') continue;
    if (!isInputRef(input)) continue;
    const inp = input;
    if (inp.nodeId === targetId || inp.nodeId.startsWith(`blend_${targetId}`) || inp.nodeId.startsWith(`add_${targetId}`)) {
      delete newScreenInputs[port];
      changed = true;
      continue;
    }
    // 如果指向的 blend/add 节点已被删除，需要处理
    const blendNode = nodes.find(n => n.id === inp.nodeId);
    if (!blendNode && (inp.nodeId.startsWith('blend_') || inp.nodeId.startsWith('add_'))) {
      delete newScreenInputs[port];
      changed = true;
    }
  }
  
  if (changed) {
    const si = nodes.findIndex(n => n.id === screenNode.id);
    nodes[si] = { ...screenNode, inputs: newScreenInputs };
  }
  
  return { ...bp, nodes };
}
