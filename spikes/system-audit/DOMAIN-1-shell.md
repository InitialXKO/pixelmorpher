# 域1 审计报告：外壳与工程

审计对象：audit/full-system @ main 3a4a55c。只读审计。判定四态：通 / 断裂 / 实现错误 / 未验证。
五段链：①入口/数据定义 → ②store/写入 → ③消费端调用 → ④消费端内部判断 → ⑤存档/进包往返。

---

## A. 画布视图开关（CanvasViewOverlays / ViewControls）

### A1 网格开关 showGrid
- 链：① ViewControls.tsx:107 GridToggle → ② editor-store.ts:270 缺省 true、toggleGrid（editor-store.ts:382）→ ③ PixelCanvas.tsx:363 调用点 → ④ `if (s.showGrid) renderGridOverlay(rc);`（PixelCanvas.tsx:363，渲染函数内查标志后才画）→ ⑤ 编辑器会话态，不入存档（设计内）。
- **判定：通。** 历史故障模式①（渲染不查标志）不复现：调用点与开关同帧读 editor-store 快照。

### A2 骨骼开关 showPuppetSkeleton
- 链：① ViewControls.tsx:132 SkeletonsToggle → ② editor-store.ts:312 缺省 false、togglePuppetSkeleton → ③ PixelCanvas.tsx:394/406 两处传参/门控 → ④ canvas-puppet-render.ts:309 `if (!shouldRender || characters.length === 0) return;`（覆盖层函数内二次查 shouldRender）；IK 手柄另有 PixelCanvas.tsx:406 `if (activeChar && s.showPuppetSkeleton)` → ⑤ 会话态不入存档。
- **判定：通。** 旧字段 showSkeletons 已无残留消费（grep 全仓仅 showPuppetSkeleton），模式②不复现。

### A3 透视缩短 perspectiveForeshorten
- 链：① ViewControls.tsx:200 ForeshortenToggle → ② editor-store.ts:350 缺省 false → ③ PixelCanvas.tsx:294 作为实参传 renderUnified；ProcPreview.tsx:75 经 projectExtras、ExportDialog.tsx:1058 经 projectExtras 进 convert → ④ unified-render.ts:3315 `if (perspectiveForeshorten) { ...算投影长度比 }`（未开则 foreshorten=undefined 不缩放）→ ⑤ 视图选项不入存档，进包时按导出时刻开关值烘（ExportDialog 读 getState）。
- **判定：通。**

### A4 显示全部角色 showAllCharacters
- 链：① ViewControls.tsx:223 ShowAllCharactersToggle → ② puppet-session-store.ts:73 缺省 false、setShowAllCharacters（:83，无条件写）→ ③ PixelCanvas 主渲染/拾取/骨骼层共用 visible-characters.ts → ④ visible-characters.ts:44-56 filterVisibleCharacters：开关开→全量；关→候选链 activeCharacterId→performCharacterId→回退全量 → ⑤ 会话态不入存档。
- **判定：通（附注记）。** 注记：ViewControls.tsx:221 注释称「rig/dress 阶段强制互斥、perform 阶段可切换」，但 Toggle 无 disabled、store setter 无阶段门控——现行行为是任何阶段可切换（与 PR #76/#78 后的候选链口径一致）。注释与行为不符（模式⑩的注释版），易误导后续维护。

### A5 洋葱皮 onionSkinEnabled / Frames / TransformFilter
- 链：① ViewControls.tsx:250 OnionSkinToggle（以 project-store 为唯一真相源，组件注释 H22 已除双写）→ ② project-slice onionSkinEnabled/onionSkinFrames/toggleOnionSkin、v15-slice onionTransformFilter/onionSkinState → ③④ PixelCanvas.tsx:143 与 :334 均 `if (s.onionSkinEnabled && s.onionSkinFrames > 0 ...)` 后才合成洋葱皮画布 → ⑤ onionSkinEnabled/Frames 在 exportProjectFile 名单内（project-slice.ts:355-356），可往返。
- **判定：通。**

