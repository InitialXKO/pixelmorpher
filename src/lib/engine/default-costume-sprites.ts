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
    [null, null, null, null, O,  O,  O,  O,  null, null, null, null, null],
    [null, null, null, O,  BH, BH, BH, BH, O,  null, null, null, null],
    [null, null, O,  BH, B,  BS, BS, B,  BH, O,  null, null, null],
    [null, O,  BH, B,  BS, B,  B,  BS, B,  BH, O,  null, null],
    [null, O,  B,  BS, B,  BH, BH, B,  BS, B,  O,  null, null],
    [null, O,  BH, B,  B,  B,  B,  B,  B,  BH, O,  null, null],
    [O,  BH, B,  BS, B,  B,  BH, BH, B,  BS, B,  BH, O],
    [O,  B,  B,  B,  BH, BH, B,  B,  BH, B,  B,  B,  O],
    [O,  BH, BS, B,  B,  B,  BS, BS, B,  B,  BS, BH, O],
    [O,  B,  B,  B,  BS, B,  B,  B,  BS, B,  B,  B,  O],
    [null, O,  BH, B,  B,  B,  B,  B,  B,  BH, O,  null, null],
    [null, O,  B,  BS, BS, B,  B,  BS, BS, B,  O,  null, null],
    [null, null, O,  B,  B,  BS, BS, B,  B,  O,  null, null, null],
    [null, null, null, O,  O,  O,  O,  O,  O,  null, null, null, null],
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
    [null, null, O,  O,  O,  O,  O,  O,  null, null, null],
    [null, O,  BH, BH, BH, BH, BH, BH, O,  null, null],
    [null, O,  BH, B,  BS, BS, B,  BH, O,  null, null],
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

// ============================================================
// Mecha template sprites (templateName === 'mecha')
// Same 10-node humanoid rig, gunmetal armor + orange reactor + cyan energy lines
// ============================================================

const MECHA = {
  M: '#9aa3b5',   // armor light
  MS: '#6b7285',  // armor shadow
  MD: '#454b5a',  // armor dark
  ACC: '#ff9f1c', // reactor orange
  ACD: '#c96f0a', // reactor dark
  E: '#22d3ee',   // energy cyan
  ED: '#0e7490',  // energy dark
};

/** Mecha head (12×14), pivot at neck bottom */
/** Mecha template sprites (redrawn: front + side) */
// ============================================================
// 机甲模板默认精灵（重绘版）
// 依赖：PALETTE（含 outline '#1a1a2e'）、rowsToPixelGrid、DefaultSpriteResult
// 设计语言：浅灰白装甲 + 深色机械关节 + 蓝色点缀 + 青色发光件，
//          板件刻线、铆钉、散热格栅，拼装感。
// 铁律：每行列数一致、闭合轮廓（carve 由向导程序化处理）、pivot 在关节上。
// ============================================================

// ---------- 正面 ----------

function generateMechaHeadSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const A = '#c8ccd4'; // 浅灰白装甲
  const AS = '#9aa3b5'; // 装甲阴影
  const J = '#3a3f4a'; // 深色机械关节
  const JD = '#2a2e38'; // 关节暗部
  const C = '#22d3ee'; // 青色发光 visor
  const CD = '#0e7490'; // 发光暗部
  const Y = '#f5c518'; // 金色 V 字天线
  const AD = '#7a8090'; // 刻线
  const pixels = rowsToPixelGrid([
    [null, null, Y, null, null, null, null, null, null, Y, null, null],
    [null, null, Y, null, null, null, null, null, null, Y, null, null],
    [null, null, null, Y, O, O, O, O, Y, null, null, null],
    [null, null, null, null, O, A, A, A, A, O, null, null],
    [null, null, null, O, A, A, AS, AS, A, A, O, null],
    [null, null, O, A, O, C, C, C, C, O, A, O],
    [null, null, O, A, O, CD, CD, CD, CD, O, A, O],
    [null, null, O, AS, A, A, A, A, A, AS, O, null],
    [null, null, null, O, A, AD, AD, AD, AD, A, O, null],
    [null, null, null, O, AS, J, J, J, J, AS, O, null],
    [null, null, null, null, O, J, JD, JD, J, O, null, null],
    [null, null, null, null, null, O, J, J, O, null, null, null],
    [null, null, null, null, null, O, J, J, O, null, null, null],
    [null, null, null, null, null, O, O, O, O, null, null, null],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 6, pivotY: 13, partName: '机甲头' };
}

function generateMechaTorsoSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const A = '#c8ccd4';
  const AS = '#9aa3b5';
  const AD = '#7a8090';
  const J = '#3a3f4a';
  const JD = '#2a2e38';
  const B = '#2a7fff'; // 蓝色点缀（驾驶舱盖）
  const C = '#22d3ee'; // 腰部发光件
  const pixels = rowsToPixelGrid([
    [null, null, null, null, null, O, O, O, O, O, O, null, null, null, null, null],
    [null, O, A, A, O, O, A, A, A, A, O, O, A, A, O, null],
    [null, O, AS, A, O, O, A, AS, AS, A, O, O, A, AS, O, null],
    [null, O, A, AD, O, O, A, B, B, A, O, O, A, AD, O, null],
    [null, O, AS, A, O, O, J, J, J, J, O, O, A, AS, O, null],
    [null, O, A, A, O, O, J, JD, JD, J, O, O, A, A, O, null],
    [null, null, O, A, A, A, AD, AD, A, A, AD, AD, A, A, O, null],
    [null, null, O, AS, A, A, A, A, A, A, A, A, AS, O, null, null],
    [null, null, O, A, AD, A, A, A, A, A, A, AD, A, O, null, null],
    [null, null, O, AS, A, A, A, A, A, A, A, A, AS, O, null, null],
    [null, null, null, null, O, J, JD, J, J, JD, J, O, null, null, null, null],
    [null, null, null, null, O, JD, C, J, J, C, JD, O, null, null, null, null],
    [null, null, null, null, O, J, J, J, J, J, J, O, null, null, null, null],
    [null, null, null, null, O, O, J, J, J, J, O, O, null, null, null, null],
    [null, null, null, O, A, A, A, A, A, A, A, A, A, O, null, null],
    [null, null, null, O, AS, A, AD, A, A, AD, A, AS, O, null, null, null],
    [null, null, null, O, A, A, A, A, A, A, A, A, A, O, null, null],
    [null, null, null, null, O, A, A, A, A, A, A, O, null, null, null, null],
    [null, null, null, null, O, J, O, null, null, O, J, O, null, null, null, null],
    [null, null, null, null, O, O, O, null, null, O, O, O, null, null, null, null],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 8, pivotY: 2, partName: '机甲躯干' };
}

function generateMechaUpperArmSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const A = '#c8ccd4';
  const AS = '#9aa3b5';
  const AD = '#7a8090';
  const J = '#3a3f4a';
  const JD = '#2a2e38';
  const B = '#2a7fff';
  const pixels = rowsToPixelGrid([
    [null, O, O, O, O, null],
    [O, A, A, A, A, O],
    [O, A, AD, A, A, O],
    [O, AS, A, A, AS, O],
    [O, A, A, A, A, O],
    [O, A, AD, AD, A, O],
    [O, AS, A, A, AS, O],
    [O, A, A, B, A, O],
    [null, O, J, J, O, null],
    [null, O, JD, J, O, null],
    [null, O, J, JD, O, null],
    [null, O, J, J, O, null],
    [null, O, JD, J, O, null],
    [null, O, O, O, O, null],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 3, pivotY: 0, partName: '机甲上臂' };
}

function generateMechaLowerArmSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const A = '#c8ccd4';
  const AS = '#9aa3b5';
  const AD = '#7a8090';
  const J = '#3a3f4a';
  const B = '#2a7fff';
  const pixels = rowsToPixelGrid([
    [O, O, O, O],
    [O, A, A, O],
    [O, A, AD, O],
    [O, AS, A, O],
    [O, A, A, O],
    [O, A, B, O],
    [O, AS, A, O],
    [O, A, A, O],
    [O, J, J, O],
    [O, O, O, O],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 2, pivotY: 0, partName: '机甲前臂' };
}

function generateMechaUpperLegSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const A = '#c8ccd4';
  const AS = '#9aa3b5';
  const AD = '#7a8090';
  const J = '#3a3f4a';
  const JD = '#2a2e38';
  const B = '#2a7fff';
  const C = '#22d3ee';
  const pixels = rowsToPixelGrid([
    [null, O, O, O, O, null],
    [O, A, A, A, A, O],
    [O, A, AD, A, A, O],
    [O, AS, A, A, AS, O],
    [O, A, A, A, A, O],
    [O, A, AD, AD, A, O],
    [O, AS, A, A, AS, O],
    [O, A, A, B, A, O],
    [null, O, J, J, O, null],
    [null, O, JD, C, O, null],
    [null, O, J, JD, O, null],
    [null, O, O, O, O, null],
    [null, O, J, J, O, null],
    [null, O, O, O, O, null],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 3, pivotY: 0, partName: '机甲大腿' };
}

function generateMechaLowerLegSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const A = '#c8ccd4';
  const AS = '#9aa3b5';
  const AD = '#7a8090';
  const J = '#3a3f4a';
  const B = '#2a7fff';
  const pixels = rowsToPixelGrid([
    [null, O, O, O, null],
    [O, A, A, A, O],
    [O, A, AD, A, O],
    [O, AS, A, AS, O],
    [O, A, A, A, O],
    [O, A, B, A, O],
    [O, AS, A, AS, O],
    [O, A, A, A, O],
    [null, O, J, O, null],
    [O, A, A, A, O],
    [O, AS, A, AS, O],
    [O, O, O, O, O],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 2, pivotY: 0, partName: '机甲小腿' };
}

// ---------- 侧面（E 方向，朝右 profile） ----------

function generateMechaSideHeadSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const A = '#c8ccd4';
  const AS = '#9aa3b5';
  const AD = '#7a8090';
  const J = '#3a3f4a';
  const JD = '#2a2e38';
  const C = '#22d3ee';
  const CD = '#0e7490';
  const Y = '#f5c518';
  const pixels = rowsToPixelGrid([
    [null, null, null, null, null, Y, null, null, null, null, null, null],
    [null, null, null, null, null, Y, null, null, null, null, null, null],
    [null, null, null, null, O, Y, O, null, null, null, null, null],
    [null, null, null, O, A, A, A, O, null, null, null, null],
    [null, null, O, A, A, AS, A, A, O, null, null, null],
    [null, null, O, AS, A, O, C, C, O, O, null, null],
    [null, null, O, A, A, A, CD, CD, A, O, O, null],
    [null, null, O, AS, A, A, A, A, A, A, O, null],
    [null, null, null, O, A, AD, AD, A, A, O, null, null],
    [null, null, null, O, AS, J, J, J, AS, O, null, null],
    [null, null, null, null, O, J, JD, J, O, null, null, null],
    [null, null, null, null, O, J, J, O, null, null, null, null],
    [null, null, null, null, O, J, J, O, null, null, null, null],
    [null, null, null, null, O, O, O, O, null, null, null, null],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 6, pivotY: 13, partName: '机甲侧面头' };
}

function generateMechaSideTorsoSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const A = '#c8ccd4';
  const AS = '#9aa3b5';
  const AD = '#7a8090';
  const J = '#3a3f4a';
  const JD = '#2a2e38';
  const B = '#2a7fff';
  const pixels = rowsToPixelGrid([
    [null, null, null, null, null, null, O, O, O, null, null, null, null, null, null, null],
    [null, null, null, O, O, O, A, A, A, A, O, null, null, null, null, null],
    [null, null, O, J, J, O, A, AS, A, A, A, O, null, null, null, null],
    [null, null, O, J, JD, O, A, B, B, A, A, O, null, null, null, null],
    [null, null, O, J, J, O, A, A, A, A, A, O, null, null, null, null],
    [null, null, O, JD, J, O, AD, A, A, AD, A, O, null, null, null, null],
    [null, null, null, O, O, O, A, AS, AS, A, A, O, null, null, null, null],
    [null, null, null, null, O, A, A, A, A, A, A, O, null, null, null, null],
    [null, null, null, null, O, AS, A, A, A, AS, A, O, null, null, null, null],
    [null, null, null, null, null, O, A, AD, AD, A, A, O, null, null, null, null],
    [null, null, null, null, null, O, J, JD, J, J, O, null, null, null, null, null],
    [null, null, null, null, null, O, JD, J, J, JD, O, null, null, null, null, null],
    [null, null, null, null, null, O, J, J, J, J, O, null, null, null, null, null],
    [null, null, null, null, null, O, O, J, J, O, O, null, null, null, null, null],
    [null, null, null, null, O, A, A, A, A, A, A, O, null, null, null, null],
    [null, null, null, null, O, AS, A, AD, A, AS, A, O, null, null, null, null],
    [null, null, null, null, O, A, A, A, A, A, A, O, null, null, null, null],
    [null, null, null, null, null, O, A, A, A, A, O, null, null, null, null, null],
    [null, null, null, null, null, O, J, J, J, O, null, null, null, null, null, null],
    [null, null, null, null, null, O, O, O, O, O, null, null, null, null, null, null],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 8, pivotY: 2, partName: '机甲侧面躯干' };
}

function generateMechaSideUpperArmSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const A = '#c8ccd4';
  const AS = '#9aa3b5';
  const AD = '#7a8090';
  const J = '#3a3f4a';
  const JD = '#2a2e38';
  const B = '#2a7fff';
  const pixels = rowsToPixelGrid([
    [null, null, O, O, null, null],
    [null, O, A, A, O, null],
    [O, A, A, AS, A, O],
    [O, A, AD, A, AS, O],
    [O, AS, A, A, A, O],
    [O, A, A, AD, A, O],
    [null, O, A, A, O, null],
    [null, O, AS, B, O, null],
    [null, O, J, J, O, null],
    [null, O, JD, J, O, null],
    [null, O, J, JD, O, null],
    [null, O, O, O, O, null],
    [null, null, O, J, O, null],
    [null, null, O, O, O, null],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 3, pivotY: 0, partName: '机甲侧面上臂' };
}

function generateMechaSideLowerArmSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const A = '#c8ccd4';
  const AS = '#9aa3b5';
  const AD = '#7a8090';
  const J = '#3a3f4a';
  const B = '#2a7fff';
  const pixels = rowsToPixelGrid([
    [O, O, O, O],
    [O, A, A, O],
    [O, A, AD, O],
    [O, AS, A, O],
    [O, A, A, O],
    [O, A, B, O],
    [O, AS, A, O],
    [O, A, A, O],
    [O, J, J, O],
    [O, O, O, O],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 2, pivotY: 0, partName: '机甲侧面前臂' };
}

function generateMechaSideUpperLegSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const A = '#c8ccd4';
  const AS = '#9aa3b5';
  const AD = '#7a8090';
  const J = '#3a3f4a';
  const JD = '#2a2e38';
  const B = '#2a7fff';
  const C = '#22d3ee';
  const pixels = rowsToPixelGrid([
    [null, O, O, O, O, null],
    [O, A, A, A, A, O],
    [O, A, AD, A, AS, O],
    [O, AS, A, A, A, O],
    [O, A, A, A, AS, O],
    [O, A, AD, A, A, O],
    [null, O, A, A, O, null],
    [null, O, AS, B, O, null],
    [null, O, J, J, O, null],
    [null, O, JD, C, O, null],
    [null, O, J, JD, O, null],
    [null, O, O, O, O, null],
    [null, null, O, J, O, null],
    [null, null, O, O, O, null],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 3, pivotY: 0, partName: '机甲侧面大腿' };
}

function generateMechaSideLowerLegSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const A = '#c8ccd4';
  const AS = '#9aa3b5';
  const AD = '#7a8090';
  const J = '#3a3f4a';
  const B = '#2a7fff';
  const pixels = rowsToPixelGrid([
    [null, O, O, O, null],
    [O, A, A, A, O],
    [O, A, AD, A, O],
    [O, AS, A, AS, O],
    [O, A, A, A, O],
    [O, A, B, A, O],
    [null, O, A, O, null],
    [null, O, J, O, null],
    [O, A, A, A, O],
    [O, AS, A, A, O],
    [O, O, A, A, O],
    [null, O, O, O, O],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 2, pivotY: 0, partName: '机甲侧面小腿' };
}

