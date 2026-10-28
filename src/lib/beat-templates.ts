// ============================================================
// PixelMorpher - 动作节拍模板（借鉴 2dimg2motion 的 8 类动作节拍表，MIT）
// ============================================================
// 节拍 = 一个动作在时间上的阶段划分（预备→接触→跟随→回收这类
// 动画规律）。模板只管「何时发生什么阶段」，不管姿势本身：套用
// 到片段后，把片段窗按节拍权重切成一串帧标签（FrameTag，本项目
// 既有结构、供时间轴与状态机消费），并按模板设定片段循环属性。
// 标签是普通数据，套用后可在 DCC 面板里继续改名、改界、改色。
// 权重是编辑缺省值（来源表只给节拍序、不给数值），按动画常识配。
// ============================================================

import type { FrameTag } from './types';

export interface BeatPhase {
  /** 稳定标识（英文，与来源节拍名对应） */
  key: string;
  /** 显示名 */
  name: string;
  /** 相对时长权重（正整数） */
  weight: number;
  /** 帧标签颜色 */
  color: string;
}

export interface BeatTemplate {
  id: string;
  /** 动作类型显示名 */
  name: string;
  /** 片段级循环建议：待机/行走循环，其余一次性 */
  loop: boolean;
  beats: BeatPhase[];
}

const C = {
  settle: '#64748b',
  rise: '#38bdf8',
  contact: '#ef4444',
  down: '#f97316',
  passing: '#a3a380',
  up: '#38bdf8',
  guard: '#94a3b8',
  anticipation: '#f59e0b',
  acceleration: '#f97316',
  follow: '#a78bfa',
  recovery: '#34d399',
  hold: '#94a3b8',
  impact: '#ef4444',
  recoil: '#f97316',
  squash: '#e879f9',
  fall: '#f97316',
  rest: '#475569',
  curled: '#94a3b8',
  unfold: '#38bdf8',
  full: '#34d399',
  charge: '#f59e0b',
  cast: '#ef4444',
};

export const BEAT_TEMPLATES: BeatTemplate[] = [
  {
    id: 'idle', name: '待机', loop: true,
    beats: [
      { key: 'settle-in', name: '沉降', weight: 3, color: C.settle },
      { key: 'rise', name: '呼吸上升', weight: 2, color: C.rise },
      { key: 'settle-out', name: '回落沉降', weight: 3, color: C.settle },
    ],
  },
  {
    id: 'walk', name: '行走', loop: true,
    beats: [
      { key: 'contact', name: '接触', weight: 2, color: C.contact },
      { key: 'down', name: '下沉', weight: 1, color: C.down },
      { key: 'passing', name: '经过', weight: 2, color: C.passing },
      { key: 'up', name: '上升', weight: 1, color: C.up },
      { key: 'opposite-contact', name: '对侧接触', weight: 2, color: C.contact },
    ],
  },
  {
    id: 'attack', name: '攻击', loop: false,
    beats: [
      { key: 'guard', name: '防备', weight: 2, color: C.guard },
      { key: 'anticipation', name: '预备', weight: 2, color: C.anticipation },
      { key: 'acceleration', name: '加速', weight: 1, color: C.acceleration },
      { key: 'contact', name: '接触', weight: 1, color: C.contact },
      { key: 'follow-through', name: '跟随', weight: 2, color: C.follow },
      { key: 'recovery', name: '回收', weight: 2, color: C.recovery },
    ],
  },
  {
    id: 'block', name: '格挡', loop: false,
    beats: [
      { key: 'raise-guard', name: '举防', weight: 1, color: C.guard },
      { key: 'hold', name: '保持', weight: 3, color: C.hold },
      { key: 'return', name: '收回', weight: 1, color: C.recovery },
    ],
  },
  {
    id: 'hit', name: '受击', loop: false,
    beats: [
      { key: 'impact', name: '冲击', weight: 1, color: C.impact },
      { key: 'recoil', name: '后仰', weight: 2, color: C.recoil },
      { key: 'squash-stretch', name: '挤压拉伸', weight: 1, color: C.squash },
      { key: 'recovery', name: '恢复', weight: 2, color: C.recovery },
    ],
  },
  {
    id: 'death', name: '死亡', loop: false,
    beats: [
      { key: 'imbalance', name: '失衡', weight: 2, color: C.anticipation },
      { key: 'fall', name: '倒下', weight: 2, color: C.fall },
      { key: 'impact', name: '落地', weight: 1, color: C.impact },
      { key: 'rest', name: '静止', weight: 3, color: C.rest },
    ],
  },
  {
    id: 'born', name: '出生', loop: false,
    beats: [
      { key: 'curled', name: '蜷缩', weight: 2, color: C.curled },
      { key: 'unfold', name: '展开', weight: 3, color: C.unfold },
      { key: 'full-identity', name: '完整成形', weight: 2, color: C.full },
    ],
  },
  {
    id: 'skill', name: '施法', loop: false,
    beats: [
      { key: 'anticipation', name: '预备', weight: 2, color: C.anticipation },
      { key: 'charge', name: '蓄力', weight: 3, color: C.charge },
      { key: 'peak-cast', name: '释放', weight: 1, color: C.cast },
      { key: 'recovery', name: '回收', weight: 2, color: C.recovery },
    ],
  },
];

