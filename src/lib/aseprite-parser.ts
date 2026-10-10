// ============================================================
// PixelMorpher - Aseprite (.ase) File Parser
// ============================================================
// Parses Aseprite .ase binary files and extracts frame pixel data.
// Supports raw and zlib-compressed cels with RGBA color depth.
// Uses browser-native DecompressionStream for deflate decompression.

import type { PixelGrid, PixelColor } from './types';
import { rgbaToHexOrNull, rgbToHex } from './engine/utils';

export interface AsepriteFrame {
  duration: number; // ms
  pixels: PixelGrid;
}

/**
 * Parse an Aseprite .ase file from an ArrayBuffer.
 *
 * Handles:
 * - File header (magic 0xA5E0)
 * - Frame headers (magic 0xF1FA)
 * - Cel chunks (0x2005) — raw (type 0) and zlib-compressed (type 2)
 * - Palette chunks (0x2018) for indexed color mode
 *
 * For indexed color mode (depth=32 with palette), the palette is stored
 * separately and pixel indices reference the palette.
 */
export async function parseAsepriteFile(buffer: ArrayBuffer): Promise<AsepriteFrame[]> {
  const view = new DataView(buffer);
  let offset = 0;

  // ---- Read Header (128 bytes total) ----
  const fileSize = view.getUint32(offset, true); offset += 4;
  const magicNumber = view.getUint16(offset, true); offset += 2;
  if (magicNumber !== 0xA5E0) {
    throw new Error('Not a valid Aseprite file (invalid magic number)');
  }

  offset += 2; // version (2 bytes)
  const frames = view.getUint16(offset, true); offset += 2;
  const width = view.getUint16(offset, true); offset += 2;
  const height = view.getUint16(offset, true); offset += 2;
  const colorDepth = view.getUint16(offset, true); offset += 2; // 8=rgba, 16=grayscale, 32=indexed
  offset += 4; // flags
  offset += 2; // speed (default frame duration in ms)
  offset += 4; // palette entry (set when 0x2004 chunk present)
  offset += 4; // number of colors
  offset += 1; // pixel width
  offset += 1; // pixel height
  offset += 2; // x position of grid
  offset += 2; // y position of grid
  offset += 2; // grid width
  offset += 2; // grid height
  // Skip remaining header bytes to reach offset 128
  offset = 128;

  const bytesPerPixel = colorDepth === 8 ? 4 : colorDepth === 16 ? 2 : 1;

  // For indexed mode, we need a palette
  let palette: Array<[number, number, number, number]> = [];

  const result: AsepriteFrame[] = [];

  // H18: linked cel 需要二遍解析——先存每帧的 cel，全部解析完再补链接、再合成
  const pendingLinks: Array<{ frame: number; layerIndex: number; linkedFrame: number; x: number; y: number; opacity: number }> = [];
  const frameCels: Array<{ duration: number; celData: Map<number, { x: number; y: number; opacity: number; pixels: PixelGrid }> }> = [];

  for (let f = 0; f < frames; f++) {
    if (offset + 16 > buffer.byteLength) break;

    const frameSize = view.getUint32(offset, true); offset += 4;
    const frameMagic = view.getUint16(offset, true); offset += 2;

    if (frameMagic !== 0xF1FA) {
      // Invalid frame, try to skip
      offset += frameSize - 6;
      continue;
    }

    const chunkCountOld = view.getUint16(offset, true); offset += 2;
    const duration = view.getUint16(offset, true); offset += 2;
    offset += 2; // padding (for future use)
    offset += 4; // new chunk count (if old count is 0xFFFF)

    const totalChunks = chunkCountOld < 0xFFFF
      ? chunkCountOld
      : view.getUint32(offset - 4, true);

    // Initialize frame pixels as all null (transparent)
    let framePixels: PixelGrid = Array.from({ length: height }, () =>
      Array<string | null>(width).fill(null)
    );

    // Collect cel data per layer for proper compositing
    const celData: Map<number, { x: number; y: number; opacity: number; pixels: PixelGrid }> = new Map();

    for (let c = 0; c < totalChunks; c++) {
      if (offset + 6 > buffer.byteLength) break;

      const chunkStart = offset;
      const chunkSize = view.getUint32(offset, true); offset += 4;
      const chunkType = view.getUint16(offset, true); offset += 2;

      if (chunkSize < 6) {
        offset = chunkStart + chunkSize;
        continue;
      }

      try {
        if (chunkType === 0x2004) {
          // Old palette chunk (legacy): 256 RGB triplets.
          // H18: 之前被整体跳过，导致老文件索引色无调色板可用。
          // 只有在还没有调色板时才填充（0x2018 新调色板优先）。
          if (palette.length === 0) {
            const count = Math.min(256, Math.floor((chunkSize - 6) / 3));
            for (let i = 0; i < count; i++) {
              const r = view.getUint8(chunkStart + 6 + i * 3);
              const g = view.getUint8(chunkStart + 6 + i * 3 + 1);
              const b = view.getUint8(chunkStart + 6 + i * 3 + 2);
              palette.push([r, g, b, 255]);
            }
          }
          offset = chunkStart + chunkSize;
          continue;
        }

        if (chunkType === 0x2018) {
          // New palette chunk
          offset += 2; // number of entries (first 2 bytes after header already read)
          // Re-read properly
          const palOffset = chunkStart + 6;
          const totalEntries = view.getUint32(palOffset, true);
          const firstIndex = view.getUint32(palOffset + 4, true);
          const lastIndex = view.getUint32(palOffset + 8, true);
          // Skip has-names flag
          let palReadOffset = palOffset + 14;

          // Ensure palette array is large enough
          while (palette.length <= lastIndex) {
            palette.push([0, 0, 0, 255]);
          }

          for (let i = firstIndex; i <= lastIndex && palReadOffset + 4 <= chunkStart + chunkSize; i++) {
            const flags = view.getUint16(palReadOffset, true); palReadOffset += 2;
            const r = view.getUint8(palReadOffset); palReadOffset += 1;
            const g = view.getUint8(palReadOffset); palReadOffset += 1;
            const b = view.getUint8(palReadOffset); palReadOffset += 1;
            const a = view.getUint8(palReadOffset); palReadOffset += 1;
            // If has name flag set, skip name string
            if (flags & 1) {
              const nameLen = view.getUint16(palReadOffset, true); palReadOffset += 2;
              palReadOffset += nameLen;
            }
            palette[i] = [r, g, b, a];
          }

          offset = chunkStart + chunkSize;
          continue;
        }

        if (chunkType === 0x2005) {
          // Cel chunk
          const layerIndex = view.getUint16(offset, true); offset += 2;
          const celX = view.getInt16(offset, true); offset += 2;
          const celY = view.getInt16(offset, true); offset += 2;
          const opacity = view.getUint8(offset); offset += 1;
          const celType = view.getUint16(offset, true); offset += 2;
          offset += 7; // padding

          // H18: 规范里 type 0/2 在 padding 之后还有 w(2)+h(2)。
          // 之前按画布尺寸推进 offset，cel 小于画布时字节流错位、后续 chunk 全错。
          let celW = width;
          let celH = height;
          if (celType === 0 || celType === 2) {
            celW = view.getUint16(offset, true); offset += 2;
            celH = view.getUint16(offset, true); offset += 2;
          }

          if (celType === 0) {
            // Raw cel data
            const celPixels = parseCelPixelData(
              view, offset, width, height, celW, celH, celX, celY,
              bytesPerPixel, colorDepth, palette
            );
            celData.set(layerIndex, { x: celX, y: celY, opacity, pixels: celPixels });
            offset += celW * celH * bytesPerPixel;
          } else if (celType === 1) {
            // Linked cel — references another frame's cel
            const linkedFrame = view.getUint16(offset, true); offset += 2;
            // H18: 记录下来，所有帧解析完后二遍补齐（之前直接丢弃，该帧渲染为空）
            pendingLinks.push({ frame: f, layerIndex, linkedFrame, x: celX, y: celY, opacity });
          } else if (celType === 2) {
            // Zlib-compressed cel data
            const compressedSize = view.getUint32(offset, true); offset += 4;

            if (offset + compressedSize > buffer.byteLength) {
              offset = chunkStart + chunkSize;
              continue;
            }

            try {
              const compressedData = new Uint8Array(buffer, offset, compressedSize);
              const decompressed = await inflateData(compressedData);
              const celPixels = parseDecompressedCelData(
                decompressed, width, height, celW, celH, celX, celY,
                bytesPerPixel, colorDepth, palette
              );
              celData.set(layerIndex, { x: celX, y: celY, opacity, pixels: celPixels });
            } catch (e) {
              console.warn('Failed to decompress cel data:', e);
            }

            offset += compressedSize;
          } else {
            // Unknown cel type, skip
          }
        }
      } catch (e) {
        console.warn('Error parsing chunk:', e);
      }

      // Move to next chunk
      offset = chunkStart + chunkSize;
    }

    frameCels.push({ duration: duration || 100, celData });
  }

  // ---- H18: 二遍——解析 linked cel ----
  for (const link of pendingLinks) {
    const src = frameCels[link.linkedFrame]?.celData.get(link.layerIndex);
    if (src) {
      frameCels[link.frame]?.celData.set(link.layerIndex, {
        x: link.x, y: link.y, opacity: link.opacity, pixels: src.pixels,
      });
    } else {
      console.warn(`Aseprite: linked cel references missing frame ${link.linkedFrame} layer ${link.layerIndex}`);
    }
  }

  // ---- 合成每一帧（按 layer index 从下到上）----
  for (const { duration, celData } of frameCels) {
    const framePixels: PixelGrid = Array.from({ length: height }, () =>
      Array<string | null>(width).fill(null)
    );
    for (const [_layerIdx, cel] of Array.from(celData.entries()).sort((a, b) => a[0] - b[0])) {
      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          const pixelVal = cel.pixels[py]?.[px];
          if (pixelVal !== null && pixelVal !== undefined) {
            // Simple over compositing — later layers overwrite
            framePixels[py][px] = pixelVal;
          }
        }
      }
    }
    result.push({ duration, pixels: framePixels });
  }

  return result;
}