/** Dog body (20×12), pivot at center */
function generateDogBodySprite(): PixelGrid {
  const O = PALETTE.outline;
  const { F, FL, FD } = DOGC;
  const n = null;
  return rowsToPixelGrid([
    [n, n, n, O, O, O, O, O, O, O, O, O, O, O, O, O, n, n, n, n],
    [n, n, O, FL, FL, FL, F, F, F, F, F, F, F, FL, FL, O, n, n, n, n],
    [n, O, FL, F, F, F, FD, FD, F, F, FD, FD, F, F, F, FL, O, n, n, n],
    [O, FL, F, FD, FD, F, F, F, F, F, F, F, F, FD, FD, F, FL, O, n, n],
    [O, F, FD, F, F, F, FL, FL, FL, FL, FL, F, F, F, F, FD, F, O, n, n],
    [O, FD, F, F, FL, FL, F, FD, FD, F, FL, FL, F, F, FL, F, FD, O, n, n],
    [O, F, F, FL, F, FD, F, F, F, F, FD, F, F, FL, F, F, F, O, n, n],
    [n, O, FD, F, F, F, FD, FD, F, FD, FD, F, F, F, FD, O, O, n, n, n],
    [n, O, O, n, n, O, O, n, n, O, O, n, n, O, O, n, n, n, n, n],
    [n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n],
    [n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n],
    [n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n],
  ]);
}

/** Dog head (10×10), pivot at neck bottom */
function generateDogHeadSprite(): PixelGrid {
  const O = PALETTE.outline;
  const { F, FL, FD, C, NOSE } = DOGC;
  const E = '#1a1a2e';
  const EW = '#ffffff';
  return rowsToPixelGrid([
    [null, null, O,  O,  O,  O,  O,  O,  null, null],
    [null, O,   FL, FL, F,  FL, F,  FL, O,   null],
    [null, O,   F,  FD, F,  F,  FD, F,  O,   null],
    [O,   FL,  F,  EW, E,  F,  FD, F,  FL,  O],
    [O,   F,   FD, F,  F,  FD, F,  F,  F,   O],
    [O,   FL,  F,  FD, F,  F,  FL, F,  F,   O],
    [null, O,   F,  C,  C,  C,  C,  F,  O,   null],
    [null, O,   FD, C,  NOSE, C, C, FD, O,   null],
    [null, null, O,  C,  C,  C,  C,  O,  null, null],
    [null, null, null, O, O,  O,  O,  null, null, null],
  ]);
}

/** Dog ear (4×6), pivot at ear base */
function generateDogEarSprite(): PixelGrid {
  const O = PALETTE.outline;
  const { F, FD } = DOGC;
  return rowsToPixelGrid([
    [null, O,  O,  null],
    [O,   F,  FD, O],
    [O,   FD, F,  O],
    [null, O,  FD, O],
    [null, O,  F,  O],
    [null, null, O,  null],
  ]);
}

/** Dog tail (4×8), pivot at tail base */
function generateDogTailSprite(): PixelGrid {
  const O = PALETTE.outline;
  const { F, FD, C } = DOGC;
  return rowsToPixelGrid([
    [null, O,  O,  null],
    [O,   F,  FD, O],
    [O,   FD, F,  O],
    [null, O,  F,  O],
    [null, O,  FD, O],
    [null, null, O,  C],
    [null, null, O,  C],
    [null, null, null, O],
  ]);
}

/** Dog leg (4×10), pivot at top */
function generateDogLegSprite(): PixelGrid {
  const O = PALETTE.outline;
  const { F, FD, C } = DOGC;
  return rowsToPixelGrid([
    [null, O,  O,  null],
    [O,   F,  FD, O],
    [O,   FD, F,  O],
    [O,   F,  FD, O],
    [null, O,  F,  O],
    [null, O,  FD, O],
    [null, O,  C,  O],
    [O,   C,  C,  O],
    [O,   C,  C,  O],
    [null, O,  O,  null],
  ]);
}

// ============================================================
// Knight template sprites (templateName === 'knight')
// 12 nodes: 10-node humanoid rig + cape + sword
// ============================================================

const KNIGHT = {
  ST: '#b8c0cc',  // steel
  STS: '#7d8590', // steel shadow
  STD: '#4a5058', // steel dark
  G: '#e8b64c',   // gold
  GD: '#a67c2e',  // gold dark
  PL: '#e63946',  // plume red
  PLD: '#a62633', // plume dark
  TU: '#3b4a6b',  // tunic blue
  TUD: '#2a3550', // tunic dark
  LE: '#6b4a2f',  // leather
  CA: '#8b1e2d',  // cape crimson
  CAD: '#5e1420', // cape dark
  CAL: '#b03040', // cape light
};

/** Knight helm (12×14) with visor slit and plume, pivot at neck bottom */
function generateKnightHeadSprite(): PixelGrid {
  const O = PALETTE.outline;
  const { ST, STS, G, PL, PLD } = KNIGHT;
  return rowsToPixelGrid([
    [null, null, null, null, null, PL, PL, null, null, null, null, null],
    [null, null, null, null, null, PL, PL, null, null, null, null, null],
    [null, null, null, O,   O,  O,  O,  O,  O,  null, null, null],
    [null, null, O,   ST,  ST, PLD, PLD, ST, ST, O,   null, null],
    [null, null, O,   ST,  STS, ST, ST, STS, ST, O,   null, null],
    [null, null, O,   STS, O,  O,  O,  O,  O,  STS, O,  null],
    [null, null, O,   ST,  STS, STS, STS, STS, ST, O,  null, null],
    [null, null, O,   ST,  G,  ST, ST, G,  ST, O,  null, null],
    [null, null, O,   STS, ST, ST, ST, ST, STS, O,  null, null],
    [null, null, null, O,  ST, STS, STS, ST, O,  null, null, null],
    [null, null, null, O,  STS, ST, ST, STS, O,  null, null, null],
    [null, null, null, null, O, ST, ST, O,  null, null, null, null],
    [null, null, null, null, O, STS, STS, O, null, null, null, null],
    [null, null, null, null, O, O,  O,  O,  null, null, null, null],
  ]);
}

/** Knight cuirass (16×20) with tabard, pivot at shoulder line */
function generateKnightTorsoSprite(): PixelGrid {
  const O = PALETTE.outline;
  const { ST, STS, G, GD, TU } = KNIGHT;
  return rowsToPixelGrid([
    [null, null, null, null, null, O,   O,   O,   O,   O,   O,   null, null, null, null, null],
    [null, null, null, O,   O,   ST,  ST,  ST,  ST,  ST,  ST,  O,   O,   null, null, null],
    [null, null, O,   ST,  ST,  ST,  ST,  ST,  ST,  ST,  ST,  ST,  ST,  O,   null, null],
    [null, null, O,   STS, ST,  ST,  TU,  TU,  ST,  ST,  STS, ST,  ST,  O,   null, null],
    [null, null, O,   ST,  STS, TU,  G,   TU,  TU,  STS, ST,  ST,  O,   null, null, null],
    [null, O,   ST,  ST,  TU,  G,   G,   TU,  TU,  ST,  ST,  ST,  O,   null, null, null],
    [null, O,   ST,  STS, TU,  G,   G,   TU,  TU,  STS, ST,  ST,  O,   null, null, null],
    [null, O,   ST,  ST,  TU,  G,   G,   TU,  TU,  ST,  ST,  ST,  O,   null, null, null],
    [null, O,   STS, ST,  TU,  TU,  TU,  TU,  TU,  ST,  STS, ST,  O,   null, null, null],
    [null, null, O,  ST,  ST,  TU,  TU,  TU,  TU,  ST,  ST,  O,   null, null, null, null],
    [null, null, O,  STS, ST,  TU,  TU,  TU,  TU,  ST,  STS, O,   null, null, null, null],
    [null, null, O,  GD,  GD,  GD,  GD,  GD,  GD,  GD,  GD,  GD,  O,   null, null, null],
    [null, null, O,  ST,  STS, ST,  ST,  ST,  ST,  ST,  STS, ST,  O,   null, null, null],
    [null, null, O,  STS, ST,  TU,  TU,  TU,  TU,  ST,  STS, O,   null, null, null, null],
    [null, null, O,  ST,  STS, TU,  TU,  TU,  TU,  STS, ST,  O,   null, null, null, null],
    [null, null, O,  STS, ST,  TU,  TU,  TU,  TU,  ST,  STS, O,   null, null, null, null],
    [null, null, null, O, ST,  ST,  TU,  TU,  ST,  ST,  O,   null, null, null, null, null],
    [null, null, null, O, STS, STS, TU,  TU,  STS, STS, O,   null, null, null, null, null],
    [null, null, null, null, O, O,  O,   O,   O,   O,   O,   O,   null, null, null, null],
    [null, null, null, null, null, O, O,  O,   O,   O,   O,   null, null, null, null, null],
  ]);
}

