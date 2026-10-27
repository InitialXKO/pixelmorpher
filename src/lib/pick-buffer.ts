// 拾取编号图（编辑器专用）：PixelCanvas 主画布每次绘制时，借
// unified-render 的拾取通道（beginPickPass/endPickPass）把当帧各节点
// 的最终剪影以编号色并行画进这里的离屏画布；命中时按戳记校验后读
// 单个像素解出节点。占据以绘制结果为准——像素链/像素修改器改过的
// 精灵、蒙皮快照弯成的形状，在这里天然就是画出来的样子。
// 戳记 = 场景身份（角色表/精灵表对象同一性 + 帧 + 画布尺寸 + 方位
// 开关）：Zustand 不可变更新换掉任一对象即失效，读到旧图一律作废、
// 回落几何判定。失效不补画（下一次主画布绘制自然刷新）。
import { beginPickPass, endPickPass } from './unified-render';

export interface PickStamp {
  characters: unknown;
  sprites: unknown;
  frame: number;
  canvasWidth: number;
  canvasHeight: number;
  nodeTurn3D: boolean;
}

interface BufferState {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  ids: Map<number, string>;
  stamp: PickStamp;
  imageData: ImageData | null;
}

let state: BufferState | null = null;

function sameStamp(a: PickStamp, b: PickStamp): boolean {
  return a.characters === b.characters && a.sprites === b.sprites
    && a.frame === b.frame && a.canvasWidth === b.canvasWidth
    && a.canvasHeight === b.canvasHeight && a.nodeTurn3D === b.nodeTurn3D;
}

/** 主画布绘制前调用：备好编号图并开启拾取通道（画布尺寸 = 工程画布，
 * 通道内坐标即画布 px）。绘制后必须调 endPickFrame 收尾。 */
export function beginPickFrame(stamp: PickStamp): void {
  if (!state) {
    const canvas = document.createElement('canvas');
    state = {
      canvas,
      ctx: canvas.getContext('2d', { willReadFrequently: true })!,
      ids: new Map(),
      stamp,
      imageData: null,
    };
  }
  const { canvas, ctx } = state;
  if (canvas.width !== stamp.canvasWidth || canvas.height !== stamp.canvasHeight) {
    canvas.width = stamp.canvasWidth;
    canvas.height = stamp.canvasHeight;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  state.stamp = stamp;
  state.imageData = null;
  beginPickPass(ctx);
}

export function endPickFrame(): void {
  if (!state) { endPickPass(); return; }
  state.ids = endPickPass();
}

/** 读 (x, y)（画布 px）处的编号：fresh = 编号图与期望戳记一致（本
 * 次读取可信）；nodeId = 该像素画着的节点（背景/半透明边缘/越界为
 * null——fresh 时 null 即「此处没画任何精灵/关节盘」，是权威结论）。 */
export function readPick(x: number, y: number, expected: PickStamp): { fresh: boolean; nodeId: string | null } {
  if (!state || !sameStamp(state.stamp, expected)) return { fresh: false, nodeId: null };
  const xi = Math.floor(x), yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= state.canvas.width || yi >= state.canvas.height) return { fresh: true, nodeId: null };
  if (!state.imageData) {
    state.imageData = state.ctx.getImageData(0, 0, state.canvas.width, state.canvas.height);
  }
  const d = state.imageData.data;
  const i = (yi * state.canvas.width + xi) * 4;
  const a = d[i + 3]!;
  if (a < 250) return { fresh: true, nodeId: null };
  const id = d[i]! | (d[i + 1]! << 8) | (d[i + 2]! << 16);
  if (id === 0) return { fresh: true, nodeId: null };
  return { fresh: true, nodeId: state.ids.get(id) ?? null };
}
