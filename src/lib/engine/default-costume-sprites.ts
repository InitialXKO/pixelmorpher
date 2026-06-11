// ============================================================
// PixelMorpher - Default Costume Sprite Generator
// Generates prefabricated default pixel art sprites for puppet nodes
// Each body part type gets a distinctive placeholder sprite
// ============================================================

import type { PixelGrid, PixelColor } from '../types';
import { createEmptyPixelGrid } from '../types';

// ---- Color Palette for Default Sprites ----
// A cohesive palette that looks good as placeholder art
const PALETTE = {
  // Skin tones
  skinLight: '#f5c6a0',
  skinMid: '#e8a87c',
  skinDark: '#c68642',

  // Clothing
  shirtPrimary: '#4a90d9',
  shirtShadow: '#3a70b0',
  shirtHighlight: '#6ab0f9',
  pantsPrimary: '#5b5b8a',
  pantsShadow: '#3e3e6a',
  pantsHighlight: '#7a7aaa',
  shoePrimary: '#4a3728',
  shoeShadow: '#3a2a1e',

  // Hair
  hairPrimary: '#5a3825',
  hairShadow: '#3e2518',
  hairHighlight: '#7a5035',

  // Outline
  outline: '#1a1a2e',

  // Body structure fill
  torsoFill: '#4a90d9',
  limbFill: '#5b5b8a',

  // Joint indicators
  jointDot: '#ff6b6b',
};

/** A single row of pixel data, using shorthand notation:
 *  - number = hex char pair (e.g. 0 → '00', ff → 'ff')
 *  - string = full hex color
 *  - null = transparent
 */
type PixelRow = (string | null)[];

// ---- Sprite Templates by Node Name Pattern ----
// Each template is a hand-crafted pixel art sprite for the body part

/** Create a PixelGrid from an array of rows, each row being hex color strings or null */
function rowsToPixelGrid(rows: PixelRow[]): PixelGrid {
  const h = rows.length;
  const w = rows.length > 0 ? Math.max(...rows.map(r => r.length)) : 0;
  const grid = createEmptyPixelGrid(w, h);
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      grid[y][x] = rows[y][x] as PixelColor;
    }
  }
  return grid;
}

// ---- Head Sprite (12×14 pixels) ----
function generateHeadSprite(): PixelGrid {
  const O = PALETTE.outline;
  const S = PALETTE.skinMid;
  const SL = PALETTE.skinLight;
  const H = PALETTE.hairPrimary;
  const HS = PALETTE.hairShadow;
  const HH = PALETTE.hairHighlight;
  const E = '#1a1a2e'; // eye
  const EW = '#ffffff'; // eye white

  return rowsToPixelGrid([
    // Row 0: hair top
    [null, null, null, O,  O,  O,  O,  O,  O,  O,  null, null],
    // Row 1: hair
    [null, null, O,  H,  H,  HH, HH, H,  H,  O,  null, null],
    // Row 2: hair + forehead
    [null, O,  H,  H,  HH, HH, HH, HH, H,  O,  null, null],
    // Row 3: hair + forehead edge
    [null, O,  H,  HS, S,  S,  S,  HS, H,  O,  null, null],
    // Row 4: forehead
    [null, O,  SL, S,  S,  S,  S,  S,  SL, O,  null, null],
    // Row 5: eyes
    [null, O,  SL, EW, E,  S,  E,  EW, SL, O,  null, null],
    // Row 6: nose area
    [null, O,  SL, S,  S,  SL, S,  S,  SL, O,  null, null],
    // Row 7: nose
    [null, null, O, S,  SL, SL, SL, S,  O,  null, null, null],
    // Row 8: cheeks + mouth area
    [null, null, O, SL, S,  S,  S,  SL, O,  null, null, null],
    // Row 9: mouth
    [null, null, O, S,  O,  O,  O,  S,  O,  null, null, null],
    // Row 10: chin
    [null, null, null, O, S,  S,  S,  O,  null, null, null, null],
    // Row 11: chin bottom
    [null, null, null, null, O,  SL, O,  null, null, null, null, null],
    // Row 12: neck start
    [null, null, null, null, O,  S,  O,  null, null, null, null, null],
    // Row 13: neck
    [null, null, null, null, O,  S,  O,  null, null, null, null, null],
  ]);
}

