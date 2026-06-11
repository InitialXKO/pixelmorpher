// ============================================================
// PixelMorpher - Effect Rendering Functions
// boxBlurAlpha, renderGlowEffect, renderParticleEffect, renderAfterimageEffect,
// createEdgeCanvas, renderMotionBlurEffect, computePhysicsOffset, getTranslateOffset,
// renderEffectTrackFrame, renderGlowStroke, renderParticleStroke, renderAfterimageStroke
// ============================================================

import type {
  Part,
  ModifierInstance,
  EffectTrack,
  EffectStroke,
  Keyframe,
  PixelGrid,
  ModifierParamValue,
} from '../types';
import { hexToRgb, lerpColor, dimColor } from './color-utils';
import { seededRandom, hashString } from './noise';
import { acquireCanvas, releaseCanvas } from './canvas-pool';

export function getTranslateOffset(modifiers: ModifierInstance[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const mod of modifiers) {
    if (!mod.enabled || mod.type !== 'translate') continue;
    x += Number(mod.params.offsetX) || 0;
    y += Number(mod.params.offsetY) || 0;
  }
  return { x, y };
}
// ============================================================
// Box Blur (for Glow Effect)
// ============================================================

/**
 * Apply multi-pass box blur to the alpha channel of ImageData.
 * 3 passes of box blur approximate a Gaussian blur.
 */
