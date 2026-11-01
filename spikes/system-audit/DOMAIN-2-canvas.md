# 域2 审计报告：画布与渲染

审计树：audit/full-system（== main 3a4a55c）。只读审计，未改任何代码。
判定四态：通 / 断裂（点名断段）/ 实现错误（机制推导）/ 未验证（缺段说明）。
五段链：①入口/数据定义 → ②store/写入 → ③消费端调用 → ④消费端内部判断 → ⑤存档/进包往返（本域多为呈现层，⑤指数据落盘/进包后回读同一消费链；呈现开关类无⑤时注明）。

---

## 1. 部件像素定稿顺序（renderNodeSprite 主链）

- 链：①部件数据 = 节点/精灵/修改器（unified-types）→ ②project-store 角色表 → ③`PixelCanvas.tsx:290` 调 `renderUnified`（unified-render.ts:5534）→ ④`generateRenderPlan`（:2963）产指令、`executeRenderPlan`（:3627）执行、`renderNodeSprite`（:4305）逐部件定稿 → ⑤与包侧同源函数（convert/运行时为域7）。
- 判定：**通**。
- 证据（renderNodeSprite 内部顺序与门控，逐段已读）：像素修改器（enabled 过滤，PIXEL_MOD_TYPES 定义于 :3734-3737）→ 逐帧修正笔刷命令（计划期以 `fcEntry.spriteId === effectiveSprite.id` 门控）→ translate 像素平移（查 enabled）→ 蓝图像素链（hasPixelChain 门控）/旧回落 → 转面（非零门控）→ mesh 蒙皮（角>0.01 且半径>0）→ 快照弯曲（同门控）→ 置换（:4551 displaceEnabled 且 amp>0）→ 宿主后处理（:4575，`firstHostFxParams` 在 host-fx.ts:89-93 查 hostFxEnabled 且 mode!=='none'）→ pixelsToCanvas/堆叠合成 → 雾（fogAmount>0.001）→ 镜像翻转 → 发光层读同一 effectivePixels 构建 → 残影在本体前 → 编号剪影在本体绘制前落图 → 身后效果（glow/afterimage/motion_blur 修改器）→ 自动运动模糊 → 身后动态粒子/弧线 → 本体 → 发光层叠上 → 身前粒子/弧线 + particle 修改器。与宿主后处理落地口径（定稿后、成画布前）一致。
- 附：动态粒子段启用门控在 simulateDynamicParticles 内（dynamic-pattern-sim），弧线在 drawDynamicArcs 内查 `p.arcEnabled`（:4000）；画布修改器 `applyCanvasModifiers` 查 track.visible && track.enabled && modifier.enabled（engine/canvas-modifiers.ts:860-864），field_wipe/block_shift 均有消费 case（:888/:891）。

## 2. 预览质量（顶栏「画质」高/中/低）

- 链：①UI `ViewControls.tsx` PreviewQualitySelect → ②`editor-store.ts:285` previewQuality 字段、`:396` setPreviewQuality → ③④⑤见下。
- 判定：**断裂（②→③ 断，全链无消费）**。历史模式⑦（参数无消费端）+④（死代码误当活链）。
- 证据：
  - store 字段全仓无任何读方（grep 确认只有定义与 setter）。
  - `PixelCanvas.tsx:292` 调 renderUnified 时画质实参硬编码 `'high'`，不读 store。
  - `renderUnified`（:5534）签名收 previewQuality（形参在 :5549），函数体不下传：其调用的 generateRenderPlan 由各编排方调用时 previewQuality 形参（:2972）一律传 undefined；:3607 把它写进 plan.previewQuality，但 executeRenderPlan 从不读。
  - `NodeRenderInstruction.previewQuality` 全仓无赋值点；`renderNodeSprite:4317` 读 `instruction.previewQuality ?? 'high'` 恒得 'high'。
  - 后果：renderNodeSprite 内全部 `previewQuality !== 'low'` 跳过分支恒不触发——置换（:4551）、宿主后处理（:4575）、发光层（:4692）、残影（:4717）、身后效果（:4763）、动态粒子（:4801 起多处）——低画质加速路径全是死代码；用户切高/中/低无任何画面或性能差异。
  - 附带死代码：`PixelCanvas.tsx:126` 局部变量 `onionQuality` 计算后从未使用。

