// 验证：scaleX 接入关键帧轨道（node.tracks.scaleX）
// A) 无轨道：world scaleX = base scaleX（与接入前静态行为一致）；base 未设 → 1
// B) 有轨道：帧间线性插值（0帧=1 → 10帧=3，5帧应为 2）
// C) 蓝图路径：轨道值再乘 bpT.scaleX（与 stretch 乘 scaleY 同口径）
import { computeWorldTransforms } from '../src/lib/unified-render';

let fail = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✓' : '✗'} ${label}: ${detail}`);
  if (!ok) fail++;
}
const approx = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-9;

function mkChar(opts: any = {}): any {
  const node: any = {
    id: 'root',
    name: 'root',
    parentId: null,
    children: [],
    transform: { x: 0, y: 0, z: 0, angle: 0, stretch: 1, variantIndex: 6, ...(opts.transform ?? {}) },
    tracks: opts.tracks ?? {},
    modifiers: [],
    sockets: [],
    attachment: { type: 'root' },
    drawLayer: 'default',
    visible: true,
  };
  return { id: 'c1', name: 'c1', rootNodeId: 'root', nodes: { root: node } };
}

const scaleTrack = { keyframes: [{ frame: 0, value: 1 }, { frame: 10, value: 3 }], interpolation: 'linear' as const };

// A1: 无轨道 + base scaleX=1.5 → 1.5
{
  const w = computeWorldTransforms(mkChar({ transform: { scaleX: 1.5 } }), 5, 200, 200);
  check('A1 无轨道走 base', approx(w.get('root')?.scaleX, 1.5), `scaleX=${w.get('root')?.scaleX}`);
}
// A2: 无轨道 + base 未设 → 1（旧默认路径返回 undefined，消费端一律 ?? 1，等值）
{
  const w = computeWorldTransforms(mkChar(), 5, 200, 200);
  check('A2 无轨道无 base → 1', approx(w.get('root')?.scaleX ?? 1, 1), `scaleX=${w.get('root')?.scaleX}`);
}
// B: 有轨道插值
{
  const ch = mkChar({ transform: { scaleX: 9 }, tracks: { scaleX: scaleTrack } });
  const w0 = computeWorldTransforms(ch, 0, 200, 200).get('root')?.scaleX;
  const w5 = computeWorldTransforms(ch, 5, 200, 200).get('root')?.scaleX;
  const w10 = computeWorldTransforms(ch, 10, 200, 200).get('root')?.scaleX;
  check('B 轨道插值', approx(w0, 1) && approx(w5, 2) && approx(w10, 3), `f0=${w0} f5=${w5} f10=${w10}`);
}
// C: 轨道 × 蓝图 scaleX
{
  const ch = mkChar({ tracks: { scaleX: scaleTrack } });
  const bp = new Map([['root', { translateX: 0, translateY: 0, translateZ: 0, rotation: 0, tilt: 0, scaleX: 2, scaleY: 1, skewX: 0, skewY: 0 }]]);
  const w = computeWorldTransforms(ch, 5, 200, 200, 12, undefined, bp);
  check('C 轨道×蓝图', approx(w.get('root')?.scaleX, 4), `scaleX=${w.get('root')?.scaleX} (轨道2 × 蓝图2)`);
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
