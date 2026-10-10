# PixelMorpher 代码审计缺陷报告

> 审计日期：2026-10-10
> 审计方式：5 个子代理并行逐文件细读（覆盖 197 个源文件中的绝大部分），每条"死代码/未引用"结论均用全仓 grep 验证；另独立运行 `npx tsc --noEmit` 做构建健康检查。
> 审计范围：木偶（puppet）渲染/动画链路、时间轴/关键帧链路、全部 zustand store、插件/脚本/AI/lib 层、主入口与面板 UI。
> **只做审计，未修改任何代码。**
>
> ⚠️ 特别说明：审计过程中工作区存在大量未提交修改（git working tree dirty），`PuppetPanel.tsx` 被重写（改用 `usePuppetSessionStore` + 新文件 `PerformPanel.tsx`），`usePuppetPanelState.ts` / `AnimateModePanel.tsx` / `AnimateControls.tsx` 被删除。木偶链路的发现已按当前磁盘状态逐条复核；已删除文件的发现不再列出。

---

## 0. 构建健康

| 项目 | 状态 |
|---|---|
| `tsconfig.json` | `strict: true` 但 **`noImplicitAny: false`** —— 隐式 any 泛滥，类型系统大面积放水（见多处 `any` 链） |
| `npx tsc --noEmit`（node_modules 已安装后实测） | **7 个错误，全部在 `src/components/pixel-editor/timeline/ParamDriverSubTrackLane.tsx`**：`Cannot find name 'FRAME_WIDTH'`（157, 203×2, 227, 228, 240×2 行）。根因见致命缺陷 F2 |
| `next.config.ts:8` | **`typescript: { ignoreBuildErrors: true }`** —— 类型错误被构建掩盖，F2 这类编译期错误不会阻断 `next build`，导致坏代码持续上线 |
| `eslint` | 未运行（非阻塞项）；代码中存在多处 `require()` 在 ESM client 组件中的用法，Turbopack 下脆弱 |

---

## 致命（Fatal）—— 导致崩溃 / 渲染完全错误 / 构建失败

### F1. `executeRenderPlan` 的 `ctx.clearRect` 擦掉同一画布上已绘制的全部内容
- **文件**：`src/lib/unified-render.ts:740`（`executeRenderPlan` 首行 `ctx.clearRect(0, 0, canvasWidth, canvasHeight)`）
- **问题**：`renderUnified`（`src/lib/unified-pipeline-bridge.ts:92-130`）先调 `renderFrame(...)` 把背景＋非木偶部件画到同一个 `ctx` 上，随后 `renderPuppetViaUnifiedPipeline`（bridge:150-215）在 `for (const character of puppetCharacters)` 循环内对每个 character 调用 `executeRenderPlan`——每次都 clear 且**不重填背景**。
- **影响**：只要项目同时有非木偶部件和木偶角色，非木偶部件被擦除；纯木偶多 character 场景只剩最后一个 character 可见。导出路径 `renderUnifiedToCanvas`（bridge:375，被 `ExportDialog.tsx` 5 处调用）同样中招。实时预览（`PixelCanvas.tsx:187`）与导出双路径线上可见。
- **修复**：`executeRenderPlan` 不应负责 clear（由调用方决定），或 bridge 改为离屏 canvas 合成后再一次性 `drawImage`。

### F2. `ParamDriverLaneRow` 引用未定义的 `FRAME_WIDTH`，展开轨道即崩溃
- **文件**：`src/components/pixel-editor/timeline/ParamDriverSubTrackLane.tsx:157, 203, 227, 228, 240`
- **问题**：内部组件 `ParamDriverLaneRow`（约 117–292 行）直接使用裸 `FRAME_WIDTH`，但该名字只在外层两个父组件各自的作用域内定义（第 33 行 `const FRAME_WIDTH` / 第 88 行 `const FW`），模块作用域无此定义。import 的是 `FRAME_WIDTH as STATIC_FRAME_WIDTH`。
- **影响**：任一轨道展开且存在 param driver 时，`wavePoints` 的 `useMemo` 在渲染期执行即抛 `ReferenceError`，整个 Timeline 卸载。经 `ParamDriverEditDialog` 的"+ 添加"按钮可达，非理论路径。`tsc --noEmit` 报 7 个错误（已独立复现），但 `ignoreBuildErrors: true` 让它混进构建。
- **修复**：`ParamDriverLaneRow` 增加 `frameWidth` prop（父组件已算出动态宽度），内部统一使用传入值。

### F3. `renderPuppetNodes` 双重平移，精灵位置整体错位（潜伏）
- **文件**：`src/lib/engine/render-pipeline.ts:1227` + `1248-1250`
- **问题**：第 1227 行 `ctx.translate(wt.worldX, wt.worldY)`，随后 1248-1250 行 `const drawX = Math.round(wt.worldX - rotResult.resultPivotX) + 0.5; ctx.drawImage(rotatedCanvas, drawX, drawY)`——canvas 变换会叠加到 drawImage 坐标上，最终绘制位置 = **2×world − pivot**。而 `computePuppetWorldTransforms`（`render-helpers/puppet-world-transforms.ts:67`）返回的是画布绝对坐标（根节点 `wx = canvasWidth/2 + offsetX`），不是相对坐标。
- **影响**：经此路径的所有木偶精灵位置错误（根节点在画布中心时精灵被画到右偏 `canvasWidth/2`、下偏 `canvasHeight/2`）。当前默认走 unified 新管线，此函数是旧管线 fallback（bridge:240/246）与 `renderFrameToCanvas` 导出 API 的入口——一旦切 fallback 即全链路错位。
- **修复**：删掉第 1227 行的 `ctx.translate`（drawX/drawY 已含 world 坐标），或改为 `drawImage(rotatedCanvas, -resultPivotX, -resultPivotY)` 二选一。

---

## 高（High）—— 功能失效 / 数据丢失 / 静默错误

### H1. `selectedBoneId` 在两个 store 各有一份，面板与画布互相看不见对方的选择
- **文件**：`src/lib/store/skeleton-slice.ts:32,45,226`（project-store）vs `src/lib/store/editor-store.ts:66,224,269`（editor-store）
- **问题**：`SkeletonPanel.tsx:1116-1195` 从 **useProjectStore** 读写 `selectedBoneId`；`use-canvas-state.ts:184` → `PixelCanvas.tsx:249` 的 `renderBoneOverlay` 用的是 **editor-store** 那份；`tool-handlers.ts:803-829` 画布点选骨骼写的是 editor-store 的 `setSelectedBoneId`。
- **影响**：面板点选骨骼，画布高亮不跟随；画布点选骨骼，面板选中态不跟随。两个真相源各自被不同 UI 写入、被另一方读取，永久失步。真实的数据流断裂 bug。
- **修复**：二选一保留（建议保留 project-store 那份，因其参与 undo 序列化），删除另一份并统一所有读写点。

### H2. `animationVariables` 被排除在 undo 快照和项目文件之外：undo 失效 + 存档丢数据
- **文件**：`src/lib/store/project-slice.ts:34`（初始化）、`:155-196`（`_captureSnapshot`）、`:330-372`（`exportProjectFile`）
- **问题**：`_captureSnapshot` 的 JSON 字段清单和 `exportProjectFile` 的逐字段构造都没有 `animationVariables`，但 `addAnimationVariable/removeAnimationVariable/updateAnimationVariable/setVariableWriter` 每次都 `pushUndo(...)`。
- **影响**：(a) 动画变量的增删改无法 undo；(b) 保存再打开项目，全部动画变量丢失；(c) `importProjectFile`（374 行）用 `{...file.project, ...}` 合并，旧项目的变量会泄漏到新导入的项目里。
- **修复**：两处字段清单补上 `animationVariables`；`importProjectFile` 显式设置 `animationVariables: file.project.animationVariables || []`。

### H3. `addAnimationClip` 不调用 `syncLegacyFromActiveClip`，新片段激活后 legacy 字段是旧数据
- **文件**：`src/lib/store/project-slice.ts:622-647`；对比同文件 `removeAnimationClip:649`、`updateAnimationClip:666`、`setActiveAnimationClip:678` 都调用了 `get().syncLegacyFromActiveClip()`（749 行）
- **问题**：`addAnimationClip` set 了 `animationClips` + `activeAnimationClipId`（指向全新空 clip），但没有同步 legacy 字段；而现有组件全部读 legacy 字段（`tracks/keyframes/effectTracks/...`）。
- **影响**：新建片段后 legacy 字段仍是上一个 clip 的数据 → 时间轴/画布渲染的是"已不存在的激活片段"的数据，直到其他操作触发同步才恢复。
- **修复**：在 `addAnimationClip` 的 set 之后补 `get().syncLegacyFromActiveClip()`。

### H4. `computeAnimationModifierTransform` 读取的参数名与 `MODIFIER_DEFINITIONS` 完全错位 —— puppet 路径动画参数被无视
- **文件**：`src/lib/unified-animation-resolver.ts:639`；真实参数定义 `src/lib/types.ts:2409+`（2426–2446 行已逐项核对）
- **问题**：代码读 `p.frequency ?? 1`、`p.decay ?? 1`（pendulum）、`p.speed`、`p.radius`、`p.trajectory`（wheel）等；真实参数名是 `period`（周期/帧）、`amplitude`、`phase`、`damping`，wheel 是 `radiusX/radiusY`、`trajectoryMode`。且 `t = frame / frameRate` 用绝对秒而非相对帧，与主路径（`animation-dispatch` + handlers，period 制）行为分裂。
- **影响**：`unified-render.ts:270` 经 `unified-pipeline-bridge.ts` 被 `PixelCanvas`（puppet 部件渲染）实际调用——puppet 路径下用户设置的周期/阻尼/半径等全部失效（恒为 `??` 默认值）。
- **修复**：统一为 `period` 制参数名，或让 unified 路径复用 `animation-dispatch.ts` 的 `computeAnimationModifierTransform`。