// ---- Torso Sprite (16×20 pixels) ----
function generateTorsoSprite(): PixelGrid {
  const O = PALETTE.outline;
  const T = PALETTE.shirtPrimary;
  const TS = PALETTE.shirtShadow;
  const TH = PALETTE.shirtHighlight;
  const S = PALETTE.skinMid;

  return rowsToPixelGrid([
    // Row 0: neck opening
    [null, null, null, null, null, O,  O,  O,  O,  O,  O,  null, null, null, null, null],
    // Row 1: shoulders top
    [null, null, null, O,  O,  S,  TH, TH, TH, TH, S,  O,  O,  null, null, null],
    // Row 2: shoulders
    [null, null, O,  S,  TH, TH, TH, TH, TH, TH, TH, TH, S,  O,  null, null],
    // Row 3: upper chest
    [null, null, O,  TH, TH, TH, TS, TH, TH, TS, TH, TH, TH, O,  null, null],
    // Row 4: chest
    [null, null, O,  TH, T,  TS, TS, T,  T,  TS, TS, T,  TH, O,  null, null],
    // Row 5: chest mid
    [null, O,  TH, T,  TS, TS, T,  T,  T,  T,  TS, TS, T,  TH, O,  null],
    // Row 6: chest detail
    [null, O,  T,  TS, TS, T,  T,  TH, TH, T,  T,  TS, TS, T,  O,  null],
    // Row 7: mid torso
    [null, O,  T,  TS, T,  T,  TH, TH, TH, TH, T,  T,  TS, T,  O,  null],
    // Row 8: mid torso detail
    [null, O,  T,  T,  T,  TH, TH, T,  T,  TH, TH, T,  T,  T,  O,  null],
    // Row 9: waist
    [null, null, O,  T,  T,  TH, T,  T,  T,  T,  TH, T,  T,  O,  null, null],
    // Row 10: waist detail
    [null, null, O,  T,  TS, T,  T,  T,  T,  T,  T,  TS, T,  O,  null, null],
    // Row 11: belt area
    [null, null, O,  TS, TS, TS, TS, TS, TS, TS, TS, TS, TS, O,  null, null],
    // Row 12: belt
    [null, null, O,  '#8b7355', '#8b7355', '#8b7355', '#8b7355', '#8b7355', '#8b7355', '#8b7355', '#8b7355', '#8b7355', '#8b7355', O,  null, null],
    // Row 13: belt bottom
    [null, null, O,  '#6b5540', '#6b5540', '#6b5540', '#6b5540', '#6b5540', '#6b5540', '#6b5540', '#6b5540', '#6b5540', '#6b5540', O,  null, null],
    // Row 14: lower torso
    [null, null, O,  T,  TS, T,  T,  T,  T,  T,  T,  TS, T,  O,  null, null],
    // Row 15: hip
    [null, null, O,  TS, T,  T,  T,  T,  T,  T,  T,  T,  TS, O,  null, null],
    // Row 16: hip detail
    [null, null, null, O,  T,  T,  T,  T,  T,  T,  T,  T,  O,  null, null, null],
    // Row 17: lower hip
    [null, null, null, O,  TS, TS, T,  T,  T,  T,  TS, TS, O,  null, null, null],
    // Row 18: bottom edge
    [null, null, null, null, O,  O,  O,  O,  O,  O,  O,  O,  null, null, null, null],
    // Row 19: bottom
    [null, null, null, null, null, O,  O,  O,  O,  O,  O,  null, null, null, null, null],
  ]);
}