### A6 显示效果：衣物色区袖口/裤腰比 + 空气透视 depthFogStrength
- 链：① ViewControls.tsx:156 DisplayFxControls 三滑杆 → ② editor-store.ts:316-318（缺省 0.1/0.1/0）→ ③ PixelCanvas.tsx:298-300 以 editorFx{ sleeveRatio, pantsRatio, fogStrength } 传入 renderUnified（改值另有 PixelCanvas.tsx:549 useEffect markDirty 触发重绘）→ ④ unified-render.ts:2123-2126 clothRatioOf 按节点名分类取比、:3570 缺省 `?? 0`；雾：:3579 `if (fogStrength > 0 ...)` 才写 fogAmount、:4658 消费 → ⑤ 仅编辑器显示，组件文案明示不进导出/包（与实现一致）。
- **判定：通。**

### A7 缩放 zoom
- 链：① ViewControls.tsx:32 ZoomControls（−/百分比读数/＋/适应）→ ② editor-store zoom/setZoom（钳 1..32）→ ③④ PixelCanvas.tsx:359 drawImage 按 `canvasWidth * zoom` 绘制、覆盖层同 rc 缩放 → ⑤ 会话态。
- **判定：通。**

### A8 预览画质 previewQuality ★断裂
- 链：① ViewControls.tsx:369 PreviewQualitySelect（顶栏「画质」高/中/低）→ ② editor-store.ts:285 缺省 'high'、setPreviewQuality（:396）→ ③ **断在此段**：全仓无任何调用点把 editor-store 的 previewQuality 传入渲染——PixelCanvas.tsx:292 给 renderUnified 传的是字面量 `'high'`，SketchPoseDialog.tsx:99 同样写死 `'high'` → ④ unified-render.ts:4317 `instruction.previewQuality ?? 'high'`，且 :4551/:4575/:4692/:4717/:4763/:4801/:4873 多处以 `previewQuality !== 'low'` 门控动态模式/辉光/残影/效果修改器（内部判断齐全，但永远收到 'high'）→ ⑤ 不适用。
- **判定：断裂（第③段，模式①+⑦）。** 用户在顶栏把画质调到中/低，主画布渲染毫无变化；低画质本应跳过的昂贵段照常执行。消费端内部机制无误，缺的是接线。

---

## B. 工具盘（CanvasToolRail，21 工具）

### B1 工具注册与分发总链
- 链：① toolbar/constants.tsx:31-56 TOOL_CONFIG 21 项，与 types.ts:1181 ToolType 联合 21 值逐一对应 → ② CanvasToolRail.tsx:32 setTool 写 editor-store → ③ use-canvas-interaction.ts:96/116/164/275 在 pointer down/move/up 调 getToolHandler(tool, isPartEdit) → ④ tool-handlers.ts:2025-2063 getToolHandler 对 21 个工具全有显式 case（brush/eraser 在 sprite_edit 走 brushEraserHandler、舞台走 node 系 handler；default 回落 puppetHandler）→ ⑤ 工具为会话态。
- **判定：通。** 无未注册工具、无无 handler 的工具值。

### B2 切工具联动（自动进 sprite_edit / toast）
- 链：CanvasToolRail.tsx:33-75 handleSelectTool：brush/eraser/fill、lasso/magic_wand/smart_select、landmark、crop 五组在非 correction/sprite_edit 时，有选中精灵→ enterSpriteEditMode，无精灵但工程有精灵→ toast 提示；landmark/mark/crop 等像素工具的 handler 内部亦有 sprite_edit 门（tool-handlers.ts:661、:717 `if (s.editMode !== 'sprite_edit' ...) return;`）。
- **判定：基本通，mark 一处断裂（见 B3）。**

### B3 精灵标记工具 mark 的切换联动缺位 ★断裂
- 链：① TOOL_CONFIG:41 mark 在像素组 → ② CanvasToolRail.tsx:33-75 的自动进 sprite_edit 分支枚举了 landmark（:63-68）却**没有 mark** → ③ markHandler（tool-handlers.ts:715）onMouseDown 首行 `if (s.editMode !== 'sprite_edit' || !s.selectedSpriteId || !s.selectedPart) return;` → ④ 结果：在普通模式点「精灵标记」工具后点画布，静默无反应（不进 sprite_edit、无 toast）；须先用别的路径进 sprite_edit 该工具才活。与同组 landmark 的联动明显不对称，全仓亦无其他 setTool('mark')+enterSpriteEdit 的入口（grep 证）。
- **判定：断裂（第②段联动缺位）。** 工具本身在 sprite_edit 内可用，故为入口断裂非功能缺失。

