# DOMAIN-6 时间线与效果轨（只读审计，基点 audit/full-system == main 3a4a55c + ca79308）

判定四态：通／断裂／实现错误／未验证。五段：①入口/数据定义 ②store/写入 ③消费端调用 ④消费端内部判断 ⑤存档/进包往返。

---

## 1. 播放调度 playback-scheduler

- 链：①`src/lib/playback-scheduler.ts` 全文（单例 rAF）→ ②写回 `setCurrentFrame`（:79）→ ③Timeline 播放态 effect 启停（`Timeline.tsx:399-408`）→ ④推进口径：`elapsed` 累加、`framesToAdvance = floor(elapsed/frameDuration)`、越界取模回绕（scheduler:71-79）；performFx 观测点在推进之前（:60），定格分支不推进但照常触发渲染回调且 `lastTimestamp` 跟随本 tick（:60-67，解冻后不把冻结时长算进推进量——机制正确）→ ⑤不涉存档。
- **判定：通**。
- 附带：`isPlaybackRunning`（:104-107）未导出、全仓零调用——死代码（④类残留，无害，建议清理时一并删）。

## 2. Timeline 播放控制 / 帧率 / 总帧数

- 链：①`TimelineControls`（`Timeline.tsx:650-675` 传参）→ ②store `setFrameRate/setTotalFrames/setCurrentFrame`（`store/project-slice.ts:139-147`）→ ③调度器逐 tick 读 store 最新值（scheduler:71）→ ④提交校验在 Timeline 侧：帧率 1–120、总帧数 1–9999，非法回填原值（`Timeline.tsx:488-498`）；`setCurrentFrame` 本身钳 [0, totalFrames-1]（project-slice:147）→ ⑤帧率/总帧数在快照内（project-slice:178-183）。
- **判定：通**。小注：`setTotalFrames` 本体不钳 `currentFrame`（project-slice:143-146），缩短总帧数后 currentFrame 可短时越界，直到下一次 setCurrentFrame 或调度器取模恢复——显示层问题、非数据损坏。

## 3. Timeline 缩放 / 吸附

- 链：①`timelineZoom/snapConfig` 在 store（`store/v15-slice.ts:24,53,64`；Timeline 选择器 `Timeline.tsx:63`）→ ②`updateSnapConfig` 合并写（v15-slice:64）→ ③`FRAME_WIDTH = getFrameWidth(timelineZoom)`（Timeline:337）统一喂标尺/车道/播放头拖拽（:545-556）→ ④`snapFrame`（:578-620)：阈值按像素→帧换算，三类吸附源（5 帧标记/他轨键/段边界）取最近——机制与注释一致 → ⑤缩放/吸附是编辑器会话态，不进存档（合理）。
- **判定：通**。

## 4. 轨道行布局（虚拟滚动）

- 链：①`timeline/useVirtualScroll.ts:26-97` 按 effect 轨/画布轨/木偶行/状态行组装 rowGroups 并累计 rowOffsets → ②Timeline 调用点传真实轨表（`Timeline.tsx:392-396`）→ ③TrackLabelsColumn 与 TrackLanesColumn 共用同一份 visibleRange/rowOffsets/rowHeights/totalHeight（Timeline:716-800）→ ④二分求可见区间（useVirtualScroll:117-141），两列同口径不会错位 → ⑤不涉存档。
- **判定：通**。小注：各条带（Input/Cue）的播放头线由 `currentFrame` prop 绘制，而 Timeline 渲染期的 currentFrame 取自订阅镜像 ref（Timeline:42,343,555），播放中 Timeline 本体不逐帧重渲染——条带播放头线是否逐帧跟随属运行时观感，本次静态审计**未验证**（主车道播放头走 playheadLineRef 直改 DOM，不受此限）。

## 5. 输入轨 InputTracksStrip

- 链：①数据 `Character.inputTracks`（`unified-types.ts:1462-1466`，三轨 KeyframeTrack<number>）→ ②条带写：`pushUndo + updateUnifiedCharacter(id, { inputTracks})`（`timeline/InputTracksStrip.tsx:45-46`），加/拖/删/改值/改过渡齐全 → ③消费：`lib/behavior-host.ts` `sampleInputTrack`（:28）/`behaviorInputAt`（:50）/`behaviorHostVars`（:70），被 unified-render 导入（`unified-render.ts:92`）喂行为图变量、BlueprintEditor 预览同源（`BlueprintEditor.tsx:221-228`）→ ④采样语义：首尾钳端值、键帧帧取键值、段内按 step/linear（behavior-host:28-48）——字面口径与注释一致；phase 为速率积分、拖时间轴可复现 → ⑤角色字段随 unifiedCharacters 整表序列化（project-slice:194,608），不进包（types 注释明示运行时用真实输入，与实现一致）。
- **判定：通**。

