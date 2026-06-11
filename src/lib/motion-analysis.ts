// ============================================================
// PixelMorpher - Motion Analysis Splitting (PRD 3.1.1)
// ============================================================
//
// Algorithm:
// 1. For each pair of consecutive frames, compute per-pixel displacement vectors
//    using block matching (small window correlation)
// 2. Accumulate displacement vectors across all frame pairs
// 3. Cluster pixels by similar motion vectors using region growing
// 4. Output clustered regions as candidate parts with estimated pivot points

import type { PixelColor, PixelGrid } from './types';
import { rgbaToHexOrNull } from './engine/utils';

// ---- Types ----

export interface MotionVector {
  dx: number;
  dy: number;
  confidence: number; // 0-1, how confident we are in this vector
}

export interface MotionRegion {
  id: string;
  pixels: { x: number; y: number }[];
  pivotX: number;
  pivotY: number;
  avgMotion: { dx: number; dy: number };
  bounds: { x: number; y: number; width: number; height: number };
  color: string; // display color for region overlay
}

export interface MotionAnalysisResult {
  regions: MotionRegion[];
  motionField: MotionVector[][]; // [y][x] motion vectors
  width: number;
  height: number;
}

// Region display colors
const REGION_COLORS = [
  '#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff',
  '#ff8800', '#8800ff', '#00ff88', '#ff0088', '#0088ff', '#88ff00',
  '#ff6666', '#66ff66', '#6666ff', '#ffff66',
  '#cc4444', '#44cc44', '#4444cc', '#cccc44',
];

/**
 * Compute motion field between two frames using block matching.
 * For each pixel in frame2, find the best matching block in frame1 within a search radius.
 */
function computeMotionField(
  frame1: PixelGrid,
  frame2: PixelGrid,
  blockSize: number = 4,
  searchRadius: number = 8,
): MotionVector[][] {
  const height = frame1.length;
  const width = frame1[0]?.length || 0;
  const field: MotionVector[][] = [];

  const halfBlock = Math.floor(blockSize / 2);

  for (let y = 0; y < height; y++) {
    field[y] = [];
    for (let x = 0; x < width; x++) {
      // Skip transparent pixels
      if (!frame2[y][x]) {
        field[y][x] = { dx: 0, dy: 0, confidence: 0 };
        continue;
      }

      let bestDx = 0;
      let bestDy = 0;
      let bestScore = -1;

      // Search in frame1 for the best matching block
      for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
          let score = 0;
          let count = 0;

          for (let by = -halfBlock; by <= halfBlock; by++) {
            for (let bx = -halfBlock; bx <= halfBlock; bx++) {
              const f1x = x + dx + bx;
              const f1y = y + dy + by;
              const f2x = x + bx;
              const f2y = y + by;

              if (f1x >= 0 && f1x < width && f1y >= 0 && f1y < height &&
                  f2x >= 0 && f2x < width && f2y >= 0 && f2y < height) {
                const c1 = frame1[f1y][f1x];
                const c2 = frame2[f2y][f2x];
                if (c1 && c2 && c1 === c2) score++;
                if (c1 || c2) count++;
              }
            }
          }

          const normalizedScore = count > 0 ? score / count : 0;
          if (normalizedScore > bestScore) {
            bestScore = normalizedScore;
            bestDx = dx;
            bestDy = dy;
          }
        }
      }

      field[y][x] = { dx: bestDx, dy: bestDy, confidence: bestScore };
    }
  }

  return field;
}

/**
 * Accumulate motion fields across multiple frame pairs using weighted averaging.
 */
function accumulateMotionFields(fields: MotionVector[][][]): MotionVector[][] {
  if (fields.length === 0) return [];
  const height = fields[0].length;
  const width = fields[0][0]?.length || 0;
  const result: MotionVector[][] = [];

  for (let y = 0; y < height; y++) {
    result[y] = [];
    for (let x = 0; x < width; x++) {
      let totalDx = 0;
      let totalDy = 0;
      let totalConf = 0;
      let count = 0;

      for (const field of fields) {
        const v = field[y]?.[x];
        if (v && v.confidence > 0.3) {
          totalDx += v.dx * v.confidence;
          totalDy += v.dy * v.confidence;
          totalConf += v.confidence;
          count++;
        }
      }

      if (count > 0) {
        result[y][x] = {
          dx: totalDx / totalConf,
          dy: totalDy / totalConf,
          confidence: totalConf / count,
        };
      } else {
        result[y][x] = { dx: 0, dy: 0, confidence: 0 };
      }
    }
  }

  return result;
}

/**
 * Cluster pixels into regions based on motion similarity using region growing.
 * Pixels with similar motion vectors that are spatially connected are grouped together.
 */