// ---- Upper Arm Sprite (6×14 pixels) ----
function generateUpperArmSprite(isLeft: boolean): PixelGrid {
  const O = PALETTE.outline;
  const T = PALETTE.shirtPrimary;
  const TS = PALETTE.shirtShadow;
  const TH = PALETTE.shirtHighlight;
  const S = PALETTE.skinMid;
  const SL = PALETTE.skinLight;

  return rowsToPixelGrid([
    // Row 0: shoulder cap
    [null, O,  O,  O,  O,  null],
    // Row 1: top
    [O,  TH, TH, TH, TH, O],
    // Row 2: upper arm
    [O,  TH, T,  T,  TS, O],
    // Row 3: upper arm
    [O,  T,  T,  TS, TS, O],
    // Row 4: mid arm
    [O,  T,  TS, TS, T,  O],
    // Row 5: mid arm
    [O,  T,  TS, T,  T,  O],
    // Row 6: lower sleeve
    [O,  TH, T,  T,  TS, O],
    // Row 7: sleeve end
    [O,  TH, TH, TH, TS, O],
    // Row 8: sleeve cuff
    [O,  O,  O,  O,  O,  O],
    // Row 9: forearm skin
    [null, O,  SL, S,  O,  null],
    // Row 10: forearm
    [null, O,  S,  SL, O,  null],
    // Row 11: forearm
    [null, O,  SL, S,  O,  null],
    // Row 12: elbow
    [null, O,  S,  O,  null, null],
    // Row 13: elbow joint
    [null, null, O,  null, null, null],
  ]);
}

// ---- Lower Arm Sprite (4×10 pixels) ----
function generateLowerArmSprite(): PixelGrid {
  const O = PALETTE.outline;
  const S = PALETTE.skinMid;
  const SL = PALETTE.skinLight;
  const SD = PALETTE.skinDark;

  return rowsToPixelGrid([
    // Row 0: elbow joint
    [null, O,  O,  null],
    // Row 1: upper forearm
    [O,  SL, S,  O],
    // Row 2: forearm
    [O,  S,  SL, O],
    // Row 3: forearm mid
    [O,  SL, S,  O],
    // Row 4: wrist
    [O,  S,  SD, O],
    // Row 5: wrist narrow
    [null, O,  O,  null],
    // Row 6: hand top
    [O,  SL, SL, O],
    // Row 7: hand
    [O,  S,  SL, S, ],
    // Row 8: fingers
    [O,  SD, O,  SD],
    // Row 9: finger tips
    [null, O,  O,  null],
  ]);
}

// ---- Upper Leg Sprite (6×14 pixels) ----
function generateUpperLegSprite(): PixelGrid {
  const O = PALETTE.outline;
  const P = PALETTE.pantsPrimary;
  const PS = PALETTE.pantsShadow;
  const PH = PALETTE.pantsHighlight;

  return rowsToPixelGrid([
    // Row 0: hip joint
    [null, null, O,  O,  null, null],
    // Row 1: top of thigh
    [null, O,  PH, PH, O,  null],
    // Row 2: upper thigh
    [O,  PH, P,  P,  PS, O],
    // Row 3: upper thigh
    [O,  P,  P,  PS, PS, O],
    // Row 4: mid thigh
    [O,  PH, P,  PS, P,  O],
    // Row 5: mid thigh
    [O,  P,  PS, P,  PH, O],
    // Row 6: lower thigh
    [O,  PH, P,  P,  PS, O],
    // Row 7: knee area
    [O,  P,  P,  PS, P,  O],
    // Row 8: knee
    [O,  PH, PH, P,  PS, O],
    // Row 9: knee detail
    [O,  PH, P,  PS, P,  O],
    // Row 10: below knee
    [null, O,  P,  PS, O,  null],
    // Row 11: knee joint
    [null, O,  PS, O,  null, null],
    // Row 12: knee bottom
    [null, null, O,  null, null, null],
    // Row 13: joint
    [null, null, O,  null, null, null],
  ]);
}

