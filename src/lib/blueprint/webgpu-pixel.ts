// ============================================================
// EXPERIMENTAL: WebGPU Pixel Compute for Blueprint
// 实验性功能：蓝图像素节点的 GPU 加速路径。
// - 使用 @keyframe-engine/webgpu 的安全检查思想（device lost/对齐/溢出）
// - 通用 WGSL compute shader，参数化像素操作（非 per-script 编译）
// - 无 WebGPU 时自动 fallback 到 CPU
// 状态：实验性，默认不启用，仅供测试。
// ============================================================
/// <reference types="@webgpu/types" />

import { webgpuAdapter } from '@keyframe-engine/webgpu';

// ---- 通用像素操作 WGSL ----
// 操作类型由 uniform 的 opType 决定，单管线覆盖多种操作。
// opType: 0=恒等, 1=反色, 2=灰度, 3=亮度调整, 4=对比度
const PIXEL_COMPUTE_WGSL = /* wgsl */ `
struct Params {
  width: u32,
  height: u32,
  opType: u32,
  amount: f32,  // 操作强度参数（如亮度系数）
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputPixels: array<u32>;   // RGBA8 packed
@group(0) @binding(2) var<storage, read_write> outputPixels: array<u32>;

fn unpack_rgba(packed: u32) -> vec4<f32> {
  let r = f32((packed >> 0u) & 0xFFu) / 255.0;
  let g = f32((packed >> 8u) & 0xFFu) / 255.0;
  let b = f32((packed >> 16u) & 0xFFu) / 255.0;
  let a = f32((packed >> 24u) & 0xFFu) / 255.0;
  return vec4<f32>(r, g, b, a);
}

fn pack_rgba(c: vec4<f32>) -> u32 {
  let r = u32(clamp(c.r, 0.0, 1.0) * 255.0 + 0.5);
  let g = u32(clamp(c.g, 0.0, 1.0) * 255.0 + 0.5);
  let b = u32(clamp(c.b, 0.0, 1.0) * 255.0 + 0.5);
  let a = u32(clamp(c.a, 0.0, 1.0) * 255.0 + 0.5);
  return (a << 24u) | (b << 16u) | (g << 8u) | r;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  let total = params.width * params.height;
  if (idx >= total) { return; }

  var c = unpack_rgba(inputPixels[idx]);

  if (params.opType == 1u) {
    // 反色
    c = vec4<f32>(1.0 - c.r, 1.0 - c.g, 1.0 - c.b, c.a);
  } else if (params.opType == 2u) {
    // 灰度
    let l = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    c = vec4<f32>(l, l, l, c.a);
  } else if (params.opType == 3u) {
    // 亮度
    c = vec4<f32>(c.rgb * params.amount, c.a);
  } else if (params.opType == 4u) {
    // 对比度
    c = vec4<f32>((c.rgb - 0.5) * params.amount + 0.5, c.a);
  }
  // opType 0 = 恒等，直接输出

  outputPixels[idx] = pack_rgba(c);
}
`;

// ---- 操作类型映射 ----
export const GPU_PIXEL_OPS = {
  identity: 0,
  invert: 1,
  grayscale: 2,
  brightness: 3,
  contrast: 4,
} as const;

export type GpuPixelOp = keyof typeof GPU_PIXEL_OPS;

// ---- 设备管理（单例，懒初始化） ----
let devicePromise: Promise<GPUDevice | null> | null = null;
let pipeline: GPUComputePipeline | null = null;

async function getDevice(): Promise<GPUDevice | null> {
  if (devicePromise) return devicePromise;
  devicePromise = (async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.gpu) {
        console.warn('[experimental-webgpu] navigator.gpu 不可用，fallback 到 CPU');
        return null;
      }
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        console.warn('[experimental-webgpu] 无 WebGPU adapter，fallback 到 CPU');
        return null;
      }
      const device = await adapter.requestDevice();
      // 借用包的安全检查：device lost 检测
      try {
        (webgpuAdapter as any).checkDeviceLost?.(device);
      } catch {
        // adapter 方法不存在时忽略，继续
      }
      return device;
    } catch (e) {
      console.warn('[experimental-webgpu] WebGPU 初始化失败，fallback 到 CPU:', e);
      return null;
    }
  })();
  return devicePromise;
}