### B4 工具参数条（Toolbar 按 tool 条件渲染）
- 魔棒容差：ToolOptionPanels MagicWandControls → editor-store.magicWandTolerance → tool-handlers.ts:1074/:1655/:1696 实际用于洪泛容差比较。**通。**
- 特效笔参数（颜色/半径/强度/密度/扩散/混合模式）：editor-store → use-canvas-state.ts:169-172 汇入 CanvasState → strokeToolHandler 消费。**通。**
- 移动目标层级 moveTargetLevel：MoveToolControls 写 editor-store，use-canvas-interaction.ts:248 Alt 临时切换并有备份恢复。**通。**
- 修正模式开关：Toolbar.tsx:341-352 setEditMode('correction') → tool-handlers.ts:928/1785/1873 三处 handler 内查 `editMode === 'correction'` 改走 frameCorrections 写入；「清除本帧修正」按钮（Toolbar.tsx:356-383）遍历角色定位节点删当前帧修正并 pushUndo。**通。**

---

## C. 顶栏全局件（Toolbar）

### C1 工程名编辑
- Toolbar.tsx:57-58 订阅 name/setProjectName，:185 提交写 store；exportProjectFile 含 name（project-slice.ts:338）。**通。**

### C2 保存/打开 .pxm（顶栏按钮）
- 链：① Toolbar.tsx:191 handleSaveProject → exportProjectFile → Blob 下载 .pxm；打开：:227 handleFileChange → JSON.parse → importProjectFile（:223），扩展名校验与失败 toast 齐全 → ⑤ 见 C3 的绑定问题。
- **判定：保存/打开本身通；与工程 ID 的绑定断裂（C3）。**

### C3 ★实现错误：顶栏打开 .pxm 不绑定工程 ID，「返回主页」会把导入内容覆盖回原工程
- 机制：Toolbar.tsx:223 打开文件只调 importProjectFile（纯 store 灌入），不设 asset-store.currentProjectId、不建新工程条目。WorkspaceSwitcher.tsx:15 返回主页时无条件 `saveCurrentProject()`，其实现（asset-store.ts:162-180）取 currentProjectId（仍是此前打开的 DB 工程）+ 当前 store 的 exportProjectFile 写回该 ID。后果：用户在工程甲里用顶栏打开外部 .pxm 看了一眼，点返回主页 → 乙文件内容被写进甲的 DB 记录，甲原数据静默丢失。对照主页导入路径（asset-store.ts:250 importProjectFromFile）是新建 ID + 新条目，两条导入路径语义不一致，顶栏这条缺绑定段。
- **判定：实现错误（数据覆盖隐患，第②/⑤段）。**

### C4 主题切换
- Toolbar.tsx:556-570 → theme.ts applyTheme 同步写 localStorage（theme.ts:5-8）、loadTheme 启动读回。**通。**

### C5 自动动态模糊开关 autoMotionBlur
- Toolbar.tsx:484 Toggle → editor-store → PixelCanvas.tsx:291 作为实参入 renderUnified → unified-render.ts:4783 `instruction.autoMotionBlur && keyframes.length > 0 ...` 内部判断。**通。**

### C6 导出按钮禁用条件
- Toolbar.tsx:575-582：`disabled={Object.keys(sprites).length === 0}`。工程只有角色无精灵（如纯人偶兜底）时导出入口被禁——是否符合产品意图无代码内依据，**未验证**（见清单）。

### C7 WorkspaceSwitcher 返回主页
- WorkspaceSwitcher.tsx:15-24：saveCurrentProject →（sprite_edit 时）exitSpriteEditMode(true) → setShowProjectHome(true)。链本身通（其数据风险归 C3）。注：Toolbar.tsx:5 import 了 useWorkspaceStore 但全文件未用（死 import，小）。

---

## D. 工作区布局 store
- 链：① page.tsx:53-59 读 layouts['puppet'] 定左右栏/时间线缺省尺寸 → ② workspace-store.ts updateLayout 为唯一写者 → ③ **updateLayout 全仓无调用点**（grep 证）：page.tsx 只读缺省值，面板尺寸实际由 page 内 useState（如 timelineCollapsed :62）与 panel 组件自管 → ④⑤ 布局从不被改写也不持久化（store 无 persist）。
- **判定：断裂（第②段写者缺位，模式③）。** 后果有限：布局恒为 DEFAULT_LAYOUTS，属「有读无写」的僵尸配置，非用户可见故障。另 asset-store.ts:336 refreshWorkflowSummary 读 `useWorkspaceStore.getState().mode`——mode 字段已随 workspace mode 退役删除，读得 undefined 且该变量未被使用（见 H3）。