// ---- Lower Leg Sprite (5×12 pixels) ----
function generateLowerLegSprite(): PixelGrid {
  const O = PALETTE.outline;
  const P = PALETTE.pantsPrimary;
  const PS = PALETTE.pantsShadow;
  const SH = PALETTE.shoePrimary;
  const SS = PALETTE.shoeShadow;

  return rowsToPixelGrid([
    // Row 0: knee joint
    [null, O,  O,  O,  null],
    // Row 1: shin top
    [O,  P,  PS, P,  O],
    // Row 2: shin
    [O,  PS, P,  PS, O],
    // Row 3: shin mid
    [O,  P,  PS, P,  O],
    // Row 4: ankle area
    [O,  PS, P,  P,  O],
    // Row 5: ankle
    [null, O,  P,  O,  null],
    // Row 6: shoe top
    [null, O,  SH, O,  null],
    // Row 7: shoe upper
    [O,  SH, SH, SS, O],
    // Row 8: shoe mid
    [O,  SH, SS, SH, O],
    // Row 9: shoe sole
    [O,  SS, SH, SS, O],
    // Row 10: shoe bottom
    [O,  O,  O,  O,  O],
    // Row 11: shoe tip
    [null, O,  O,  O,  null],
  ]);
}

// ---- Tail Sprite (4×8 pixels) ----
function generateTailSprite(): PixelGrid {
  const O = PALETTE.outline;
  const T = PALETTE.hairPrimary;
  const TS = PALETTE.hairShadow;

  return rowsToPixelGrid([
    [null, O,  O,  null],
    [O,  T,  TS, O],
    [O,  TS, T,  O],
    [null, O,  T,  O],
    [null, O,  TS, O],
    [null, null, O,  O],
    [null, null, null, O],
    [null, null, null, O],
  ]);
}

// ---- Body (Quadruped) Sprite (20×12 pixels) ----
function generateQuadrupedBodySprite(): PixelGrid {
  const O = PALETTE.outline;
  const B = '#8b7355';
  const BS = '#6b5540';
  const BH = '#a89070';
  const S = PALETTE.skinMid;

  return rowsToPixelGrid([
    // Row 0: top outline
    [null, null, null, O,  O,  O,  O,  O,  O,  O,  O,  O,  O,  O,  O,  O,  null, null, null, null],
    // Row 1: back top
    [null, null, O,  BH, BH, BH, B,  B,  B,  B,  B,  B,  B,  BH, BH, O,  null, null, null, null],
    // Row 2: back
    [null, O,  BH, B,  B,  B,  BS, BS, B,  B,  BS, BS, B,  B,  B,  BH, O,  null, null, null],
    // Row 3: mid body
    [O,  BH, B,  BS, BS, B,  B,  B,  B,  B,  B,  B,  B,  BS, BS, B,  BH, O,  null, null],
    // Row 4: belly area
    [O,  B,  BS, B,  B,  B,  BH, BH, BH, BH, BH, B,  B,  B,  B,  BS, B,  O,  null, null],
    // Row 5: belly
    [O,  BS, B,  B,  BH, BH, B,  BS, BS, B,  BH, BH, B,  B,  BH, B,  BS, O,  null, null],
    // Row 6: lower belly
    [O,  B,  B,  BH, B,  BS, B,  B,  B,  B,  BS, B,  B,  BH, B,  B,  B,  O,  null, null],
    // Row 7: underside
    [null, O,  BS, B,  B,  B,  BS, BS, B,  BS, BS, B,  B,  B,  BS, O,  O,  null, null, null],
    // Row 8: leg openings
    [null, O,  O,  null, null, O,  O,  null, null, O,  O,  null, null, O,  O,  null, null, null, null, null],
    // Row 9: leg tops
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    // Row 10: bottom
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    // Row 11: bottom edge
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  ]);
}

