> ⚠️ **本文档已过期**（2026-11 全系统审计）：内容基于已退役的旧模型与旧管线，部分引用的文件已删除或改名，不再与现状相符。现行口径以根目录 `README.md` 与 `spikes/system-audit/AUDIT.md` 为准。

# PixelMorpher 管线迁移状态

## 2026-10-13 梳理

### 新管线（统一管线）
- `src/lib/unified-render.ts` (1338 行) — 统一渲染主入口，`generateRenderPlan()` + `executeRenderPlan()`
- `src/lib/unified-pipeline-bridge.ts` (403 行) — 旧数据到新管线的桥，`renderUnified()` 调 `liveAdapter.getCharacter()` 再调 `generateRenderPlan()`
- `src/lib/unified-types.ts` — 统一类型（Character/Node）
- `src/lib/migration-adapter.ts` (717 行) — LiveAdapter，旧 store 数据转统一 Character
- `src/lib/unified-animation-resolver.ts` — 动画解析

### 旧管线（仍在使用！）
- `src/lib/engine/render-pipeline.ts` — 旧渲染管线入口，导出 `renderFrame`, `renderFrameToCanvas`, `renderPuppetNodes`, `renderPartEditMode`
  - `renderFrameToCanvas` → 被 `ExportDialog.tsx` 使用（导出功能）
  - `renderPuppetNodes` → 被 `PixelCanvas.tsx:163` 使用
  - `renderPartEditMode` → 被 `PixelCanvas.tsx` 使用
- `src/lib/engine/puppet-render.ts` (1260 行)
  - `renderPuppetFrame` 已死（未导出，未被调用）
  - `renderPixelPerfectRotation` → 被 `unified-render.ts` 使用（工具函数）
  - `resolvePuppetNodeSprite` → 被多个 UI 组件使用（工具函数）

### 桥接层
- `migration-adapter.ts`：`LiveAdapter.getCharacter()` 把旧 `PuppetSkeleton`/`Part[]` 转为统一 `Character`
- `unified-pipeline-bridge.ts`：`renderUnified()` 是统一管线的入口

## 迁移状态总结

**未迁移干净**：
1. `PixelCanvas.tsx` 同时使用新旧两条管线：
   - `renderUnified()`（新，`unified-pipeline-bridge.ts`）
   - `renderPuppetNodes()`（旧，`render-pipeline.ts`）
   - `renderPartEditMode()`（旧，`render-pipeline.ts`）
2. `ExportDialog.tsx` 使用旧管线的 `renderFrameToCanvas`
3. `puppet-render.ts` 文件仍在，因为 2 个工具函数还被需要

**术语混乱根源**：
- 代码里 `puppet*` 命名是旧管线残留
- 用户模型：角色/骨架/服装/部件精灵
- 统一管线用新术语，旧管线用旧术语，两套并存