---

## E. 工程生命周期

### E1 ProjectHomeScreen
- 链：新建（:78-84 createProject→openProject）、打开（:86）、删除（:88-93+确认框）、复制（:95-97）、重命名（:99-108 双击编辑→renameProject）、导入（:110-117→importProjectFromFile）全部接到 asset-store 动作；列表来自 loadProjectList（dbGetAll projectMeta 按 updatedAt 排序，asset-store.ts:88-97）。**通（除 E3/E4 两条）。**

### E2 createProject / openProject / saveCurrentProject（IndexedDB 主链）
- createProject（asset-store.ts:99-124）：写 projectMeta + resetProject 后 exportProjectFile 写 projects 行，两行同 ID。openProject（:126-161）：dbGet projects → importProjectFile；无数据时按 meta 初始化默认工程并落行；成功后 set currentProjectId +关主页。saveCurrentProject（:162-180）：exportProjectFile 写行 + updateCurrentProjectMeta 刷元信息。db.ts 五个 objectStore 与 keyPath 定义齐全（db.ts:18-52）。
- **判定：通。**

### E3 ★断裂：复制项目（duplicateProject）复制不出数据
- 机制（asset-store.ts:193-219）：从 DB 读出的 projectData 是带顶层 `id` 的记录（落行时以 `{id, ...projectFile}` 写入，db.ts keyPath='id'）。复制时 `dbPut('projects', { id: duplicate.id, ...projectData })`（:211）——展开在后，projectData.id（原工程 ID）覆盖 duplicate.id，记录仍落在原工程键下（内容相同，无损原工程），**新工程 ID 下没有任何数据行**。随后 openProject(副本) dbGet 不到 → 走「meta 存在则初始化默认工程」分支（:134-145）→ 副本打开是空白新工程。exportProjectAsFile(副本) 同样因 dbGet 不到而静默无下载。
- **判定：断裂（第⑤段往返，展开顺序错误）。** 对照 importProjectFromFile（:254 先 `projectData.id = newId` 再展开）写法正确，唯独复制这条反了。

### E4 ★断裂：项目缩略图永远为空
- ProjectMeta.thumbnail 定义为「首帧 base64 缩略图」（asset-types.ts:18-19），ProjectHomeScreen.tsx:164-167 有渲染分支；但全部写点都是空串：asset-store.ts:99（createProject）、:268（importProjectFromFile）、:304（updateCurrentProjectMeta）。全仓无任何生成缩略图的生产者。
- **判定：断裂（第②段生产者缺位，模式③）。** 项目卡片永远显示首字母占位。

### E5 自动保存（OPFS）主链
- page.tsx:90-126：5 分钟定时 + visibilitychange hidden + beforeunload 三路触发，hasWork 门控（有精灵/角色/片段才存），写 exportProjectFile 到 OPFS；autosave-opfs.ts 读写/元信息/旧 localStorage 迁移函数完整。**通（恢复段除外，E6）。**

### E6 ★断裂：自动保存恢复后不进编辑器，恢复成果无声丢失
- 机制：page.tsx:128-141 handleRestoreAutosave 只 `importProjectFile(projectFile)` + 清 OPFS + 关对话框，**不调 setShowProjectHome(false)、不设 currentProjectId**。asset-store.ts:74 showProjectHome 初值 true，page.tsx:293 以其三目决定渲染主页或编辑器。对照 openProject 在成功后明确 set({ currentProjectId, showProjectHome: false })（asset-store.ts:158）。后果：启动弹窗点「恢复」→ 对话框关闭、界面仍停在项目主页，恢复的数据只在 store 里；用户接下来打开任一工程（openProject 灌入）或新建工程（resetProject）即把恢复内容静默冲掉；且因 currentProjectId 为空，WorkspaceSwitcher 的 saveCurrentProject 也无处落。
- **判定：断裂（第③段消费缺位：恢复动作不切换视图/不绑定工程）。**