// ---- Quadruped Head Sprite (10×10 pixels) ----
function generateQuadrupedHeadSprite(): PixelGrid {
  const O = PALETTE.outline;
  const B = '#8b7355';
  const BS = '#6b5540';
  const BH = '#a89070';
  const E = '#1a1a2e';
  const EW = '#ffffff';
  const N = '#2a2020';

  return rowsToPixelGrid([
    [null, null, O,  O,  O,  O,  O,  null, null, null],
    [null, O,  BH, BH, B,  BH, B,  O,  null, null],
    [null, O,  B,  BS, B,  B,  BS, O,  null, null],
    [O,  BH, B,  EW, E,  B,  BS, B,  O,  null],
    [O,  B,  BS, B,  B,  BS, B,  B,  O,  null],
    [O,  BH, B,  BS, B,  B,  BH, B,  O,  null],
    [null, O,  B,  B,  N,  B,  B,  O,  null, null],
    [null, O,  BS, B,  B,  BS, O,  null, null, null],
    [null, null, O,  B,  B,  O,  null, null, null, null],
    [null, null, null, O,  O,  null, null, null, null, null],
  ]);
}

// ---- Quadruped Leg Sprite (4×10 pixels) ----
function generateQuadrupedLegSprite(): PixelGrid {
  const O = PALETTE.outline;
  const B = '#8b7355';
  const BS = '#6b5540';
  const SH = '#4a3728';
  const SS = '#3a2a1e';

  return rowsToPixelGrid([
    [null, O,  O,  null],
    [O,  B,  BS, O],
    [O,  BS, B,  O],
    [O,  B,  BS, O],
    [null, O,  B,  O],
    [null, O,  BS, O],
    [null, O,  SH, O],
    [O,  SH, SS, O],
    [O,  O,  O,  O],
    [null, O,  O,  null],
  ]);
}

// ---- Simple Body Sprite (12×14 pixels) ----
function generateSimpleBodySprite(): PixelGrid {
  const O = PALETTE.outline;
  const B = '#6a5acd';
  const BS = '#4a3aaa';
  const BH = '#8a7aee';

  return rowsToPixelGrid([
    [null, null, null, null, O,  O,  O,  O,  null, null, null, null],
    [null, null, null, O,  BH, BH, BH, BH, O,  null, null, null],
    [null, null, O,  BH, B,  BS, BS, B,  BH, O,  null, null],
    [null, O,  BH, B,  BS, B,  B,  BS, B,  BH, O,  null],
    [null, O,  B,  BS, B,  BH, BH, B,  BS, B,  O,  null],
    [null, O,  BH, B,  B,  B,  B,  B,  B,  BH, O,  null],
    [O,  BH, B,  BS, B,  B,  BH, BH, B,  BS, B,  BH, O],
    [O,  B,  B,  B,  BH, BH, B,  B,  BH, B,  B,  B,  O],
    [O,  BH, BS, B,  B,  B,  BS, BS, B,  B,  BS, BH, O],
    [O,  B,  B,  B,  BS, B,  B,  B,  BS, B,  B,  B,  O],
    [null, O,  BH, B,  B,  B,  B,  B,  B,  BH, O,  null],
    [null, O,  B,  BS, BS, B,  B,  BS, BS, B,  O,  null],
    [null, null, O,  B,  B,  BS, BS, B,  B,  O,  null, null],
    [null, null, null, O,  O,  O,  O,  O,  O,  null, null, null],
  ]);
}

// ---- Simple Head Sprite (10×10 pixels) ----
function generateSimpleHeadSprite(): PixelGrid {
  const O = PALETTE.outline;
  const B = '#6a5acd';
  const BS = '#4a3aaa';
  const BH = '#8a7aee';
  const E = '#1a1a2e';
  const EW = '#ffffff';

  return rowsToPixelGrid([
    [null, null, O,  O,  O,  O,  O,  O,  null, null],
    [null, O,  BH, BH, BH, BH, BH, BH, O,  null],
    [null, O,  BH, B,  BS, BS, B,  BH, O,  null],
    [O,  BH, B,  EW, E,  BS, E,  EW, B,  BH, O],
    [O,  B,  BS, B,  BS, B,  BS, B,  BS, B,  O],
    [O,  BH, B,  BS, B,  B,  B,  BS, B,  BH, O],
    [null, O,  BH, B,  B,  B,  B,  B,  BH, O,  null],
    [null, O,  B,  BS, BS, O,  BS, BS, B,  O,  null],
    [null, null, O,  B,  B,  B,  B,  B,  O,  null, null],
    [null, null, null, O,  O,  O,  O,  O,  null, null, null],
  ]);
}

