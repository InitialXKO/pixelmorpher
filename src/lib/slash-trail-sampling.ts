// ============================================================
// 刀光轨迹采样（编辑器侧共用）：轨迹模式（SlashFanSpec.mode ===
// 'trail'）下，在片段窗 / 表演时长内逐点采样锚点与尖端节点的
// 世界位，组成 SlashTrailSample[] 喂给 slash-trail.ts 的
// generateTrailFrame。
//
// 坐标口径：样本点是投影后的画布平面 px 坐标（projectToView +
// subToPx），以画布中心为原点——与扇面定格位姿在 unified-render
// 里落到 slashFx.worldX/worldY 前的同一空间（只差画布中心平移，
// 布局与 plug 按样本自身导出、与平移无关）。投影朝向取采样窗
// 起始帧根节点的朝向（与扇面「起始帧定格」的口径一致：整条轨迹
// 冻在起始帧的观察平面里，角色中途转身不扭曲已采的路径）。
//
// 取位函数由调用方注入（worldTransformsAt）：主画布计划传它当帧
// 的变量/蓝图上下文（与扇面定格同源）；面板预览传裸的
// computeWorldTransforms（其内部按帧自建上下文兜底）。采样帧可
// 以是分数帧（窗内均匀铺点），插值口径与主渲染一致。
//
// 任一采样点上锚点或尖端缺位姿（节点不存在/被剔除）→ 整条轨迹
// 无效、返回 null；调用方据此不出轨迹（不回落扇面）。
// ============================================================

import type { Character, DirectionIndex } from './unified-types';
import { projectToView, subToPx } from './unified-types';
import type { WorldTransform } from './unified-render';
import type { SlashFanSpec } from './slash-fan';
import type { SlashTrailSample } from './slash-trail';

export interface SlashTrailSamplingArgs {
  character: Character;
  spec: SlashFanSpec;
  /** 采样窗起始帧（片段 = startFrame；表演预览以 0 为起点、按本地帧号映射） */
  startFrame: number;
  /** 采样窗长度（帧，可为分数：durationSec × frameRate） */
  durFrames: number;
  /** 取某帧世界变换表（调用方注入，见文件头） */
  worldTransformsAt: (frame: number) => Map<string, WorldTransform>;
}

export function sampleSlashTrail(args: SlashTrailSamplingArgs): SlashTrailSample[] | null {
  const { character, spec, startFrame, durFrames, worldTransformsAt } = args;
  const anchorId = spec.anchorNodeId;
  const tipId = spec.tipNodeId;
  if (!tipId || !character.nodes[anchorId] || !character.nodes[tipId]) return null;
  const dur = Math.max(0.01, durFrames);
  // 采样数：帧数（生成帧数与窗帧数取大）钳在 [2, 48]
  const count = Math.min(48, Math.max(2, Math.round(spec.frameCount || 6), Math.round(dur)));
  const spawn = worldTransformsAt(startFrame);
  if (!spawn.get(anchorId) || !spawn.get(tipId)) return null;
  // 投影朝向定格在起始帧（根节点当帧朝向）
  const dir = (spawn.get(character.rootNodeId)?.variantIndex ?? 0) as DirectionIndex;
  const out: SlashTrailSample[] = [];
  for (let i = 0; i < count; i++) {
    const f = startFrame + (dur * i) / (count - 1);
    const ts = i === 0 ? spawn : worldTransformsAt(f);
    const a = ts.get(anchorId);
    const b = ts.get(tipId);
    if (!a || !b) return null;
    const pa = projectToView(a.worldX, a.worldY, a.worldZ, dir);
    const pb = projectToView(b.worldX, b.worldY, b.worldZ, dir);
    out.push({
      ax: subToPx(pa.canvasX), ay: subToPx(pa.canvasY),
      bx: subToPx(pb.canvasX), by: subToPx(pb.canvasY),
    });
  }
  return out;
}