### E7 序列化与版本迁移链（exportProjectFile / importProjectFile）
- exportProjectFile（project-slice.ts:332-374）写 version '3.1' + project 主体 + proceduralAnimations + history。importProjectFile（:376-627）迁移链齐全且均有标记门控/幂等注释：旧 parts→sprites、clip 结构迁移（clip-migration）、时间单位迁移（timeUnitsVersion）、刀光中心语义（slashCenterVersion）、图案/刀光蓝图统一（pattern/blueprintVersion）、slot 补挂（含历史快照内）、骨轴守卫（含快照内）、精灵出生信息回填；set 时对易残留字段显式 `|| []` 清空（canvasModifierTracks/animationVariables 等，:613-615）。
- **判定：主体通；globalBlueprint 一项断裂（E8）。**

### E8 ★断裂：全局蓝图 globalBlueprint 不进存档、也不进撤销快照
- globalBlueprint 是活数据：编辑器渲染读（PixelCanvas.tsx 渲染实参）、进包读（convert.ts:2384-2395 经 projectData.globalBlueprint，ExportDialog.tsx:1057 导出时从 live store 传）。但：
  - exportProjectFile 的 project 字段名单（project-slice.ts:336-373）**没有 globalBlueprint**；importProjectFile 的 set 名单（:605-627）也没有——保存→重开后全局蓝图丢失（DB/.pxm/OPFS 自动保存三路同源同缺）。
  - _captureSnapshot（project-slice.ts:165-205）同样没有它：addGlobalModifier/removeGlobalModifier 会 pushUndo（global-modifier-slice.ts:33/77），撤销时快照恢复 globalModifiers 却不动 globalBlueprint，蓝图里手术同步的节点残留——撤销后蓝图与修改器列表不一致（渲染/进包优先读蓝图时，被撤销的修改器仍以蓝图节点形态生效）。
- **判定：断裂（第⑤段，模式⑨）。** 同类较小项：customModifiers、brushPresets 在 _captureSnapshot 内（可撤销）但也不在 exportProjectFile 内——用户自定义修改器/笔刷预设不随工程保存（brushPresets 在 resetProject 时被重播种为内置四件，project-slice.ts:699-713；是否为有意「全局偏好不入工程」无代码依据，列未验证）。

### E9 ResizePreviewDialog（精灵尺寸调整）与画布尺寸
- 精灵尺寸：① PuppetAssetPanel.tsx:173 挂载 → ② 对话框本地态（尺寸/裁剪偏移）→ ③ handleApply 调 sprite-slice resizeSprite（sprite-slice.ts:174）→ ④ slice 内同口径重映射像素/heightmap/landmarks（:185-233）并 pushUndo → ⑤ 精灵数据随工程存档。画布尺寸：PixelCanvas 状态条编辑 → use-canvas-state.ts:217 applyCanvasSize → project-slice.ts:135 setCanvasSize（pushUndo + 设字段），画布为中心原点参考系、无内容迁移（设计内）。
- **判定：主体通；预览锚点口径一处实现错误（E10）。**

### E10 实现错误：ResizePreviewDialog 的无 plug 精灵锚点预览与落库不一致
- 对话框 spritePivot（ResizePreviewDialog.tsx:19-24）：无 plug 时锚点取 **0**，预览「新锚点」= clamp(0 + 裁剪偏移)。落库 resizeSprite（sprite-slice.ts:196-197）：无 plug 时 oldPlug 取 **oldW/2、oldH/2（中心）**，新 plug = clamp(中心 + 偏移)。无 plug 精灵（导入/迁移来源可缺 plug，如 importProjectFile 的 parts 迁移仅在 pivotX 存在时写 plug，project-slice.ts:449）走此对话框时，预览所示锚点与实际写入不符——违反裁剪改动对位口径（模式⑤/⑥）。
- **判定：实现错误（预览/落库双口径）。**

---

## F. 新建角色

### F1 NewCharacterMenu（统一入口）
- 七项：创建向导/参考图装配（editor.setLeftPanelTab('assets')+setRefWizardOpen(true)，宿主在资产面板）/火柴人/3D 烘焙/Spine 导入/新建道具（addUnifiedCharacter）/示例小狗（动态 import quadruped-run），对话框均在本组件唯一宿主（NewCharacterMenu.tsx:108-113）；showProjectHome 时整组件不渲染（:85），防无工程时建角。**通。**