## 6. 事件轨 CueTrackStrip + perform-fx

- 链：①数据 `Character.cueTrack: KeyframeTrack<CueEventValue{hitstop,shake}>`（`unified-types.ts:796-802,1472`）→ ②条带写（`timeline/CueTrackStrip.tsx:42-47`），加键缺省 {hitstop:0.12, shake:6}（:23,55）、拖移帧、改定格（0–2s）/震屏（0–40px）/删键（:143-160）→ ③消费：PixelCanvas 每帧发布 `cueEventsAt(可见角色集, currentFrame)`（`PixelCanvas.tsx:279`），scheduler 推进前 `performFx.observe`（scheduler:60），震屏偏移由 PixelCanvas 平移叠加 → ④`sampleCueTrack` 恰帧命中才触发、无插值（`perform-fx.ts:46-55`），多角色取大（:57-72)，driver 每（遍，帧）只判别一次、帧号变小算新一遍（perform-fx PerformFxDriver.observe）——与「第 F 帧有键 = 第 F 帧触发」的字面语义一致 → ⑤随 unifiedCharacters 往返；不进包，convert 以 `characterHasCueEvents`（perform-fx）点名警告（`convert.ts:813-815` 一带，警告文案与事件轨口径一致）。
- **判定：通**。

## 7. effectTracks 工程级总链

- 链：①`EffectTrack{id,type,name,visible,keyframes[]}`（`types.ts:554-568`）；加轨菜单遍历 EFFECT_CONFIG 六类型（`timeline/TrackLabelsColumn.tsx:129`）→ ②`store/effect-slice.ts` 全套动作（加/删轨、显隐、加/删/改关键帧，:58-126）→ ③编辑器消费两处同构：executeRenderPlan 的 plan 路径（`unified-render.ts:3691-3708`）与 renderUnified 直路（:5592-5609）→ ④两处均先查 `visible`（:3693/:5594），非 text_pop 取「frame ≤ 当前帧的最大键」（:3704-3706/:5605-5607）——「最新关键帧持续生效」在消费端是真按此读；⑤存档：快照显式含 effectTracks（project-slice:171），载入经 `...file.project` 展开 + 快照恢复显式字段（:359）；进包：ExportDialog 与 ProcPreview 都把 store 的 effectTracks 塞 projectData（`ExportDialog.tsx:1056`、`puppet/ProcPreview.tsx:74`）→ convert 整份透传 `fx.effectTracks = pd.effectTracks`（`convert.ts:2406`）→ 包内 fxRenderSet 消费（见 §9 表）。
- **判定：通**（参数可写性问题单列 §8；片段级副本问题单列 §13）。

## 8. 五种效果轨的参数在 UI 里写不进去

- 对象：glow / particle / afterimage / pixel_displace / motion_blur 的关键帧 params。
- 证据链：唯一建帧入口 `Timeline.tsx:503` `handleAddEffectKeyframe` 不传 params → slice 落 `params = {}`（`effect-slice.ts:84-85`，仅 text_pop 有缺省播种）；唯一改参入口 EffectKeyframeEditDialog 只渲染 params **已有的键**（`dialogs/EffectKeyframeEditDialog.tsx:73`），空 params 显示「No parameters to edit」（:94-96），且对话框没有任何「新增字段」的控件；`updateEffectKeyframe` 全仓仅此对话框调用。机制推导：UI 里新建的这五类关键帧永远 params={}，渲染端只能走写死回落值——用户加多少关键帧、画面都一模一样（每帧都是缺省参数），且无法经任何界面改动。
- **判定：断裂（②写入段）**。渲染/进包段本身是通的（§7/§9），断在「参数无从写入」。text_pop 因有播种 + 对话框垫底而不在此列（§10）。

## 9. EffectType 四处对照表

| 类型 | 定义 | 编辑器渲染（effect-render.ts) | 包内渲染（runtime-template.ts fxRenderSet) | convert |
|---|---|---|---|---|
| glow | types.ts:554 | case:656 | if 链（:4546 起分发，glow 支） | 透传:2406 |
| particle | 同上 | case:677 | particle 支 | 同上 |
| afterimage | 同上 | case:710 | afterimage 支 | 同上 |
| pixel_displace | 同上 | case:722 | pixel_displace 支 | 同上 |
| motion_blur | 同上 | case:735 | motion_blur 支 | 同上 |
| text_pop | 同上 | case:749 | 专支（逐事件）:4551-4592 | 同上 |

