// 程序化运行时：表面层程序预设库（pattern 层语言的著者入口 v1）。
// 每个预设是一段层程序数据（与运行时 compileTile 的层格式同构）：
// mask 层按序覆盖；bump 层以距离场为伪高度图跑枚举公式、量化成三档。
// 完整层程序编辑器是后续工作；著者改程序 = 换预设或由数据层直改 surface。
import type { ParametricAppearance, ParametricLayer } from '../unified-types';
import { LIGHT, OUTLINE, RIM, GLINT } from './palettes';

const gradY = (slots: [number, number, number]): ParametricLayer[] => [
  { mask: { m: 'inside' }, slot: slots[2] },
  { mask: { m: 'gradLt', axis: 'y', t: 0.66 }, slot: slots[1] },
  { mask: { m: 'gradLt', axis: 'y', t: 0.33 }, slot: slots[0] },
];
const flat = (slot: number): ParametricLayer[] => [{ mask: { m: 'inside' }, slot }];
const outlineDark: ParametricLayer[] = [{ mask: { m: 'edge', w: 1 }, slot: 0 }];

export const SURFACE_PRESETS: Record<string, () => ParametricLayer[]> = {
  '穹光（bump）': () => [
    { bumpForm: 'dome', hi: 3, mid: 2, lo: 1 },
    { mask: { m: 'facing', deg: 45, tol: 65, w: 99 }, slot: 0, ch: 'glint' },
    { mask: { m: 'facing', deg: -135, tol: 60, w: 1.8 }, slot: 4 },
    ...outlineDark,
  ],
  '纵向渐变': () => [...gradY([3, 2, 1]), ...outlineDark],
  '平缓渐变': () => [...gradY([3, 2, 2]), ...outlineDark],
  '条纹布': () => [
    ...gradY([2, 1, 1]),
    { mask: { m: 'bands', axis: 'd', f: 3, ph: 0, duty: 0.5 }, slot: 5 },
    ...outlineDark,
  ],
  '鳞甲': () => [
    ...flat(2),
    { mask: { m: 'bands', axis: 'y', f: 3, ph: 0, duty: 0.5 }, slot: 1 },
    ...outlineDark,
  ],
  '噪点皮': () => [
    ...flat(2),
    { mask: { m: 'noise', f: 2, seed: 5, gt: 0.72 }, slot: 3 },
    ...outlineDark,
  ],
  '素面': () => [...flat(2), ...outlineDark],
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