/**
 * Parse raw cel pixel data from a DataView at the given offset.
 */
function parseCelPixelData(
  view: DataView,
  offset: number,
  canvasWidth: number,
  canvasHeight: number,
  celW: number,
  celH: number,
  celX: number,
  celY: number,
  bytesPerPixel: number,
  colorDepth: number,
  palette: Array<[number, number, number, number]>,
): PixelGrid {
  const result: PixelGrid = Array.from({ length: canvasHeight }, () =>
    Array<string | null>(canvasWidth).fill(null)
  );

  let readOffset = offset;

  // H18: 按 cel 自身宽高读取（之前按画布尺寸，cel 更小时字节流错位）
  for (let py = 0; py < celH; py++) {
    for (let px = 0; px < celW; px++) {
      if (readOffset + bytesPerPixel > view.byteLength) break;

      const drawX = px + celX;
      const drawY = py + celY;

      if (drawX < 0 || drawX >= canvasWidth || drawY < 0 || drawY >= canvasHeight) {
        readOffset += bytesPerPixel;
        continue;
      }

      const color = readPixelColor(view, readOffset, bytesPerPixel, colorDepth, palette);
      readOffset += bytesPerPixel;

      if (color !== null) {
        result[drawY][drawX] = color;
      }
    }
  }

  return result;
}