export function boxBlurAlpha(imageData: ImageData, radius: number): ImageData {
  const { width, height } = imageData;
  const pixelCount = width * height;
  const src = new Float32Array(pixelCount);
  const tmp = new Float32Array(pixelCount);

  // Extract alpha channel
  for (let i = 0; i < pixelCount; i++) {
    src[i] = imageData.data[i * 4 + 3];
  }

  // 3 passes of separable box blur
  for (let pass = 0; pass < 3; pass++) {
    // Horizontal pass: src -> tmp
    for (let y = 0; y < height; y++) {
      let sum = 0;
      let count = 0;
      // Initialize running sum for first pixel
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = Math.min(Math.max(dx, 0), width - 1);
        sum += src[y * width + nx];
        count++;
      }
      tmp[y * width] = sum / count;

      // Slide the window
      for (let x = 1; x < width; x++) {
        const addX = Math.min(x + radius, width - 1);
        const removeX = Math.max(x - radius - 1, 0);
        sum += src[y * width + addX] - src[y * width + removeX];
        tmp[y * width + x] = sum / count;
      }
    }

    // Vertical pass: tmp -> src
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = Math.min(Math.max(dy, 0), height - 1);
        sum += tmp[ny * width + x];
        count++;
      }
      src[x] = sum / count;

      for (let y = 1; y < height; y++) {
        const addY = Math.min(y + radius, height - 1);
        const removeY = Math.max(y - radius - 1, 0);
        sum += tmp[addY * width + x] - tmp[removeY * width + x];
        src[y * width + x] = sum / count;
      }
    }
  }

  // Write back to a new ImageData
  const result = new ImageData(
    new Uint8ClampedArray(imageData.data),
    width,
    height,
  );
  for (let i = 0; i < pixelCount; i++) {
    result.data[i * 4 + 3] = Math.min(255, Math.round(src[i]));
  }

  return result;
}
export function renderGlowEffect(
  ctx: CanvasRenderingContext2D,
  part: Part,
  mod: ModifierInstance,
  partCanvas: HTMLCanvasElement,
): void {
  const radius = Number(mod.params.radius) || 3;
  const color = String(mod.params.color) || '#ffff00';
  const intensity = Number(mod.params.intensity) || 0.5;

  const padding = radius * 2;
  const glowW = partCanvas.width + padding * 2;
  const glowH = partCanvas.height + padding * 2;

  // Create glow canvas
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowW;
  glowCanvas.height = glowH;
  const glowCtx = glowCanvas.getContext('2d')!;

  // Draw part centered on glow canvas
  glowCtx.drawImage(partCanvas, padding, padding);

  // Get image data and blur the alpha channel
  const imageData = glowCtx.getImageData(0, 0, glowW, glowH);
  const blurred = boxBlurAlpha(imageData, radius);

  // Tint with glow color and apply intensity
  const [r, g, b] = hexToRgb(color);
  for (let i = 0; i < blurred.data.length; i += 4) {
    const alpha = blurred.data[i + 3];
    if (alpha > 0) {
      blurred.data[i] = r;
      blurred.data[i + 1] = g;
      blurred.data[i + 2] = b;
      blurred.data[i + 3] = Math.round(alpha * intensity);
    }
  }
  glowCtx.putImageData(blurred, 0, 0);

  // Composite glow behind the part using additive blending
  // Note: pivot offset is already in the transform chain, so we only add padding offset
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(glowCanvas, -padding, -padding);
  ctx.restore();
}
export function renderParticleEffect(
  ctx: CanvasRenderingContext2D,
  part: Part,
  mod: ModifierInstance,
  currentFrame: number,
): void {
  const rate = Number(mod.params.rate) || 10;
  const speed = Number(mod.params.speed) || 2;
  const life = Number(mod.params.life) || 10;
  const color = String(mod.params.color) || '#ff8800';
  const gravity = Number(mod.params.gravity) || 0.5;

  const [r, g, b] = hexToRgb(color);
  const baseSeed = hashString(part.id);

  // Part center relative to pivot (origin is at pivot in current transform)
  const cx = part.width / 2 - part.pivotX;
  const cy = part.height / 2 - part.pivotY;

  ctx.save();

  // Render all particles alive at this frame
  const startBirth = Math.max(0, currentFrame - life + 1);
  for (let birthFrame = startBirth; birthFrame <= currentFrame; birthFrame++) {
    const seed = baseSeed + birthFrame * 7919;
    const rng = seededRandom(seed);

    for (let i = 0; i < rate; i++) {
      const age = currentFrame - birthFrame;
      const lifeRatio = age / life;

      // Random direction and speed variation
      const angle = rng() * Math.PI * 2;
      const speedVar = speed * (0.5 + rng() * 0.5);
      const sizeVar = 1 + Math.floor(rng() * 3); // 1-3px

      // Compute particle position at current age
      const vx = Math.cos(angle) * speedVar;
      const vy = Math.sin(angle) * speedVar;

      const px = cx + vx * age;
      const py = cy + vy * age + 0.5 * gravity * age * age;

      // Alpha fades as particle ages
      const alpha = Math.max(0, 1 - lifeRatio);

      ctx.globalAlpha = alpha;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(Math.round(px), Math.round(py), sizeVar, sizeVar);
    }
  }

  ctx.restore();
}

/**
 * Render afterimage effect: ghostly copies of the part trailing behind.
 * Direction determined by translate modifier offset.
 */
export function renderAfterimageEffect(
  ctx: CanvasRenderingContext2D,
  part: Part,
  mod: ModifierInstance,
  modifiers: ModifierInstance[],
  partCanvas: HTMLCanvasElement,
): void {
  const count = Number(mod.params.count) || 3;
  const opacity = Number(mod.params.opacity) || 0.3;
  const spacing = Number(mod.params.spacing) || 5;

  // Get movement direction from translate modifier
  const { x: dx, y: dy } = getTranslateOffset(modifiers);
  const len = Math.sqrt(dx * dx + dy * dy);

  // Normalize direction; trail goes opposite to movement
  let dirX: number;
  let dirY: number;
  if (len > 0.01) {
    dirX = -dx / len;
    dirY = -dy / len;
  } else {
    // Default trail direction: left
    dirX = -1;
    dirY = 0;
  }

  // Draw afterimage copies behind the part
  for (let i = 1; i <= count; i++) {
    const offsetDist = i * spacing;
    const alpha = opacity * (1 - (i - 1) / count);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      partCanvas,
      dirX * offsetDist,
      dirY * offsetDist,
    );
    ctx.restore();
  }
}