export function getBeatTemplate(id: string): BeatTemplate | undefined {
  return BEAT_TEMPLATES.find((t) => t.id === id);
}

/**
 * 把 [startFrame, endFrame]（含端点）按模板节拍权重切成帧标签：
 * 连续、无缝、无重叠，首尾正好覆盖整窗。帧数足够时每节拍至少 1 帧；
 * 帧数少于节拍数时按权重从大到小保留（同权按原序），其余节拍舍弃。
 * 分配用最大余数法，结果只依赖入参（idGen 可注入以便测试）。
 */
export function beatFrameTags(
  startFrame: number,
  endFrame: number,
  template: BeatTemplate,
  idGen: () => string = () => crypto.randomUUID(),
): FrameTag[] {
  const total = endFrame - startFrame + 1;
  if (total <= 0 || template.beats.length === 0) return [];
  const beats = template.beats;
  const counts = new Array(beats.length).fill(0);

  if (total >= beats.length) {
    // 每节拍先保底 1 帧，余量按权重最大余数分配
    const rest = total - beats.length;
    const wSum = beats.reduce((a, b) => a + b.weight, 0);
    const exact = beats.map((b) => (rest * b.weight) / wSum);
    const base = exact.map((v) => Math.floor(v));
    let leftover = rest - base.reduce((a, b) => a + b, 0);
    const order = beats
      .map((b, i) => ({ i, frac: exact[i] - base[i], w: b.weight }))
      .sort((a, b2) => b2.frac - a.frac || b2.w - a.w || a.i - b2.i);
    for (let k = 0; leftover > 0; k++, leftover--) base[order[k % order.length].i]++;
    beats.forEach((_, i) => (counts[i] = 1 + base[i]));
  } else {
    // 帧比节拍还少：权重大的节拍各得 1 帧
    const order = beats
      .map((b, i) => ({ i, w: b.weight }))
      .sort((a, b2) => b2.w - a.w || a.i - b2.i);
    for (let k = 0; k < total; k++) counts[order[k].i] = 1;
  }

  const tags: FrameTag[] = [];
  let cursor = startFrame;
  beats.forEach((beat, i) => {
    if (counts[i] <= 0) return;
    const end = cursor + counts[i] - 1;
    tags.push({
      id: idGen(),
      name: beat.name,
      startFrame: cursor,
      endFrame: end,
      color: beat.color,
      loop: template.loop ? 'loop' : 'once',
      direction: 'forward',
    });
    cursor = end + 1;
  });
  return tags;
}
