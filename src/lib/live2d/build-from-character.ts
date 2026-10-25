/**
 * 编辑器角色（2D 木偶）→ Live2dModel：主界面导出对话框的 Live2D 页签用。
 *
 * 几何/画序全部取编辑器自己的渲染计划（generateRenderPlan 的
 * sortedInstructions——与主画布同一条消费链）：每条带精灵的指令成一个
 * 图元，纹理 = 精灵像素网格，位置 = 指令的世界位姿（位置/转角/横向
 * 缩放/纵向拉伸/镜像）作用到以枢轴（sprite.plug + attachment.plug
 * 偏移，无 plug 时居中——与渲染计划生成端自己的枢轴口径一致）为
 * 原点的精灵四角。
 *
 * v1 边界（与 PMX 路径的区别）：这是第 0 帧静态姿态导出——参数只声明
 * 角度三件（AngleX/AngleY/BodyAngleX，无关键形族），靠写入器的静态
 * 绑定追踪绘制顺序；带骨骼关键形的版本走 3D 烘焙对话框的 PMX 导出。
 * 修改器/蓝图对像素的加工不在精灵原图里，不进本导出。
 */
import { generateRenderPlan } from '../unified-render';
import { subToPx } from '../unified-types';
import type { Character, Sprite } from '../unified-types';
import { hexToRgbCached } from '../engine/color-utils';
import type { Live2dDrawable, Live2dModel, Live2dTexture } from './model';

export interface Live2dCharacterOptions {
  /** 画布边长（模型坐标空间），默认 1024 */
  viewportSize?: number;
  /** 取样帧，默认 0 */
  frame?: number;
  /** 工程帧率（计划求值用），默认 12 */
  frameRate?: number;
}

function spriteToTexture(sprite: Sprite): Live2dTexture {
  const w = sprite.width;
  const h = sprite.height;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = sprite.data[y];
    if (!row) continue;
    for (let x = 0; x < w; x++) {
      const color = row[x];
      if (!color) continue;
      const packed = hexToRgbCached(color);
      const i = (y * w + x) * 4;
      rgba[i] = (packed >> 16) & 0xff;
      rgba[i + 1] = (packed >> 8) & 0xff;
      rgba[i + 2] = packed & 0xff;
      rgba[i + 3] = 255;
    }
  }
  return { rgba, width: w, height: h };
}

const STATIC_PARAMS: Live2dModel['params'] = [
  { id: 'ParamAngleX', label: '角度 X', min: -30, max: 30, default: 0 },
  { id: 'ParamAngleY', label: '角度 Y', min: -30, max: 30, default: 0 },
  { id: 'ParamBodyAngleX', label: '身体角度 X', min: -10, max: 10, default: 0 },
];

export function buildLive2dModelFromCharacter(
  character: Character,
  sprites: Record<string, Sprite>,
  options: Live2dCharacterOptions = {},
): Live2dModel {
  const V = options.viewportSize ?? 1024;
  const frame = options.frame ?? 0;
  const plan = generateRenderPlan(
    character, frame, 512, 512, 'pixel-perfect', options.frameRate ?? 12,
    undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, sprites,
  );

  const seen = new Set<string>();
  const rawQuads: { nodeId: string; sprite: Sprite; corners: [number, number][] }[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ins of plan.sortedInstructions) {
    if (!ins.sprite || !ins.sprite.data || ins.sprite.data.length === 0) continue;
    if (seen.has(ins.nodeId)) continue;
    seen.add(ins.nodeId);
    const sprite = ins.sprite;
    const node = character.nodes[ins.nodeId];
    // 枢轴口径与渲染计划生成端一致：sprite.plug（子像素）→ attachment.plug
    // 偏移 → 都无则精灵中心
    const pivotX = (sprite.plug ? subToPx(sprite.plug.x) : sprite.width / 2)
      + (node?.attachment?.plug ? subToPx(node.attachment.plug.x) : 0);
    const pivotY = (sprite.plug ? subToPx(sprite.plug.y) : sprite.height / 2)
      + (node?.attachment?.plug ? subToPx(node.attachment.plug.y) : 0);
    const rad = (ins.angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const sx = (ins.scaleX ?? 1) * (ins.mirror ? -1 : 1);
    const sy = ins.stretch ?? 1;
    const wx = subToPx(ins.worldX);
    const wy = subToPx(ins.worldY);
    const srcCorners: [number, number][] = [
      [0, 0], [sprite.width, 0], [sprite.width, sprite.height], [0, sprite.height],
    ];
    const corners = srcCorners.map(([px, py]) => {
      const lx = (px - pivotX) * sx;
      const ly = (py - pivotY) * sy;
      // 画布 y 向下、角度顺时针为正（canvas rotate 同式）
      const x = wx + cos * lx - sin * ly;
      const y = wy + sin * lx + cos * ly;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      return [x, y] as [number, number];
    });
    rawQuads.push({ nodeId: ins.nodeId, sprite, corners });
  }
  if (rawQuads.length === 0 || !Number.isFinite(minX)) {
    throw new Error('当前帧没有可导出的精灵（角色无可见节点精灵）');
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const half = Math.max(maxX - minX, maxY - minY) / 2 || 1;
  const s = ((V / 2) * 0.94) / half;
  const drawables: Live2dDrawable[] = rawQuads.map(({ nodeId, sprite, corners }, i) => {
    const neutralPositions = new Float32Array(8);
    const uvs = new Float32Array(8);
    const srcCorners: [number, number][] = [
      [0, 0], [sprite.width, 0], [sprite.width, sprite.height], [0, sprite.height],
    ];
    corners.forEach(([x, y], ci) => {
      neutralPositions[ci * 2] = V / 2 + (x - cx) * s;
      neutralPositions[ci * 2 + 1] = V / 2 + (y - cy) * s;
      const [px, py] = srcCorners[ci];
      uvs[ci * 2] = px / sprite.width;
      uvs[ci * 2 + 1] = 1 - py / sprite.height;
    });
    const id = `chr_${nodeId}`;
    return {
      id,
      label: character.nodes[nodeId]?.name ?? nodeId,
      meshId: id,
      leafIds: [id],
      vertexCount: 4,
      triangleCount: 2,
      triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
      meshVertexIndices: new Uint32Array([0, 1, 2, 3]),
      neutralPositions,
      uvs,
      texture: spriteToTexture(sprite),
      renderOrder: i,
    };
  });

  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    modelName: character.name,
    viewport: { width: V, height: V },
    params: STATIC_PARAMS.map((p) => ({ ...p })),
    drawables,
    families: {},
    depthFamilies: {},
    neutralDepths: drawables.map(() => 0),
    order: drawables.map((d) => d.id),
    errorReport: { comboCount: 0, meanErrorPx: 0, maxErrorPx: 0, perCombo: [], worstDrawable: null },
    orderReport: { flips: [], samplesChecked: 0 },
  };
}