### H5. 统一管线静默丢弃多种动画 modifier（与旧管线行为断裂）
- **文件**：`src/lib/unified-animation-resolver.ts:655-735`；`src/lib/unified-render.ts:236-246`
- **问题**：resolver 的 switch 只实现了 `pendulum/wheel/bounce/breath/wobble/gait/custom_wave`（`elliptical_compress` case 在 728 行但被 `isAnimationModifier` 排除，实际不可达）；`float/shake/elastic/expression/noise/wave/spring/jitter` 全部落入 `default` → 零变换贡献。而旧管线 `bake-transform-handlers.ts:134-221, 309-312` 明确实现了 `float/shake/elastic/expression`。
- **影响**：木偶节点上挂这些 modifier 时统一管线静默无效果，不报错，用户难以察觉是管线差异。
- **修复**：补齐 resolver 的 case，或在 `isAnimationModifier` 中对未实现类型打警告日志。

### H6. 统一管线的 `buildVariableContext` 是 stub，动画变量驱动恒为默认值
- **文件**：`src/lib/unified-animation-resolver.ts:474-504`
- **问题**：三遍循环做的都是同一件事 `values[v.name] = v.value`，注释明写 "Full writer resolution requires the driver system to be integrated"。而旧管线 `param-driver.ts` 的同名函数做了完整的拓扑排序＋writer 求值。
- **影响**：puppet 路径下由 ParamDriver 驱动的 AnimationVariable 永远等于静态默认值，变量动画失效且静默。`unified-render.ts:659` 在 puppet 路径调用。
- **修复**：复用 `param-driver.ts` 的 `buildVariableContext`（注意两者 `VariableContext` 类型不同构，见 M 级条目）。

### H7. 全局 shake 用 `Math.random()`，渲染非确定性
- **文件**：`src/lib/engine/animation-handlers/global-transform-handlers.ts:67-68`
- **问题**：同文件 `jitterHandler` 用 `seededRandom`，bake 路径 `shakeHandler` 用 `seededRandom(seed + step * 7919)`，唯独此处用 `Math.random()`。
- **影响**：同一帧每次渲染结果不同，破坏帧缓存/洋葱皮/导出一致性；缓存命中与未命中时画面跳变。
- **修复**：改为 `seededRandom(ctx.currentFrame * K + seed)` 确定性序列。

### H8. 插值缓存从不失效，编辑关键帧后暂停帧显示过期插值
- **文件**：`src/lib/engine/interpolation.ts:23`（`invalidateInterpolationCache` 从未被调用且未导出）；`render-pipeline.ts:716` 缓存键 `${prevKf.id}:${nextKf.id}:${t.toFixed(4)}`
- **影响**：暂停在插值帧上，用 `ModifierParamEditDialog` 改参数 → store 更新 → 重渲染 → 相同 key 缓存命中 → 画布显示旧值，直到 scrub 改变 t 或 512 条目淘汰。属"改了参数画布不动"类故障。
- **修复**：导出该函数，在 `updateModifier`/`updateKeyframe`/`updateModifierParamKeyframe` 等处调用，或把 params hash 纳入缓存键。

### H9. `_paramDriverEvalCache` 永不失效；`clearAnimationStateCache` 总开关零调用
- **文件**：`src/lib/engine/param-driver.ts:195-210`；`src/lib/engine/frame-cache.ts:81-99, 95`
- **问题**：`evaluateParamDriverWithSources` 用 `driverId:frame` 做键缓存求值结果（键里没有 variables 上下文和驱动参数）；唯一的失效入口 `invalidateParamDriverEvalCache` 只在 `clearAnimationStateCache`（frame-cache.ts:95，经 `require` 动态调用）中被调用，而 `clearAnimationStateCache` 全项目零调用。另注意第 95 行在 TS/ESM 下用 `require`，浏览器 ESM 环境可能直接抛 ReferenceError（被 try/catch 吞掉 → 静默不清缓存）。
- **影响**：用户修改 ParamDriver 的 amplitude/phase/period 等参数后，同帧求值命中缓存，画面不更新；所有"应清未清"的缓存问题都无兜底。
- **修复**：缓存键加入参数 hash，或在驱动参数变更时调用失效函数；导出 `clearAnimationStateCache` 并在工程加载/撤销重做等处调用；`require` 改顶层 import（需先解决循环依赖）或事件通知。

### H10. `applyCanvasModifiers` 被重复应用两次
- **文件**：`src/lib/unified-pipeline-bridge.ts:213`、`:381`；`src/lib/engine/render-pipeline.ts:1057`
- **问题**：`renderFrame` 内部 1057 行已调用 `applyCanvasModifiers(ctx, canvasModifierTracks, ...)`；bridge 把 `canvasModifierTracks` 传给 `renderFrame` 后，又在木偶路径末尾对同一个 ctx 再次调用（213 行；导出路径 381 行同样）。
- **影响**：bloom / scanlines / color_lut 等后处理被叠加两次，画面与单管线预览不一致。
- **修复**：只让其中一处应用（建议 `renderFrame` 内部应用后，木偶路径不再重复调用，或反之）。

### H11. `renderUnifiedToCanvas` 丢失全局变换，与实时预览不一致
- **文件**：`src/lib/unified-pipeline-bridge.ts:302-383` 对比 `:150-215`
- **问题**：`renderPuppetViaUnifiedPipeline` 在渲染木偶前用 `ctx.save/translate/rotate/scale` 包裹了 `computeGlobalModifierTransform` 的结果（168-190 行）；而 `renderUnifiedToCanvas` 的木偶循环（330-376 行）直接 `generateRenderPlan` + `executeRenderPlan`，没有这层包装。
- **影响**：存在 globalModifiers（镜头/世界变换）时，导出的图与预览不一致。
- **修复**：把全局变换包装抽成共享函数，两处复用。

### H12. `renderPixelPerfectRotation` 拉伸分支把拉伸又抵消掉了
- **文件**：`src/lib/engine/puppet-render.ts:209-213`
- **问题**：`angle === 0` 且 `stretchY !== 1` 时走分支 `const result = downsample4x(upCanvas, sw, sh)`，而 upscaled 画布是按 `sh * UPSCALE * stretchY` 拉伸绘制的（196-209 行）。下采样目标写死为原始 `sw, sh`，等于把拉伸重采样回原高度——拉伸被静默擦除，且返回的 `resultPivotX/Y` 未按拉伸缩放。
- **影响**：木偶节点 `worldAngle` 恰为 0 而 `stretch ≠ 1` 时，垂直拉伸完全失效。在线路径：`render-pipeline.ts:1245` 与 `unified-render.ts:1091` 都会以 `(worldAngle=0, stretch≠1)` 调用它。
- **修复**：拉伸分支下采样目标应为 `(sw, round(sh*stretchY))`，`resultPivotY = pivotY * stretchY`。

### H13. 旋转缓存与画布池的 use-after-release（缓存污染）
- **文件**：`src/lib/engine/puppet-render.ts:213, 281`；`src/lib/engine/canvas-pool.ts:36-42`；`src/lib/engine/render-cache.ts:110-140`
- **问题**：`setCachedRotation(cacheKey, { canvas: result, ... })` 把**池化 canvas**存入 LRU 缓存；调用方 `render-pipeline.ts:1252-1254` 无条件 `releaseCanvas(rotatedCanvas)`。release 只是 push 回池，acquire 会复用（改尺寸即清空画布）。于是缓存命中的 canvas 可能已被他人复用改写；且缓存键的 5 像素指纹保护的是源画布而非缓存的结果画布。另：`unified-render.ts` 中 0 处 `releaseCanvas`，同一缓存在新管线里把池 canvas 永久钉住（池泄漏而非损坏）——两处处理都不对。
- **影响**：旧管线下旋转精灵可能出现错乱/串图，难以复现。
- **修复**：二选一——(a) 缓存存入非池化的独立 canvas（如 `createPartCanvas` 的像素缓存做法）；(b) 调用方对缓存命中的 canvas 不 release（需 `renderPixelPerfectRotation` 返回是否命中的标记）。

### H14. `NodeTree.tsx:90` — 点击子节点选中其父节点
- **文件**：`src/components/pixel-editor/puppet/NodeTree.tsx:90`
- **问题**：`NodeTreeItem` 的 prop 是 `onSelect: () => void`（36-43 行，wrapper 125 行已绑定本节点 `onSelect={() => onSelect(node.id)}`）；但递归渲染子节点时第 90 行 `onSelect={onSelect}` 把**父节点已绑定的零参闭包**原样传给子 `NodeTreeItemWrapper`（其期望 `(id: string) => void`，TS 允许少参赋值）。子 wrapper 再包一层调用时，父闭包忽略传入的 child id，实际执行的是父节点的选中。
- **影响**：任何 depth≥1 的嵌套节点在节点树中都点不中，点击子节点总是选中其父节点。
- **修复**：第 90 行改为传递原始 dispatcher（把未绑定的 `(id) => void` 经 props 透传，而非复用已绑定的 `onSelect`）。