// ---- Generic fallback sprite (6×6 colored block) ----
function generateGenericSprite(color: string, width: number = 6, height: number = 6): PixelGrid {
  const grid = createEmptyPixelGrid(width, height);
  const O = PALETTE.outline;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
        grid[y][x] = O;
      } else {
        grid[y][x] = color;
      }
    }
  }
  return grid;
}

// ---- Public API ----

export interface DefaultSpriteResult {
  /** The generated pixel grid */
  pixels: PixelGrid;
  /** Suggested width */
  width: number;
  /** Suggested height */
  height: number;
  /** Suggested pivot X (at the attachment point for puppet nodes) */
  pivotX: number;
  /** Suggested pivot Y (at the attachment point for puppet nodes) */
  pivotY: number;
  /** Suggested part name */
  partName: string;
}

/**
 * Generate a default costume sprite for a puppet node based on its name and template.
 *
 * Node name patterns recognized:
 * - "head" → humanoid head with face
 * - "torso" → humanoid torso with shirt
 * - "upper_arm_L/R" → upper arm with sleeve
 * - "lower_arm_L/R" → forearm with hand
 * - "upper_leg_L/R" → upper leg with pants
 * - "lower_leg_L/R" → lower leg with shoe
 * - "tail" → animal tail
 * - "body" → quadruped/simple body
 * - "front_leg_L/R", "back_leg_L/R" → quadruped leg
 * - Fallback: colored block based on node color
 */