- 六类型四处齐全，无缺处。包内分发前先查 `tr.visible`（fxRenderSet 首行），非飘字取最新键（`k.frame <= frame` 取最大）——与编辑器两侧同口径。
- 种子/PRNG 核对（防 ⑤ 漂移）：编辑器 `hashString`（`engine/noise.ts:16-22`，h*31+c 后 `>>>0`) 与包内 `dynSeedOf`（`proc-runtime/dynamic-src.ts:27-31`，同式、带符号返回）数值差 2³² 的整数倍，两端 LCG 入口都做 `seed|0`（noise.ts:8 / dynamic-src dynProcSeededRandom:857-859），且 LCG 本体逐式相同（1664525/1013904223/4294967295）——粒子序列两端一致，**此项验过非漂移**。
- 覆盖层算法注记：五类的编辑器与包内实现都是「整幅覆盖层」级近似（不采样角色像素），两端公式逐项对过：afterimage 有效 alpha 两端同为 opacity×0.015、motion_blur 同为 pow(·)×0.01、pixel_displace 同为 0.01、glow 环 alpha 同式（锚点编辑器画布中心 vs 包内角色位，为既有中心近似口径）；particle 的 y 向符号差是两端坐标系（Y 下/Y 上）之差，非漂移。

## 10. 效果轨参数的 0 值被编辑器缺省顶替

- 编辑器 effect-render 五类全部用 `Number(params.x) || 缺省`（`effect-render.ts:658-746`，如 radius `|| 3`、intensity `|| 0.5`、rate `|| 10`、gravity `|| 0.5`）；包内用正经的 `num()`（缺失/非有限才回缺省，0 是有效值，`runtime-template.ts:4548`）。
- 机制推导：用户把 intensity/rate/gravity 等设为 0（=关掉该项）时，包内按 0 执行、编辑器预览却按缺省值画——预览与导出不一致。同类错误在画布修改器侧已被明文修掉（`engine/canvas-modifiers.ts:19-25` 注释点名旧 `Number(p) || 缺省` 之害），效果轨侧漏修。
- **判定：实现错误（⑥/⑤，编辑器单侧）**。注：因 §8，五类参数当前只能经工程文件手写进入，此错的触发面限于手写/导入的工程；修 §8 时应一并处理。

## 11. text_pop 飘字

- 链：①EffectType 成员（types.ts:554）+ 事件缺省（`text-pop.ts:198-208`)→ ②建帧播种缺省事件（effect-slice:84-85）、对话框以缺省垫底保证全字段可编（Dialog:37-41）→ ③编辑器两个调用点**都**对 text_pop 走逐关键帧遍历（unified-render:3695-3702 与:5596-5603），没有误用「最新键持续生效」；包内 fxRenderSet 专支同样逐事件（runtime-template:4551-4592）→ ④包络门控：`textPopEnvelope` 在 tSec<0 或 ≥duration 时 active=false（text-pop.ts:156-158），编辑器对过期事件的调用无副作用；锚点口径两端同（char=中心近似/canvas=画布坐标）→ ⑤随 effectTracks 往返/进包同 §7。
- **判定：通**。

## 12. canvasModifierTracks 总链 + 八类型四处对照

- 链：①`CanvasModifierType` 八类型与逐参数定义表（`types.ts:438-446`、CANVAS_MODIFIER_DEFINITIONS，含缺省/min/max/options）→ ②effect-slice 轨/修改器/关键帧全套动作（effect-slice.ts:188-末）+ CanvasModifierPanel 按 def.params 通用渲染编辑（`CanvasModifierPanel.tsx:108-126,239-244`，改参有活动关键帧时写关键帧、否则写实例）→ ③编辑器 `applyCanvasModifiers`（`engine/canvas-modifiers.ts:851-897`）由 unified-render 三处调用（:5641,5695,5777）→ ④消费端逐级查标志：`track.visible && track.enabled`（:859）、`modifier.enabled`（:863）——历史故障 ①（不查标志）在本链已防；参数解析 `resolveCanvasModifierParams`（:42-90）端点钳制 + 数值线性插值，`numParam` 保证 0 不被顶替（:21-25）→ ⑤存档往返（project-slice:172 快照 /:605 载入显式回落）；进包：projectData.canvasModifierTracks → convert `fx.canvasTracks`（convert:2407）→ 包内 fxCollectCanvasMods 同样三级查标志（runtime-template:1987-1995)、fxResolveCanvasParams 与编辑器逐式同构（:1855-1882)、fxRunPostChain 逐类型施加（:2175-2292）。