/**
 * Parse decompressed cel pixel data from a Uint8Array.
 */
function parseDecompressedCelData(
  data: Uint8Array,
  canvasWidth: number,
  canvasHeight: number,
  celW: number,
  celH: number,
  celX: number,
  celY: number,
  bytesPerPixel: number,
  colorDepth: number,
  palette: Array<[number, number, number, number]>,
): PixelGrid {
  const result: PixelGrid = Array.from({ length: canvasHeight }, () =>
    Array<string | null>(canvasWidth).fill(null)
  );

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let readOffset = 0;

  // H18: 按 cel 自身宽高读取
  for (let py = 0; py < celH; py++) {
    for (let px = 0; px < celW; px++) {
      if (readOffset + bytesPerPixel > data.length) break;

      const drawX = px + celX;
      const drawY = py + celY;

      if (drawX < 0 || drawX >= canvasWidth || drawY < 0 || drawY >= canvasHeight) {
        readOffset += bytesPerPixel;
        continue;
      }

      const color = readPixelColor(view, readOffset, bytesPerPixel, colorDepth, palette);
      readOffset += bytesPerPixel;

      if (color !== null) {
        result[drawY][drawX] = color;
      }
    }
  }

  return result;
}

/**
 * Read a single pixel color from the data view.
 */
