// 头部构造见证判定表（防漏二号关的判定底本）。
// 键 = `${族}:${src}`（src 是 headIR 给每个节点的溯源标记，见
// engine.ts stepSrc）。判定三档：witness = 在参考里指得出见证
// （w 记样本 + 部位）；invented = 已知是发明（留在产品里的须在
// 报告里交代去处）；unread = 尚未读过参考（关轮不许有未读件）。
// 初始底本 = 轮十 45 件自枚举审计 + 轮十一/十二各轮的定案；新增
// 或改形一个构造时，先在这里补判定再关轮——表里没有的件，审计
// 脚本按未读处理。
export type HeadVerdict = 'witness' | 'invented' | 'unread';
export interface VerdictEntry { v: HeadVerdict; w?: string }

export const HEAD_VERDICTS: Record<string, VerdictEntry> = {
  // —— 敏捷族（样本 mecha-agile-side；太阳穴栓芯与眉鳍座另见 ann-h2/g3）——
  'agile:base': { v: 'witness', w: 'mecha-agile-side 盔体' },
  'agile:dome': { v: 'witness', w: 'mecha-agile-side 穹顶 + 回声带' },
  'agile:eyeSeat': { v: 'witness', w: 'mecha-agile-side 眼窝' },
  'agile:eyeGlow': { v: 'witness', w: 'mecha-agile-side 泪滴光体' },
  'agile:cheekPlate': { v: 'witness', w: 'mecha-agile-side 颊板（轮十二）' },
  'agile:cheekPlateF': { v: 'witness', w: 'mecha-agile-side 颊板前脸（轮十二）' },
  'agile:cheekSeam': { v: 'witness', w: 'mecha-agile-side 颊面竖缝（轮十二）' },
  'agile:cheekNotch': { v: 'witness', w: 'mecha-agile-side 颊面前脸短横凹线（轮十三标注 S7；单样本见证、敏捷族变体）' },
  'agile:maskPlate': { v: 'witness', w: 'mecha-agile-side 前置面甲（轮十二）' },
  'agile:maskLines': { v: 'witness', w: 'mecha-agile-side 面甲横槽（轮十二）' },
  'agile:jawPlate': { v: 'witness', w: 'mecha-agile-side 颌板（轮十二）' },
  'agile:jawWedge': { v: 'witness', w: 'mecha-agile-side 颏楔（轮十二）' },
  'agile:earSensor': { v: 'witness', w: 'mecha-agile-side 耳侧暗栅' },
  'agile:templeBolt': { v: 'witness', w: 'ann-h2/g3 太阳穴栓芯' },
  'agile:fairingPts': { v: 'witness', w: 'mecha-agile-side 整流罩' },
  'agile:finBase': { v: 'witness', w: 'mecha-agile-side 鳍座楔形罩；眉鳍式见 ann-h2/g3' },
  'agile:wing:main': { v: 'witness', w: 'mecha-agile-side 主鳍' },
  'agile:wing:rear': { v: 'witness', w: 'mecha-agile-side 后鳍' },
  'agile:wingSpine': { v: 'witness', w: 'mecha-agile-side 刃中脊' },
  'agile:shellStep': { v: 'witness', w: 'mecha-agile-side 壳阶' },
  'agile:shellSeams': { v: 'witness', w: 'mecha-agile-side 壳缝' },
  // —— 主战/olive 族（样本 mecha-side）——
  'olive:base': { v: 'witness', w: 'mecha-side 盔壳' },
  'olive:dome': { v: 'witness', w: 'mecha-side 圆顶' },
  'olive:eyeSeat': { v: 'witness', w: 'mecha-side 眼窝' },
  'olive:eyeGlow': { v: 'witness', w: 'mecha-side 橙色缝眼' },
  'olive:brow': { v: 'witness', w: 'mecha-side 眉块' },
  'olive:descent': { v: 'witness', w: 'mecha-side 面部降式楔' },
  'olive:respTube': { v: 'witness', w: 'mecha-side 横向呼吸管' },
  'olive:seg:respTubeSeg': { v: 'witness', w: 'mecha-side 管环沟' },
  'olive:respMouth': { v: 'witness', w: 'mecha-side 管口' },
  'olive:tip:respTip': { v: 'witness', w: 'mecha-side 管端点色' },
  'olive:earGrille': { v: 'witness', w: 'mecha-side 耳侧栅板' },
  'olive:wing:horn': { v: 'witness', w: 'mecha-side 顶角' },
  'olive:wingSpine': { v: 'witness', w: 'mecha-side 角脊亮边' },
  // —— 动力服族（样本 powersuit-side）——
  'powersuit:base': { v: 'witness', w: 'powersuit-side 盔壳' },
  'powersuit:dome': { v: 'witness', w: 'powersuit-side 白穹 + 橙回声带' },
  'powersuit:visorPts': { v: 'witness', w: 'powersuit-side 面甲板' },
  'powersuit:cheek': { v: 'witness', w: 'powersuit-side 颊块' },
  'powersuit:breatherPts': { v: 'witness', w: 'powersuit-side 呼吸器颌板' },
  'powersuit:breatherPipe': { v: 'witness', w: 'powersuit-side 颌管口' },
  'powersuit:breatherTip': { v: 'witness', w: 'powersuit-side 颏尖橙件' },
  'powersuit:ribbon': { v: 'witness', w: 'powersuit-side 脸侧橙带（ann-head-ps 框注）' },
  'powersuit:earCover': { v: 'witness', w: 'powersuit-side 耳盖板' },
};
