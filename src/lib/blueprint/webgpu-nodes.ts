// ============================================================
// EXPERIMENTAL: GPU Pixel Node Registration
// 实验性：将 webgpu-pixel.ts 的能力注册为蓝图节点。
//
// 注意：蓝图求值是同步的，WebGPU 是异步的。
// 当前实验版本：节点内用 CPU 同步计算（与 WGSL 逻辑一致），
// GPU 异步路径通过 gpuPixelCompute() 供脚本/批量处理直接调用。
// 未来：可做"上一帧 GPU 结果缓存"模式实现逐帧 GPU 加速。
// ============================================================

import { registerEvaluator } from './eval';
import { GPU_PIXEL_OPS } from './webgpu-pixel';
import type { GpuPixelOp } from './webgpu-pixel';

// CPU 版实现（与 WGSL 着色器逻辑一致，用于同步求值）
function cpuPixelOp(
  pixels: (string | null)[][],
  op: GpuPixelOp,
  amount: number,
): (string | null)[][] {
  const parse = (c: string | null): [number, number, number] => {
    if (!c || !c.startsWith('#') || c.length !== 7) return [0, 0, 0];
    return [
      parseInt(c.slice(1, 3), 16),
      parseInt(c.slice(3, 5), 16),
      parseInt(c.slice(5, 7), 16),
    ];
  };
  const toHex = (r: number, g: number, b: number): string => {
    const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    return `#${cl(r).toString(16).padStart(2, '0')}${cl(g).toString(16).padStart(2, '0')}${cl(b).toString(16).padStart(2, '0')}`;
  };

  return pixels.map((row) =>
    row.map((p) => {
      if (p === null) return null;
      let [r, g, b] = parse(p);
      const opType = GPU_PIXEL_OPS[op];
      if (opType === 1) {
        r = 255 - r; g = 255 - g; b = 255 - b;
      } else if (opType === 2) {
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        r = g = b = l;
      } else if (opType === 3) {
        r *= amount; g *= amount; b *= amount;
      } else if (opType === 4) {
        r = (r - 127.5) * amount + 127.5;
        g = (g - 127.5) * amount + 127.5;
        b = (b - 127.5) * amount + 127.5;
      }
      return toHex(r, g, b);
    }),
  );
}

export function registerExperimentalGpuNodes(): void {
  registerEvaluator('experimental_gpu_pixel', (node, inputs, _ctx) => {
    const pixelsInput = inputs.pixels as any;
    const inputPixels: (string | null)[][] = pixelsInput?.value ?? pixelsInput ?? [];
    const op = (node.params?.op as GpuPixelOp) ?? 'identity';
    const amount = Number(node.params?.amount ?? 1.0);

    // 实验性：同步路径用 CPU（与 WGSL 一致）
    // GPU 异步加速通过 gpuPixelCompute() 单独调用
    const result = cpuPixelOp(inputPixels, op, amount);
    return { pixels: { value: result } as any };
  });

  console.info('[experimental] 已注册 experimental_gpu_pixel 节点（CPU 同步版，GPU 异步版待接入）');
}