## 3. 显示过滤（全部角色开关 / 洋葱皮候选链）

- 链：①`visible-characters.ts` 单槽记忆函数（保 Record 同一性供拾取戳记比对）→ ②候选链 = editor-store activePuppetSkeletonId 优先、performCharacterId 回退、皆无回退全显；showAllCharacters 在 puppet-session store → ③④消费四处同口径：`PixelCanvas.tsx:165`（洋葱皮）、`:276`（主渲染+拾取 visibleCharactersRecord）、`:397`（骨骼覆盖层 filterVisibleCharacters）、`use-canvas-state.ts:385`（拾取读侧，与绘制侧共用同一记忆结果）。
- 判定：**通**。三处（主渲染/拾取/骨骼层）共用同一份过滤结果，无双实现漂移。

## 4. 拾取编号图（pick-buffer）

- 链：①`pick-buffer.ts`（85 行）戳记 = 角色表/精灵表对象同一性 + 帧 + 画布尺寸 + nodeTurn3D → ②无 store 写入，绘制期生成 → ③`PixelCanvas.tsx:284` beginPickFrame、渲染后 endPickFrame，try/finally 包住 renderUnified → ④戳记新鲜时编号图为 tier 0 权威；alpha<250 读空回落几何 → ⑤不入存档（纯编辑期结构）。
- 判定：**通**，与 2026-10-28 编号拾取定案一致。
- 边界注记：角色级蓝图路径（renderCharacterWithBlueprint，:5321）编号剪影取自蓝图后处理**之前**的合成；若角色蓝图整体搬移像素，编号图与最终画面错位。此为定案口径（编号图 = 各节点最终 workingCanvas 剪影）之外的层，未判缺陷，记录备查。

## 5. 几何拾取 tier 0/1/2 + 胶囊段归属 + joint 退化形状

- 链：①`node-picking.ts` pickNodesAt → ③PixelCanvas/use-canvas-state 调用 → ④内部：bufferNodeId 置顶（score −1e9）并去重该节点几何候选；bufferAuthoritative 时仅压制 tier 0 几何（精灵像素+关节盘），tier 1/2 不受影响；关节盘 tier 0 归子节点（盘画在父 socket 处）；tier 2 对 joint 退化形给 −0.5 分偏置。
- 人偶形状：`computeMannequinShapes`（mannequinShapesInternal，:1844）——段记起始（父侧）节点（nodeId=父、toNodeId=子）、每节点另有 kind 'joint' 退化形、不可见子不出段（visible===false 跳过）、头蛋 kind 'head' 的 nodeId=头节点且中心在头关节。
- 判定：**通**，与 2026-10-28 命中两定案（胶囊段归父侧、编号图新鲜时 tier 0 权威）逐项一致。

## 6. 关节盘

- 链：①节点 attachment.autoJointDisc/discColor/jointWidth → ②画布菜单 clearJointDiscs/regenerateJointDiscs（joint-discs.ts:26/:38，只作用于 socket 连接节点，置 false/删字段，与渲染判定同字段）经 PixelCanvas applyJointDiscOp（pushUndo + updateUnifiedCharacter）写入 → ③generateDiscInstructions（:1665）→ ④`nodeHasJointDisc`（:1504）查 autoJointDisc===false 抑制；mesh 蒙皮与蒙皮快照认领时抑制出盘；盘指令 nodeId = 关节属主（子节点）→ 绘制序（executeRenderPlan :3627 与 renderDisc :5043-5052）：盘 → 人偶 → 深度序节点（盘始终被遮挡），编号图同序落图。
- 判定：**通**。

## 7. 视图开关（网格/骨骼/透视缩短/全部角色/洋葱皮/显示效果）

- 链：①②开关组件在 ViewControls.tsx，经 CanvasViewOverlays.tsx 挂画布右上：GridToggle→editor-store.showGrid、SkeletonsToggle→showPuppetSkeleton、ForeshortenToggle→perspectiveForeshorten、ShowAllCharactersToggle→puppet-session.showAllCharacters、OnionSkinToggle→project-store.onionSkinEnabled（单
...[truncated 7492 chars]