// 全身比例垫图（借 PoseSketcher 附录 A 比例常数）：以「头高」为单位
// 生成标准人偶的关节点位（正面/侧面），可画成垫图（data URL）走编辑器
// 既有参考图通道（contain 居中 + 不透明度），与外部图源并列。
// 头身比预设 = 同一组比例参数的不同取值（总高 = 头数）。

export interface ProportionPreset {
  id: string;
  name: string;
  /** 总高（头高为 1） */
  heads: number;
}

export const PROPORTION_PRESETS: ProportionPreset[] = [
  { id: 'realistic', name: '写实 7.5 头身', heads: 7.5 },
  { id: 'standard', name: '标准 6 头身', heads: 6 },
  { id: 'chibi', name: 'Q 版 3 头身', heads: 3 },
];

export type ProportionView = 'front' | 'side';

/** 关节点位（头高单位，y 向下，地面 = heads） */
export interface ProportionJoints {
  headCenter: { x: number; y: number };
  neck: { x: number; y: number };
  chest: { x: number; y: number };
  waist: { x: number; y: number };
  hipL: { x: number; y: number };
  hipR: { x: number; y: number };
  shoulderL: { x: number; y: number };
  shoulderR: { x: number; y: number };
  elbowL: { x: number; y: number };
  elbowR: { x: number; y: number };
  wristL: { x: number; y: number };
  wristR: { x: number; y: number };
  kneeL: { x: number; y: number };
  kneeR: { x: number; y: number };
  ankleL: { x: number; y: number };
  ankleR: { x: number; y: number };
}

/**
 * 比例关节点位。躯干段沿用 PoseSketcher 主轴落点（头中心 .5、颈 1.0、
 * 胸腰中 2.25、腰 3.0——以 6 头身为标尺），总高变化主要由腿长吸收、
 * 躯干按总高轻微缩放（Q 版躯干压到 42% 总高）；肢内切分肘 .40/腕 .84、
 * 膝 .40/踝 .85（占肢长比例）；肩横偏 .42、髋横偏 .30（×头高）；
 * 侧面横偏 ×0.2（对方侧面模式口径）。手臂 A 势：自肩向下外张 50°。
 */
export function proportionJoints(heads: number, view: ProportionView): ProportionJoints {
  const side = view === 'side';
  const lat = (v: number) => (side ? v * 0.2 : v);
  const torsoScale = Math.min(1, Math.max(0.62, heads / 6));
  const neckY = 1.0 * torsoScale + (1 - torsoScale) * 0.5;
  const waistY = 3.0 * torsoScale;
  const chestY = neckY + (waistY - neckY) * 0.55;
  const hipY = waistY + 0.22 * torsoScale;
  const ankleY = heads - 0.12;
  const kneeY = hipY + (ankleY - hipY) * 0.47;
  const shoulderY = neckY + 0.18 * torsoScale;
  const armLen = heads * 0.43;
  const armAng = (50 * Math.PI) / 180; // 自水平向下
  const armPt = (shoulder: { x: number; y: number }, sign: number, t: number) => ({
    x: shoulder.x + sign * lat(Math.cos(armAng) * armLen * t + 0.001),
    y: shoulder.y + Math.sin(armAng) * armLen * t,
  });
  const shoulderL = { x: -lat(0.42), y: shoulderY };
  const shoulderR = { x: lat(0.42), y: shoulderY };
  // 髋关节横偏：正面 ±0.16，侧面近中线 ±0.02
  const hipX = side ? 0.02 : 0.16;
  return {
    headCenter: { x: 0, y: 0.5 },
    neck: { x: 0, y: neckY },
    chest: { x: 0, y: chestY },
    waist: { x: 0, y: waistY },
    hipL: { x: -hipX, y: hipY },
    hipR: { x: hipX, y: hipY },
    shoulderL, shoulderR,
    elbowL: armPt(shoulderL, -1, 0.4),
    elbowR: armPt(shoulderR, 1, 0.4),
    wristL: armPt(shoulderL, -1, 0.84),
    wristR: armPt(shoulderR, 1, 0.84),
    kneeL: { x: -hipX * 1.05, y: kneeY },
    kneeR: { x: hipX * 1.05, y: kneeY },
    ankleL: { x: -hipX, y: ankleY },
    ankleR: { x: hipX, y: ankleY },
  };
}

