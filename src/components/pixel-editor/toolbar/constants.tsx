import React from 'react';
import {
  MousePointer2,
  Paintbrush,
  Eraser,
  PaintBucket,
  Pipette,
  Move,
  Route,
  Crop,
  Wind,
  Sun,
  Sparkles,
  Ghost,
  Lasso,
  Wand2,
  WandSparkles,
  Scan,
  PersonStanding,
  Scissors,
  Crosshair,
  MapPin,
  Rotate3d,
} from 'lucide-react';
import type { ToolType } from '@/lib/types';

// ============================================================
// Toolbar Constants
// ============================================================

export const TOOL_CONFIG: { value: ToolType; icon: React.ReactNode; label: string; group?: string }[] = [
  { value: 'puppet', icon: <PersonStanding className="size-3.5" />, label: '木偶' },
  { value: 'split_node', icon: <Scissors className="size-3.5" />, label: '拆分节点' },
  { value: 'pseudo3d_rotate', icon: <Rotate3d className="size-3.5" />, label: '伪3D旋转' },
  { value: 'select', icon: <MousePointer2 className="size-3.5" />, label: '选择' },
  { value: 'brush', icon: <Paintbrush className="size-3.5" />, label: '画笔' },
  { value: 'eraser', icon: <Eraser className="size-3.5" />, label: '橡皮擦' },
  { value: 'fill', icon: <PaintBucket className="size-3.5" />, label: '填充' },
  { value: 'eyedropper', icon: <Pipette className="size-3.5" />, label: '取色器' },
  { value: 'landmark', icon: <Crosshair className="size-3.5" />, label: '特征点标注', group: 'pixel' },
  { value: 'mark', icon: <MapPin className="size-3.5" />, label: '精灵标记', group: 'pixel' },
  { value: 'move', icon: <Move className="size-3.5" />, label: '移动' },
  { value: 'trajectory', icon: <Route className="size-3.5" />, label: '轨迹', group: 'trajectory' },
  { value: 'crop', icon: <Crop className="size-3.5" />, label: '裁剪' },
  // Motion blur brush
  { value: 'motion_blur_brush', icon: <Wind className="size-3.5" />, label: '动态模糊笔', group: 'blur' },
  // Effect brushes
  { value: 'glow_brush', icon: <Sun className="size-3.5" />, label: '辉光笔', group: 'effect' },
  { value: 'particle_brush', icon: <Sparkles className="size-3.5" />, label: '粒子笔', group: 'effect' },
  { value: 'afterimage_brush', icon: <Ghost className="size-3.5" />, label: '残影笔', group: 'effect' },
  // Selection tools
  { value: 'lasso', icon: <Lasso className="size-3.5" />, label: '套索' },
  { value: 'magic_wand', icon: <Wand2 className="size-3.5" />, label: '魔棒' },
  // AI tools
  { value: 'smart_select', icon: <Scan className="size-3.5" />, label: 'AI选区' },
  { value: 'inpaint', icon: <WandSparkles className="size-3.5" />, label: '修复' },
];

export const MAX_RECENT_COLORS = 8;