/** Knight pauldron arm (6×14), pivot at shoulder cap */
function generateKnightUpperArmSprite(): PixelGrid {
  const O = PALETTE.outline;
  const { ST, STS, G } = KNIGHT;
  return rowsToPixelGrid([
    [null, O,  O,  O,  O,  null],
    [O,   G,  G,  G,  G,  O],
    [O,   ST, ST, ST, ST, O],
    [O,   STS, ST, ST, STS, O],
    [O,   ST, STS, STS, ST, O],
    [O,   STS, ST, ST, STS, O],
    [O,   ST, ST, ST, ST, O],
    [O,   O,  O,  O,  O,  O],
    [null, O,  STS, ST, O,  null],
    [null, O,  ST, STS, O,  null],
    [null, O,  STS, ST, O,  null],
    [null, O,  ST, O,  null, null],
    [null, O,  STS, O,  null, null],
    [null, null, O,  null, null, null],
  ]);
}

/** Knight gauntlet (4×10), pivot at elbow */
function generateKnightLowerArmSprite(): PixelGrid {
  const O = PALETTE.outline;
  const { ST, STS } = KNIGHT;
  return rowsToPixelGrid([
    [null, O,  O,  null],
    [O,   ST, STS, O],
    [O,   STS, ST, O],
    [O,   ST, STS, O],
    [O,   STS, ST, O],
    [null, O,  ST, O],
    [O,   ST, STS, O],
    [O,   STS, O,  O],
    [O,   ST, O,  null],
    [null, O,  O,  null],
  ]);
}

/** Knight cuisse (6×14), pivot at hip */
function generateKnightUpperLegSprite(): PixelGrid {
  const O = PALETTE.outline;
  const { ST, STS, TU, TUD } = KNIGHT;
  return rowsToPixelGrid([
    [null, null, O,  O,  null, null],
    [null, O,   TU, TU, O,   null],
    [O,   TU,  TU, TUD, TU,  O],
    [O,   ST,  ST, ST, ST,  O],
    [O,   STS, ST, ST, STS, O],
    [O,   ST, STS, STS, ST,  O],
    [O,   STS, ST, ST, STS, O],
    [O,   ST, ST, ST, ST,  O],
    [O,   STS, STS, ST, STS, O],
    [O,   O,   O,  O,  O,   O],
    [null, O,   ST, STS, O,   null],
    [null, O,   STS, O,  null, null],
    [null, null, O,  null, null, null],
    [null, null, O,  null, null, null],
  ]);
}

/** Knight greave + sabaton (5×12), pivot at knee */
function generateKnightLowerLegSprite(): PixelGrid {
  const O = PALETTE.outline;
  const { ST, STS } = KNIGHT;
  return rowsToPixelGrid([
    [null, O,  O,  O,  null],
    [O,   ST, STS, ST, O],
    [O,   STS, ST, STS, O],
    [O,   ST, STS, ST, O],
    [O,   STS, ST, STS, O],
    [null, O,  ST, O,  null],
    [null, O,  STS, O,  null],
    [O,   ST, ST, STS, O],
    [O,   STS, ST, ST, O],
    [O,   ST, STS, STS, O],
    [O,   O,  O,  O,  O],
    [O,   O,  O,  O,  null],
  ]);
}

/** Knight cape (10×18), pivot at neck clasp */
function generateKnightCapeSprite(): PixelGrid {
  const O = PALETTE.outline;
  const { CA, CAD, CAL } = KNIGHT;
  return rowsToPixelGrid([
    [null, null, null, null, O,   O,   null, null, null, null],
    [null, null, null, O,   CA,  CA,  O,   null, null, null],
    [null, null, O,   CA,  CA,  CA,  CA,  O,   null, null],
    [null, null, O,   CAL, CA,  CA,  CAD, O,   null, null],
    [null, O,   CA,  CAL, CA,  CAD, CA,  CA,  O,   null],
    [null, O,   CAL, CA,  CAD, CA,  CAL, CA,  O,   null],
    [null, O,   CA,  CAD, CA,  CAL, CA,  CAD, O,   null],
    [O,   CA,  CAL, CAD, CAL, CAD, CA,  CAL, O,   null],
    [O,   CAL, CA,  CAD, CA,  CAD, CAL, CA,  O,   null],
    [O,   CA,  CAD, CAL, CAD, CAL, CA,  CAD, O,   null],
    [O,   CAL, CAD, CA,  CA,  CAD, CAL, CA,  O,   null],
    [O,   CA,  CAL, CAD, CAD, CAL, CA,  CAL, O,   null],
    [O,   CAD, CAL, CA,  CA,  CAL, CAD, CA,  O,   null],
    [O,   CA,  CAD, CAL, CAL, CAD, CA,  CAD, O,   null],
    [null, O,   CAD, CAL, CA,  CAL, CAD, CA,  O,   null],
    [null, O,   CA,  CAD, CAL, CAD, CA,  CAD, O,   null],
    [null, null, O,  CAD, CAD, CAD, CAD, CAD, O,   null],
    [null, null, null, O,  O,   O,   O,   O,  O,   null],
  ]);
}

/** Knight longsword (4×14), pivot at grip */
function generateKnightSwordSprite(): PixelGrid {
  const O = PALETTE.outline;
  const { ST, STS, G, GD, LE } = KNIGHT;
  return rowsToPixelGrid([
    [null, null, O,  null],
    [null, O,   ST, O],
    [null, O,   ST, O],
    [null, O,   STS, O],
    [null, O,   ST, O],
    [null, O,   STS, O],
    [null, O,   ST, O],
    [null, O,   STS, O],
    [null, O,   ST, O],
    [O,   G,   G,  O],
    [null, O,   LE, O],
    [null, O,   LE, O],
    [null, O,   GD, O],
    [null, null, O,  null],
  ]);
}

// ---- Template sprite dispatch ----

/** Mecha template dispatcher (redrawn) */
function generateMechaSprite(name: string): DefaultSpriteResult {
  // 新版函数直接返回 DefaultSpriteResult；L/R 只调整 partName
  if (name === 'head') return generateMechaHeadSprite();
  if (name === 'torso') return generateMechaTorsoSprite();
  if (name.startsWith('upper_arm')) {
    const r = generateMechaUpperArmSprite();
    return { ...r, partName: name.endsWith('l') ? '机甲左上臂' : '机甲右上臂' };
  }
  if (name.startsWith('lower_arm')) {
    const r = generateMechaLowerArmSprite();
    return { ...r, partName: name.endsWith('l') ? '机甲左前臂' : '机甲右前臂' };
  }
  if (name.startsWith('upper_leg')) {
    const r = generateMechaUpperLegSprite();
    return { ...r, partName: name.endsWith('l') ? '机甲左大腿' : '机甲右大腿' };
  }
  if (name.startsWith('lower_leg')) {
    const r = generateMechaLowerLegSprite();
    return { ...r, partName: name.endsWith('l') ? '机甲左小腿' : '机甲右小腿' };
  }
  const pixels = generateGenericSprite('#9aa3b5', 8, 8);
  return { pixels, width: 8, height: 8, pivotX: 4, pivotY: 4, partName: name };
}

