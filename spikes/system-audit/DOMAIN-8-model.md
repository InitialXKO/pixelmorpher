# 域8 审计：核心心智模型统一性

审计对象：同一概念在 ①数据模型（src/lib/unified-types.ts 为主）②代码命名 ③编辑器 UI 文案 ④运行时包（src/lib/proc-runtime/）⑤仓库文档（README.md / AUDIT_REPORT.md / MIGRATION_STATUS.md / docs/ / wiki/）五处是否同名同义。
方法：只读审计，全部结论以当前分支（audit/full-system == main 3a4a55c）代码与文档原文为据，file:line 标注。
判定四类：**同名异义**（一词多指）/ **异名同义**（一概念多名）/ **语义漂移**（跨编辑器↔包边界同名不同义）/ **文档不符**（文档表述与实现现状不符）。

---

## 一、核心概念总表

| 概念 | 数据定义 | 代码名 | UI 文案 | 包内对应 | 文档表述 | 统一判定 |
|---|---|---|---|---|---|
| 角色 | `Character`（unified-types.ts:1372） | Character | 角色 | 转换单位（convert 逐角色出包） | README「Character」 | **统一** |
| 节点 | `Node`（unified-types.ts:815） | Node | 节点 | `RuntimePart`（convert.ts:130，扁平化后的部件） | README「Node」 | 基本统一（包内改称 Part，见分歧 S3） |
| 精灵 | `Sprite`（unified-types.ts:346），全局表 `s.sprites` | Sprite | 精灵 | 烘焙图集/瓦片（表示变换） | README「Sprite：全局 sprites 表」 | **统一**（跨包表示变换属预期） |
| 槽位（连接点） | `Socket`（unified-types.ts:504），`Node.sockets`（:830） | Socket / sockets | **插槽**（PuppetAssetPanel.tsx:995、NodeTree.tsx:187、PixelCanvas.tsx:765） | 转换时由 attachment 展开，无独立物 | wiki 称「插槽」但定义错位（见 D4） | **不统一**：UI 用「插槽」，「槽位」被服装件占用（见 T1） |
| 插头 | `Attachment.plug`（unified-types.ts:537）；`Sprite.plug`（:352） | plug | 插头 | 同名透传 | docs/render-pipeline.md 一致 | **统一**（wiki 除外，见 D4） |
| 服装件 | `CostumePiece`（unified-types.ts:1198），挂载字段 `Node.slot`（:893），键 `slotKey` | CostumePiece / slot / slotKey | **槽位**（DressPanel.tsx:209「槽位级变体」、PuppetAssetPanel.tsx:759「{n} 槽位」） | piece 按 slotKey 键 | README 误写字段名 `costumePiece`（见 D1） | **不统一**：字段名/类型名/UI 名三者互不相同（见 T1、D1） |
| 服装集 | `CostumeSet`（unified-types.ts:1227），`Character.costumeSets` + `activeCostumeSetId` | CostumeSet | 服装集 | 同名进包 | README 一致 | **统一** |
| 变体 | `Character.variantDefs`/`slotVariants` + `CostumePiece.variantSprites`（unified-types.ts:1209） | variant | 变体（槽位级） | 变体替代精灵（convert.ts:156） | README 数据模型未提 | 基本统一（文档缺失） |
| 方向（离散） | `DirectionIndex` 0–7（unified-types.ts:395），载体 `NodeTransform.variantIndex` | variantIndex / DirectionIndex | 方向（方向盘） | convert 以根节点 variantIndex 为代表方向（convert.ts:317） | README「8 方向（S/SE/E/NE/N/NW/W/SW）」 | 基本统一，但与旧字符串表示并存（见 Y2） |
| 纬度 | `Character.latitude`（unified-types.ts:1436，度，−90..90）+ `CostumePiece.latitudeSprites`（:1213） | latitude | 纬度（DirectionWheel.tsx:186） | convert 消费 | README 仅方向盘处一句 | **统一**（与方向/偏航三分清楚，见断层线⑥） |
| 连续偏航 | `Character.facingAngle`（unified-types.ts:1492，度，0~360） | facingAngle | 朝向角（PerformPanel/操控） | convert 按 yaw 增量烘进摆放（facingYawDeltaRad） | README 未提 | **统一**（文档缺失） |
| 蓝图 | `BlueprintGraph`（blueprint/ir.ts:47）一份 IR，多挂载：节点蓝图 `Node.blueprint`（:836）、角色蓝图 `Character.blueprint`（:1442）、状态蓝图（:1446）、行为图 `behaviorGraphs`（:1451）、表演图 `ProcPerformance.graphs`、全局蓝图、IK 蓝图 `ikBlueprint` | BlueprintGraph | 蓝图 / 行为图 / 表演图（按挂载加限定词） | 图经 graph-translate 采样烘焙为曲线，不以图形态进包 | README「蓝图为唯一渲染 IR」 | **统一**（一份类型多挂载，UI 用挂载点作限定词，模型干净） |
| 修改器 | `ModifierInstance`（unified-types.ts:704）/`ModifierType`（:666） | Modifier | **修改器**（主流）与**修饰器**（Timeline 轨点编辑）并存 | pixel modifiers 等段 | wiki「修改器」 | **不统一**（见 Y1） |
| 关键帧轨道 | `NodeTracks`（unified-types.ts:910）+ `KeyframeTrack`（:774，全仓唯一定义） | tracks / KeyframeTrack | 轨道 | 采样烘焙成曲线 | — | **统一**（数据层单一定义） |
| 轨迹 | `Node.trajectory`（unified-types.ts:844） | trajectory | 轨迹（工具与「烘焙为轨道」StrokePanel.tsx:247-255） | 烘焙进轨道曲线 | — | **统一**（与轨道的区分在 UI/代码/注释三处一致守住） |
| 输入轨 | `Character.inputTracks`（unified-types.ts:1470） | inputTracks | 输入轨（InputTracksStrip） | 不进包（运行时用真实输入，unified-types.ts:1466-1469 注释明示） | — | **统一** |
| 事件轨 | `Character.cueTrack`（unified-types.ts:1480）+ `CueEventValue`（:794） | cueTrack | 事件轨（CueTrackStrip） | 不进包（perform-fx.ts:22-24 边界明示） | — | **统一** |
| 效果轨 | `EffectTrack`/`EffectType`（**types.ts:562/554**，旧类型文件） | EffectTrack | 效果轨（EffectTrackLane） | fx 进包（convert.ts:257） | — | 基本统一（类型定义 split 在旧文件，见断层线④） |
| 片段 | `AnimationClip`（**types.ts:801**），字段含旧名 `puppetCharacterId` | AnimationClip / clip | 动画片段（AnimationClipPanel.tsx:95） | **段表演**（convert.ts:1475-1477） | — | 基本统一（包内名「段表演」与编辑器「片段」靠 ExportDialog 文案桥接） |
| 表演 | `ProcPerformance`（unified-types.ts:1152），`Character.performances`（:1453） | ProcPerformance | 表演（BehaviorPanel.tsx:174，挂在「行为」页签内） | 表演（烘焙曲线 + 状态机表演态） | — | **漂移**：包内「表演」集合大于编辑器表演（见 S2） |
| 操控 | 无独立数据型；`PerformPanel`（直接拖动+自动录制关键帧）+ puppet-session-store 的 perform* 字段 | perform | 操控（PuppetPanel 页签「操控」） | 无对应物 | README 把时间轴/蓝图/IK 都归到「操控 (Perform)」标题下 | 相邻易混（与「表演」是两个概念，见 Y5） |
| 行为 | `Character.behaviorGraphs`（unified-types.ts:1451） | behaviorGraphs | 行为图（BehaviorPanel 页签「行为」） | 宿主侧实时求值 | — | **统一** |
| 状态机 | `StateMachineSpec`（unified-types.ts:1094） | StateMachineSpec | 状态机（PuppetPanel 页签） | 作者规格直通进包 / convert 生成默认机 | — | **统一** |
| 行为树 | `BehaviorTreeSpec`（unified-types.ts:1138） | BehaviorTreeSpec | 行为树（PuppetPanel 页签） | **不进包**，宿主侧 tick（unified-types.ts:1132-1137 注释明示） | — | **统一** |
| 动态模式 | `DynamicPatternInstance`/Params（dynamic-patterns.ts），双挂载 `Node.dynamicPatterns` / `CostumePiece.dynamicPatterns` | DynamicPattern | 动态模式（DynamicPatternEditor） | DYNAMIC_SRC 孪生 | RESEARCH 以「模式库」统称 | **统一** |
| 模式库 | 模板/条目：`PatternTemplate`（proc-runtime/pattern-templates.ts）、`LibraryEntry`（library-entries.ts） | pattern library / library entries | 模式库（DynamicPatternEditor.tsx:159「模式库管理」） | pattern-library.ts | pixelfx RESEARCH「模式库」 | 基本统一（编辑器侧模板与条目两词并存，指同一库的两类对象） |
| 刀光 | `SlashDefinition`（unified-types.ts:1146，角色级共享定义）+ `SlashFanSpec`（slash-fan.ts） | slashDefs / slashEffect / slash_fan 节点 | 刀光 | 同名进包（convert.ts:1461） | — | **统一**（定义/引用/物化口径三处一致） |
| 宿主 | 无单一定义 | host（behavior-host.ts）/ HostFx（host-fx.ts） | 宿主变量（行为）/ 宿主像素（动态模式） | procRuntime 宿主 API | — | **不统一**：两个互不相干的指称共用一词（见 T2） |
| 锚点 | 无单一定义：`ClampAnchor`（unified-types.ts:1322）、`Node.clipPlane.anchor`、slash `anchorNodeId`（slash-fan.ts:31） | anchor | 锚点（多处） | dynAnchors 等 | — | **不统一**：泛称词，≥4 个不同指称（见 T4） |
| 标记 / 特征点 | `SpriteMark`（unified-types.ts:339，命名语义标记）与 `SpriteLandmarks`（:320，眼/鼻/嘴特征点）两套并存 | marks / landmarks | 标记 / 特征点（两工具分开） | marks 按名解析进包 | — | 基本统一（两概念有意分开，类型与工具都分开） |
| 包 / 运行时 | `window.procRuntime`（runtime-template.ts:3807） | procRuntime / RuntimePackage | 导出/运行时包 | 本体 | wiki PluginDevelopment 以 procRuntime 为口 | **统一** |
| D1–D6 | 无集中定义，散见段注释 | D1 表面（unified-types.ts:996）、D2 置换（dynamic-patterns.ts:22）、D3 自转（:34）、D4 弧线（:50）、D5 残影（:40）、D6 有状态模拟（unified-types.ts:1399-1411） | — | D6 三件在包内 | pixelfx RESEARCH 以 D6 为分流目的地 | **部分不统一**：D1–D5 是模式段代际、D6 是模拟线，编号异质（见断层线⑨） |

---

## 二、分歧清单

### 同名异义

**T1.「槽位」三角占用，且与既定术语口径相反。**
- 「槽位」在编辑器 UI 与文档里指**服装件槽**（slotKey）：PuppetAssetPanel.tsx:759（服装集「{n} 槽位」= pieces 数）、DressPanel.tsx:209（「槽位级变体」）、DynamicPatternEditor.tsx:67（「当前槽位」= 服装件）、ParametricAppearanceEditor.tsx:107（「槽位 {slotKey}」）、docs/render-pipeline.md:11（「slot: { slotKey } // 服装槽位定义」）、runtime-template.
...[truncated 11170 chars]