// ---- Brush Style Parameter Labels ----
export const BS_PARAM_LABELS: Record<string, string> = {
  opacity: '不透明度',
  hardness: '硬度',
  innerColor: '内焰色',
  outerColor: '外焰色',
  innerRadius: '内焰比例',
  falloff: '过渡',
  flickerAmount: '闪烁',
  flameDirection: '焰方向',
  elongation: '拉伸',
  density: '密度',
  spread: '扩散',
  glowRadius: '光晕半径',
  glowIntensity: '光晕强度',
  gradientType: '渐变类型',
  secondaryColor: '副色',
  seed: '种子',
  // Tapered (渐细笔触)
  taperLength: '渐细长度',
  taperCurve: '渐细曲线',
  minSizeRatio: '最小比例',
  // Pipe (管道)
  highlightPosition: '高光位置',
  highlightSize: '高光宽度',
  highlightIntensity: '高光强度',
  wallShade: '壁面阴影',
  // Segmented Pipe (分节管道)
  segmentLength: '节段长度',
  segmentGap: '节段间隔',
  segmentTaper: '节段渐细',
  bellowsWidth: '波纹扩展',
  // Vine (藤蔓/血管)
  lightDirection: '光照方向',
  lightIntensity: '光照强度',
  veinColor: '脉络色',
  organicNoise: '有机噪点',
  branchDensity: '分支密度',
  // Star (五角星)
  spikeCount: '角数',
  hollow: '空心',
  innerOuterRatio: '内外比',
  rotation: '旋转',
  // Heart (爱心)
  lobeWidth: '叶宽',
  pointiness: '尖锐度',
  // Sphere (高光球体)
  highlightX: '高光X',
  highlightY: '高光Y',
  highlightRadius: '高光半径',
  highlightBrightness: '高光亮度',
  shadingIntensity: '明暗强度',
  // Droplet (水滴)
  tailLength: '尾长',
  tailDirection: '尾方向',
  // Bubble (泡泡)
  iridescence: '虹彩',
  membraneThickness: '膜厚度',
  reflectionSize: '反射大小',
  // Punctuation (卡通标点)
  punctuationType: '标点类型',
  outlineThickness: '描边粗细',
  outlineColor: '描边色',
  // Emoji (表情包)
  emojiType: '表情类型',
  eyeSize: '眼大小',
  mouthCurve: '嘴弧度',
  // Bevel Seam (倒角线/缝)
  bevelDepth: '倒角深度',
  bevelWidth: '倒角宽度',
  bevelLightDir: '倒角光照',
  bevelShadow: '倒角阴影',
  grooveColor: '沟槽色',
  // Prism (棱柱/台)
  topWidthRatio: '顶面宽度比',
  prismHeight: '棱柱高度',
  prismLightDir: '棱柱光照',
  topFaceBrightness: '顶面亮度',
  edgeHighlight: '棱边高光',
  // Plate (板材/面板)
  plateThickness: '板材厚度',
  plateBevel: '边缘倒角',
  plateLightDir: '板材光照',
  surfaceTexture: '表面纹理',
  plateEdgeBright: '边缘亮度',
  // Grille (格栅)
  slatCount: '栅条数',
  slatGap: '栅条间距',
  slatDepth: '栅条深度',
  frameWidth: '边框宽度',
  openingColor: '开口色',
  // Vent (散热口/喷口)
  ventOpening: '开口比例',
  rimThickness: '包边厚度',
  rimColor: '包边色',
  innerDepth: '内部深度',
  hasSlats: '内部栅条',
  ventSlatCount: '栅条数量',
};