/** Create a canvas containing only the edge pixels of a part */
function createEdgeCanvas(part: Part, partCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const srcCtx = partCanvas.getContext('2d')!;
  const imageData = srcCtx.getImageData(0, 0, partCanvas.width, partCanvas.height);
  const edgeData = new Uint8ClampedArray(imageData.data);
  const w = partCanvas.width;
  const h = partCanvas.height;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (imageData.data[i + 3] === 0) continue; // skip transparent

      // Check 4-connected neighbors
      let isEdge = false;
      const neighbors: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [ddy, ddx] of neighbors) {
        const ny = y + ddy;
        const nx = x + ddx;
        if (ny < 0 || ny >= h || nx < 0 || nx >= w) {
          isEdge = true;
          break;
        }
        const ni = (ny * w + nx) * 4;
        if (imageData.data[ni + 3] === 0) {
          isEdge = true;
          break;
        }
      }

      if (!isEdge) {
        // Remove interior pixel
        edgeData[i + 3] = 0;
      }
    }
  }

  const edgeCanvas = document.createElement('canvas');
  edgeCanvas.width = w;
  edgeCanvas.height = h;
  const edgeCtx = edgeCanvas.getContext('2d')!;
  edgeCtx.putImageData(new ImageData(edgeData, w, h), 0, 0);
  return edgeCanvas;
}

/**
 * Render motion blur effect: trail of the part along the movement direction.
 * If edgesOnly is true, only blur the edge pixels.
 */
export function renderMotionBlurEffect(
  ctx: CanvasRenderingContext2D,
  part: Part,
  mod: ModifierInstance,
  modifiers: ModifierInstance[],
  partCanvas: HTMLCanvasElement,
): void {
  const length = Number(mod.params.length) || 5;
  const decay = Number(mod.params.decay) || 0.5;
  const edgesOnly = Boolean(mod.params.edgesOnly);

  // Get movement direction from translate modifier
  const { x: dx, y: dy } = getTranslateOffset(modifiers);
  const len = Math.sqrt(dx * dx + dy * dy);

  // Normalize direction; trail goes opposite to movement
  let dirX: number;
  let dirY: number;
  if (len > 0.01) {
    dirX = -dx / len;
    dirY = -dy / len;
  } else {
    // Default trail direction: left
    dirX = -1;
    dirY = 0;
  }

  // Use edge-only canvas if requested
  const blurCanvas = edgesOnly ? createEdgeCanvas(part, partCanvas) : partCanvas;

  // Draw blur trail with decreasing opacity
  ctx.save();
  for (let i = 1; i <= length; i++) {
    const t = i / length;
    // Decay controls how quickly opacity falls off
    // Higher decay = slower falloff = longer visible trail
    const alpha = Math.pow(1 - t, (1 - decay) * 4 + 1);
    const offsetDist = i;

    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      blurCanvas,
      dirX * offsetDist,
      dirY * offsetDist,
    );
  }
  ctx.restore();
}

// ============================================================
// ============================================================

/**
 * Compute the physics-based translation offset for the current frame.
 *
 * Improved simulation: projectile motion with gravity, bounce off a
 * "ground level" perpendicular to gravity direction, elasticity, and
 * per-frame damping.  Fully deterministic — uses frame number as time.
 *
 * Algorithm:
 * 1. Decompose gravity direction (angle in degrees) into (gx, gy) components.
 *    0° = right, 90° = down (standard screen coords).
 * 2. Gravity magnitude scales with frame number to produce realistic
 *    acceleration: v += g per frame, position += v per frame.
 * 3. The ground plane is perpendicular to gravity at a distance of 200px
 *    from origin along the gravity direction. When the particle crosses
 *    this plane, its velocity component along gravity is reversed and
 *    scaled by elasticity (0 = no bounce, 1 = perfect bounce).
 * 4. Damping is applied every frame to both velocity components:
 *    v *= (1 - damping * 0.1). This causes the particle to gradually
 *    slow down and settle.
 * 5. The simulation runs from frame 0 to currentFrame deterministically.
 */