### H15. 工作区切换陷阱：从项目主页切换模式后编辑器永远回不来
- **文件**：`src/app/page.tsx:578`；`src/components/pixel-editor/WorkspaceSwitcher.tsx:60-75`
- **问题**：`handleModeSwitch` 只在进入 `project_home` 时调用 `setShowProjectHome(true)`，切换到其他任何模式时从不置回 false。`setShowProjectHome(false)` 只在 `lib/asset-store.ts:338`（openProject）、`:469`（createProject）出现。Toolbar（含 WorkspaceSwitcher）在主页依然渲染（page.tsx 工具栏在条件之外），所以用户点主页上的"动画模式"图标 → `mode='animation'` 但 `showProjectHome` 仍为 true → 页面继续显示 ProjectHomeScreen，工具栏却高亮"动画模式"，状态自相矛盾。
- **影响**：用户误点 Home 图标后无法通过切换器返回当前编辑状态，唯一出路是打开/新建项目（会重载数据）。
- **修复**：在 `handleModeSwitch` 中对非 `project_home` 模式统一 `setShowProjectHome(false)`；或让 page.tsx 条件只看 `mode`。

### H16. 工具栏 4 组控件是摆设（局部 state 从未写入 store/求解器）
- **文件**：`src/components/pixel-editor/toolbar/ToolOptionPanels.tsx:64-91`（IKToolControls）、`:93-133`（WeightPaintToolControls）、`:19-62`（BoneToolControls）；`src/components/pixel-editor/Toolbar.tsx`（blendMode/coordinateMode）
- **问题**：
  - IK 的 `ikChainLength`/`ikIterations` 是组件内 `useState`，从未写入 store、从未传给求解器（真实消费方是 `SkeletonPanel.tsx:444-465` 的另一套局部 state）。
  - 权重绘制的 `weightPaintRadius`、`selectedBoneForWeight` 都是局部 state；store 明明有 `weightPaintRadius`/`weightPaintBoneId` 及 setters（`editor-store.ts:74-76, 228-229, 273-274`），`PixelCanvas.tsx:250` 只读 store 的值；`applyWeightPaint`（`use-canvas-state.ts:631`）读 store 的 `weightPaintBoneId` 且根本不用 radius（`bindPartToBone(..., 1.0)` 硬编码）。
  - 骨骼工具的 `boneColor` 局部 state，`handleNewBone` 调 `addBone(...)` 时根本没传颜色（`addBone` 签名 `types.ts:221` 无 color 参数；`skeleton-slice.ts:92` 新骨骼颜色硬编码 `'#ff6644'`）。
  - 特效笔刷的 `blendMode` 是 Toolbar 局部 state；`use-canvas-interaction.ts:44-52` 的 `commitStroke` 创建 `MotionBlurStroke`/`EffectStroke` 时不写 `blendMode` 也不写 `coordinateMode`（类型 `types.ts:1214, 1232` 有字段，`brush-render.ts:40, 297` 渲染层也读 `stroke.blendMode`）→ 画出来的永远是 normal/默认坐标。
- **影响**：用户调节这些控件毫无效果，属误导性 UI。
- **修复**：IK/权重/骨骼颜色控件改为读写 store；`commitStroke` 写入当前 `blendMode` 与 `effectCoordinateMode`；或删除无效控件。

### H17. 木偶模式下所有画笔工具被劫持，用户无法作画且无提示
- **文件**：`src/components/pixel-editor/canvas/tool-handlers.ts:862`：`if (isPuppetMode || tool === 'puppet') return puppetHandler;`
- **影响**：进入木偶工作区后，无论工具栏选了画笔/橡皮/填充，canvas 全部走 `puppetHandler`（拖拽旋转节点）。工具栏的画笔选项区照常显示，属误导性 UI。
- **修复**：木偶模式下禁用/隐藏绘画工具，或至少给出提示。

### H18. Aseprite 解析器忽略 cel 自身宽高，读错字节流
- **文件**：`src/lib/aseprite-parser.ts:150-166`
- **问题**：Cel chunk 在 `celType`＋7 字节 padding 之后还有 `w(2)+h(2)` 字段（Aseprite 规范），代码未读取，直接按画布宽高执行 `offset += width * height * bytesPerPixel`（162 行）并用画布尺寸解析像素；`linked cel（type 1）` 读了 `linkedFrame` 后直接丢弃（164-168 行）；旧调色板 chunk `0x2004` 被整体跳过（112-116 行）。
- **影响**：cel 小于画布（常见情况）时，像素错位且 offset 越界吞掉后续 chunk，整文件解析错乱；引用 linked cel 的帧渲染为空。
- **修复**：按规范读取 cel 的 w/h 并以此推进 offset；linked cel 需二遍解析补帧。

### H19. B7 帧缓存是摆设 + B8 脏标记只写不读
- **文件**：`src/lib/engine/frame-cache.ts:129-151`（`setCachedFrame` 全项目零调用，`getCachedFrame` 恒返回 null）；`:155-169`（`markPartDirty` 被 `part-slice.ts:99,108` 调用，但 `isPartDirty`/`markPartClean` 未导出且零调用；`_frameCacheKeyframeHash` 第 18 行是死变量）
- **影响**：洋葱皮每帧全量重渲染（性能损失）；store 里 "B8: Mark part as dirty so canvas gets rebuilt" 的注释是虚假的，脏标记对渲染无任何作用（目前靠引用比对侥幸正确）。即使未来启用 B7，`computeKeyframeHash`（120-127 行）只拼 `kf.id:kf.frame:kf.modifiers.length`，不含部件像素、特效轨、变量 → 必然陈旧。
- **修复**：补上 `setCachedFrame` 调用（洋葱皮渲染后写入）并把 hash 做实，或删除该缓存；要么接入脏标记读取端，要么删除整套脏标记及相关注释。

### H20. 插件 `executeScript` 的"沙箱"可逃逸
- **文件**：`src/lib/plugin-manager.ts:135-152`；`src/components/pixel-editor/PluginPanel.tsx:83`
- **问题**：`const fn = new Function(...Object.keys(sandbox), code)`，注释称 "sandboxed context"。但 `new Function` 创建的函数可通过 `api.constructor.constructor` 拿到 Function 构造器逃逸到全局作用域；且沙箱内本就给了完整高权限 API（可读写全部 store）。与 `expression-parser.ts` 刻意 "NO eval(), NO Function()" 的安全姿态自相矛盾。
- **影响**：注释承诺的安全边界不存在。
- **修复**：要么承认插件代码是完全信任代码并修正注释/文档，要么做真正的隔离（iframe/worker + 结构化 API 网关）。

### H21. `unified-slice.ts` 整个 slice 是僵尸代码；`migration-adapter.ts` 约一半函数只服务于它
- **文件**：`src/lib/store/unified-slice.ts`（整体）；`src/lib/migration-adapter.ts:317-432, 433, 454, 477, 507-623, 624, 676, 1029-1177, 1178, 1194, 1210`
- **问题**（全仓 grep 验证）：`getUnifiedProject / getUnifiedCharacter / getUnifiedNode / getUnifiedAnimationClips / getUnifiedAnimationVariables / invalidateUnifiedCache / rebuildUnifiedCache` 除 slice 自身外零调用。`unified-pipeline-bridge.ts:42` 只有一句注释提到它，实际渲染走 `LiveAdapter`。slice 头部注释 "Cache is invalidated whenever relevant old state changes" 不成立——没有任何 slice action 调用 `invalidateUnifiedCache`。`migrateOldProject`（317 行）的唯一调用者在已死的 `getUnifiedProject`；`LiveAdapter`（1230 行，桥接层实际在用的类）不调用它。
- **影响**：约 700+ 行迁移代码 + 整个 unified-slice（200 行）是无人调用的僵尸代码，却带有"Phase 1/2/3 渐进迁移"的注释，会持续误导后续开发（且 `computeCacheKey` 的缓存键本身也不完备：modifier 参数变化不改变 key，若有人启用它会读到脏缓存）。
- **修复**：删除 `unified-slice.ts`（及 `index.ts:15,29` 的装配、`types.ts` 对 `UnifiedSlice` 的 extends）或明确标记废弃；migration-adapter 保留 `LiveAdapter` 可达的函数（`partToNode:47`、`puppetNodeToNode:112`、`puppetToCharacter:227` 等确有调用），删除上述死亡树。

### H22. 洋葱皮三套状态并存，语义打架
- **文件**：`src/lib/store/effect-slice.ts:33-34,166-167`（project-store：实际渲染用，`PixelCanvas.tsx:81,87,131,209,215,283`）；`src/lib/store/editor-store.ts:46,254`（`showOnionSkin`，渲染从不读取，只在 `ViewControls.tsx:214,237` 参与按钮 `pressed` 状态）；`src/lib/store/v15-slice.ts`（`onionTransformFilter/onionSkinState`，`PixelCanvas.tsx:67-72` 画另一套 transform-filter 幽灵）
- **影响**：`ViewControls.tsx:226-229` 的 toggle 被迫同时翻转两个 store 的开关来"保持同步"；undo 只恢复 project-store 那份，undo 后两者失步。v15 的 filter 幽灵与 legacy 帧幽灵是两套独立叠加层，用户无法从 UI 理解开了"哪个"洋葱皮。
- **修复**：明确一套为权威（建议 project-store 的 `onionSkinEnabled`），删除 editor-store 的 `showOnionSkin`，v15 的 filter 配置并入同一开关语义或明确标注为叠加层。

---

## 中（Medium）—— 行为错误 / 体验断裂 / 维护负担