export function generateDefaultCostumeSprite(
  nodeName: string,
  templateName: string,
  nodeColor: string = '#888888',
): DefaultSpriteResult {
  const name = nodeName.toLowerCase();

  // Humanoid template sprites
  if (name === 'head') {
    if (templateName === 'quadruped') {
      const pixels = generateQuadrupedHeadSprite();
      // Pivot at neck (bottom center) — plug connects here
      // Neck at row 9 is columns 3-4, center ≈ 4
      return { pixels, width: pixels[0]?.length ?? 10, height: pixels.length, pivotX: 4, pivotY: 9, partName: '头' };
    }
    if (templateName === 'simple') {
      const pixels = generateSimpleHeadSprite();
      // Pivot at neck (bottom center) — plug connects here
      // Neck at row 9 is columns 3-7, center at 5
      return { pixels, width: pixels[0]?.length ?? 10, height: pixels.length, pivotX: 5, pivotY: 9, partName: '头' };
    }
    const pixels = generateHeadSprite();
    // Pivot at neck (bottom center) — plug connects here to parent's neck socket
    // Neck at row 13 is columns 5-6, center at 6
    return { pixels, width: pixels[0]?.length ?? 12, height: pixels.length, pivotX: 6, pivotY: 13, partName: '头' };
  }

  if (name === 'torso') {
    const pixels = generateTorsoSprite();
    // Pivot at shoulder area (row 2, center) — root node's anchor
    // Sockets relative to this pivot:
    //   neck: (0, -2) → sprite(8,0) row0 neck opening ✓
    //   shoulder_L: (-5, 0) → sprite(3,2) row2 left shoulder ✓
    //   shoulder_R: (5, 0) → sprite(13,2) row2 right shoulder ✓
    //   hip_L: (-3, 16) → sprite(5,18) row18 left hip ✓
    //   hip_R: (3, 16) → sprite(11,18) row18 right hip ✓
    return { pixels, width: pixels[0]?.length ?? 16, height: pixels.length, pivotX: 8, pivotY: 2, partName: '躯干' };
  }

  if (name.startsWith('upper_arm')) {
    const isLeft = name.endsWith('l');
    const pixels = generateUpperArmSprite(isLeft);
    // Pivot at shoulder cap (top center, row 0) — plug connects here to parent's shoulder socket
    // Elbow socket at sprite pixel (3, 12): socket.localY = 12 - 0 = 12
    return { pixels, width: pixels[0]?.length ?? 6, height: pixels.length, pivotX: 3, pivotY: 0, partName: isLeft ? '左上臂' : '右上臂' };
  }

  if (name.startsWith('lower_arm')) {
    const pixels = generateLowerArmSprite();
    // Pivot at elbow joint (top center, row 0) — plug connects here to parent's elbow socket
    return { pixels, width: pixels[0]?.length ?? 4, height: pixels.length, pivotX: 2, pivotY: 0, partName: name.endsWith('l') ? '左前臂' : '右前臂' };
  }

  if (name.startsWith('upper_leg')) {
    const pixels = generateUpperLegSprite();
    // Pivot at hip joint (top center, row 0) — plug connects here to parent's hip socket
    // Knee socket at sprite pixel (3, 12): socket.localY = 12 - 0 = 12
    return { pixels, width: pixels[0]?.length ?? 6, height: pixels.length, pivotX: 3, pivotY: 0, partName: name.endsWith('l') ? '左大腿' : '右大腿' };
  }

  if (name.startsWith('lower_leg')) {
    const pixels = generateLowerLegSprite();
    // Pivot at knee joint (top center, row 0) — plug connects here to parent's knee socket
    return { pixels, width: pixels[0]?.length ?? 5, height: pixels.length, pivotX: 2, pivotY: 0, partName: name.endsWith('l') ? '左小腿' : '右小腿' };
  }

  if (name === 'tail') {
    const pixels = generateTailSprite();
    // Pivot at tail base (top center, row 0) — plug connects here to parent's tail socket
    return { pixels, width: pixels[0]?.length ?? 4, height: pixels.length, pivotX: 2, pivotY: 0, partName: '尾巴' };
  }

  // Quadruped body
  if (name === 'body') {
    if (templateName === 'quadruped') {
      const pixels = generateQuadrupedBodySprite();
      // Pivot at center — root node anchor
      // Sockets relative to this pivot:
      //   head_attach(0,-4) → sprite(10,1) row1 back top ✓
      //   tail_attach(3,2) → sprite(13,7) row7 underside ✓
      //   front_leg_L(-7,3) → sprite(3,8) row8 leg opening ✓
      //   front_leg_R(-3,3) → sprite(7,8) row8 leg opening ✓
      //   back_leg_L(2,3) → sprite(12,8) row8 leg opening ✓
      //   back_leg_R(5,3) → sprite(15,8) row8 leg opening ✓
      return { pixels, width: pixels[0]?.length ?? 20, height: pixels.length, pivotX: 10, pivotY: 5, partName: '身体' };
    }
    const pixels = generateSimpleBodySprite();
    // Pivot at head_attach socket area — root node anchor
    return { pixels, width: pixels[0]?.length ?? 12, height: pixels.length, pivotX: 6, pivotY: 2, partName: '身体' };
  }

  // Quadruped legs
  if (name.includes('leg') || name.includes('arm')) {
    if (templateName === 'quadruped') {
      const pixels = generateQuadrupedLegSprite();
      // Pivot at top center (row 0) — plug connects here to parent's leg socket
      return { pixels, width: pixels[0]?.length ?? 4, height: pixels.length, pivotX: 2, pivotY: 0, partName: nodeName };
    }
  }

  // Generic fallback
  const pixels = generateGenericSprite(nodeColor, 8, 8);
  return { pixels, width: pixels[0]?.length ?? 8, height: pixels.length, pivotX: 4, pivotY: 4, partName: nodeName };
}

/**
 * Generate all default costume sprites for a given puppet template.
 * Returns a map of nodeName → DefaultSpriteResult.
 */
function generateAllDefaultSprites(
  templateName: string,
  nodeNames: string[],
  nodeColors: string[] = [],
): Map<string, DefaultSpriteResult> {
  const result = new Map<string, DefaultSpriteResult>();
  for (let i = 0; i < nodeNames.length; i++) {
    const color = nodeColors[i] ?? '#888888';
    result.set(nodeNames[i], generateDefaultCostumeSprite(nodeNames[i], templateName, color));
  }
  return result;
}