| 类型 | 定义（types.ts) | 编辑器（canvas-modifiers.ts switch:869-894) | 包内（fxRunPostChain uEffect) |
|---|---|---|---|
| outline_emphasis | CANVAS defs |:870 | pass 6（:2267 一带） |
| color_lut | 同上 |:873 | pass 1 |
| pixel_zoom | 同上 |:876 | pass 3 |
| bloom | 同上 |:879 | pass 5/7/8/9 |
| scanlines | 同上 |:882 | pass 2 |
| canvas_mask | 同上 |:885 | pass 4 |
| field_wipe | 同上 |:888 | pass 10（+ fxBuildWipeTex 栅格孪生） |
| block_shift | 同上 |:891 | pass 11（+ fxBuildShiftTex） |

- **判定：通**（关键帧参数袋问题单列 §13 错误清单 E2）。

## 13. 画布轨关键帧是「全轨共享参数袋」，多修改器同轨时串扰

- 机制：关键帧挂在**轨**上、params 是扁平袋（`types.ts` CanvasModifierKeyframe）；加帧时 Timeline 把轨内**每个**修改器在该帧的解析参数依次 `Object.assign` 进同一个袋（`Timeline.tsx:511-517`)；解析时又把同一袋覆盖到每个修改器上（canvas-modifiers.ts:52 `{...modifier.params,...kf.params}`，包内 fxResolveCanvasParams:1863-1864 同式）。
- 同轨加的修改器恒为同 type（`CanvasModifierPanel.tsx:359` 按 track.type 加），两个同类型修改器参数名全同——快照时后者的值覆盖前者，解析时两者共用一袋：第一个修改器在任何有关键帧的帧上，参数被第二个的快照值顶替，其实例 params 里与之不同的值在关键帧帧/插值段内失效。面板改参同理（有活动关键帧时写入共享袋，CanvasModifierPanel:125）。
- 影响面：单修改器轨（缺省形态）完全正常；同轨叠第二个同类型修改器并打关键帧才触发。两端同病（数据模型层，非双实现漂移）。
- **判定：实现错误（数据模型层）**。

## 14. GlobalModifier 全局修改器

- 链：①`GlobalModifierType` 14 类型（`types.ts:577-590`) + GLOBAL_MODIFIER_DEFINITIONS 逐类型参数表（:615 起，实数核对 14 条齐全）→ ②`store/global-modifier-slice.ts` 增删改（:31-129）；面板按 def.params 通用编辑 + startFrame 编辑（`GlobalModifierPanel.tsx:116,181-184`)→ ③编辑器消费：renderUnified 路径的全局变换包装（`unified-render.ts:5450-5482`)→ ④内部判断：`globalBlueprint?? modifiersToBlueprint(globalModifiers)`（:5462)，migrate 内先按 `enabled` 过滤（`blueprint/migrate.ts:28`)、startFrame/endFrame 经 timeGate 门控（migrate:113-129)、paramKeyframes 转 keyframes 节点（migrate:158-160)、paramDrivers 转 waveform 节点；14 类型在 blueprint specs 与 eval 中逐一有定义/求值器（逐名核对齐全）；结果只取五路变换（translate/rotation/scale）施加——14 类型全是变换族，与此通道相容。蓝图优先的安全前提成立：面板改全局修改器时 slice 对已有 globalBlueprint 做手术式同步（global-modifier-slice:65-87)，不存在「改了面板不生效」→ ⑤存档往返（project-slice:191 快照 /:603 载入）；进包：convert 以同一翻译链（modifiersToBlueprint → pruneToTransform → translateBehaviorGraph）入包并对无变换输出等情形点名警告（convert:2382-2400）；编辑器侧与包侧对「无全局修改器时 globalBlueprint 不单独生效」的口径一致（unified-render:5461 先判 modifiers 非空；convert:2396 一带同界警告）。
- **判定：通**。

## 15. 片段级轨（clip.effectTracks 等）无人维护，且与工程级双套并存