/** 段连接（画胶囊链用） */
export const PROPORTION_SEGMENTS: [keyof ProportionJoints, keyof ProportionJoints][] = [
  ['neck', 'chest'], ['chest', 'waist'],
  ['waist', 'hipL'], ['waist', 'hipR'],
  ['shoulderL', 'chest'], ['shoulderR', 'chest'],
  ['shoulderL', 'elbowL'], ['elbowL', 'wristL'],
  ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
  ['hipL', 'kneeL'], ['kneeL', 'ankleL'],
  ['hipR', 'kneeR'], ['kneeR', 'ankleR'],
];

/** 把垫图画到给定画布（透明底）：头身刻度线 + 胶囊人偶 + 头蛋形 */
export function drawProportionGuide(
  canvas: HTMLCanvasElement,
  preset: ProportionPreset,
  view: ProportionView,
): void {
  const unit = 90; // 每头高的像素数
  const j = proportionJoints(preset.heads, view);
  const wUnits = view === 'side' ? 2.2 : 3.4;
  canvas.width = Math.round(wUnits * unit);
  canvas.height = Math.round((preset.heads + 0.3) * unit);
  const ctx = canvas.getContext('2d')!;
  const ox = canvas.width / 2;
  const oy = 0.15 * unit;
  const P = (p: { x: number; y: number }) => ({ x: ox + p.x * unit, y: oy + p.y * unit });

  // 头身刻度线（每 1 头高一条，带数字）
  ctx.strokeStyle = 'rgba(120,130,160,0.35)';
  ctx.fillStyle = 'rgba(120,130,160,0.8)';
  ctx.lineWidth = 1;
  ctx.font = `${Math.round(unit * 0.16)}px sans-serif`;
  for (let i = 0; i <= Math.floor(preset.heads); i++) {
    const y = oy + i * unit;
    ctx.beginPath();
    ctx.moveTo(4, y);
    ctx.lineTo(canvas.width - 4, y);
    ctx.stroke();
    ctx.fillText(String(i), 6, y - 3);
  }

  // 胶囊段（描边垫底 + 主体）
  const seg = (a: { x: number; y: number }, b: { x: number; y: number }, r: number) => {
    const pa = P(a), pb = P(b);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
    ctx.strokeStyle = '#4a5160'; ctx.lineWidth = r * 2 + 2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
    ctx.strokeStyle = '#8f9bb0'; ctx.lineWidth = r * 2; ctx.stroke();
  };
  const torsoR = unit * 0.16;
  for (const [a, b] of PROPORTION_SEGMENTS) {
    seg(j[a], j[b], a === 'neck' || a === 'chest' || a === 'waist' ? torsoR : unit * 0.09);
  }
  // 关节点
  ctx.fillStyle = '#d7deeb';
  for (const p of Object.values(j)) {
    const pp = P(p);
    ctx.beginPath();
    ctx.arc(pp.x, pp.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // 头：蛋形（长半轴 .5、宽半轴 .35 × 头高，锚在头中心）
  const hc = P(j.headCenter);
  ctx.beginPath();
  ctx.ellipse(hc.x, hc.y, unit * 0.35, unit * 0.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#8f9bb0';
  ctx.fill();
  ctx.strokeStyle = '#4a5160';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** 生成垫图 data URL（浏览器环境）；预设 id 未知时回退标准 */
export function proportionGuideDataUrl(presetId: string, view: ProportionView): string {
  const preset = PROPORTION_PRESETS.find((p) => p.id === presetId) ?? PROPORTION_PRESETS[1]!;
  const canvas = document.createElement('canvas');
  drawProportionGuide(canvas, preset, view);
  return canvas.toDataURL('image/png');
}