### M1. rig 阶段纬度/方向状态断裂（SkeletonModePanel / PuppetPanel）
- `src/components/pixel-editor/puppet/SkeletonModePanel.tsx:287`：`DirectionWheel` 的 `onLatitudeChange={setLatitude}` 只写本地 state；对比 `PerformPanel.tsx:175` 的 `onLatitudeChange={(lat) => useProjectStore.getState().setPuppetLatitude(skeleton.id, lat)}`。渲染端 `render-pipeline.ts:1187` 读的是 keyframe/skeleton 的 `viewLatitude` → rig 阶段拖纬度 UI 有变化但渲染/导出不受影响；切到 perform 阶段方向盘显示又跳回 `skeleton.viewLatitude`。
- `src/components/pixel-editor/PuppetPanel.tsx:39-40`：rig 阶段 `direction`/`latitude` 用本地 `useState`，无从 `skeleton.currentDirection`/`viewLatitude` 回填的 effect → 切换骨骼后方向盘显示 'S'/0，与骨骼实际脱节。
- **修复**：与 PerformPanel 一致，同时调用 `setPuppetLatitude`；选中骨骼变化时用 `skeleton.currentDirection ?? 'S'` 回填（或改读 store）。

### M2. `PlugConnectionEditor` 无环检测，可制造环导致渲染栈溢出
- **文件**：`src/components/pixel-editor/puppet/PlugConnectionEditor.tsx:58-78, 118-144`
- **问题**：插口下拉列出所有其他节点的插口（仅排除自身），"连接到父节点"按钮直接取第一个有插口的节点；均无祖先/环检查。`buildPuppetNodeTree`（`puppet-slice.ts:85-112`）与 `computeWorldTransformsRecursive`（`puppet-world-transforms.ts:51-89`）均无 visited 集合。另：下拉选"— 选择父插口 —"（`value=""`）会把 `socketId` 置空成悬空 plug，各路径处理不一致（render-helpers 视为根丢到画布中心；老路径直接跳过不渲染该节点）。
- **影响**：把节点接到其后代节点的插口上形成环 → 渲染与编辑器骨�骨叠加层无限递归 → 栈溢出崩溃。
- **修复**：连接前做环检测（沿 parent 链检查目标插口是否属于自身后代）；禁止空 socketId（断开走"断开连接"按钮）。

### M3. `applyProceduralAnimations` 的 `find()` 不查 `enabled`，程序化动画值静默丢失
- **文件**：`src/lib/engine/skeleton.ts:381,388,395,402`
- **问题**：`result.find(m => m.type === 'translate')`（rotate/uniform_scale 同）未过滤 `enabled`；对比 `render-pipeline.ts:893` 的 `applyBoneDrivenTransforms` 用的是 `m.type === 'rotate' && m.enabled`。
- **影响**：若同类型第一个修改器被禁用，程序化动画值加到禁用修改器上 → 视觉完全无效果，且启用的那个收不到值。
- **修复**：`find(m => m.type === 'translate' && m.enabled)`，找不到则跳过（或新建）。

### M4. 精灵解析两套实现行为分叉
- **文件**：`src/lib/engine/puppet-render.ts:676-680` 的 `resolvePuppetNodeSprite`（有服装 `${node.id}:default` 回退）vs `src/lib/engine/render-helpers/puppet-sprite-resolver.ts:59-101` 的 `resolveNodeSprite`（无该回退，只有 `${nodeId}:${direction}`）
- **影响**：同一项目按渲染路径不同可能解析出不同精灵。
- **修复**：统一为一套实现并明确语义。

### M5. 节点关键帧插值"首帧之前"语义分叉：编辑器叠加层 ≠ 实际渲染
- **文件**：`src/lib/engine/render-helpers/puppet-keyframe-interpolation.ts:77-90`（渲染与 PerformPanel 读数用，无 prevKf 时向前保持首关键帧）vs `src/components/pixel-editor/canvas/canvas-puppet-render.ts:74-105`（编辑器骨骼叠加层，prevKf 为空时用节点静止值）
- **影响**：首个关键帧之前的帧，画布上叠加的骨骼位置与实际渲染的木偶位置不一致。
- **修复**：统一语义（建议与渲染一致：保持首关键帧）。

### M6. 删除操作不清理关联数据（孤儿数据越积越多）
- **文件**：`SkeletonModePanel` 的 `handleDeleteSkeleton`（约 60-72 行）删骨骼+角色但不删其木偶 clip（`animationClips` 残留悬空 `puppetCharacterId`）；`handleDeleteNode`（约 74-88 行）不清 `puppetNodeKeyframes`；`puppet-slice.ts:159-163` `removePuppetSkeleton` 与 `:405-409` `removePuppetCharacter` 同样不清理 clip；`removePuppetSocket` 不解挂接入该插口的子节点 plug → 悬空。
- **影响**：孤儿 clip/关键帧越积越多；悬空 plug 节点行为按路径各异。
- **修复**：删除时级联清理 clip、节点关键帧、悬空 plug（`removePuppetNode` 已有级联删子节点逻辑可作参照）。

### M7. `unified-animation-resolver.ts:377` `evaluateWaveform` 把帧当秒用
- **问题**：`const t = frame;` 注释自称 "Convert frame to time in seconds"，随后 `omega = 2π*freq; sin(omega*t)`。文档写 frequency 是 Hz，实际按"每帧周期数"解释，12fps 下 1Hz 波形每秒跑 12 个周期。经 `resolveNodeModifiers`（`unified-render.ts:263`）在 puppet 路径实际调用。
- **修复**：`t = frame / frameRate`。

### M8. `ModifierParamKeyframe` 两套类型定义字段错位 → puppet 路径恒为 step 插值
- **文件**：`src/lib/types.ts:143`（`{ id, frame, params }`，无 interpolation）vs `src/lib/unified-types.ts:271`（`{ frame, params, interpolation, bezierCP1?, bezierCP2? }`，无 id）
- **问题**：`migration-adapter.ts:701/1189/1205` 把 types.ts 形状直传进 unified 路径，`unified-animation-resolver.ts` 的 `interpolateParamKeyframes` 读 `sorted[i+1].interpolation ?? 'step'` 恒为 undefined → puppet 路径参数关键帧恒为 step 插值，而主路径（`render-pipeline.ts:777` 传 `renderKf.interpolationMode ?? 'linear'`）默认 linear。同一数据两种行为。
- **修复**：统一类型定义（补齐字段），迁移层做字段映射。

### M9. `interpolateModifiers` 丢参数/丢使能态
- **文件**：`src/lib/engine/interpolation.ts`（约 170 行起）
- **问题**：第一遍只遍历 `Object.keys(fromMod.params)`：`to` 端独有的参数被直接丢弃，段内不可见、到 `t>=1` 才突然弹出（fast path `return to`）。`enabled` 取 `fromMod.enabled`：from 禁用→to 启用时整个区间保持禁用、到关键帧处突然出现；第二遍（新增 modifier）却用 `toMod.enabled`，前后不一致。
- **修复**：并集遍历 key，`enabled` 按 `easedT < 0.5` 阶梯切换（与非数值参数同策略）。

### M10. `unbakeAnimParamDriver` 用 `paramKeyframes: []` 粗暴清空，丢失手动关键帧
- **文件**：`src/lib/store/animation-slice.ts:528`
- **问题**：`bakeAnimParamDriver` 经 `bakeParamDriverToKeyframes`（`param-driver.ts:1063`）是合并语义（保留范围外/已存在的手动关键帧）；而动画级 `unbake` 直接清空。对比 `modifier-slice.ts:1125` 的 keyframe 级 `unbakeParamDriver` 做了精细清理（只删烘焙产生的、剥离被驱动参数）。两处 `unbake` 语义不一致。
- **修复**：照搬 keyframe 级的清理逻辑。

### M11. 五个 memo 比较器漏掉 `frameWidth`，缩放后轨道元素位置过期
- **文件**：`src/components/pixel-editor/timeline/KeyframeMarker.tsx`（`EffectKeyframeMarker`、`PuppetKeyframeMarker`）、`ModifierSubTrackLane.tsx`、`PuppetNodeTrackLane.tsx`、`KeyframeModifierSubTrackLane.tsx`
- **问题**：`KeyframeMarker` 主标记和 `TrackLane` 的比较器有 `frameWidth`，这五处没有，说明是遗漏而非设计。
- **影响**：Ctrl+滚轮缩放后 effect/puppet/子轨道元素停留在旧像素位置，直到其他 prop 变化。
- **修复**：比较器加 `prevProps.frameWidth !== nextProps.frameWidth`。

### M12. 三个双击回调的 `useCallback` 依赖缺 `FRAME_WIDTH`，缩放后双击落点算错帧
- **文件**：`src/components/pixel-editor/timeline/EffectTrackLane.tsx:29-37`、`PuppetNodeTrackLane.tsx:44-53`、`KeyframeModifierSubTrackLane.tsx` 的 `handleDoubleClick`
- **影响**：缩放后双击添加关键帧时闭包内仍是旧帧宽，`Math.floor(x / 旧FW)` 落到错误帧。
- **修复**：依赖数组补 `FRAME_WIDTH`（或 frameWidth prop）。

### M13. spring 硬编码 60fps；expression 硬编码 `fps: 12, totalFrames: 24`
- **文件**：`src/lib/engine/animation-handlers/bake-transform-handlers.ts:274`（`ctx.relativeFrame / 60`）、`:205`（`fps: 12, totalFrames: 24`）；`src/lib/engine/animation-handlers/realtime-transform-handlers.ts:311`（`rf / 60`）、`:236`（同）
- **影响**：项目帧率 12 时弹簧慢 5 倍；表达式里引用 `fps`/`totalFrames` 恒错（`expression-parser.ts` 文档承诺支持这两个变量，`BakeTransformContext` 里有真实 `frameRate`）。
- **修复**：用 `ctx.frameRate`；传入工程真实总帧数。