### F2 PuppetCreationWizard 全流程
- 三步（名称+模板/分配精灵/确认）状态齐全（:427-432），7 个模板真实定义（:60-404 ALL_TEMPLATES）。handleCreate（:453-716）：Pass1 生成默认精灵并算 jointWidth → Pass2 addSprite+setSpritePixels 落精灵 → 内存拼齐全部节点（createDefaultNode+attachment/sockets/slot，含 skipPlaceholderRoot:true 的 addUnifiedCharacter :544）→ updateUnifiedCharacter 一次原子写（nodes/rootNodeId/costumeSets/activeCostumeSetId，:706-711）→ 可选 addAnimationClip 归属新角色（:714）。全程不回读 store 快照（注释与 AGENTS 纪律一致）。
- **判定：通。**

---

## G. 导入

### G1 SpineImportDialog
- 链：三文件+名称门控（:39）→ parseAtlas/extractSpritesFromAtlas/importSpineToCharacter（spine-importer）→ pushUndo 后单次 setState 写 unifiedCharacters+selectedCharacterId+sprites（:72-78）；try/catch 全包，失败置 error 状态并显示消息（:79-82）。**通。** 注记：落库走 useProjectStore.setState 直写而非 character-slice 动作，绕过 slice 层规范化（如 slot 补挂只在 importProjectFile 时跑）；spine-importer 自身建的节点是否全带 slot 未在本域深挖，列未验证。

### G2 SpritesheetImportDialog
- 网格模式区域生成有图界检查（:106 `x + frameWidth <= imageData.width && ...`）；handleImport（:286-337）pushUndo 后逐区域 addSprite+setSpritePixels，可选 addAnimationClip（归属 '' 占位，与迁移口径一致）。**主体通，atlas 模式一处实现错误（G3）。**

### G3 实现错误：atlas 模式区域不钳图界，越界像素变非法颜色串
- atlas 模式（:125-158）直接采信外部 JSON 的 x/y/w/h，无图界校验；提取时（:314-326）srcX/srcY 越界 → `fullImageData.data[pixIdx]` 为 undefined → rgbaToHexOrNull(undefined,...)（engine/utils.ts:26-29）：`a < ALPHA_THRESHOLD` 对 undefined 为 false → 落 rgbToHex(NaN...) 生成含 "NaN" 的非法颜色字符串写入精灵像素（不崩，但像素数据被污染且无任何提示）。
- **判定：实现错误（外部数据未校验，静默污染）。**

### G4 aseprite-parser（.ase 导入，宿主在 ExportDialog）
- ExportDialog.tsx:1552-1582：parseAsepriteFile（aseprite-parser.ts:28，magic 校验 0xA5E0、帧/cel/调色板解析）→ 逐帧 addSprite+setSpritePixels，try/catch + alert 失败。**通（附注记）。** 注记：对话框文案（ExportDialog.tsx:1546）称「每帧加为独立 part，或作为选中 part 的关键帧」，实现只有加精灵一途，无 keyframes 选项——文案与实现不符（模式⑩）；且文案用已退役的 part 一词。

### G5 DccPipelinePanel 落库路径
- 事件/标签/碰撞三页签经 updateAnimationClip 直写 clip.events/tags/hitboxMap（DccPipelinePanel.tsx:102-145 等），调色板页签经 useProjectStore.setState 直写 palettes/activePaletteId（:898-926）；消费端在位：convert.ts:1536 clipEventsOf、:1548-1551 clipHitboxesOf 进包，FrameTag 由 Timeline/TrackLanesColumn 渲染，palettes 随 exportProjectFile（project-slice.ts:371-372）与 convert projectData 进包。**落库与消费通（附 H4 死代码注记）。**

### G6 ★断裂：调色板约束 paletteConstrained 无消费端
- 链：① DccPipelinePanel.tsx:1024-1026 复选框「约束到调色板」→ ② editor-store.ts:322 字段 + setPaletteConstrained（:409）→ ③④ **全仓无任何消费**：grep 证除面板自身与 editor-store 外无人读 paletteConstrained——画笔/填充/取色路径（tool-handlers、brush-engine）均不查此标志，不做最近色约束。
- **判定：断裂（第③④段缺位，模式⑦）。** 开关可拨、状态可存（会话内），绘画行为毫无变化。

---

## H. 撤销重做与 store 全局

### H1 pushUndo / undo / redo 机制
- project-slice.ts:205-240 pushUndo（快照式，_captureSnapshot :165-205；maxUndoLevels 截断；coalesceKey+1s 窗口合并 :226-238）；undo/redo（:264-330）恢复快照并失效插值/驱动缓存；beginDrag/endDrag 拖拽期单快照（:241-285 附近）；_isDragActive 时 pushUndo 静默跳过。UndoRedoControls（顶栏）订阅栈长定 disabled、右键菜单可多步跳撤。键盘路径不在本域。
- **判定：机制通；合并键一处实现错误（H2），快照字段缺 globalBlueprint（已记 E8）。**