// ---- Brush Style Numeric Parameter Ranges ----
export const BS_PARAM_RANGES: Record<string, [number, number, number]> = {
  opacity: [0, 1, 0.05],
  hardness: [0, 1, 0.05],
  innerRadius: [0, 1, 0.05],
  falloff: [0, 1, 0.05],
  flickerAmount: [0, 1, 0.05],
  flameDirection: [0, 360, 1],
  elongation: [0.5, 4, 0.1],
  density: [0, 1, 0.05],
  spread: [0.5, 3, 0.1],
  glowRadius: [0, 8, 1],
  glowIntensity: [0, 1, 0.05],
  seed: [0, 9999, 1],
  // Tapered
  taperLength: [0, 0.5, 0.01],
  minSizeRatio: [0, 1, 0.05],
  // Pipe
  highlightSize: [0, 1, 0.05],
  highlightIntensity: [0, 1, 0.05],
  wallShade: [0, 1, 0.05],
  // Segmented Pipe
  segmentLength: [2, 32, 1],
  segmentGap: [0, 8, 1],
  segmentTaper: [0, 1, 0.05],
  bellowsWidth: [0, 1, 0.05],
  // Vine
  lightDirection: [0, 360, 1],
  lightIntensity: [0, 1, 0.05],
  organicNoise: [0, 1, 0.05],
  branchDensity: [0, 1, 0.05],
  // Star
  spikeCount: [3, 12, 1],
  innerOuterRatio: [0.1, 0.9, 0.05],
  rotation: [0, 360, 5],
  // Heart
  lobeWidth: [0.5, 1.5, 0.05],
  pointiness: [0, 1, 0.05],
  // Sphere
  highlightX: [-1, 1, 0.05],
  highlightY: [-1, 1, 0.05],
  highlightRadius: [0.1, 0.8, 0.05],
  highlightBrightness: [0, 1, 0.05],
  shadingIntensity: [0, 1, 0.05],
  // Droplet
  tailLength: [0, 1, 0.05],
  tailDirection: [0, 360, 5],
  // Bubble
  iridescence: [0, 1, 0.05],
  membraneThickness: [0.02, 0.3, 0.01],
  reflectionSize: [0.1, 0.5, 0.05],
  // Punctuation
  outlineThickness: [0, 3, 1],
  // Emoji
  eyeSize: [0.1, 0.5, 0.05],
  mouthCurve: [-1, 1, 0.05],
  // Bevel Seam
  bevelDepth: [0, 1, 0.05],
  bevelWidth: [0, 1, 0.05],
  bevelLightDir: [0, 360, 5],
  bevelShadow: [0, 1, 0.05],
  // Prism
  topWidthRatio: [0.3, 1.0, 0.05],
  prismHeight: [0.2, 1.0, 0.05],
  prismLightDir: [0, 360, 5],
  topFaceBrightness: [0, 1, 0.05],
  edgeHighlight: [0, 1, 0.05],
  // Plate
  plateThickness: [0.1, 1.0, 0.05],
  plateBevel: [0, 0.5, 0.05],
  plateLightDir: [0, 360, 5],
  surfaceTexture: [0, 1, 0.05],
  plateEdgeBright: [0, 1, 0.05],
  // Grille
  slatCount: [1, 12, 1],
  slatGap: [0, 1, 0.05],
  slatDepth: [0, 1, 0.05],
  frameWidth: [0, 0.5, 0.05],
  // Vent
  ventOpening: [0.2, 0.9, 0.05],
  rimThickness: [0.05, 0.3, 0.01],
  innerDepth: [0, 1, 0.05],
  ventSlatCount: [0, 8, 1],
};

// Params that display as percentage
export const PERCENT_PARAMS = new Set([
  'opacity', 'hardness', 'innerRadius', 'falloff', 'flickerAmount', 'density',
  'glowIntensity', 'minSizeRatio', 'highlightSize', 'highlightIntensity', 'wallShade',
  'segmentTaper', 'bellowsWidth', 'lightIntensity', 'organicNoise', 'branchDensity',
  'taperLength', 'innerOuterRatio', 'pointiness', 'highlightBrightness', 'shadingIntensity',
  'tailLength', 'iridescence', 'reflectionSize', 'eyeSize', 'lobeWidth',
  'bevelDepth', 'bevelWidth', 'bevelShadow', 'topWidthRatio', 'prismHeight',
  'topFaceBrightness', 'edgeHighlight', 'plateThickness', 'plateBevel', 'surfaceTexture',
  'plateEdgeBright', 'slatGap', 'slatDepth', 'frameWidth', 'ventOpening', 'rimThickness', 'innerDepth',
]);

// Params that display as degrees
export const DEGREE_PARAMS = new Set([
  'flameDirection', 'lightDirection', 'rotation', 'tailDirection',
  'bevelLightDir', 'prismLightDir', 'plateLightDir',
]);

// Color parameter names
export const COLOR_PARAMS = new Set([
  'innerColor', 'outerColor', 'secondaryColor', 'veinColor', 'outlineColor',
  'grooveColor', 'openingColor', 'rimColor',
]);