### M14. spring `Math.sqrt(1 - zeta*zeta)` 在 damping≥1 时为 NaN
- **文件**：`src/lib/engine/animation-handlers/global-transform-handlers.ts`（springHandler）
- **影响**：`translateY` 变 NaN 会污染画布变换。
- **修复**：钳制 `zeta` 到 [0, 1)。

### M15. `shared-helpers.ts:59` 短淡化取整条件把长淡入也变阶梯
- **文件**：`src/lib/engine/animation-handlers/shared-helpers.ts:59`
- **问题**：`if (weight >= 0.5 && weight < 1 && (fadeInFrames <= 1 || fadeOutFrames <= 1))`：`fadeInFrames=10, fadeOutFrames=0` 时，淡入中段 weight=0.6 被 `Math.round` 成 1，10 帧的淡入在中点变成硬切换。
- **修复**：按各自 fade 分别判断取整。

### M16. 撤销/重做按钮的 disabled 状态不随历史更新
- **文件**：`src/components/pixel-editor/toolbar/UndoRedoControls.tsx:39, 65`
- **问题**：render 里直接读 `useProjectStore.getState().undoStack.length`，没有订阅，zustand 不会因此重渲染；右键历史菜单内容同样用 `getState()` 读取，不刷新。
- **修复**：改用 `useProjectStore((s) => s.undoStack.length)` 订阅。

### M17. "全局表达式"修改器的 4 个参数在面板里完全不渲染
- **文件**：`src/components/pixel-editor/shared/ParamControl.tsx`（只处理 `number/color/select/boolean`，其他类型直接 `return null`）；`src/lib/types.ts:124`（定义了 5 种类型含 `'string'`）；`src/lib/types.ts:839-842`（`expression` 修改器 4 个表达式参数全是 `type: 'string'`）
- **影响**：面板上是空白，用户无法编辑表达式。
- **修复**：ParamControl 补 `string` 类型的文本输入。

### M18. 插件注册的"自定义修改器/导出器"只有展示，无法真正使用
- **文件**：`src/lib/plugin-manager.ts`（`getCustomModifiers/getCustomExporters`）；唯一调用方 `src/components/pixel-editor/PluginPanel.tsx:107-108, 276-279`（详情弹窗里的"注册的能力"展示行）
- **影响**：插件返回 `customModifiers` 后用户在任何地方都用不上（ModifierPanel 的添加列表、渲染引擎均无消费）。
- **修复**：接到 ModifierPanel 的可添加列表与渲染管线，或文档中明确标注为"仅展示"。

### M19. `dimColor`/`darkenColor` 不钳制，factor>1 时产生非法 hex
- **文件**：`src/lib/engine/color-utils.ts:69-76`（`dimColor`）、`:96-103`（`darkenColor`）
- **问题**：`Math.round(r * factor)` 后直接 `toString(16)`，无 `Math.min(255,...)`。已实测：`dimColor('#ff8800', 1.5)` → `'#17fcc00'`（7 位非法）。真实触发点：`annihilate.ts:76`（`Math.min(2, brighten)`，brighten 可达 1.5）、`crt-off.ts:61`（`Math.min(1.8, brighten)`）。`lightenColor` 有钳制，前后不一致。
- **影响**：非法颜色串写入像素网格，下游 `hexToRgbCached` 解析回绕（382 & 0xFF），画面出现错误亮斑。
- **修复**：与 `lightenColor` 对齐，加钳制。

### M20. `computePhysicsOffset` 的 `??` 永不触发，缺参数时 NaN 污染位移
- **文件**：`src/lib/engine/effect-render.ts:386-388`
- **问题**：`const gravityAngle = Number(mod.params.gravity) ?? 90;`（elasticity/damping 同式）。`Number(undefined)` 是 `NaN` 而非 nullish，`??` 右侧永不可达 → 参数缺失时 `rad=NaN`，整个模拟的 `px/py` 为 NaN。文件内其他地方都用 `||` 做 fallback（如 110 行），此处不一致。
- **修复**：改 `??` 为 `||`。

### M21. geometric 系 6 个 renderer 的 `edge_copy` 孔洞填充会污染透明背景
- **文件**：`src/lib/engine/modifier-renderers/geometric.ts:156, 267, 405, 515, 651, 767`（applyBend / applyEllipticalCompress / applyDumbbellStretch / applyPillowStretch / applyHyperbolicStretch / applyRingRipple 末尾）
- **问题**：`if (result[y][x] === null && holeFill === 'edge_copy')` 不检查源像素原本是否透明。`findNearestSourceColor` 在半径 10 内找任意非空源像素 → 部件周围 10px 内的透明背景被染成精灵颜色（光晕/膨胀），包围盒被动扩大。对比 `wave-deform.ts` 的孔洞填充有 `if (pixels[y][x] === null) continue; // was already empty` 保护，geometric 系缺失该检查。
- **修复**：补上"源本透明则跳过"的判断。

### M22. `computeZOrder` 算出 `directionOrder` 却从未使用
- **文件**：`src/lib/unified-render.ts:466`
- **问题**：`const directionOrder = character.directionDrawOrders[currentDirection];` 后续无任何引用 → `Character.directionDrawOrders`（按方向覆盖绘制顺序的特性）静默失效。
- **修复**：实现方向相关的子节点排序，或删除该字段及注释。

### M23. 插件 `enabled` 开关对 customModifiers/customExporters 无效；`manifest.main` 被校验为必填但从未被调用
- **文件**：`src/lib/plugin-manager.ts:117-129`（`getCustomModifiers()/getCustomExporters()` 直接返回全量注册表，不检查 `plugin.enabled`；`togglePlugin` 只翻 flag）；`:56-89`（`manifest.main` 注释"function name to call"零引用）；`src/components/pixel-editor/PluginPanel.tsx:62`（UI 校验 `data.main` 必填）
- **影响**：用户在 UI 里禁用插件后，其自定义 modifier/exporter 仍可用，开关是摆设；`main` 字段要求用户填写但无任何语义。
- **修复**：getter 中过滤 `enabled`；实现 main 入口调用语义，或从 manifest 及 UI 校验中移除该字段。

### M24. expression 的 `fps`/`totalFrames` 变量被硬编码（同 M13，另一处）
- **文件**：`src/lib/engine/animation-handlers/bake-transform-handlers.ts:200-208`（`vars = { ..., fps: 12, totalFrames: 24, ... }`）
- **修复**：传入真实 `ctx.frameRate` 和工程总帧数。

### M25. expression 求值用 `in` 判断变量，原型链属性被误判为变量
- **文件**：`src/lib/expression-parser.ts:346`：`if (ast.name in vars)` —— `vars` 是普通对象字面量，`'constructor' in vars` / `'toString' in vars` 恒为 true，返回非数字值参与运算得 NaN，而不是抛 `Unknown variable`。
- **影响**：变量名拼写成原型属性名时静默得 NaN，极难排查。
- **修复**：改用 `Object.hasOwn(vars, ast.name)`。

### M26. 两套同名不同构的 `VariableContext` 并存
- **文件**：`src/lib/engine/param-driver.ts:489`（`type VariableContext = Map<string, number>`）vs `src/lib/unified-animation-resolver.ts:460`（`interface VariableContext { values: Record<string, number> }`），各带自己的 `EMPTY_VARIABLE_CONTEXT`
- **影响**：同名类型在 bridge/管线交界处极易混用传错，编译器也拦不住跨模块的误传。
- **修复**：统一为一种表示，或重命名其中之一。

### M27. `ParamDriverEditDialog` 底部烘焙/取消烘焙按钮对 animation source 静默无操作
- **文件**：`src/components/pixel-editor/timeline/dialogs/ParamDriverEditDialog.tsx`
- **问题**：列表行的 🔥/↩ 按钮正确区分 `isAnim`（走 `bakeAnimParamDriver/unbakeAnimParamDriver`），但底部大按钮的 `onClick` 只判断 `if (keyframeId && modifierId)`，`source='animation'` 时 `keyframeId` 为 null → 点击无任何反应。Timeline 的 `handleEditAnimParamDriver` 正是走此 source。
- **修复**：底部按钮同样区分 `isAnim` 走动画级 bake/unbake。

### M28. `removeAnimationVariable` 不清理 part 级驱动器
- **文件**：`src/lib/store/animation-slice.ts`（约 660–690 行）
- **问题**：只遍历 `s.keyframes` 内 modifier 的 `paramDrivers`，`part.animationModifiers` 的 paramDrivers 引用被删变量后残留悬空 `paramSources`。且 `setVariableWriter` 的 `driverMap` 同样只收录 keyframe 级 drivers，校验不完整。
- **修复**：同时清理 `part.animationModifiers` 的 paramDrivers。

### M29. `keyframe-slice.ts` 浅拷贝问题：跨关键帧 id 碰撞隐患
- **文件**：`src/lib/store/keyframe-slice.ts`（`addKeyframe` 约 33–43 行 / `duplicateKeyframe` 约 78–92 行）
- **问题**：复制 modifier 时 `paramKeyframes`/`paramDrivers` 共享原数组引用且 id 不变（仅 modifier 换新 id）；且 `addKeyframe` 未像 `duplicateKeyframe` 那样深拷贝 `brushCommands`，共享引用。
- **修复**：深拷贝并重新生成子 id。

### M30. 导入时未知 modifier 类型被改写为 `type: 'unknown'`，原始类型永久丢失
- **文件**：`src/lib/store/project-slice.ts:383`
- **问题**：`...mod` 展开后覆盖 type，原始类型永久丢失，再保存也回不来（降级加载的数据损坏）。
- **修复**：保留原始 type 到单独字段（如 `originalType`），或不改写。