### H2 实现错误：coalesceKey 'behavior' 被三个不相干功能共用
- pushUndo 合并规则（project-slice.ts:216-228）：同 key 且 1 秒内，只刷新栈顶时间戳、不再压新快照。'behavior' 同时被 BehaviorPanel.tsx:62（行为图编辑）、InputTracksStrip.tsx:45（输入轨全部增删改移）、CueTrackStrip.tsx:42（事件轨全部增删改移）使用。后果：1 秒内跨功能连改（如刚在行为面板改完立刻去输入轨加键）被并成一条撤销步，撤销一次同时回退两处不相干编辑，且历史菜单只显示先者描述。单功能内连续拖动合并是本意，跨功能共用同一 key 是口径错误。
- **判定：实现错误（撤销粒度污染，域内调用点抽查证实）。**

### H3 死代码：asset-store.refreshWorkflowSummary / workflowSummary
- asset-store.ts:331-352 refreshWorkflowSummary：读已退役的 workspaceStore.mode（undefined，未用）、projectStore.parts / .keyframes（现 ProjectStore 无此二字段，真调用将抛 TypeError）；且该函数**全仓无调用点**，workflowSummary 亦无任何读者。updateWorkflowSummary 同样无调用点。
- **判定：死代码（模式④）。** 不可达，故不构成现行故障；但属误当活链的高危残留，列此备案。

### H4 死代码：dcc-pipeline-slice 整个动作层无调用
- dcc-pipeline-slice.ts:59-273 的 addAnimationEvent/removeAnimationEvent/updateAnimationEvent/addFrameTag/addHitboxShape/addPalette/applyPaletteSwap/setActivePalette/getEventsAtFrame 等全部动作与 getter，组件层零引用（grep 逐个证 0 外部 refs）——面板实际走 updateAnimationClip/setState 直写（G5）。slice 仅剩类型与（经 index 合并的）声明在场。
- **判定：死代码（模式④，双写路径的假活链）。** 数据本身经面板直写正常落库，故不影响功能，但维护者按 slice 找写路径会走错门。

### H5 store selector 审计（模式⑧）
- 方法：grep 全部 useProjectStore/useEditorStore/useAssetStore/usePuppetSessionStore/useWorkspaceStore 选择器（单行约 195+ 处）+ 对象/数组字面量、map/filter/Object.values、`?? {}`/`?? []` 模式专项扫。
- 结果：**未发现 selector 内现造对象/数组**。`?? {}`/`?? []` 命中 12 处（PuppetAssetPanel.tsx:274、StrokePanel.tsx:340/502-504、Timeline.tsx:76 等）均作用于 store 层恒有定义字段（project-slice.ts:55-64 unifiedCharacters/motionBlurStrokes/effectStrokes/palettes 初始即 {} / []，永不为 undefined），回落分支不可达、身份稳定，与历史事故（精灵 landmarks 可选字段 ?? {}）形态不同。索引型选择器（RigPanel.tsx:394 等）返回稳定引用。
- **判定：通。**

### H6 editor-store 其他字段抽查
- simRealtimePreview：PixelCanvas.tsx:307 与 ChainBakePanel.tsx:55 消费，通。selectedPaletteSlot：除声明外 0 引用，死字段（小）。isDirty（editor-store）：仅类型与初值，无读写方，死字段（小）。selectedHitboxId：DccPipelinePanel.tsx:417 读，通。

---

## I. 导出入口（细节归域7，本域只验入口→convert 参数）

- 链：Toolbar 导出按钮（C6）→ page.tsx:289/520 开 ExportDialog → 程序化运行时页签 procPkg（ExportDialog.tsx:1050-1062）调 convertCharacterToRuntimePackage，参数齐全：frameRate/totalFrames/clips（按 puppetCharacterId 过滤）/patternLibrary/libraryEntries/projectData{proceduralAnimations, globalModifiers, globalBlueprint, canvasModifierTracks, effectTracks, motionBlurStrokes, effectStrokes, canvasWidth/Height, palettes, activePaletteId}/projectEx
...[truncated 1755 chars]