// 程序化运行时：表面层程序预设库（pattern 层语言的著者入口 v1）。
// 每个预设是一段层程序数据（与运行时 compileTile 的层格式同构）：
// mask 层按序覆盖；bump 层以距离场为伪高度图跑枚举公式、量化成三档。
// 预设不焊边缘压暗（用户拍板甲）：暗边归外观的 OUTLINE 枚举管辖——
// 枚举 OUTER/INNER 负责描边，设 NONE 即真无框；表面程序只管面内图案。
import type { ParametricAppearance, ParametricLayer } from '../unified-types';
import { LIGHT, OUTLINE, RIM, GLINT } from './palettes';

const gradY = (slots: [number, number, number]): ParametricLayer[] => [
  { mask: { m: 'inside' }, slot: slots[2] },
  { mask: { m: 'gradLt', axis: 'y', t: 0.66 }, slot: slots[1] },
  { mask: { m: 'gradLt', axis: 'y', t: 0.33 }, slot: slots[0] },
];
const flat = (slot: number): ParametricLayer[] => [{ mask: { m: 'inside' }, slot }];

export const SURFACE_PRESETS: Record<string, () => ParametricLayer[]> = {
  '穹光（bump）': () => [
    { bumpForm: 'dome', hi: 3, mid: 2, lo: 1 },
    { mask: { m: 'facing', deg: 45, tol: 65, w: 99 }, slot: 0, ch: 'glint' },
    { mask: { m: 'facing', deg: -135, tol: 60, w: 1.8 }, slot: 4 },
  ],
  '纵向渐变': () => [...gradY([3, 2, 1])],
  '平缓渐变': () => [...gradY([3, 2, 2])],
  '条纹布': () => [
    ...gradY([2, 1, 1]),
    { mask: { m: 'bands', axis: 'd', f: 3, ph: 0, duty: 0.5 }, slot: 5 },
  ],
  '鳞甲': () => [
    ...flat(2),
    { mask: { m: 'bands', axis: 'y', f: 3, ph: 0, duty: 0.5 }, slot: 1 },
  ],
  '噪点皮': () => [
    ...flat(2),
    { mask: { m: 'noise', f: 2, seed: 5, gt: 0.72 }, slot: 3 },
  ],
  '素面': () => [...flat(2)],
};
export const SURFACE_PRESET_NAMES = Object.keys(SURFACE_PRESETS);

/** 新建参数化外观的默认值（形状 8×10 矩形、纵向渐变、shirt 家族） */
export function createDefaultParametricAppearance(): ParametricAppearance {
  return {
    shape: { kind: 'rect', size: [8, 10], roundness: 0.35 },
    centerOffset: [0, 0],
    surface: SURFACE_PRESETS['纵向渐变'](),
    surfaceName: '纵向渐变',
    palette: 'shirt',
    light: LIGHT.TOP_LEFT,
    outline: OUTLINE.OUTER,
    rim: RIM.NONE,
    glint: GLINT.NONE,
    rimI: 0.35,
    glintI: 0,
  };
}