function readPixelColor(
  view: DataView,
  offset: number,
  bytesPerPixel: number,
  colorDepth: number,
  palette: Array<[number, number, number, number]>,
): PixelColor {
  if (colorDepth === 8) {
    // RGBA mode (8 bytes per pixel means each channel is 8-bit)
    // But actually Aseprite uses: 8bpp = indexed, 16bpp = grayscale, 32bpp = RGBA
    // The bytesPerPixel for depth=8 is actually 1 byte (index into palette)
    // Let me re-check: In the header, colorDepth: 8=rgba, 16=grayscale, 32=indexed
    // Wait, actually the Aseprite spec says:
    // Color depth: 8 = 32 bpp RGBA, 16 = 16 bpp grayscale, 32 = 8 bpp indexed
    // This is confusing but the "depth" field represents bits per pixel differently
    // For depth=8 (32bpp RGBA): bytesPerPixel=4
    const r = view.getUint8(offset);
    const g = view.getUint8(offset + 1);
    const b = view.getUint8(offset + 2);
    const a = view.getUint8(offset + 3);
    if (a === 0) return null;
    return rgbToHex(r, g, b);
  } else if (colorDepth === 16) {
    // Grayscale (16 bpp): 1 byte gray + 1 byte alpha
    const gray = view.getUint8(offset);
    const a = view.getUint8(offset + 1);
    if (a === 0) return null;
    return rgbToHex(gray, gray, gray);
  } else if (colorDepth === 32) {
    // Indexed (8 bpp): 1 byte index into palette
    const index = view.getUint8(offset);
    if (index >= palette.length) return null;
    const [r, g, b, a] = palette[index];
    if (a === 0) return null;
    return rgbToHex(r, g, b);
  }
  return null;
}

/**
 * Inflate (decompress) zlib-compressed data using the browser's DecompressionStream API.
 * Falls back to a basic implementation if DecompressionStream is not available.
 */
async function inflateData(compressed: Uint8Array): Promise<Uint8Array> {
  // Try using DecompressionStream (browser native, available in all modern browsers)
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();

      writer.write(compressed as unknown as BufferSource);
      writer.close();

      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const result = new Uint8Array(totalLength);
      let writeOffset = 0;
      for (const chunk of chunks) {
        result.set(chunk, writeOffset);
        writeOffset += chunk.length;
      }
      return result;
    } catch {
      // Fall through to try 'deflate-raw'
    }

    // Some Aseprite files use raw deflate (no zlib header)
    try {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();

      writer.write(compressed as unknown as BufferSource);
      writer.close();

      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const result = new Uint8Array(totalLength);
      let writeOffset = 0;
      for (const chunk of chunks) {
        result.set(chunk, writeOffset);
        writeOffset += chunk.length;
      }
      return result;
    } catch {
      // Both attempts failed
    }
  }

  // Fallback: return empty data (we can't decompress without pako or DecompressionStream)
  console.warn('No decompression method available for Aseprite compressed cels');
  return new Uint8Array(0);
}