export function computePhysicsOffset(
  modifiers: ModifierInstance[],
  currentFrame: number,
): { x: number; y: number } {
  for (const mod of modifiers) {
    if (!mod.enabled || mod.type !== 'simple_physics') continue;

    const gravityAngle = Number(mod.params.gravity) ?? 90;
    const elasticity = Number(mod.params.elasticity) ?? 0.5;
    const damping = Number(mod.params.damping) ?? 0.9;

    // Gravity direction: 0° = right, 90° = down
    const rad = (gravityAngle * Math.PI) / 180;
    const gravityMag = 0.5; // pixels per frame² (constant acceleration)
    const gx = Math.cos(rad) * gravityMag;
    const gy = Math.sin(rad) * gravityMag;

    // Gravity unit vector (for ground-plane projection)
    const gLen = Math.sqrt(gx * gx + gy * gy);
    const gnx = gLen > 0.0001 ? gx / gLen : 0;
    const gny = gLen > 0.0001 ? gy / gLen : 1; // default down if no gravity

    // Ground level: distance from origin along gravity direction
    const groundLevel = 200;

    // Per-frame damping factor: damping 0 → no damping, damping 1 → heavy damping
    const dampFactor = 1 - damping * 0.1;

    // Simulate from frame 0 to currentFrame
    let vx = 0;
    let vy = 0;
    let px = 0;
    let py = 0;

    for (let f = 0; f < currentFrame; f++) {
      // 1. Apply gravity acceleration
      vx += gx;
      vy += gy;

      // 2. Apply per-frame damping (reduces velocity each frame)
      vx *= dampFactor;
      vy *= dampFactor;

      // 3. Update position
      px += vx;
      py += vy;

      // 4. Bounce off ground level: project position onto gravity direction
      //    If the component along gravity exceeds groundLevel, reflect and apply elasticity
      const proj = px * gnx + py * gny; // scalar projection onto gravity direction

      if (proj > groundLevel) {
        // Push position back to ground level
        const overshoot = proj - groundLevel;
        px -= gnx * overshoot;
        py -= gny * overshoot;

        // Reflect velocity component along gravity, scaled by elasticity
        const vProj = vx * gnx + vy * gny;
        if (vProj > 0) {
          // Only bounce if moving towards ground
          vx -= (1 + elasticity) * vProj * gnx;
          vy -= (1 + elasticity) * vProj * gny;
        }
      }

      // Also bounce off the origin side (opposite of ground)
      if (proj < 0) {
        // Push position back to origin plane
        px -= gnx * proj;
        py -= gny * proj;

        const vProj = vx * gnx + vy * gny;
        if (vProj < 0) {
          vx -= (1 + elasticity) * vProj * gnx;
          vy -= (1 + elasticity) * vProj * gny;
        }
      }

      // Cross-axis bounds: prevent drift perpendicular to gravity
      // (perpendicular unit vector)
      const pnx = -gny;
      const pny = gnx;
      const crossProj = px * pnx + py * pny;
      const crossBound = 200;
      if (crossProj > crossBound) {
        px -= pnx * (crossProj - crossBound);
        const vCross = vx * pnx + vy * pny;
        if (vCross > 0) {
          vx -= (1 + elasticity) * vCross * pnx;
          vy -= (1 + elasticity) * vCross * pny;
        }
      } else if (crossProj < -crossBound) {
        px -= pnx * (crossProj + crossBound);
        const vCross = vx * pnx + vy * pny;
        if (vCross < 0) {
          vx -= (1 + elasticity) * vCross * pnx;
          vy -= (1 + elasticity) * vCross * pny;
        }
      }
    }

    return { x: px, y: py };
  }

  return { x: 0, y: 0 };
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

export function renderEffectTrackFrame(
  ctx: CanvasRenderingContext2D,
  effectTrack: EffectTrack,
  keyframe: { id: string; frame: number; params: Record<string, ModifierParamValue> },
  currentFrame: number,
  _canvasWidth: number,
  _canvasHeight: number,
): void {
  const params = keyframe.params;

  ctx.save();

  switch (effectTrack.type) {
    case 'glow': {
      // Global glow overlay
      const radius = Number(params.radius) || 3;
      const color = String(params.color) || '#ffff00';
      const intensity = Number(params.intensity) || 0.5;
      const [r, g, b] = hexToRgb(color);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = intensity * 0.3;
      ctx.fillStyle = `rgba(${r},${g},${b},1)`;
      // Draw a soft radial glow in the center
      const cx = _canvasWidth / 2;
      const cy = _canvasHeight / 2;
      for (let ring = radius * 4; ring >= 1; ring--) {
        const t = ring / (radius * 4);
        ctx.globalAlpha = intensity * 0.15 * (1 - t);
        ctx.beginPath();
        ctx.arc(cx, cy, ring * 8, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'particle': {
      // Global particle emission from center
      const rate = Number(params.rate) || 10;
      const speed = Number(params.speed) || 2;
      const life = Number(params.life) || 10;
      const color = String(params.color) || '#ff8800';
      const gravity = Number(params.gravity) || 0.5;
      const [r, g, b] = hexToRgb(color);
      const cx = _canvasWidth / 2;
      const cy = _canvasHeight / 2;
      const seed = hashString(effectTrack.id);
      const startBirth = Math.max(0, currentFrame - life + 1);
      for (let birthFrame = startBirth; birthFrame <= currentFrame; birthFrame++) {
        const frameSeed = seed + birthFrame * 7919;
        const rng = seededRandom(frameSeed);
        for (let i = 0; i < rate; i++) {
          const age = currentFrame - birthFrame;
          const lifeRatio = age / life;
          const angle = rng() * Math.PI * 2;
          const speedVar = speed * (0.5 + rng() * 0.5);
          const sizeVar = 1 + Math.floor(rng() * 3);
          const vx = Math.cos(angle) * speedVar;
          const vy = Math.sin(angle) * speedVar;
          const px = cx + vx * age;
          const py = cy + vy * age + 0.5 * gravity * age * age;
          const alpha = Math.max(0, 1 - lifeRatio) * 0.6;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(Math.round(px), Math.round(py), sizeVar, sizeVar);
        }
      }
      break;
    }
    case 'afterimage': {
      // Global afterimage is handled at the part level; this is a subtle overlay
      const count = Number(params.count) || 3;
      const opacity = Number(params.opacity) || 0.3;
      const spacing = Number(params.spacing) || 5;
      ctx.globalAlpha = opacity * 0.15;
      ctx.fillStyle = 'rgba(128, 0, 255, 0.1)';
      for (let i = 1; i <= count; i++) {
        ctx.fillRect(-i * spacing, 0, _canvasWidth, _canvasHeight);
      }
      break;
    }
    case 'pixel_displace': {
      // Global pixel displacement - slight wave effect
      const intensity = Number(params.intensity) || 2;
      const frequency = Number(params.frequency) || 0.1;
      const timeOffset = currentFrame * frequency * Math.PI * 2;
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = 'rgba(100, 255, 200, 0.05)';
      for (let y = 0; y < _canvasHeight; y += 4) {
        const dx = Math.sin((y * frequency + timeOffset) * Math.PI * 2) * intensity;
        ctx.fillRect(dx, y, _canvasWidth, 1);
      }
      break;
    }
    case 'motion_blur': {
      // Global motion blur overlay
      const length = Number(params.length) || 5;
      const decay = Number(params.decay) || 0.5;
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = 'rgba(200, 200, 255, 0.1)';
      for (let i = 1; i <= length; i++) {
        const t = i / length;
        const alpha = Math.pow(1 - t, (1 - decay) * 4 + 1) * 0.1;
        ctx.globalAlpha = alpha;
        ctx.fillRect(-i, 0, _canvasWidth, _canvasHeight);
      }
      break;
    }
  }

  ctx.restore();
}