/** Dog template sprites */
function generateDogSprite(name: string): DefaultSpriteResult {
  if (name === 'body') {
    const pixels = generateDogBodySprite();
    return { pixels, width: 20, height: 12, pivotX: 10, pivotY: 5, partName: '狗身体' };
  }
  if (name === 'head') {
    const pixels = generateDogHeadSprite();
    return { pixels, width: 10, height: 10, pivotX: 4, pivotY: 9, partName: '狗头' };
  }
  if (name === 'ear_l' || name === 'ear_r') {
    const pixels = generateDogEarSprite();
    return { pixels, width: 4, height: 6, pivotX: 2, pivotY: 0, partName: name === 'ear_l' ? '左耳' : '右耳' };
  }
  if (name === 'tail') {
    const pixels = generateDogTailSprite();
    return { pixels, width: 4, height: 8, pivotX: 2, pivotY: 0, partName: '狗尾巴' };
  }
  // 两段式腿：front_upper_leg_L / front_lower_leg_L / back_upper_leg_R ……
  if (name.includes('front_upper_leg')) {
    const r = generateDogFrontUpperLegSprite();
    return { ...r, partName: name.endsWith('l') ? '狗左前大腿' : '狗右前大腿' };
  }
  if (name.includes('front_lower_leg')) {
    const r = generateDogFrontLowerLegSprite();
    return { ...r, partName: name.endsWith('l') ? '狗左前小腿' : '狗右前小腿' };
  }
  if (name.includes('back_upper_leg')) {
    const r = generateDogBackUpperLegSprite();
    return { ...r, partName: name.endsWith('l') ? '狗左后大腿' : '狗右后大腿' };
  }
  if (name.includes('back_lower_leg')) {
    const r = generateDogBackLowerLegSprite();
    return { ...r, partName: name.endsWith('l') ? '狗左后小腿' : '狗右后小腿' };
  }
  if (name.includes('leg')) {
    const pixels = generateDogLegSprite();
    const isLeft = name.endsWith('l');
    const front = name.includes('front');
    return {
      pixels, width: 4, height: 10, pivotX: 2, pivotY: 0,
      partName: front ? (isLeft ? '狗左前腿' : '狗右前腿') : (isLeft ? '狗左后腿' : '狗右后腿'),
    };
  }
  const pixels = generateGenericSprite('#c68b4e', 8, 8);
  return { pixels, width: 8, height: 8, pivotX: 4, pivotY: 4, partName: name };
}