function clusterByMotion(
  frame: PixelGrid,
  motionField: MotionVector[][],
  motionThreshold: number = 2.0,
  minRegionSize: number = 10,
): MotionRegion[] {
  const height = frame.length;
  const width = frame[0]?.length || 0;
  const visited: boolean[][] = Array.from({ length: height }, () => Array(width).fill(false));
  const regionMap: number[][] = Array.from({ length: height }, () => Array(width).fill(-1));
  const regions: MotionRegion[] = [];

  let regionId = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (visited[y][x] || !frame[y][x]) continue;

      // Start a new region via BFS
      const pixels: { x: number; y: number }[] = [];
      const queue: { x: number; y: number }[] = [{ x, y }];
      visited[y][x] = true;
      const baseMotion = motionField[y]?.[x] ?? { dx: 0, dy: 0 };

      // Track the average motion for this region (used for growing threshold)
      let regionSumDx = baseMotion.dx;
      let regionSumDy = baseMotion.dy;
      let regionCount = 1;

      while (queue.length > 0) {
        const curr = queue.shift()!;
        pixels.push(curr);
        regionMap[curr.y][curr.x] = regionId;

        // Running average motion for this region
        const avgDx = regionSumDx / regionCount;
        const avgDy = regionSumDy / regionCount;

        // Check 4-connected neighbors
        const neighbors = [
          { x: curr.x - 1, y: curr.y },
          { x: curr.x + 1, y: curr.y },
          { x: curr.x, y: curr.y - 1 },
          { x: curr.x, y: curr.y + 1 },
        ];

        for (const n of neighbors) {
          if (n.x < 0 || n.x >= width || n.y < 0 || n.y >= height) continue;
          if (visited[n.y][n.x] || !frame[n.y][n.x]) continue;

          const neighborMotion = motionField[n.y]?.[n.x] ?? { dx: 0, dy: 0, confidence: 0 };

          // Only consider neighbors with reasonable confidence
          if (neighborMotion.confidence < 0.1 && baseMotion.confidence < 0.1) {
            // Both low confidence — cluster by spatial proximity only if nearby
            visited[n.y][n.x] = true;
            queue.push(n);
            regionSumDx += neighborMotion.dx;
            regionSumDy += neighborMotion.dy;
            regionCount++;
            continue;
          }

          const motionDiff = Math.sqrt(
            Math.pow(neighborMotion.dx - avgDx, 2) +
            Math.pow(neighborMotion.dy - avgDy, 2)
          );

          if (motionDiff < motionThreshold) {
            visited[n.y][n.x] = true;
            queue.push(n);
            regionSumDx += neighborMotion.dx;
            regionSumDy += neighborMotion.dy;
            regionCount++;
          }
        }
      }

      if (pixels.length >= minRegionSize) {
        // Compute bounds and pivot
        let minX = width, minY = height, maxX = 0, maxY = 0;
        let sumX = 0, sumY = 0, sumDx = 0, sumDy = 0;

        for (const p of pixels) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
          sumX += p.x;
          sumY += p.y;
          const mv = motionField[p.y]?.[p.x];
          if (mv) {
            sumDx += mv.dx;
            sumDy += mv.dy;
          }
        }

        regions.push({
          id: `region_${regionId}`,
          pixels,
          pivotX: sumX / pixels.length,
          pivotY: sumY / pixels.length,
          avgMotion: { dx: sumDx / pixels.length, dy: sumDy / pixels.length },
          bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
          color: REGION_COLORS[regionId % REGION_COLORS.length],
        });

        regionId++;
      } else {
        // Too small, mark as unassigned for merging
        for (const p of pixels) {
          regionMap[p.y][p.x] = -1;
        }
      }
    }
  }

  // Merge small orphan pixels into nearest region
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (regionMap[y][x] === -1 && frame[y][x]) {
        let nearestRegion = -1;

        // Search outward for the nearest assigned pixel
        outer:
        for (let dist = 1; dist <= 10; dist++) {
          for (let dy = -dist; dy <= dist; dy++) {
            for (let dx = -dist; dx <= dist; dx++) {
              // Only check perimeter of the search square
              if (Math.abs(dx) !== dist && Math.abs(dy) !== dist) continue;
              const ny = y + dy;
              const nx = x + dx;
              if (ny >= 0 && ny < height && nx >= 0 && nx < width && regionMap[ny][nx] >= 0) {
                nearestRegion = regionMap[ny][nx];
                break outer;
              }
            }
          }
        }

        if (nearestRegion >= 0 && nearestRegion < regions.length) {
          regionMap[y][x] = nearestRegion;
          const region = regions[nearestRegion];
          region.pixels.push({ x, y });
        }
      }
    }
  }

  return regions;
}

/**
 * Convert ImageData to PixelGrid.
 */
export function imageDataToPixelGrid(imageData: ImageData): PixelGrid {
  const { width, height, data } = imageData;
  const pixels: PixelGrid = [];
  for (let y = 0; y < height; y++) {
    const row: PixelColor[] = [];
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      row.push(rgbaToHexOrNull(r, g, b, a));
    }
    pixels.push(row);
  }
  return pixels;
}

/**
 * Main entry point: analyze multi-frame animation and produce candidate parts.
 *
 * @param frames - Array of PixelGrid frames (at least 2)
 * @param blockSize - Block size for block matching (default: 4)
 * @param searchRadius - Search radius for block matching (default: 8)
 * @param motionThreshold - Threshold for clustering similar motion (default: 2.0)
 * @param minRegionSize - Minimum pixels for a valid region (default: 10)
 * @returns MotionAnalysisResult with detected regions and motion field
 */
export function analyzeMotionAndSplit(
  frames: PixelGrid[],
  blockSize: number = 4,
  searchRadius: number = 8,
  motionThreshold: number = 2.0,
  minRegionSize: number = 10,
): MotionAnalysisResult {
  if (frames.length < 2) {
    throw new Error('Motion analysis requires at least 2 frames');
  }

  // Compute motion fields for consecutive frame pairs
  const fields: MotionVector[][][] = [];
  for (let i = 0; i < frames.length - 1; i++) {
    fields.push(computeMotionField(frames[i], frames[i + 1], blockSize, searchRadius));
  }

  // Accumulate motion fields
  const accumulatedField = fields.length === 1 ? fields[0] : accumulateMotionFields(fields);

  // Use the last frame as the reference for clustering
  const referenceFrame = frames[frames.length - 1];
  const regions = clusterByMotion(referenceFrame, accumulatedField, motionThreshold, minRegionSize);

  return {
    regions,
    motionField: accumulatedField,
    width: referenceFrame[0]?.length || 0,
    height: referenceFrame.length,
  };
}
