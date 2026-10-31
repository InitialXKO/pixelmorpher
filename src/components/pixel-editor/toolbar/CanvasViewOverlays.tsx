'use client';

import React from 'react';
import {
  ZoomControls,
  GridToggle,
  SkeletonsToggle,
  ForeshortenToggle,
  DisplayFxControls,
  ShowAllCharactersToggle,
  OnionSkinToggle,
} from './ViewControls';

// ============================================================
// CanvasViewOverlays — 画布悬浮视图控制（原顶部工具栏的视图排迁来）
// 视图开关只改画布怎么显示、不动数据，切换时眼睛在画布上，故贴画布：
// 纯显示开关（网格/骨骼/透视缩短/全部角色/洋葱皮/显示效果）悬浮右上
// 一列；缩放是导航不是开关，沉右下（−/百分比/＋/适应，自带百分比读数）。
// 预览质量是渲染管线设置，不属视图开关，仍留顶栏全局区。
// 工具盘（左缘）不混开关：工具互斥单选、开关独立多选，心智模型不同。
// ============================================================

export function CanvasViewToggles() {
  return (
    <div className="absolute top-2 right-2 z-20 flex flex-col items-center gap-0.5 p-1 rounded-md bg-[#12121f]/90 border border-white/10 backdrop-blur-sm select-none">
      <GridToggle />
      <SkeletonsToggle />
      <ForeshortenToggle />
      <ShowAllCharactersToggle />
      <OnionSkinToggle />
      <DisplayFxControls />
    </div>
  );
}

export function CanvasZoomDock() {
  return (
    <div className="absolute bottom-2 right-2 z-20 flex items-center rounded-md bg-[#12121f]/90 border border-white/10 backdrop-blur-sm select-none">
      <ZoomControls />
    </div>
  );
}