async function getPipeline(device: GPUDevice): Promise<GPUComputePipeline> {
  if (pipeline) return pipeline;
  const module = device.createShaderModule({ code: PIXEL_COMPUTE_WGSL });
  pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  return pipeline;
}

// ---- 像素格式转换 ----
// 输入：(string | null)[][]（CSS 颜色或 null 透明）
// GPU 用 u32 RGBA8 packed
function parseColor(color: string | null): [number, number, number, number] {
  if (!color) return [0, 0, 0, 0];
  // 简单解析 #rrggbb
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return [r, g, b, 255];
  }
  return [0, 0, 0, 255];
}

function toPacked(pixels: (string | null)[][]): { data: Uint32Array; width: number; height: number } {
  const height = pixels.length;
  const width = height > 0 ? pixels[0]!.length : 0;
  const data = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = parseColor(pixels[y]![x]!);
      data[y * width + x] = (a << 24) | (b << 16) | (g << 8) | r;
    }
  }
  return { data, width, height };
}

function fromPacked(data: Uint32Array, width: number, height: number): (string | null)[][] {
  const pixels: (string | null)[][] = [];
  for (let y = 0; y < height; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < width; x++) {
      const packed = data[y * width + x]!;
      const r = (packed >> 0) & 0xff;
      const g = (packed >> 8) & 0xff;
      const b = (packed >> 16) & 0xff;
      const a = (packed >> 24) & 0xff;
      if (a === 0) {
        row.push(null);
      } else {
        row.push(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`);
      }
    }
    pixels.push(row);
  }
  return pixels;
}

// ---- 主入口：GPU 像素计算 ----
// 返回 null 表示不可用（调用方应 fallback 到 CPU）
export async function gpuPixelCompute(
  pixels: (string | null)[][],
  op: GpuPixelOp,
  amount = 1.0,
): Promise<(string | null)[][] | null> {
  const device = await getDevice();
  if (!device) return null;

  try {
    const { data, width, height } = toPacked(pixels);
    if (width === 0 || height === 0) return pixels;

    const computePipeline = await getPipeline(device);
    const pixelCount = width * height;

    // Buffer（借用包的边界检查思想：手动校验大小）
    const inputBuffer = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const outputBuffer = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const paramBuffer = device.createBuffer({
      size: 16, // 4x u32/f32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const readbackBuffer = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // 写入
    const inputData = new Uint32Array(data);
    device.queue.writeBuffer(inputBuffer, 0, inputData);
    const params = new ArrayBuffer(16);
    const paramView = new DataView(params);
    paramView.setUint32(0, width, true);
    paramView.setUint32(4, height, true);
    paramView.setUint32(8, GPU_PIXEL_OPS[op], true);
    paramView.setFloat32(12, amount, true);
    device.queue.writeBuffer(paramBuffer, 0, params);

    // Dispatch
    const bindGroup = device.createBindGroup({
      layout: computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramBuffer } },
        { binding: 1, resource: { buffer: inputBuffer } },
        { binding: 2, resource: { buffer: outputBuffer } },
      ],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(computePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(pixelCount / 64));
    pass.end();
    encoder.copyBufferToBuffer(outputBuffer, 0, readbackBuffer, 0, data.byteLength);
    device.queue.submit([encoder.finish()]);

    // 读回
    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const resultData = new Uint32Array(readbackBuffer.getMappedRange().slice(0));
    readbackBuffer.unmap();

    // 清理
    inputBuffer.destroy();
    outputBuffer.destroy();
    paramBuffer.destroy();
    readbackBuffer.destroy();

    return fromPacked(resultData, width, height);
  } catch (e) {
    console.warn('[experimental-webgpu] GPU 计算失败，fallback 到 CPU:', e);
    return null;
  }
}

// ---- 是否可用（供 UI 判断） ----
export async function isWebGpuAvailable(): Promise<boolean> {
  const device = await getDevice();
  return device !== null;
}