### M31. `setTrackFrameStep`/`onSetTrackFrameStep` 全项目无调用
- **问题**：`trackFrameSteps` 永为空，`TrackLane` 的 frameStep 跳帧遮罩恒不激活。另有潜在键不一致：`TrackLanesColumn` 调 `getEffectiveFrameStep(track.partId, …)` 而 store 按 `trackId` 存取。
- **修复**：删除该半成品功能，或接通调用链并统一键。

### M32. `renameAnimationVariable` 缺 `pushUndo` 且缺 `invalidateVariableContextCache()`
- **文件**：`src/lib/store/animation-slice.ts`（对比 `updateAnimationVariable`）
- **修复**：补上 undo 与缓存失效。

### M33. `animation-slice.ts` `getPartWorldTransform` 疑似半成品/死代码
- **文件**：`src/lib/store/animation-slice.ts:578`（仅 606 行自递归调用，外部零引用）
- **问题**：精确帧匹配、无插值；若未来被父子链渲染采用，部件会跳变而非插值。
- **修复**：删除或补完插值。

### M34. 死 action 清单（全仓 grep 验证，定义文件之外零引用、无内部自调用）
- `src/lib/store/v15-slice.ts:80` `setTimelineThumbnailQuality`（注：state 本身被 `Timeline.tsx:654` 读取，只有 setter 死亡）
- `src/lib/store/v15-slice.ts:112` `setTrackSegmentStep`
- `src/lib/store/v15-slice.ts:125,131,137` `addSelectionFrameStep` / `removeSelectionFrameStep` / `updateSelectionFrameStep`（整个 SelectionFrameStep CRUD 无人用）
- `src/lib/store/animation-slice.ts:726` `ensurePartKeyframe`、`:699` `getSurroundingPartKeyframes`、`:793` `renameAnimationVariable`（见 M32）、`:801` `setVariableWriter`
- `src/lib/store/project-slice.ts:873` `createClipFromCharacter`
- **修复**：删除或标注 `@deprecated`。

### M35. `src/lib/store/index.ts:48` 用 `as ProjectStore` 强转装配结果，掩盖 slice 与类型的漂移
- **问题**：15 个 slice 的返回类型（如 `SkeletonSlice`、`EffectSlice`）没有被 `ProjectStore` interface extends（只有 `PuppetSlice/DccPipelineSlice/UnifiedSlice` 被 extends，`types.ts:88`），其余靠 `types.ts` 内手写重复声明；V15 字段也是尾部手写重复声明而非 extends `V15Slice`。
- **影响**：slice 实现与 `types.ts` 声明漂移时编译器不报错（cast 压住）。目前抽查 V15 的 21 个成员两边一致，但这是持续隐患。
- **修复**：让 `ProjectStore` extends 各 slice 的导出类型，去掉手写重复声明；装配处用满足性检查代替 `as`。

### M36. Effect keyframe 无独立选中态；`EffectKeyframeMarker` 不支持拖拽移动
- **文件**：`src/components/pixel-editor/timeline/EffectTrackLane.tsx`
- **问题**：把轨道级 `isSelected` 传给每个 `EffectKeyframeMarker`（全项目无 `selectedEffectKeyframeId`），选中轨道时其所有关键帧变白，误导以为全选；无 pointer handlers，主/puppet 标记均支持拖拽；右键菜单也无"Move to Frame"。
- **修复**：引入 `selectedEffectKeyframeId`；补拖拽/移动。

### M37. `DEFAULT_MIRROR_MAP` 中 `6: 2` 与注释矛盾
- **文件**：`src/lib/unified-types.ts:87-92`：`6: 2, // South stays South (no mirror needed, but can be overridden)` —— 条目实际含义是"South 方向取 North 精灵并水平翻转"，注释却说"South 保持 South（不需要镜像）"。
- **修复**：注释与行为对齐，二选一。

### M38. README 多处宣称与实际不符
- 无 OffscreenCanvas（全库 grep 零命中）
- 导出格式无 JPEG（`ExportFormat = 'spritesheet'|'png'|'gif'|'video'|'lottie'|'project'`，`ExportDialog.tsx:54`）
- 项目文件扩展名代码用 `.pxm`（`Toolbar.tsx`、`ExportDialog.tsx:1039`），README 写 `.pixelmorpher`
- 撤销步数 README 写"多达 100 步"，代码默认 50、范围 10-200（`UndoRedoControls.tsx`）
- "200+ UI 组件"实际 `src/components` 下 86 个 tsx
- README 宣称 MIT License，但仓库无 LICENSE 文件
- 触屏：`PixelCanvas.tsx:316-324` 只绑定鼠标事件，无 pointer/touch → README"移动端适配"不成立

### M39. `recordFullPose` 在首关键帧前录制的是"首关键帧值"而非所见静止姿态（疑似）
- **文件**：`src/lib/puppet-session-store.ts:147-195`（165-189 行用 `interpolateNodeKeyframes` 的 hold-forward 语义求"当前可见姿态"再全量替换本帧关键帧）
- **影响**：在首个关键帧之前的帧点"记录姿态"，写入的是首关键帧的值；而编辑器叠加层在该区间显示的是静止值（见 M5）——用户看到 A，录进去的是 B。
- **修复**：先定 M5 的语义，录制与显示用同一套。

---

## 低（Low）—— 死代码 / 文档 / 边缘问题

### L1. `puppet-render.ts` 约 600 行死代码
- `src/lib/engine/puppet-render.ts:834` `renderPuppetFrame` 未导出、零外部调用（仅 `unified-pipeline-bridge.ts:149` 注释提及），连带 `computePuppetNodeWorldTransforms`、`interpolateNodeKeyframes`（文件内）、`generateJointDiscs`、`renderJointDisc`、`computeLatitudeDepthBias`（:94，标 Deprecated）、`createPartCanvasFromPart`、`computeRenderSortKey`、`applyHalfPixelAlignment` 约 600 行不可达。注意 `createPartCanvasFromPart` 与 `createPartCanvasInner` 有同构 bug（keyframe 修改器步用赋值覆盖 edit 修改器的 `modOffsetX/Y`，应累加）——死代码内，仅记录。

### L2. `CostumeModePanel.tsx` 全文件零外部引用 + 内部 bug
- `src/components/pixel-editor/puppet/CostumeModePanel.tsx`：`PuppetPanel` 实际渲染的是根目录 `CostumeManager`，此文件无人引用。其 `handleDeleteCostumeSet` 另有 bug：`activeCostumeSetId` 取的是过滤前 `c.costumeSets[0]?.id`（约 96-102 行），若删除的正是第 0 个则激活指向已删除服装（`useCostumeManagerAdapter` 的实现是正确的）。
- `puppet/types.tsx` 的 `DIRECTION_LABELS`/`DIRECTION_COMPASS` 有定义无 `export`，文件内也无人用。
- `src/lib/store/puppet-slice.ts:79-82` `halfPixelAlign` 零外部引用（unified 用的是 `halfPixelAlignSub`），且语义错误：偶数返回整数而非 n+0.5，与 `puppet-render.ts:117-122` 的 `applyHalfPixelAlignment`（恒 +0.5）不一致。
- `src/lib/store/puppet-slice.ts:203`：`const templateName = skeleton ? 'humanoid' : 'humanoid'` 恒等三元，死分支。

### L3. `unified-render.ts` 死代码
- `spriteDataToCanvas`（:1251，零引用）、`renderUnifiedFrame`（:1271，未导出零引用）、`renderFrameViaUnifiedPipeline`（:1302，未导出零引用）、未使用的 import `getTranslateOffset`（:60）、`getEmptyVariableContext`（:70）、局部 `pxToSub`（:1316-1318）与 `unified-types` 导出的同名函数重复。
- disc `outlineColor = '#000000'` 硬编码（注释写 "From global palette in full implementation"，半成品）。
- `useUnifiedPipeline=false` 的老 fallback 路径实际不可达（`renderUnified` 该参数默认 `true`，无调用方传 `false`，`renderPuppetViaOldPipeline` 成死分支）。

