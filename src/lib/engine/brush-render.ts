// ============================================================
// PixelMorpher - Brush/Stroke Rendering
// renderMotionBlurStroke, renderEffectStroke, applyAutoMotionBlur,
// glow/particle/afterimage stroke rendering
// ============================================================

import type {
  MotionBlurStroke,
  EffectStroke,
  Part,
  Keyframe,
  ModifierInstance,
} from '../types';
import { hexToRgb } from './color-utils';
import { hashString, seededRandom } from './noise';
import { getTranslateOffset } from './effect-render';

// ============================================================
// Motion Blur Stroke Rendering
// ============================================================

/**
 * Render a motion blur stroke on the canvas.
 * Linear blur: blurs along the stroke direction
 * Radial blur: blurs outward from center of stroke
 * Directional blur: blurs at a configured angle
 */
export function renderMotionBlurStroke(
  ctx: CanvasRenderingContext2D,
  stroke: MotionBlurStroke,
): void {
  if (stroke.points.length < 2) return;

  const intensity = stroke.intensity;
  const [r, g, b] = hexToRgb('#ffffff'); // Blur is always white/gray tint

  ctx.save();

  // Apply blend mode
  const blendMode = stroke.blendMode ?? 'normal';
  const compositeOp: Record<string, GlobalCompositeOperation> = {
    normal: 'source-over',
    lighter: 'lighter',
    overlay: 'overlay',
    screen: 'screen',
  };
  ctx.globalCompositeOperation = compositeOp[blendMode] ?? 'source-over';

  switch (stroke.brushType) {
    case 'linear': {
      // Blur along the stroke path direction
      for (let i = 0; i < stroke.points.length - 1; i++) {
        const p1 = stroke.points[i];
        const p2 = stroke.points[i + 1];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.01) continue;

        const dirX = dx / len;
        const dirY = dy / len;

        // Draw smear copies along the direction
        const steps = Math.max(1, Math.floor(intensity));
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const alpha = (1 - t) * 0.4 * (intensity / 10);
          const mx = p1.x + dirX * s * 2;
          const my = p1.y + dirY * s * 2;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = `rgba(${r},${g},${b},1)`;
          ctx.fillRect(Math.round(mx), Math.round(my), 2, 2);
        }

        // Draw the blur trail line
        ctx.globalAlpha = 0.3 * (intensity / 10);
        ctx.strokeStyle = `rgba(${r},${g},${b},0.5)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
      break;
    }

    case 'radial': {
      // Blur outward from center of stroke
      const cx = stroke.points.reduce((sum, p) => sum + p.x, 0) / stroke.points.length;
      const cy = stroke.points.reduce((sum, p) => sum + p.y, 0) / stroke.points.length;

      for (const point of stroke.points) {
        const dx = point.x - cx;
        const dy = point.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.01) continue;

        const dirX = dx / dist;
        const dirY = dy / dist;

        const steps = Math.max(1, Math.floor(intensity));
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const alpha = (1 - t) * 0.35 * (intensity / 10);
          const mx = point.x + dirX * s * 2;
          const my = point.y + dirY * s * 2;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = `rgba(${r},${g},${b},1)`;
          ctx.fillRect(Math.round(mx), Math.round(my), 2, 2);
        }
      }
      break;
    }

    case 'directional': {
      // Blur at a configured angle
      const angleRad = (stroke.direction * Math.PI) / 180;
      const dirX = Math.cos(angleRad);
      const dirY = Math.sin(angleRad);

      for (const point of stroke.points) {
        const steps = Math.max(1, Math.floor(intensity));
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const alpha = (1 - t) * 0.35 * (intensity / 10);
          const mx = point.x + dirX * s * 2;
          const my = point.y + dirY * s * 2;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = `rgba(${r},${g},${b},1)`;
          ctx.fillRect(Math.round(mx), Math.round(my), 2, 2);
        }
      }
      break;
    }
  }

  ctx.restore();
}

// ============================================================
// Effect Stroke Rendering
// ============================================================

/**
 * Render a glow effect stroke on the canvas.
 * Paints soft glowing circles along the stroke path.
 */
function renderGlowStroke(
  ctx: CanvasRenderingContext2D,
  stroke: EffectStroke,
): void {
  const radius = stroke.radius;
  const intensity = stroke.intensity;
  const [r, g, b] = hexToRgb(stroke.color);

  ctx.save();

  for (const point of stroke.points) {
    // Draw concentric circles with decreasing alpha
    for (let ring = radius; ring >= 1; ring--) {
      const t = ring / radius;
      const alpha = intensity * (1 - t) * 0.6;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `rgba(${r},${g},${b},1)`;

      // Draw a filled circle approximation with pixels
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (dx * dx + dy * dy <= ring * ring) {
            ctx.fillRect(
              Math.round(point.x + dx),
              Math.round(point.y + dy),
              1,
              1,
            );
          }
        }
      }
    }
  }

  ctx.restore();
}

/**
 * Render a particle effect stroke on the canvas.
 * Sprinkles small dots along the stroke path using deterministic random.
 */
function renderParticleStroke(
  ctx: CanvasRenderingContext2D,
  stroke: EffectStroke,
): void {
  const density = stroke.density ?? 10;
  const spread = stroke.spread ?? 5;
  const intensity = stroke.intensity;
  const [r, g, b] = hexToRgb(stroke.color);

  ctx.save();

  for (let i = 0; i < stroke.points.length; i++) {
    const point = stroke.points[i];
    const seed = hashString(stroke.id + i.toString());
    const rng = seededRandom(seed);

    for (let d = 0; d < density; d++) {
      const ox = (rng() - 0.5) * spread * 2;
      const oy = (rng() - 0.5) * spread * 2;
      const size = rng() > 0.5 ? 2 : 1;
      const alpha = intensity * (0.5 + rng() * 0.5);

      ctx.globalAlpha = alpha;
      ctx.fillStyle = `rgba(${r},${g},${b},1)`;
      ctx.fillRect(
        Math.round(point.x + ox),
        Math.round(point.y + oy),
        size,
        size,
      );
    }
  }

  ctx.restore();
}

/**
 * Render an afterimage effect stroke on the canvas.
 * Creates semi-transparent copies of nearby pixels offset along the stroke direction.
 */
function renderAfterimageStroke(
  ctx: CanvasRenderingContext2D,
  stroke: EffectStroke,
): void {
  if (stroke.points.length < 2) return;

  const spread = stroke.spread ?? 5;
  const intensity = stroke.intensity;

  ctx.save();

  // Calculate overall stroke direction
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const dirX = len > 0.01 ? dx / len : -1;
  const dirY = len > 0.01 ? dy / len : 0;

  // Sample pixels from the canvas around the stroke points and offset them
  const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  const w = ctx.canvas.width;

  // Draw ghostly copies of nearby pixels
  const copyCount = Math.max(1, Math.floor(spread));
  for (let c = 1; c <= copyCount; c++) {
    const offsetDist = c * 2;
    const alpha = intensity * (1 - c / (copyCount + 1)) * 0.5;

    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;

    // Create a shifted copy of the image data around stroke points
    for (const point of stroke.points) {
      const px = Math.round(point.x + dirX * offsetDist);
      const py = Math.round(point.y + dirY * offsetDist);

      // Sample from original position
      const sx = Math.round(point.x);
      const sy = Math.round(point.y);

      if (sx >= 0 && sx < ctx.canvas.width && sy >= 0 && sy < ctx.canvas.height) {
        const idx = (sy * w + sx) * 4;
        if (imageData.data[idx + 3] > 0) {
          const [r2, g2, b2] = hexToRgb(stroke.color);
          ctx.fillStyle = `rgba(${r2},${g2},${b2},${alpha})`;
          ctx.fillRect(px, py, 1, 1);
        }
      }
    }
  }

  ctx.restore();
}

/**
 * Render an effect stroke on the canvas.
 * Dispatches to the appropriate effect type renderer.
 */
export function renderEffectStroke(
  ctx: CanvasRenderingContext2D,
  stroke: EffectStroke,
): void {
  // P2-2: Handle coordinateMode for effect strokes
  const coordinateMode = stroke.coordinateMode || 'follow_part';

  // Apply blend mode
  const blendMode = stroke.blendMode ?? 'normal';
  const compositeOp: Record<string, GlobalCompositeOperation> = {
    normal: 'source-over',
    lighter: 'lighter',
    overlay: 'overlay',
    screen: 'screen',
  };

  ctx.save();

  // P2-2: For world_fixed mode, we don't apply the part's transform
  // The caller is responsible for NOT applying the part transform before calling this
  // For follow_part mode (default), the part transform is already applied by the caller

  ctx.globalCompositeOperation = compositeOp[blendMode] ?? 'source-over';

  switch (stroke.type) {
    case 'glow_brush':
      renderGlowStroke(ctx, stroke);
      break;
    case 'particle_brush':
      renderParticleStroke(ctx, stroke);
      break;
    case 'afterimage_brush':
      renderAfterimageStroke(ctx, stroke);
      break;
  }

  ctx.restore();
}

// ============================================================
// Auto Motion Blur
// ============================================================

/**
 * Apply auto motion blur by comparing current and previous keyframe translate offsets.
 * Generates a motion blur trail in the direction of movement.
 */
export function applyAutoMotionBlur(
  ctx: CanvasRenderingContext2D,
  part: Part,
  currentFrame: number,
  keyframes: Keyframe[],
  intensity: number,
  partCanvas: HTMLCanvasElement,
  animVelocity?: { vx: number; vy: number },  // M5: animation modifier velocity
): void {
  // Find the current and previous keyframes
  const partKeyframes = keyframes
    .filter((k) => k.partId === part.id)
    .sort((a, b) => a.frame - b.frame);

  let currentKf: Keyframe | null = null;
  let prevKf: Keyframe | null = null;

  for (const kf of partKeyframes) {
    if (kf.frame <= currentFrame) {
      prevKf = currentKf;
      currentKf = kf;
    }
  }

  if (!currentKf) return;

  // Get current translate offset
  const currentOffset = getTranslateOffset(currentKf.modifiers);
  const prevOffset = prevKf ? getTranslateOffset(prevKf.modifiers) : { x: 0, y: 0 };

  // M5: Combine keyframe velocity with animation modifier velocity
  let totalDx = currentOffset.x - prevOffset.x;
  let totalDy = currentOffset.y - prevOffset.y;

  if (animVelocity) {
    totalDx += animVelocity.vx;
    totalDy += animVelocity.vy;
  }

  const totalDist = Math.sqrt(totalDx * totalDx + totalDy * totalDy);

  if (totalDist < 1) return; // No movement, no blur

  // Normalize direction; trail goes opposite to movement
  const dirX = -totalDx / totalDist;
  const dirY = -totalDy / totalDist;

  // Scale blur length by intensity
  const blurLength = Math.min(totalDist * intensity * 2, 50);

  ctx.save();
  for (let i = 1; i <= blurLength; i++) {
    const t = i / blurLength;
    const alpha = Math.pow(1 - t, 2) * intensity * 0.5;
    const offsetDist = i;

    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      partCanvas,
      dirX * offsetDist,
      dirY * offsetDist,
    );
  }
  ctx.restore();
}