- 事实链：`types.ts:1124-1133` 把工程级 tracks/effectTracks/canvasModifierTracks/strokes 标为 @deprecated，注释称「存在 activeAnimationClip 时片段数据优先」——但全仓没有任何代码实现这个优先序：「Sync legacy fields」在 removeAnimationClip/updateAnimationClip 里是**空块**（`project-slice.ts:761-762,769-770`)，setActiveAnimationClip 只改 id（:775-779）。
- 编辑器全程只用工程级（Timeline 编辑、PixelCanvas 渲染、导出 projectData 都读 store 工程级字段，§7 证据）；片段级 effectTracks 的写者只有两个：旧工程载入迁移时把工程轨**复制**进迁移片段（project-slice:412）与片段复制时的 structuredClone（`AnimationClipPanel.tsx:78`)。新建片段恒为空（project-slice:733）。片段级轨没有任何编辑界面。
- 后果（进包侧）：convert 的 clipFxOf 把 clip.effectTracks 原样入段表演 fx（`convert.ts:1501`)，与工程级 fx 集（convert:2406）在运行时同帧各画一遍（`runtime-template.ts:5609` 工程集 +:5612 段表演集）。迁移工程里两者是同一份数据的两份拷贝 → 段表演期间效果轨双重应用（辉光叠两遍、粒子双份），编辑器里看不到。
- 对照：同函数的 clip.canvasModifierTracks 已设防——与工程级逐项全同则判旧迁移双写、不入包并点名（convert:1502-1510)；clip.effectTracks / motionBlurStrokes / effectStrokes（convert:1501,1513-1514）**没有**同等设防。
- **判定：断裂（片段级 ②写入/维护段缺位 + ③字段无人维护）**；其中 convert 对 effectTracks 迁移双写未设防单列错误清单 E3。

## 16. 存档往返（本域汇总）

- 工程级：effectTracks/canvasModifierTracks/globalModifiers 快照与载入双向显式（project-slice:171-172,191 /:355-360,603-605），载入注释明示「文件缺字段时必须清空、不许残留会话轨」（:604-605)——防 ⑨ 做到位。
- 角色级：inputTracks/cueTrack 随 unifiedCharacters 整表进出（project-slice:194,608)，无逐字段剥离点。
- 迁移片段里 canvasModifierTracks 置 [] 是**有注释的刻意决定**（防双重应用，project-slice:414-417)，不是丢失；但 effectTracks 在同一迁移里被复制（:412）——正是 §15 的双写来源，两轨处理不一致。
- **判定：通**（问题归 §15，不在本项重复计）。

---

## 断裂清单

- **D6-1（§8）**：glow/particle/afterimage/pixel_displace/motion_blur 五类效果轨关键帧的 params 在 UI 内无任何写入路径（建帧恒 {}、编辑对话框不能新增字段），参数不可编、关键帧形同虚设。断在 ②。
- **D6-2（§15）**：片段级 effectTracks/canvasModifierTracks/strokes 无编辑面、无同步（「Sync legacy fields」为空块；types 注释宣称的片段优先序无实现），字段靠复制/迁移偶然填充，属无人维护的第二套数据。

## 实现错误清单

- **E1（§10）**：编辑器 effect-render 五类用 `Number(params.x) || 缺省`，0 值被缺省顶替，与包内 num() 口径不一致（画布修改器侧已修、效果轨侧漏修）。
- **E2（§13）**：画布轨关键帧为全轨共享扁平参数袋，同轨第二个同类型修改器的快照值覆盖第一个，关键帧帧/插值段内第一个修改器的差异参数失效；编辑器与包内同病（数据模型层）。
- **E3（§15）**：convert 对 clip.effectTracks（及 motionBlurStrokes/effectStrokes）的旧迁移双写未设防（canvasModifierTracks 已有逐项比对设防），迁移工程在包内段表演期间效果轨双重应用，编辑器不可见。

## 未验证清单

- **U1（§4）**：播放中 InputTracksStrip/CueTrackStrip 的播放头线是否逐帧跟随（Timeline 渲染期 currentFrame 来自订阅 ref，主车道走 ref 直改 DOM、条带走 prop）——需运行时目检。
- **U2**：效果关键帧无「移动帧」动作（effect-slice 无 moveEffectKeyframe，KeyframeMarker 无拖拽），只能删后重加——能力缺失事实已由代码坐实，是否列为待补由主线定。
- **U3**：EffectTrackLane 在相邻关键帧间画连接线（`EffectTrackLane.tsx:74-89`），视觉上暗示插值，但消费语义是阶梯保持（§7 ④）——⑩ 类轻微表里不一，未做用户观感验证。
- **U4**：全局修改器 14 类型经蓝图求值后的逐类型数值正确性（波形/弹簧等公式）属域5 蓝图求值审计范围，本域只验到「定义/注册/接线齐全」，未逐式验算。