### L4. 其他死函数/死 import（均经 grep 验证零引用）
- `src/lib/engine/render-cache.ts:226` `clearRotationCache`、`:234` `clearDiscCache`（未导出零引用）；`:110-140` 旋转缓存指纹过弱（疑似）：仅采样 5 个像素 + 宽高 + pivot 量化到 0.1px，不同精灵可能哈希碰撞。
- `src/lib/engine/perf-monitor.ts`：`perfMark`、`perfMeasure`、`perfSummary` 未导出零引用（仅 `perfTrack` 在用）。
- `src/lib/engine/utils.ts:55` `pixelGridToImageData` 未导出零引用。
- `src/lib/expression-parser.ts:426` `validateExpression` 未导出零引用（公开 API 本应导出供 UI 做表达式校验）。
- `src/lib/sam.ts:166` `checkSAMCapabilities` 未导出零调用。
- `src/lib/presets.ts:63,73` `updatePreset`、`getPresetsByType` 未导出零引用。
- `src/lib/csv-waveform.ts:58` `sampleWaveformScaled` 未导出零引用。
- `src/lib/tile-blob-engine.ts`：`:95` `const rng = mulberry32(params.seed)` 从未使用；`:579` `createEmptyTileGrid`、`:584` `tileGridToImageData` 未导出零引用；`TemplateBlendParams.featherRadius` 被接受但 `computeBlendFactor` 完全忽略；文件头注释 "Generate 47 tile variations" 与实际 161 及 `generateAllTiles` 文档的 161 不一致。
- `src/lib/engine/effect-render.ts:495,536,576` 的 `renderGlowStroke/renderParticleStroke/renderAfterimageStroke` 私有零调用 —— 与 `brush-render.ts` 中的同名实现是两套重复代码。
- `src/lib/engine/canvas-modifiers.ts:11`：`import type { ..., getCanvasModifierDef }` —— `getCanvasModifierDef` 在 `types.ts:3207` 是函数值，以 `import type` 引入后从未使用。
- `src/lib/motion-analysis.ts` 的 `imageDataToPixelGrid` 与 `engine/utils.ts`、`tile-blob-engine.ts` 的 `imageDataToTilePixels` 是第三处重复实现。
- `src/components/pixel-editor/timeline/`：`constants.tsx:23` `MIN_KEYFRAME_HIT_AREA` 导出后无引用；`useVirtualScroll.ts:6` 导入 `FRAME_WIDTH` 未使用；`KeyframeMarker.tsx` 的 `snapFrame` prop（89/104 行）声明但体内从未使用（内部自实现 `computeSnapFrame`，与 `Timeline.tsx` 的 `snapFrame` 逻辑重复）；`lastSnappedFrameRef`（117/138/169 行）只写不读。
- `src/lib/engine/animation-state.ts:69-105` 重复声明 `_activeDriversCache/_kfByPartCache/_modifierResolveCache/_frameRenderCache/_partDirtyFlags`，文件内零使用（真实实现在 `frame-cache.ts`）；另有未使用的 import 和未导入直接使用的 `Keyframe` 类型。
- `src/lib/playback-scheduler.ts:90` `isPlaybackRunning()` 未导出、未调用。
- `src/components/pixel-editor/puppet/useCostumeManagerAdapter.ts:42-44` `pixelsToDataUrl` 只解析 6 位 hex，3/8 位颜色的像素在缩略图中被静默丢弃。
- `src/lib/engine/render-helpers/puppet-joint-discs.ts:62`：`if (diameter <= 0) return;` 不可达（上一行 `diameter = Math.max(1, …)`）。
- `src/components/pixel-editor/canvas/canvas-render-helpers.ts:462-466`：trajectory snap 的空 if 块（只有注释），死代码。

### L5. 类型漂移 / 僵尸类型
- `noise_displace` 是僵尸 modifier 类型 —— 仅 `src/lib/unified-types.ts:230` 联合类型中出现，全项目唯一命中；无 renderer、无 dispatch、`types.ts` 的 `ModifierType` 里也没有。
- `custom_wave` 类型漂移 —— `unified-animation-resolver.ts:717`、`migration-adapter.ts:1085` 在引用，但 `types.ts` 的 `ModifierType` 联合类型中不存在。
- `unified-types.ts` 四个函数缺 `export`：`createDefaultTransform`、`createDefaultTrack`、`createDefaultSocketAttachment`、`resetSocketToTemplate`（疑似想导出而漏写）。

### L6. page.tsx / 入口小问题
- `src/app/page.tsx:5` 死 import `PartPanel`（实际在 `AssetLibraryPanel.tsx:756` 作为 tab 渲染）；`:48` 死解构 `updateLayout`；`:62-66` render 阶段 setState（`activeMode` 完全冗余，可直接用 `mode`）。
- `src/components/pixel-editor/toolbar/constants.tsx`：`ik` 与 `puppet` 共用 `Target` 图标，`inpaint` 与 `eraser` 共用 `Eraser` 图标。
- `src/lib/types.ts:1238` 的 `ToolType` 含 `'hitbox_drag'`，无工具栏按钮、`getToolHandler` 无此 case。
- `src/components/pixel-editor/PixelCanvas.tsx:8`：import 了 `invalidateUnifiedPipelineCache` 却从未调用（实际调用在 `use-canvas-state.ts:702`）。
- `src/lib/store/v15-slice.ts:13`：import 了 `segmentKey` 但从未调用（第 43 行只是把它当作参数名 shadowing），无效 import。
- `src/lib/store/editor-store.ts:203,223`：`moveTargetLevel: 'keyframe'` 初始化了两次，冗余但无害。
- `src/lib/store/project-slice.ts:579`（`resetProject`）：只重置 `defaultProject` 覆盖的字段，v15 状态（timelineZoom 等）与 `_unifiedProjectCache` 不会被清理。
- `src/app/api/route.ts`：仅返回 Hello world 的 stub，全库无任何 fetch 调用，死路由。
- `src/app/layout.tsx`：favicon 指向外部 URL（`https://z-cdn.chatglm.cn/...`，外部依赖风险）；`<html lang="en">` 而应用为中文。
- `Toolbar.tsx` 的 `isDark` state 实际存 `ThemeMode`（'dark'|'light'），功能正常，仅命名误导。
- `ProjectHomeScreen.tsx:44` 死解构 `setShowProjectHome` 且主页无"返回编辑器"按钮（配合 H15）。

### L7. expression-parser 词法边缘问题
- `src/lib/expression-parser.ts` `:tokenize` 中 `.` 是未知字符被跳过，`".5"` 会被解析为 `5`；`"-2**2"` 因 unary 绑定比 `**` 紧而得 `4`（数学惯例为 `-4`）；`"1.2.3"` 被 `parseFloat` 静默截断为 `1.2` 不报错。
- `default-costume-sprites.ts:46-53`：`rowsToPixelGrid` 注释声称支持 `number` 简写（`0 → '00'`），但 `PixelRow` 类型与实现都不支持，注释过期。

### L8. 疑似项（需运行时/构建验证，未完全确认）
- `src/components/pixel-editor/puppet/NodePropertiesEditor.tsx:128`：client 组件事件处理内用 `require('@/lib/workspace-store')`，ESM/Turbopack 下疑似抛 `ReferenceError: require is not defined`（点击"编辑此节点的精灵像素"时求值）。同类：`WorkspaceSwitcher.tsx:66` 的 `require('@/lib/asset-store')`。
- `src/lib/engine/skeleton.ts:56-62` spring 公式疑似错误：`return (restLength>0 ? restLength : 1) * e^{-γt}cos(ωt) + restLength` —— t=0 时恒为 2×restLength，初始位移被硬编码为 restLength 本身而非可配置振幅；物理上应为 `restLength + amplitude * e^{-γt}cos(ωt)`。
- 播放到结尾自动循环（`playback-scheduler.ts`：`nextFrame % totalFrames`），无 stop-at-end、无循环开关，`playState` 永不回落。是否为设计意图不明。
- bounce 的 `Math.pow(1 - damping, bounceIndex)`：damping>1 时底数为负、整数指数导致符号翻转（定义里 damping 默认 0.5，暂标疑似）。
- `src/components/pixel-editor/PuppetPanel.tsx:86-89`：`handleSelectNodeWithSync` 不再同步 editor 的 `activePuppetSkeletonId`（节点树点击不设置，骨骼下拉 onChange 处仍有设置）——若画布木偶工具依赖该 id，可能出现"树中选了节点但画布工具不知道是哪个骨骼"。

### L9. TrackLane memo 比较器缺 `part` → 轨道缩略图过期
- `src/components/pixel-editor/timeline/TrackLane.tsx`：比较器只比 track.id/locked/visible、keyframes 引用等；`thumbnailUrl` 的 `useMemo` 依赖 `part`，但 part 像素变化（绘制/缩略图更新）不会触发重渲染，轨道缩略图过期。

### L10. `KeyframeModifierSubTrackLane` param keyframe 拖拽用 `Math.floor(x / FW)`，与关键帧拖拽统一的 `Math.round((x - FW/2) / FW)`（中心对齐）不一致，标记视觉位置与光标有半帧错位感。

---

## 非缺陷 / 误报排除（已核实，特此说明以免返工）

- `ExportDialog`（PNG 序列/Spritesheet/GIF/视频/Lottie/工程文件导入导出）、`PuppetCreationWizard`（三步向导真实创建 skeleton/nodes/sockets/character/costumeSet/clip）、SAM（`sam-web` 懒加载封装）、Inpainting（Telea 风格扩散填充）、运动分析、Spritesheet 导入 —— 均为真实实现，非空壳。
- `PuppetPanel` 与 `puppet/` ModePanel 没有两套并存逻辑：`PuppetPanel.tsx` 是薄装配器，按 mode 分发；`usePuppetPanelState` 统一管状态。
- `puppet-slice.ts` 的 `setPuppetDirection` 不再同步关键帧 direction 是故意的（注释说明渲染器用 `skeleton.currentDirection` 实时值，三处渲染入口确实一致）。
- `unified-pipeline-bridge.ts` 不是空壳：是真实的 hybrid 桥（非木偶走旧 `renderFrame`，木偶走新管线），但受 F1/H10/H11 影响。
- `workspace-store.ts` vs `tile-workflow-store.ts` 是"设置 vs 执行"分工，无字段级冲突。
- `migrateCostumeSetPieces` 中 `toStr as DirectionIndex` 的 cast 经核实无害。
- Timeline UI 操作 → keyframe-slice → render-pipeline 链路通；播放 scheduler tick → `setCurrentFrame` → 渲染驱动无断裂；保存/加载字段丢失仅见 M30。
- 缓动数学经手算验证正确：`cubicBezierEasing` 二分求解、`applyInterpolationMode`（step/linear/bezier）、`evaluateParamDriver` 各波形公式、`computeKeyframeBaseTransform` 的 pivot 补偿、caterpillar/rounded_rect 轨迹分段连续性。

---

## 修复状态（2026-10-10）

以下条目已在本轮修复并通过 `npx tsc --noEmit` + `npm run build` 验证：