/** Knight template: humanoid rig + cape + sword */
function generateKnightSprite(name: string): DefaultSpriteResult {
  if (name === 'head') {
    const pixels = generateKnightHeadSprite();
    return { pixels, width: 12, height: 14, pivotX: 5, pivotY: 13, partName: '骑士头盔' };
  }
  if (name === 'torso') {
    const pixels = generateKnightTorsoSprite();
    return { pixels, width: 16, height: 20, pivotX: 8, pivotY: 2, partName: '骑士胸甲' };
  }
  if (name.startsWith('upper_arm')) {
    const pixels = generateKnightUpperArmSprite();
    return { pixels, width: 6, height: 14, pivotX: 3, pivotY: 0, partName: name.endsWith('l') ? '骑士左上臂' : '骑士右上臂' };
  }
  if (name.startsWith('lower_arm')) {
    const pixels = generateKnightLowerArmSprite();
    return { pixels, width: 4, height: 10, pivotX: 2, pivotY: 0, partName: name.endsWith('l') ? '骑士左臂铠' : '骑士右臂铠' };
  }
  if (name.startsWith('upper_leg')) {
    const pixels = generateKnightUpperLegSprite();
    return { pixels, width: 6, height: 14, pivotX: 3, pivotY: 0, partName: name.endsWith('l') ? '骑士左大腿甲' : '骑士右大腿甲' };
  }
  if (name.startsWith('lower_leg')) {
    const pixels = generateKnightLowerLegSprite();
    return { pixels, width: 5, height: 12, pivotX: 2, pivotY: 0, partName: name.endsWith('l') ? '骑士左胫甲' : '骑士右胫甲' };
  }
  if (name === 'cape') {
    const pixels = generateKnightCapeSprite();
    return { pixels, width: 10, height: 18, pivotX: 5, pivotY: 0, partName: '披风' };
  }
  if (name === 'sword') {
    const pixels = generateKnightSwordSprite();
    return { pixels, width: 4, height: 14, pivotX: 2, pivotY: 11, partName: '长剑' };
  }
  const pixels = generateGenericSprite('#b8c0cc', 8, 8);
  return { pixels, width: 8, height: 8, pivotX: 4, pivotY: 4, partName: name };
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
 * - templateName 'mecha' → armored robot variants of the humanoid rig
 * - templateName 'dog' → dog: body/head/ears/tail/legs
 * - templateName 'knight' → armored knight variants + cape + sword
 * - Fallback: colored block based on node color
 */
export function generateDefaultCostumeSprite(
  nodeName: string,
  templateName: string,
  nodeColor: string = '#888888',
): DefaultSpriteResult {
  const name = nodeName.toLowerCase();

  // Template-specific sprite sets (full art direction per template)
  if (templateName === 'mecha') return generateMechaSprite(name);
  if (templateName === 'dog') return generateDogSprite(name);
  if (templateName === 'knight') return generateKnightSprite(name);

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


/** Dog two-segment legs */
// 小狗两段式四肢精灵（正面版）
// 依赖：PALETTE / rowsToPixelGrid / DefaultSpriteResult / PixelGrid（见 default-costume-sprites.ts）
// 配色沿用小狗模板：皮毛 #c68b4e / 浅 #e0aa6e / 深 #9a6a38，奶油 #f0d5a8，轮廓 #1a1a2e
// 铁律：闭合轮廓（向导会程序化 carve 关节开口），pivot 在顶部关节。

const DOGC = {
  F: '#c68b4e',  // fur
  FL: '#e0aa6e', // fur light
  FD: '#9a6a38', // fur dark
  C: '#f0d5a8',  // cream（爪子）
  NOSE: '#2a1a12',
};

/** 狗前大腿 (4×8)，pivot 在顶部髋关节，上粗下细 */
function generateDogFrontUpperLegSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const { F, FL, FD } = DOGC;
  const n = null;
  const pixels = rowsToPixelGrid([
    [n, O,  O,  n ],  // 4
    [O, FL, F,  O ],  // 4
    [O, F,  FD, O ],  // 4
    [O, FD, F,  O ],  // 4
    [O, F,  FD, O ],  // 4
    [n, O,  F,  O ],  // 4
    [n, O,  FD, O ],  // 4
    [n, O,  O,  n ],  // 4
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 2, pivotY: 0, partName: '狗前大腿' };
}

/** 狗前小腿+爪子 (3×8)，pivot 在顶部膝关节，爪子奶油色 */
function generateDogFrontLowerLegSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const { F, FD, C } = DOGC;
  const n = null;
  const pixels = rowsToPixelGrid([
    [n, O,  n ],  // 3
    [O, F,  O ],  // 3
    [O, FD, O ],  // 3
    [O, F,  O ],  // 3
    [O, FD, O ],  // 3
    [O, C,  O ],  // 3
    [O, C,  O ],  // 3
    [n, O,  n ],  // 3
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 1, pivotY: 0, partName: '狗前小腿' };
}

/** 狗后大腿 (5×8)，pivot 在顶部髋关节；比前腿粗，外侧保留腓肠肌弧度 */
function generateDogBackUpperLegSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const { F, FL, FD } = DOGC;
  const n = null;
  const pixels = rowsToPixelGrid([
    [n, O,  O,  O,  n ],  // 5
    [O, FL, F,  F,  O ],  // 5
    [O, F,  FD, FD, O ],  // 5
    [O, FD, F,  F,  O ],  // 5
    [O, F,  FD, FD, O ],  // 5
    [n, O,  F,  F,  O ],  // 5，左侧收细、右侧保持肌肉弧度
    [n, O,  FD, FD, O ],  // 5
    [n, O,  O,  O,  n ],  // 5，底部圆角收口
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 2, pivotY: 0, partName: '狗后大腿' };
}

/** 狗后小腿+爪子 (3×8)，pivot 在顶部膝关节，爪子奶油色 */
function generateDogBackLowerLegSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const { F, FD, C } = DOGC;
  const n = null;
  const pixels = rowsToPixelGrid([
    [n, O,  n ],  // 3
    [O, F,  O ],  // 3
    [O, FD, O ],  // 3
    [O, F,  O ],  // 3
    [O, FD, O ],  // 3
    [O, C,  O ],  // 3
    [O, C,  O ],  // 3
    [n, O,  n ],  // 3
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 1, pivotY: 0, partName: '狗后小腿' };
}

/** Humanoid/Simple side views (E) */
// ============================================================
// PixelMorpher - 人形 / 简单模板侧面（E 方向，朝右 profile）精灵
// 依赖（集成时由 default-costume-sprites.ts 提供）：
//   PALETTE, rowsToPixelGrid, DefaultSpriteResult, PixelGrid
// 铁律：每行列数一致、闭合轮廓（向导会程序化 carve 关节开口）、
// pivot 与正面版一致（头=颈部，躯干=(8,2)，四肢=顶部关节）。
// L/R 共用一套。
// ============================================================

/** 侧面头（12×14）：侧脸 profile，一只眼、鼻子朝右，pivot 在颈部 (6,13) */
function generateHumanoidSideHeadSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const S = PALETTE.skinMid;
  const SL = PALETTE.skinLight;
  const H = PALETTE.hairPrimary;
  const HS = PALETTE.hairShadow;
  const HH = PALETTE.hairHighlight;
  const E = '#1a1a2e'; // eye
  const EW = '#ffffff'; // eye white

  const pixels = rowsToPixelGrid([
    // Row 0: hair top
    [null, null, null, O,  O,  O,  O,  O,  O,  null, null, null],
    // Row 1: hair
    [null, null, O,  H,  H,  HH, HH, H,  H,  O,  null, null],
    // Row 2: hair back
    [null, O,  H,  H,  HS, H,  H,  H,  H,  O,  null, null],
    // Row 3: forehead
    [null, O,  H,  HS, S,  S,  S,  S,  S,  O,  null, null],
    // Row 4: brow
    [null, O,  HS, S,  SL, S,  S,  S,  S,  O,  null, null],
    // Row 5: eye (single, side profile)
    [null, O,  HS, S,  EW, E,  S,  S,  S,  O,  null, null],
    // Row 6: nose bridge -> tip
    [null, O,  HS, S,  S,  S,  S,  S,  S,  O,  O,  null],
    // Row 7: nose (protrudes right)
    [null, O,  HS, SL, S,  S,  S,  S,  S,  S,  O,  null],
    // Row 8: under nose / upper lip
    [null, null, O,  S,  SL, S,  S,  S,  O,  O,  null, null],
    // Row 9: mouth
    [null, null, O,  S,  S,  O,  O,  S,  O,  null, null, null],
    // Row 10: chin
    [null, null, null, O,  S,  S,  S,  O,  null, null, null, null],
    // Row 11: chin bottom
    [null, null, null, null, O,  SL, O,  null, null, null, null, null],
    // Row 12: neck start
    [null, null, null, null, O,  S,  O,  null, null, null, null, null],
    // Row 13: neck (pivot)
    [null, null, null, null, O,  S,  O,  null, null, null, null, null],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 6, pivotY: 13, partName: '侧面头' };
}

/** 侧面躯干（16×20）：侧面轮廓，胸部朝右微凸，pivot 在颈部 (8,2) */
function generateHumanoidSideTorsoSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const T = PALETTE.shirtPrimary;
  const TS = PALETTE.shirtShadow;
  const TH = PALETTE.shirtHighlight;
  const S = PALETTE.skinMid;
  const BL = '#8b7355'; // belt leather
  const BD = '#6b5540'; // belt shadow

  const pixels = rowsToPixelGrid([
    // Row 0: neck opening
    [null, null, null, null, null, O,  O,  O,  O,  O,  O,  null, null, null, null, null],
    // Row 1: shoulders top
    [null, null, null, null, O,  S,  TH, TH, TH, TH, S,  O,  null, null, null, null],
    // Row 2: shoulders
    [null, null, null, O,  S,  TH, TH, TH, TH, TH, TH, S,  O,  null, null, null],
    // Row 3: upper chest
    [null, null, O,  TH, TH, TH, TH, TS, TH, TH, TH, O,  null, null, null, null],
    // Row 4: chest (protrudes right)
    [null, null, O,  TH, T,  T,  TS, T,  T,  TH, T,  T,  O,  null, null, null],
    // Row 5: chest mid
    [null, O,  TH, T,  TS, T,  T,  T,  T,  TH, T,  T,  O,  null, null, null],
    // Row 6: chest detail
    [null, O,  T,  TS, T,  T,  TH, T,  T,  TS, T,  O,  null, null, null, null],
    // Row 7: mid torso
    [null, O,  T,  T,  T,  TH, TH, T,  T,  T,  T,  O,  null, null, null, null],
    // Row 8: mid torso detail
    [null, O,  T,  TH, T,  T,  T,  TH, T,  T,  T,  O,  null, null, null, null],
    // Row 9: waist
    [null, null, O,  T,  T,  T,  TH, T,  T,  T,  T,  O,  null, null, null, null],
    // Row 10: waist detail
    [null, null, O,  T,  TS, T,  T,  T,  T,  TS, T,  O,  null, null, null, null],
    // Row 11: belt area
    [null, null, O,  TS, TS, TS, TS, TS, TS, TS, TS, O,  null, null, null, null],
    // Row 12: belt
    [null, null, O,  BL, BL, BL, BL, BL, BL, BL, BL, O,  null, null, null, null],
    // Row 13: belt bottom
    [null, null, O,  BD, BD, BD, BD, BD, BD, BD, BD, O,  null, null, null, null],
    // Row 14: lower torso
    [null, null, O,  T,  T,  T,  T,  T,  T,  T,  T,  O,  null, null, null, null],
    // Row 15: hip
    [null, null, O,  TS, T,  T,  T,  T,  T,  TS, T,  O,  null, null, null, null],
    // Row 16: hip detail
    [null, null, null, O,  T,  T,  T,  T,  T,  T,  O,  null, null, null, null, null],
    // Row 17: lower hip
    [null, null, null, O,  TS, T,  T,  T,  TS, T,  O,  null, null, null, null, null],
    // Row 18: bottom edge
    [null, null, null, null, O,  O,  O,  O,  O,  O,  O,  null, null, null, null, null],
    // Row 19: bottom
    [null, null, null, null, null, O,  O,  O,  O,  O,  null, null, null, null, null, null],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 8, pivotY: 2, partName: '侧面躯干' };
}

/** 侧面上臂（6×14）：pivot 在肩部关节 (3,0) */
function generateHumanoidSideUpperArmSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const T = PALETTE.shirtPrimary;
  const TS = PALETTE.shirtShadow;
  const TH = PALETTE.shirtHighlight;
  const S = PALETTE.skinMid;
  const SL = PALETTE.skinLight;

  const pixels = rowsToPixelGrid([
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
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 3, pivotY: 0, partName: '侧面上臂' };
}

/** 侧面前臂（4×10）：pivot 在肘部关节 (2,0) */
function generateHumanoidSideLowerArmSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const S = PALETTE.skinMid;
  const SL = PALETTE.skinLight;
  const SD = PALETTE.skinDark;

  const pixels = rowsToPixelGrid([
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
    [O,  S,  SL, O],
    // Row 8: fingers
    [O,  SD, SD, O],
    // Row 9: finger tips
    [null, O,  O,  null],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 2, pivotY: 0, partName: '侧面前臂' };
}

/** 侧面大腿（6×14）：pivot 在髋部关节 (3,0) */
function generateHumanoidSideUpperLegSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const P = PALETTE.pantsPrimary;
  const PS = PALETTE.pantsShadow;
  const PH = PALETTE.pantsHighlight;

  const pixels = rowsToPixelGrid([
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
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 3, pivotY: 0, partName: '侧面大腿' };
}

/** 侧面小腿（5×12）：鞋尖朝右，pivot 在膝部关节 (2,0) */
function generateHumanoidSideLowerLegSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const P = PALETTE.pantsPrimary;
  const PS = PALETTE.pantsShadow;
  const SH = PALETTE.shoePrimary;
  const SS = PALETTE.shoeShadow;

  const pixels = rowsToPixelGrid([
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
    // Row 11: toe pointing right
    [null, O,  O,  O,  O],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 2, pivotY: 0, partName: '侧面小腿' };
}

/** 简单头侧面（11×10）：紫色 blob 的侧脸，一只眼、鼻子朝右，pivot 在颈部 (5,9) */
function generateSimpleSideHeadSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const B = '#6a5acd';
  const BS = '#4a3aaa';
  const BH = '#8a7aee';
  const E = '#1a1a2e';
  const EW = '#ffffff';

  const pixels = rowsToPixelGrid([
    [null, null, O,  O,  O,  O,  O,  O,  null, null, null],
    [null, O,  BH, BH, BH, BH, BH, BH, O,  null, null],
    [null, O,  BH, B,  BS, B,  BH, BH, O,  null, null],
    [O,  BH, B,  EW, E,  B,  BS, B,  BH, O,  null],
    [O,  B,  BS, B,  B,  BS, B,  B,  O,  O,  null],
    [O,  BH, B,  BS, B,  B,  BH, B,  B,  O,  null],
    [null, O,  BH, B,  B,  B,  BH, B,  O,  null, null],
    [null, O,  B,  BS, BS, BS, BS, B,  O,  null, null],
    [null, null, O,  B,  B,  B,  B,  O,  null, null, null],
    [null, null, null, O,  O,  O,  O,  null, null, null, null],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 5, pivotY: 9, partName: '简单侧面头' };
}

/** 简单身体侧面（13×14）：紫色 blob 侧面，pivot 在颈部 (6,2) */
function generateSimpleSideBodySprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const B = '#6a5acd';
  const BS = '#4a3aaa';
  const BH = '#8a7aee';

  const pixels = rowsToPixelGrid([
    [null, null, null, null, O,  O,  O,  O,  null, null, null, null, null],
    [null, null, null, O,  BH, BH, BH, BH, O,  null, null, null, null],
    [null, null, O,  BH, B,  BS, BS, B,  BH, O,  null, null, null],
    [null, O,  BH, B,  BS, B,  B,  BS, B,  BH, O,  null, null],
    [null, O,  B,  BS, B,  BH, BH, B,  BS, B,  B,  O,  null],
    [null, O,  BH, B,  B,  B,  B,  B,  B,  B,  BH, O,  null],
    [O,  BH, B,  BS, B,  B,  BH, BH, B,  BS, B,  BH, O],
    [O,  B,  B,  B,  BH, BH, B,  B,  BH, B,  B,  B,  O],
    [O,  BH, BS, B,  B,  B,  BS, BS, B,  B,  BS, BH, O],
    [O,  B,  B,  B,  BS, B,  B,  B,  BS, B,  B,  B,  O],
    [null, O,  BH, B,  B,  B,  B,  B,  B,  BH, B,  O,  null],
    [null, O,  B,  BS, BS, B,  B,  BS, BS, B,  B,  O,  null],
    [null, null, O,  B,  B,  BS, BS, B,  B,  B,  O,  null, null],
    [null, null, null, O,  O,  O,  O,  O,  O,  O,  null, null, null],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 6, pivotY: 2, partName: '简单侧面身体' };
}

/** Knight side views (E) */
// 骑士模板侧面（E 方向，朝右 profile）精灵
// 配色与正面版统一：钢甲 #b8c0cc / 钢影 #7d8590 / 金 #e8b64c / 红缨 #e63946 / 蓝罩袍 #3b4a6b / 绛红披风 #8b1e2d
// 铁律：每行列数一致、闭合轮廓（向导程序化 carve 关节开口）、pivot 与正面版一致









/** 骑士头盔侧面 (12x14)：红缨朝后（左）、单眼 visor 缝、鼻部朝右，pivot 在颈部 */
function generateKnightSideHeadSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const { ST, STS, STD, G, PL, PLD } = KNIGHT;
  const n = null;
  const pixels = rowsToPixelGrid([
    [n, n, n, n, n, n, n, n, n, n, n, n],
    [n, PL, PL, PL, n, n, n, n, n, n, n, n],
    [n, PLD, PLD, O, O, O, O, O, n, n, n, n],
    [n, PLD, O, ST, ST, ST, ST, ST, O, n, n, n],
    [n, n, O, ST, STS, ST, ST, ST, ST, O, n, n],
    [n, n, O, STS, ST, ST, ST, ST, ST, ST, O, n],
    [n, n, O, ST, ST, G, G, ST, ST, ST, ST, O],
    [n, n, O, STD, STD, STD, STD, STD, STD, STD, STD, O],
    [n, n, O, ST, STS, ST, ST, ST, ST, ST, ST, O],
    [n, n, O, STS, ST, ST, ST, ST, ST, ST, ST, O],
    [n, n, n, O, ST, STS, STS, ST, ST, ST, O, n],
    [n, n, n, O, STS, ST, ST, ST, ST, O, n, n],
    [n, n, n, n, O, STS, STS, ST, O, n, n, n],
    [n, n, n, n, n, O, O, O, n, n, n, n],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 5, pivotY: 13, partName: '侧面头盔' };
}

/** 骑士胸甲侧面 (16x20)：胸前罩袍竖条（十字竖臂）+ 金腰带，pivot 在颈部顶部 */
function generateKnightSideTorsoSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const { ST, STS, G, GD, TU } = KNIGHT;
  const n = null;
  const pixels = rowsToPixelGrid([
    [n, n, n, n, n, n, O, O, O, O, n, n, n, n, n, n],
    [n, n, n, n, n, O, ST, ST, ST, ST, O, n, n, n, n, n],
    [n, n, n, n, O, ST, ST, ST, ST, ST, ST, O, n, n, n, n],
    [n, n, n, O, ST, ST, ST, ST, ST, ST, ST, ST, O, n, n, n],
    [n, n, n, O, STS, ST, ST, ST, ST, ST, G, TU, ST, O, n, n],
    [n, n, O, ST, STS, ST, ST, ST, ST, TU, G, TU, ST, O, n, n],
    [n, n, O, ST, ST, ST, ST, ST, TU, G, TU, ST, ST, O, n, n],
    [n, n, O, STS, ST, ST, ST, TU, G, TU, TU, ST, ST, O, n, n],
    [n, n, O, ST, ST, ST, ST, TU, G, TU, TU, ST, ST, O, n, n],
    [n, n, n, O, ST, ST, ST, TU, TU, TU, ST, ST, ST, O, n, n],
    [n, n, n, O, STS, ST, TU, TU, TU, TU, ST, ST, ST, O, n, n],
    [n, n, n, O, GD, GD, GD, GD, GD, GD, GD, GD, GD, O, n, n],
    [n, n, n, O, ST, ST, TU, TU, TU, TU, ST, ST, ST, O, n, n],
    [n, n, n, O, STS, ST, TU, TU, TU, TU, ST, ST, O, n, n, n],
    [n, n, n, O, ST, STS, TU, TU, TU, TU, STS, ST, O, n, n, n],
    [n, n, n, O, STS, ST, TU, TU, TU, TU, ST, O, n, n, n, n],
    [n, n, n, n, O, ST, ST, TU, TU, ST, ST, O, n, n, n, n],
    [n, n, n, n, O, STS, STS, TU, TU, STS, O, n, n, n, n, n],
    [n, n, n, n, n, O, O, O, O, O, O, O, n, n, n, n],
    [n, n, n, n, n, n, O, O, O, O, O, O, n, n, n, n],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 8, pivotY: 2, partName: '侧面胸甲' };
}

/** 骑士侧面上臂甲 (6x14)：肩甲 + 背侧（左）加重阴影，pivot 在肩部 */
function generateKnightSideUpperArmSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const { ST, STS, G } = KNIGHT;
  const n = null;
  const pixels = rowsToPixelGrid([
    [n, O, O, O, O, n],
    [O, G, G, G, G, O],
    [O, STS, ST, ST, ST, O],
    [O, STS, STS, ST, ST, O],
    [O, STS, ST, STS, ST, O],
    [O, STS, STS, ST, STS, O],
    [O, STS, ST, ST, ST, O],
    [O, O, O, O, O, O],
    [n, O, STS, ST, O, n],
    [n, O, STS, STS, O, n],
    [n, O, STS, ST, O, n],
    [n, O, STS, O, n, n],
    [n, O, STS, O, n, n],
    [n, n, O, n, n, n],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 3, pivotY: 0, partName: '侧面上臂甲' };
}

/** 骑士侧面臂铠 (4x10)：拳甲 profile，pivot 在肘部 */
function generateKnightSideLowerArmSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const { ST, STS } = KNIGHT;
  const n = null;
  const pixels = rowsToPixelGrid([
    [n, O, O, n],
    [O, STS, ST, O],
    [O, STS, STS, O],
    [O, STS, ST, O],
    [O, STS, STS, O],
    [n, O, STS, O],
    [O, STS, ST, O],
    [O, STS, O, O],
    [O, STS, O, n],
    [n, O, O, n],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 2, pivotY: 0, partName: '侧面臂铠' };
}

/** 骑士侧面大腿甲 (6x14)：腿甲 + 束腰布，pivot 在髋部 */
function generateKnightSideUpperLegSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const { ST, STS, TU, TUD } = KNIGHT;
  const n = null;
  const pixels = rowsToPixelGrid([
    [n, n, O, O, n, n],
    [n, O, TU, TU, O, n],
    [O, TU, TU, TUD, TU, O],
    [O, STS, ST, ST, ST, O],
    [O, STS, STS, ST, ST, O],
    [O, STS, ST, STS, ST, O],
    [O, STS, STS, ST, STS, O],
    [O, STS, ST, ST, ST, O],
    [O, STS, STS, ST, STS, O],
    [O, O, O, O, O, O],
    [n, O, STS, STS, O, n],
    [n, O, STS, O, n, n],
    [n, n, O, n, n, n],
    [n, n, O, n, n, n],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 3, pivotY: 0, partName: '侧面大腿甲' };
}

/** 骑士侧面胫甲 (5x12)：胫甲 + 朝右的足甲，pivot 在膝部 */
function generateKnightSideLowerLegSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const { ST, STS } = KNIGHT;
  const n = null;
  const pixels = rowsToPixelGrid([
    [n, O, O, O, n],
    [O, STS, ST, ST, O],
    [O, STS, STS, ST, O],
    [O, STS, ST, STS, O],
    [O, STS, STS, ST, O],
    [n, O, STS, O, n],
    [n, O, STS, O, n],
    [O, STS, ST, STS, O],
    [O, STS, STS, ST, O],
    [O, ST, ST, ST, O],
    [n, O, O, O, O],
    [n, n, O, O, O],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 2, pivotY: 0, partName: '侧面胫甲' };
}

/** 骑士披风侧面 (10x18)：颈扣系于顶部、向后（左）飘，pivot 在颈扣 */
function generateKnightSideCapeSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const { CA, CAD, CAL } = KNIGHT;
  const n = null;
  const pixels = rowsToPixelGrid([
    [n, n, n, n, O, O, n, n, n, n],
    [n, n, n, O, CA, CA, O, n, n, n],
    [n, n, O, CA, CA, CA, O, n, n, n],
    [n, O, CA, CAL, CA, CAD, O, n, n, n],
    [n, O, CAL, CA, CAD, CA, O, n, n, n],
    [O, CA, CAL, CAD, CA, CAL, O, n, n, n],
    [O, CAL, CA, CAD, CAL, CA, O, n, n, n],
    [O, CA, CAD, CAL, CAD, CAL, O, n, n, n],
    [O, CAL, CAD, CA, CAD, CAL, O, n, n, n],
    [O, CA, CAD, CAL, CAD, CAL, O, n, n, n],
    [O, CAD, CAL, CA, CAL, CAD, O, n, n, n],
    [O, CA, CAD, CAL, CAD, CAL, O, n, n, n],
    [O, CAD, CAL, CA, CAL, CAD, O, n, n, n],
    [O, CA, CAD, CAL, CAD, CAL, O, n, n, n],
    [n, O, CAD, CAL, CA, CAD, O, n, n, n],
    [n, O, CA, CAD, CAL, CAD, O, n, n, n],
    [n, n, O, CAD, CAD, CAD, O, n, n, n],
    [n, n, n, O, O, O, O, n, n, n],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 5, pivotY: 0, partName: '侧面披风' };
}

/** 骑士长剑侧面 (4x14)：剑身 profile，pivot 在剑柄 */
function generateKnightSideSwordSprite(): DefaultSpriteResult {
  const O = PALETTE.outline;
  const { ST, STS, G, GD, LE } = KNIGHT;
  const n = null;
  const pixels = rowsToPixelGrid([
    [n, n, O, n],
    [n, O, ST, O],
    [n, O, ST, O],
    [n, O, STS, O],
    [n, O, ST, O],
    [n, O, STS, O],
    [n, O, ST, O],
    [n, O, STS, O],
    [n, O, ST, O],
    [O, G, G, O],
    [n, O, LE, O],
    [n, O, LE, O],
    [n, O, GD, O],
    [n, n, O, n],
  ]);
  return { pixels, width: pixels[0].length, height: pixels.length, pivotX: 2, pivotY: 11, partName: '侧面长剑' };
}

/**
 * 侧面版（E 方向）默认精灵分发。W 方向由 DIRECTION_MIRROR 自动镜像 E。
 * 尚无侧面设计的节点返回 null（调用方回退到正面）。
 */
export function generateDefaultCostumeSideSprite(
  nodeName: string,
  templateName: string,
  nodeColor: string = '#888888',
): DefaultSpriteResult | null {
  const name = nodeName.toLowerCase();
  if (templateName === 'mecha') {
    if (name === 'head') return generateMechaSideHeadSprite();
    if (name === 'torso') return generateMechaSideTorsoSprite();
    if (name.startsWith('upper_arm')) return generateMechaSideUpperArmSprite();
    if (name.startsWith('lower_arm')) return generateMechaSideLowerArmSprite();
    if (name.startsWith('upper_leg')) return generateMechaSideUpperLegSprite();
    if (name.startsWith('lower_leg')) return generateMechaSideLowerLegSprite();
    return null;
  }
  if (templateName === 'knight') {
    if (name === 'head') return generateKnightSideHeadSprite();
    if (name === 'torso') return generateKnightSideTorsoSprite();
    if (name.startsWith('upper_arm')) return generateKnightSideUpperArmSprite();
    if (name.startsWith('lower_arm')) return generateKnightSideLowerArmSprite();
    if (name.startsWith('upper_leg')) return generateKnightSideUpperLegSprite();
    if (name.startsWith('lower_leg')) return generateKnightSideLowerLegSprite();
    if (name === 'cape') return generateKnightSideCapeSprite();
    if (name === 'sword') return generateKnightSideSwordSprite();
    return null;
  }
  if (templateName === 'humanoid') {
    if (name === 'head') return generateHumanoidSideHeadSprite();
    if (name === 'torso') return generateHumanoidSideTorsoSprite();
    if (name.startsWith('upper_arm')) return generateHumanoidSideUpperArmSprite();
    if (name.startsWith('lower_arm')) return generateHumanoidSideLowerArmSprite();
    if (name.startsWith('upper_leg')) return generateHumanoidSideUpperLegSprite();
    if (name.startsWith('lower_leg')) return generateHumanoidSideLowerLegSprite();
    return null;
  }
  if (templateName === 'simple') {
    if (name === 'head') return generateSimpleSideHeadSprite();
    if (name === 'body') return generateSimpleSideBodySprite();
    return null;
  }
  void nodeColor;
  return null;
}