- **F1** ✅ `executeRenderPlan` 不再清画布（调用方负责清屏/填充）
- **F2** ✅ `ParamDriverLaneRow` 增加 `frameWidth` prop
- **F3** ✅ 删除 `render-pipeline.ts` 重复的 `ctx.translate`
- **H1** ✅ 删除 editor-store 的 `selectedBoneId` 副本，统一用 project-store
- **H2** ✅ `animationVariables` 补进 undo 快照/导出/导入
- **H3** ✅ `addAnimationClip` 补 `syncLegacyFromActiveClip()`
- **H4+H5** ✅ unified resolver 改为委托 `animation-dispatch` 真实实现（参数名/全类型统一）
- **H7** ✅ shake 改 `seededRandom` 确定性序列
- **H10** ✅ canvas modifiers 只在 `renderUnified`/`renderUnifiedToCanvas` 末尾应用一次
- **H11** ✅ 全局变换包装抽成 `applyGlobalTransformWrapper`，导出路径复用
- **H12** ✅ 拉伸分支下采样目标按 `stretchY` 缩放，pivot 同步缩放
- **H13** ✅ 旋转缓存存独立 canvas 副本；unified 路径补 `releaseCanvas`
- **H14** ✅ NodeTree 子节点透传未绑定的 `onSelectNode`
- **H15** ✅ 非主页模式清除 `showProjectHome`
- **H16** ✅ IK/权重绘制/骨骼颜色/混合模式 4 组控件接通真实数据链路（权重半径控件删除，`weightPaintRadius` 状态同步删除）
- **H17** ✅ `part_edit` 时画笔/橡皮/填充/吸管不再被木偶 handler 劫持
- **M1** ✅ rig 阶段方向/纬度回填 + 纬度写入 store
- **M3** ✅ `applyProceduralAnimations` 的 `find` 过滤 `enabled`
- **M14** ✅ spring `zeta` 钳制到 [0, 1)
- **M15** ✅ 淡入淡出取整改为按实际所处短淡化判断
- **M16** ✅ 撤销/重做按钮订阅 store
- **M17** ✅ ParamControl 补 `string` 类型输入
- **M19** ✅ `dimColor`/`darkenColor` 钳制
- **M20** ✅ `computePhysicsOffset` 的 `??` 改 `||`
- **M25** ✅ expression 变量判断改 `Object.hasOwn`

### 第二轮（2026-10-10 深夜）
- **H6** ✅ unified `buildVariableContext` 改为委托主路径真实实现（拓扑排序+writer 求值）；bridge 透传 `writerDriverId`；`generateRenderPlan` 收集节点 active drivers
- **H8** ✅ `invalidateInterpolationCache` 导出并在 update/add/remove/duplicate/undo/redo 处调用
- **H9** ✅ `invalidateParamDriverEvalCache` 接入 engine 导出，在驱动 CRUD 与关键帧变更、undo/redo 处调用
- **H18** ✅ Aseprite：解析 cel 自身 w/h（type 0/2）；linked cel 二遍补齐；0x2004 老调色板解析
- **H21** ✅ 删除 `unified-slice.ts`（200 行）及 store 装配/类型 extends；删除 `migration-adapter.ts` 约 580 行死亡迁移代码（`migrateOldProject` 全树 + `characterToOldFormat` 逆转换树）；修正 bridge 过期注释
- **H22** ✅ 删除 editor-store 的 `showOnionSkin` 副本，洋葱皮开关以 project-store `onionSkinEnabled` 为唯一真相源（v15 字段实为同一洋葱皮的 tint 配置，非独立层）
- **M2** ✅ 插口连接环检测（沿 parent 链上行检查）；空插口选择改为断开连接而非悬空 plug

尚未处理：H19（帧缓存摆设）、H20（插件沙箱注释与实际不符）、M4–M13、M18、M21–M24、M26–M39、L1–L10、M38（README 宣称与实际不符）。

### 第三轮（2026-10-10 中午）：UI 溢出/裁剪系统性修复
方法：按用户要求改用源码审查而非截图（截图无法代表用户分辨率）。
- 全仓 22 处 `truncate flex-1` / `flex-1 truncate` 补 `min-w-0`（flex 子项默认 min-width:auto，长文本会撑开容器而非截断）：AnimationClipPanel、AssetLibraryPanel、GlobalModifierPanel、ModifierPanel、PartPanel、PuppetAssetPanel、SpritesheetImportDialog、NodeModifierSection、NodeTree、PerformPanel（2 处）、TrackLabelsColumn（4 处）、UndoRedoControls（2 处）
- 8 处 flex 行内 `<select class="flex-1">` 补 `min-w-0`（长选项名会把 select 撑出容器）：CostumeManager（2）、CostumeModePanel（2）、NodePropertiesEditor、SkeletonModePanel、GlobalModifierPanel、PartPanel
- `PuppetModeBanner`：标题与提示分别加 `truncate`/`flex-1 min-w-0`，长角色名不再把提示挤出
- `PuppetPanel` 步骤条加 `flex-wrap`（右侧面板可缩至 15% 宽，3 个按钮不再溢出）
- `PuppetCreationWizard`：对话框加 `max-w-[calc(100vw-2rem)]`（窄视口不再溢出屏幕）；步骤指示器加 `flex-wrap`；确认页长角色名/长部件名截断
- `PerformPanel`：角度读数与"n 帧有键"加 `flex-shrink-0`
- 排查结论：`absolute` 下拉菜单的定位父级均在 header（不在滚动区内），不会被裁；`TileAssetPanel` 的 `w-[180px]` 为设计定宽，内部有滚动，不属溢出 bug

### 第四轮（2026-10-10 午后）：默认精灵关节盘约定落地
用户要求的四条约定全部实现（`src/lib/engine/render-helpers/puppet-joint-color.ts` 为约定文档 + `sampleJointDiscColor` + `carveJointOpening` + `applyJointOpenings`）：
- **轮廓开口**：默认精灵在 plug / socket 对应的轮廓处 carve 开口（只清轮廓色像素，不动填充；开口方向按最近边缘自动判定横/纵槽），开口宽度 = crossSection（plug 侧按上下半取 top/bottom，socket 侧取子节点 crossSectionTop）。应用点：`PuppetCreationWizard`（模板全信息）与 `puppet-slice.addPuppetNode`（手动节点）。视觉抽查：躯干颈/肩/髋、头颈、上臂肩/肘开口干净准确。
- **颜色自定义不限枚举**：`PuppetPlug.discColor?: string | null`（null=自动）；`PlugConnectionEditor` 新增"关节盘颜色"行：预设 swatch + 原生取色器（任意颜色）+ "恢复自动"。透传链：`PuppetPlug` → unified `Attachment.discColor`（`puppetNodeToNode` 与 `puppetToCharacter` 两处）→ `generateDiscInstructions`。
- **默认颜色 = 子节点侧开口处众数颜色**：`sampleJointDiscColor` 取开口中心半径 3 内排除轮廓色（`#1a1a2e`）的众数颜色；无有效像素返回 null 走旧 fallback。冒烟测试 9 项（carve 位置/只清轮廓/内部点无操作/方向判定/采样排除轮廓色/空窗口 null）全过。
- **z-order 被两侧遮挡**：unified `computeZOrder` 的 discZ 从 `childZ - 50` 改为 `min(parentZ, childZ) - 50`；旧管线 `renderPuppetNodes` 的 `renderJointDiscs` 调用从 Step 6（精灵之后）移到 Step 4.8（精灵之前），并补 `parts` 参数走同一颜色约定。
- **大小 = 开口平均**：两侧已是 `(parent.crossSectionBottom + child.crossSectionTop) / 2`，开口 carve 用同一组 crossSection，构造一致。
- 路径确认：活的只有 unified（主画布+导出）与 render-pipeline（洋葱皮）；`puppet-render.ts` 的 `renderPuppetFrame`（含旧 disc 逻辑）零调用，属死代码，本轮未动。
- 缓存：`updatePuppetNode` 换 `puppetSkeletons` 数组引用 → canvas effect 触发 `invalidateUnifiedPipelineCache()`，discColor 修改即时生效。

---

## 修复优先级建议

1. **先修 F1（clearRect 擦除）** —— 渲染正确的底线，影响实时预览与导出两条路径。
2. **修 F2（FRAME_WIDTH 作用域）+ 关掉 `ignoreBuildErrors`** —— 让类型错误重新阻断构建，否则修了也白修。
3. **修 F3（双重平移）+ H12/H13（拉伸/缓存污染）** —— 木偶渲染链路的数学正确性，这是用户接下来 UI 重做的地基。
4. **修 H1/H2/H3（store 数据流断裂三件套）** —— 面板↔画布选择失步、变量 undo/存档丢失、新 clip 数据错乱。
5. **修 H4/H5/H6/H7/H8/H9（统一管线与缓存失效）** —— "改了参数画布不动"类问题最伤用户信任；puppet 路径参数错位让木偶动画调参完全失效。
6. **修 H15/H16/H17（UI 陷阱与摆设控件）** —— 工作区切换死胡同、4 组无效控件、画笔劫持。
7. **修 M1/M2/M5/M6（木偶编辑器数据流）** —— rig/perform 阶段状态断裂、环检测、插值语义统一、孤儿数据清理。
8. **清理 H21/H22 与 L1–L5 死代码/僵尸类型** —— 约 1000+ 行误导性代码，建议在重做 UI 工作流时同步删除。
9. **修 M13/M14/M19/M20/M21（数值/颜色/物理小 bug）** —— 明确的逻辑错误，顺手修。
10. **README 与文档**（M38）—— 去掉夸大宣称，补 LICENSE。
