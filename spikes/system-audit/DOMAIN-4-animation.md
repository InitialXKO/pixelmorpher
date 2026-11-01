# DOMAIN-4 动画与表演（审计报告，2026-11-01，只读审计，未改代码）

审计对象：main 3a4a55c。每项走全链五段（①入口/数据定义 → ②store/写入 → ③消费端调用 → ④消费端内部判断 → ⑤存档/进包往返），判定四态：通／断裂／实现错误／未验证。带 ★ 的条目为审计主持人亲读代码复核过的承重断言（轨迹主消费缺失、A 版 step 边界、B 版 bezier、ik-bake 骨长、调度不读片段、复制片段漏刀光、presets/motionAnalysis/csv 孤儿、convert 刀光解引用传 undefined），其余为分组审计证据。

---

## 一、关键帧与轨道

### 1. 节点 tracks 数据与写入路径｜通（写入侧）
- ①定义：`src/lib/unified-types.ts:774-787` KeyframeTrack{keyframes, interpolation}／KeyframePoint{frame, value, interpolation?, bezierCP1?, bezierCP2?}；`:736` InterpolationMode='step'|'linear'|'bezier'；`:900-930` NodeTracks（angle/tilt/x/y/stretch/scaleX/variantIndex/zIndex/modifierKeys/faceTurnKeys/parentKeys）。
- ②写入：姿态通道直写 `src/components/pixel-editor/canvas/tool-handlers.ts:98-146` writePuppetPoseKeyframe（已有点保字段更新、新点排序插入、新轨缺省 linear）；时间线增/删/复制/移动 `src/components/pixel-editor/Timeline.tsx:132-205` → `src/lib/store/character-slice.ts:610-636`（均 pushUndo），纯函数 upsertPoint/removePoint/shiftFramePoints 在 `character-slice.ts:220-256`（写入恒排序）；附件轨 setter 在 `character-slice.ts:560-606`。
- ⑤存档：整对象序列化带出（见 §二-6），tracks 无剥离。

### 2. ★插值实现三份并存、边界帧口径不一致｜实现错误 + 断裂
实际有三份插值实现，node tracks 的消费方用其中两份，口径互不一致：
- **A 主渲染私有版** `src/lib/unified-render.ts:1370-1439` interpolateTrack——被 interpolateTransformImpl（`:1261-1278`）→ computeWorldTransforms → 主画布、命中、convert 采样消费，是唯一决定出图的版本。
- **B 辅助版** `src/lib/engine/render-helpers/puppet-keyframe-interpolation.ts:20-33`——被 Timeline 加帧取值、tool-handlers 拖拽基准、PerformPanel 读数、recordFullPose、motion-guide 基准消费。
- **C 旧版** `src/lib/engine/interpolation.ts:117-136`——不被任何 node tracks 消费方使用，只服务 ParamDriver/修饰器参数（旧 types 形），非活链。
- **A 版 step 边界帧错（亲验）**：`:1387-1394` 段扫描取第一个含当前帧的段，恰在中间关键帧 F 时命中的是「前点 P→F」段，mode 取 F 点的 interpolation，step 时返回 `kfs[i].value` = **P 的旧值**——step 在关键帧帧仍显示旧值、晚一帧才切换（仅首/末点被 `:1380/:1383` 钳制句救回）。`src/lib/behavior-host.ts:25-28` 注释自己把此称为 interpolateTrack 的「怪癖」并刻意不跟随，旁证属实。B 版同帧取 F 点值（prev=≤F 的最后一点，`:25-27`），step 语义正确。→ A/B 在 step 边界帧差一帧（模式⑤双实现漂移，且错的是出图的那份）。
- **B 版 bezier 是假实现（亲验）**：`:32-33` 只判 step，其余一律线性插值，bezierCP 完全不读；A 版真做三次 bezier（`:1400-1419`）。→ 面板读数/拖拽基准/录姿路径下 bezier 轨道按直线走，与主画布出图不一致。
- linear 两版在关键帧帧均取该点值，一致。

### 3. bezier 控制点字段无人维护、缺省三处不一｜实现错误（模式③⑥⑦）
- CP 写入端缺位：在 `src/components` 与 `src/lib/store` 全量 grep `bezierCP` **零命中**——没有任何 UI/store 给 node 轨点写 CP，字段只能来自导入文件；而 UI 提供 Bezier 选项（`src/components/pixel-editor/timeline/TimelineControls.tsx:284-296`），实际曲线恒由 A 版写死缺省决定。
- 缺省不一：A 版 cp1 取**前点** `bezierCP1 ?? {x:0.33,y:0}`、cp2 取**后点** `bezierCP2 ?? {x:0.66,y:1}`（`unified-render.ts:1408-1409`，取材点还左右不对称）；C 版缺省 (0.25,0.1)/(0.25,1.0)（`engine/interpolation.ts:36-37`）；B 版不用 CP。

### 4. setNodeFrameInterpolation 无撤销｜实现错误（弱）
`character-slice.ts:638-653` 函数体无 pushUndo，调用方 `Timeline.tsx:660-666` 也无——同组其他帧操作（增/删/复制/移动、附件轨）都有。插值模式改动不可 Ctrl+Z。

### 5. parentKeys 被帧级操作漏掉｜断裂
`character-slice.ts:218` ALL_TRACK_KEYS 不含 parentKeys，但时间线车道并集含它（`src/components/pixel-editor/timeline/NodeTrackLane.tsx:13`）。后果：删除某帧键删不掉该帧的 parentKeys 点、复制/移动也不带它，菱形仍显示该帧有键。parentKeys 自身链通：写 `src/lib/parent-switch.ts:54`、消费 `unified-render.ts:349-362` parentKeyAt。

### 6. 导入轨点无规范化｜未验证
两份活插值都不排序、都假设 keyframes 升序；A 版同帧重复点在 linear/bezier 分母为 0 → NaN（`:1397/:1403`），B 版有守卫。应用内写者全排序+按帧 upsert 故内部安全；导入路径（project-slice importProjectFile）未见轨点排序/去重规范化段——外部/旧文件乱序或重复轨点会静默算错，此段缺证据，标未验证。

---

## 二、轨迹（node.trajectory）

### 7. ★轨迹在主渲染与进包均无消费方｜断裂（本域最重）
- ①定义：`unified-types.ts:841-844`，注释明言「When present, renderer interpolates x/y from trajectory instead of tracks」。
- ②写入：手绘（§二-8）、制导（§二-9）两条生成链均正常写入 node.trajectory。
- ③④消费——**主渲染缺位（亲验）**：`src/lib/unified-render.ts` 全文 grep `traj` **零命中**；computeWorldTransforms → interpolateTransformImpl 只读 tracks（`:1271-1272`），主画布渲染走的正是这条（`src/components/pixel-editor/canvas/canvas-puppet-render.ts:330`）。**进包同样缺位（亲验）**：`src/lib/proc-runtime/convert.ts` 全文 `traj` 零命中，且无任何 warning 点名（与同文件对 stretch/scaleX 等通道缺口逐项点名的纪律 `convert.ts:1677-1696` 形成反差）→ 轨迹运动进包静默丢失（模式⑨）。
- 实际消费方只有辅助链：`puppet-keyframe-interpolation.ts:50-101` 的 interpolateSingleNode/interpolateNodeKeyframes（Timeline 加帧填充、tool-handlers 拖拽基准、PerformPanel 读数、recordFullPose 落轨、motion-guide 基准），以及蓝图 trajectory_source 节点（`src/lib/blueprint/eval.ts:2103-2113`，用户显式接线时把轨迹当 path 数据读，非位姿消费）。
- 后果：手绘/制导写下的轨迹在**主画布播放时节点不动、包内也不动**；面板读数却「看得见」轨迹——`PerformPanel.tsx:94`「与画布一致」注释与事实不符（模式⑩）；`unified-types.ts:843` 注释同。既有探针 verify-trajectory-bake / verify-motion-guide 都只经 interpolateNodeKeyframes 采样，测的是辅助消费方、不是出图对象（探针全绿与本断裂不冲突）。

### 8. 轨迹优先级与插值口径（仅对辅助实现成立）｜通（辅助链内）
`puppet-keyframe-interpolation.ts:50-101`：先算 tracks x/y 再被轨迹覆写（`:50-56`），定案「轨迹盖过轨道」在此实现内属实；空数组不覆写（故删除轨迹写 `trajectory: []` 生效，`StrokePanel.tsx:295,314`）；单点全程吸附该点；范围外两端 hold 端值；同帧重复点入段读第一点、出段读最后一点、恰帧取最后一点（`:88-96`）；轨迹插值带 Math.round（`:98-99`）。

### 9. 手绘轨迹工具链｜写入通、整链随 §二-7 断裂
- ①②③：工具注册 `tool-handlers.ts:2047`，handler 本体 `:1503-1565`；采样口径属实（`:1549-1550` numSamples = min(totalFrames, max(2, round(路径点数/3)))，路径点由 getLinePixels 逐像素补点故点数≈弧长）；帧号恒铺满 0..totalFrames-1（`:1557`），与绘制时当前帧无关（当前帧只作位姿基准）。
- ④烘焙换算：调共用函数 `bakeCanvasPointsToTrajectory`（`tool-handlers.ts:1556-1560`，定义在 motion-guide.ts，见 §二-10）。
- ⑤写入：`pushUndo('绘制节点轨迹') + updateUnifiedNode(..., {trajectory: points})`（`:1561-1562`）属实；守卫齐（路径<2 点、无选中节点均返回）。

### 10. motion-guide 制导生成｜生成链通、产物消费随 §二-7 断裂
- 共用烘焙换算属实：`src/lib/motion-guide.ts:256-275` bakeCanvasPointsToTrajectory（画布增量按父角逆旋转 R(−θ)、pxToSub 加基准帧插值 x/y 并取整），手绘 handler 真改调它——「共用同一份」的断言成立。
- 求解器与注释一致：turnTowardDeg 转率钳制 `:64-68`；捕获判定 `:196-205` 与文件头注释逐字对应；末段对准减速整形 `:165-166,209-214` 与注释一致；不可达返回明确错误（`:228-234`）；缎带扭转端点包络为 0（`:240-259`）。
- 校验齐全：generateGuidedTrajectory `:416-427`（节点/目标存在、目标非自身、帧数≥2、转向>0），标记存在经 `:358-367` 点名报错，StrokePanel 调用方再做一层 UI 校验后一步撤销写入（`StrokePanel.tsx:398-428`）。
- 一处口径注记（未验证）：捕获判定用全速 speed 而非末段整形后的 stepSpeed（判定在 `:197`、整形在 `:207` 之后），注释未区分「一步」指哪种步速，代码内无定案。

### 11. 轨迹烘焙为轨道｜实现通、「等价」前提不成立
`StrokePanel.tsx:233-268` bakeToTracks：同帧取最后一点（byFrame Map 覆写 `:251-253`）、逐点写 x/y 线性轨道、清 `trajectory: []`、一次 pushUndo + 一次写入（一步撤销）——定案逐项属实。细节：唯一帧点 <2 时静默 return（`:255`），无提示。但须点明：烘焙前后等价性只在辅助消费方成立；在主渲染里烘焙前轨迹不生效、烘焙后轨道生效——**烘焙实际是把轨迹救活成主画布可见运动的操作，不是等价变换**。

---

## 三、程序化条目

### 12. 条目凭自身生效、无修改器门控｜通
- ①定义：`src/lib/types.ts:1842-1851` ProceduralAnimation，五类 config 在 `:1796-1840`。②store：`src/lib/store/procedural-slice.ts:20,36,43,50,59`；存档往返 `project-slice.ts:175,371,602`（顶层 proceduralAnimations）。
- ③④消费：`unified-render.ts:3060-3086` 逐节点汇总增量图喂 computeWorldTransforms；`src/lib/engine/procedural.ts:190-193` computeProceduralPoseDelta 只查 enabled + 帧范围 + 命中，无任何修改器查找。全仓 grep `ineffectiveNote` 零命中；面板列表过滤（`ProceduralPanel.tsx:896-905`）同样无门控。

### 13. 精灵命中双通道、面板/渲染/进包三口径｜通
- 引擎：`procedural.ts:190-191` nodeId 命中，或 pa.spriteId 非空且等于调用方当次解析的精灵 id（双命中只计一次）。
- 渲染端精确口径：`unified-render.ts:3068-3075` 每节点按当帧方向 resolveSprite 取 id（无平面图回落堆叠中间层图 id），当前方向+当前服装集。
- 面板超集口径：`ProceduralPanel.tsx:875-905` 当前服装集 × 8 方向 + 堆叠层图并集——与渲染口径不同且各自正确（列条目求全、渲染求准）。
- 进包口径：`convert.ts:2325-2348` mountNodesOf 跨全部服装集×8 方向建挂载集合，包条目无方向/服装维度（`:252`），故包内宽于编辑器当前方向——convert 注释 `:2310-2320` 已自认此差异，属定案内差异、非静默断裂。

### 14. 五类取值：波浪/抖动/弹簧/噪声｜通
- 波浪/抖动：编辑器 `procedural.ts:28-60` 与包内 `proc-runtime/dynamic-src.ts:993-1018` dynProceduralValue 逐式同构；种子随机/噪声 hash 常量两端一致（LCG 1664525/1013904223 等）。
- 弹簧定案逐条对上：两端同式（`procedural.ts:45-49`、`dynamic-src.ts:1007-1011`）——lf=max(0, frame−startFrame) 起振、独立 amplitude（缺省 ?? 5、不迁移）、restLength 只作收敛常数偏移；面板缺省参数推导周期 2π/0.691 ≈ 9.09 帧、衰减到 5% 需 ln20/0.15 ≈ 19.97 帧，与定案「约 9 帧/约 20 帧」吻合。
- 噪声居中只在消费层：`procedural.ts:26` `(fbmNoise(...)*2-1)*amplitude`，包内同式；原语 `engine/noise.ts:52-63` fbmNoise 本体未动、输出 ∈[0,1)，其他消费方各自补偿不受影响。

### 15. 公式类型两端同规格｜通
- 编辑器 `src/lib/engine/formula.ts`：MAX_LENGTH=200（`:19`）、MAX_DEPTH=32（`:20`）、函数集（一元 sin/cos/tan/abs/sqrt/exp/log/floor/ceil/round + 二元 pow/min/max）、变量 f/F/p 与 pi、^ 右结合（parsePower 指数侧递归 parseUnary）、长度超限/解析错/非有限一律回 0（`:187-193`）。
- 包内第二份 `dynamic-src.ts:879-989` dynFormulaValue：函数表、深度钳、长度钳、^ 结合性、错误回落逐项相同；变量口径两端同源。面板校验直接调 validateFormula、小预览直接调引擎 computeProceduralValue（`ProceduralPanel.tsx:21-22`），无本地近似副本。
- 注：`src/lib/expression-parser.ts` 是**另一套**表达式规格（蓝图 expression 节点与旧动画处理器用，支持 `**`/三元/比较/任意 vars），与公式类型无关、不可互换——见 §八-30。

### 16. 增量落点：世界合成叠加、播放器传播、缩放不累乘｜通
- 编辑器：根节点合成 `unified-render.ts:567-587`（旋转 frame 左乘增量、缩放只乘自身量）；子节点 `:1143-1182`（增量叠在自身最终变换、缩放不读父 worldStretch → 不沿层级累乘，父已叠加的变换递归下传 → 整树跟随）；关节盘读同一张世界变换表（`:3563`）。
- 播放器：部件循环内汇总自身增量（`runtime-template.ts:5017-5027`，scale 只乘自身），循环后传播遍 `:5152-5170` dynPropagateProc 按父链刚体递推，其后才是钳制遍 `:5172`——「部件循环后、钳制遍前」成立。
- 烘焙 IK 交叉：computeWorldTransforms 第二遍同时带 bakedOverrides 与 procDeltas（`:631-636`），覆写只替换局部 angle/tilt、程序化 rotDeg 在其后的合成点才左乘进 frame——烘焙关节自身的程序化增量不被覆写掉，子节点继承保留。（此点修正旧记忆里「自身 rotDeg 会被覆写」的说法，以现代码为准。）

### 17. 面板目标节点推导｜通
`ProceduralPanel.tsx:844-870`：不用 selectedCharacterId（注释点名该字段几乎无人维护），以 activePuppetSkeletonId 命中角色为首选、再扫全部角色，找 nodes 实际包含 selectedNodeId 的角色定目标——画布/节点树/资产面板三路选择都只写 selectedNodeId，故都认得出。

### 18. 旧门控函数 applyProceduralAnimations 死代码残留｜断裂（死代码，模式④）
`procedural.ts:80-146` 仍是旧消费路：按 targetProperty 找**已启用的**修改器才落值（无修改器即丢弃）——正是已摘除的门控。但无活消费：仅 `engine/index.ts:41` 再导出、`scripts/verify-dcc-consumers.mts` 探针调用。活链不受影响；风险在未来有人误接此函数复活门控。
另：`unified-types.ts:1745-1770` NodeProceduralAnimation/ProceduralAnimationConfig 为零引用死类型声明（活类型在 types.ts:1842），仅声明残留、无第二份逻辑。

---

## 四、IK

### 19. 拖拽 IK 链｜通
- ①定义：`unified-types.ts:1255-1296` IKChain{rootNodeId,endNodeId,target（旧镜像）,target3D（求解唯一输入）,poleTarget3D?,targetBlueprint?,solver,bendDir?,tipLength?,enabled}；建链 `IKChainEditor.tsx:125-147`（缺省 enabled:false）。
- ②拖拽挂起：puppet 工具 mousedown 命中链末端时 suspendIKChain（`tool-handlers.ts:182-186`，状态集 `src/lib/ik-drag-state.ts`）；消费端真查标志：`unified-render.ts:638` 活链过滤 `c.enabled && !isIKChainSuspended(c.id)`（非模式①）。
- ③拖拽期间走 FK 写位姿关键帧（`tool-handlers.ts:416/426/509`）；④松手 `tool-handlers.ts:605-628` 遍历挂起链 → computeIKChainTip 算新尖端 → 写 target3D 与 target 镜像 → resumeIKChain。
- ik-tip：`src/lib/ik-tip.ts:34-81` 以 computeWorldTransforms 真管线算末关节位 + frame +Y 轴 × tipLength（解析与求解器同口径 resolveSpriteTipLength）；消费方为松手重算与 IKChainEditor 建链/捕获目标。
- 解算内部（真读）：solveChainIKOverrides（`unified-render.ts` 约 `:855-990`）按实际段数分流——2 段解析 2bone、3 段解析 3bone、4 段含尖端剥尖端 3 骨、其余/退化 FABRIK 40 次迭代，显式 solver='fabrik' 优先；结果经 deriveIKOverridesFromSolved 闭式反解为局部覆写，再整树重算 FK。

### 20. ★烘焙 IK 蓝图：骨长丢 Z｜实现错误（条件性，模式⑤）
- ①入口：`IKBakeButton.tsx:36-51` 克隆角色（链全 disabled、ikBlueprint:null 防接管）→ computeWorldTransforms 真世界变换 → ikChainsToBlueprint → 写回。
- ②骨长来源主点成立：`src/lib/blueprint/ik-bake.ts:55-63` 从传入的真世界变换关节点位量测，非静止帧直加——定案「真世界变换量测」成立。
- **但量法丢 Z（亲验）**：ik-bake.ts:58-63 骨长 = `Math.hypot(ΔworldX, ΔworldY)` 二维；而活求解与烘焙桥的段长都是三维 `Math.hypot(seg.x, seg.y, seg.z)`（`unified-render.ts:729,891`）。机制：链关节在 Z 向有分离（offset3D/tilt 姿态）时烘焙骨长系统性偏短 → 蓝图内 2D 解析按短骨长算角度、桥接端又用三维真长展开 solved 位置，两口径拼合后末端落点偏离目标。纯平面（z 恒 0）链逐值无差，故为条件性错误。
- ③④消费同路成立：有 ikBlueprint 时 solveBakedIKOverrides（`unified-render.ts:694` 起）与直解共用 deriveIKOverridesFromSolved 同一闭式反解 + 覆写整树重算（`:624-652`）——「覆写+整树重算同路径」定案成立。

### 21. IK 进包选项｜通
- ①定义/缺省：`editor-store.ts:139,353` exportBakeIk: 'drop'|'bake'，缺省 'drop'。②UI：`ExportDialog.tsx:1657-1666` 两档 Select，文案点明预览与导出共用。
- ③写者同字段：ExportDialog（`:1037,1060`）与 ProcPreview（`:63,76`）都读同一 exportBakeIk 传 `bake:{..., ik}`。
- ④convert 真消费：`convert.ts:781` 缺省 'drop'（=现行不进包）；'bake' 档在采样剥离克隆里保留 ikChains（`:1703`）让 computeWorldTransforms 同源求解烘进位姿曲线，含变量目标蓝图的链逐链点名警告（`:1708-1715`）；'drop' 档剥成 []。无定义了不消费的档位。

---

## 五、预设与节拍

### 22. 修改器预设 presets.ts｜断裂（整模块死代码，模式④）
- ①定义：`src/lib/presets.ts:10-20` ModifierPreset + localStorage 键。②写入函数 loadPresets/addPreset/removePreset 齐备（updatePreset/getPresetsByType 未导出且无人调用）。
- ③消费端不存在（亲验）：全仓 src+scripts 对 `lib/presets` 的 import **零命中**——无面板入口、无应用路径，整模块从未被读写。注意修改器面板里的「预设」是另一套链预设（`PuppetModifierPanel.tsx:266-285,407-429` + chain-presets），与 presets.ts 无关。

### 23. 节拍模板｜通
- ①清单：`src/lib/beat-templates.ts:63-158` 共 8 个（idle/walk 循环，其余一次性），每节拍 {key,name,weight,color}。
- ②应用：`AnimationClipPanel.tsx:311-333` 下拉+套用 → `dcc-pipeline-slice.ts:122-134` applyBeatTemplate 内存拼好一次写入，**替换**既有 frameTags 并同步 `clip.loop = template.loop`（一步、替换语义明示）。
- ③帧计算：`beat-templates.ts:163-214` beatFrameTags——含端点、每节拍保底 1 帧 + 最大余数法按权重分配、帧少于节拍数时按权重取舍、cursor 连续推进无缝覆盖整窗（算法本体亲读无誤）。
- ④消费：时间轴标签条渲染（`Timeline.tsx:719,751` → `TrackLanesColumn.tsx:102-105`）、DCC 面板可改名/改界/删（`DccPipelinePanel.tsx:269-304`）、getFrameTagsAtFrame 按帧查询（`dcc-pipeline-slice.ts:115-116`）。
- ⑤存档：frameTags 为 AnimationClip 字段随片段序列化往返。但**进包断裂**见 §七-27。
- 未验证子项：tag 级 `loop` 字段除写入与 DCC 编辑外未找到按它分支的消费端。

---

## 六、步态（两套并存，语义不同，须分开判）

### 24. 蓝图/修改器 gait 节点｜链通，但机制是时间开环、非足目标钉地
- ①定义：蓝图节点 `blueprint/specs.ts:237-241`；修改器同参同缺省 `types.ts:2378-2395`（period 0.4s/stride 20/lift 12/stanceRatio 0.6）。②修改器→蓝图迁移接线 `blueprint/migrate.ts:274-280`；IK 目标可由 gait 驱动（ik-bake 保留 target 输入）。
- ③消费三路共用同一纯函数、无漂移：蓝图 eval（`eval.ts:876-908`）、实时 handler、烘焙 handler 均调 computeGaitTransform（`engine/modifier-renderers/shared-helpers.ts:657`）；缺省两端一致。
- ④内部（真读）：`shared-helpers.ts:717-799`——支撑相脚沿弦线性移、摆动相按 style 弧线；**相位由时间推进**（(t%period)/period），不读身体位移、无世界锚点记录。足目标只是髋局部轨迹，钉地仅在速度恰匹配 stride/period 时涌现。接 ik_2bone 作足目标的形态存在（ik-gait-test.ts），同属开环。
- ⑤进包：gait 在 convert 是 'sample' 方言（采样烘焙），口径自洽。
- 附带：`ik-gait-test.ts:31` 仍传 `period: 24`（帧制旧口径），eval 现按秒解释，该脚本只断言 isFinite，其输出已不可作步态幅度证据（陈旧探针）。

### 25. 包内播放器兜底步态 FB（定案本体）｜通，逐条对上
`proc-runtime/runtime-template.ts` runFallbackPass——先说清门控：`:2975-2976` 需 ≥2 腿链、无同名 walk/jump 表演、腿非行为图驱动，是「兜底」定位、非无条件生效。
- 足目标驱动：相位只由实际位移推进（横版 `:3141` fbPhase += π·dxF·faceF/stride；俯视 `:3318` 按 dist/cycTop），静止相位不走——非开环正弦 ✓。
- 支撑钉地：开步把脚锚在世界点 fbPlants、其后脚位=锚点−char.x（身体越过脚不动，`:3178-3180`；俯视平面同法 `:3361-3368`）；站高由钉地+腿长反推（`:3181-3187`）✓。
- 摆动弧线：从上帧脚尖 smoothstep 送至链根+前伸位、抛物线抬高（`:3191-3194`）；俯视外弧 bow（`:3384-3385`）✓。解算回写 fbSolveChain/fbWriteChain 两骨写 pose（`:2866-2887,3237-3240`）。
- 跳跃四段：阶段机 `:3033-3117`——下蹲与蹬伸是同一 crouch 段的两段曲线（u<FB_EXT_U 缓出压深、其后过冲伸展，按各链可达域钳制）、腾空上升收腿 0.55 倍/下落伸腿（`:3159-3173`）、落地吸收 0.18s/0.6 倍深（`:3113-3117`）。机制齐备，与定案四段对应（下蹲/伸展同 stage 两曲线，非两独立 stage）。
- 顶视双模式：`:3310` 按 |dir.y|≥|dir.x| 分流并平滑混合（`:3439-3445`），相位共用不重置；横向=平面足目标步态；纵向=走廊驱动 fbCorridorGeom/fbCorridorChain（`:2801-2858`）——每关节 = 根 + 静止垂距向量（恒定）+ 沿自身静止轴按同比 k 滑动/伸缩，垂向分量构造上不变、膝无横向自由度 ✓；走廊支撑锚定 `:3396-3426`。
- 结论：定案（足目标/钉地/跳跃四段/顶视双模式）只存在于这套包内兜底 FB；与 §六-24 的编辑器 gait 是两套并存、语义不同的步态（模式⑤），汇报与验收不可混称。

---

## 七、片段（AnimationClip）

### 26. 片段 CRUD 与存档｜写入通，两处缺陷
- ①定义在 `src/lib/types.ts:801-846`（不在 unified-types）：AnimationClip{id,name,puppetCharacterId,startFrame,endFrame,loop,stateKeyframes?,slashEffect?,slashDefId?,effectTracks,canvasModifierTracks,笔触,tags,events?,frameTags?,hitboxMap?}。
- ②面板 `AnimationClipPanel.tsx:20-89` 建/切换/删/改名/改窗；store `project-slice.ts:723-780` add（pushUndo、窗缺省 [0,totalFrames-1]、设 active）/remove（active 回落首个）/update/setActive（校验 id 存在）。⑤存档往返 `project-slice.ts:169,342,398-467,598` 齐备。
- **缺陷一（断裂，静默丢数据，亲验）**：复制片段 `AnimationClipPanel.tsx:70-89` handleDuplicateClip 逐项克隆十余个字段，**唯独漏 slashEffect 与 slashDefId**（也漏 thumbnail）——复制出的片段刀光静默丢失、无提示。
- **缺陷二（实现弱点）**：`project-slice.ts:764-774` updateAnimationClip 本身不 pushUndo（add/remove 都压），面板改名/改窗/改循环/刀光绑定均直调它且不补压——这些编辑不可撤销。

### 27. 片段消费：状态/刀光通，帧窗与循环在调度层断裂｜断裂（模式①，亲验）
- 姿态不走片段：节点轨以工程绝对帧插值（`puppet-keyframe-interpolation.ts:194`，无 clip 参数）——片段只是窗+状态+刀光+事件的段描述，同角色多片段共用同一套节点轨，此为模型本身。
- 状态轨/刀光门控正确：`unified-render.ts:2349-2385` pickClipStateKeyframes/pickSlashClip 须 active 片段、归属相符、帧在 [startFrame,endFrame] 内才生效；状态轨求值 `resolveTrackCostumeState:2294-2315` 增量应用、再叠状态蓝图。
- **帧窗/loop 无消费（亲验）**：`src/lib/playback-scheduler.ts` 全文不读 animationClips/activeClip（grep 零命中），推进只有 `nextFrame >= totalFrames ? nextFrame % totalFrames : nextFrame`（`:78`）。后果：loop:false 的片段播到工程末尾照样绕回；片段窗外照常播放（姿态轨不被窗门控）；播放起点恒 0 而非 startFrame。PerformPanel 显示口径与之打架：`PerformPanel.tsx:126-127` totalFrames 取 clip.endFrame+1 仅供显示与回零判断，调度器不认。
- **片段级 fx 编辑器不消费**：PixelCanvas 传 renderUnified 的是工程级 effectTracks/canvasModifierTracks/笔触（`PixelCanvas.tsx:293`），clip 级 fx 只在 convert 进段表演（`convert.ts:1499-1516`）——编辑器预览看不到片段级 fx，预览/进包不一致。
- **frameTags 不进包且无点名（模式⑩）**：convert.ts 全文零 `frameTags`——节拍模板与 DCC 页签写进 clip 的帧标签既不进包也无 warning；clip.description/tags/thumbnail 同样静默不进包（性质较轻）。events 的窗外/inactive 过滤有点名缺失（过滤本身合理）。

### 28. clip-migration｜通（幂等成立），注释一处不符
- 触发唯一处：导入工程时 `project-slice.ts:461-467` 无条件调用 migrateClipStructure——**无版本标记门控**（同文件 timeUnits/slashCenter/pattern 等迁移都查标记），靠自身幂等。
- 内容：归属补绑（`clip-migration.ts:159-168`）、时间窗规范化（`:171-181`）、关键帧迁轨（`:93-150`：仅**主片段**的 modifiers/faceTurn/zIndex 三类经 upsertPoint 写进节点 tracks.modifierKeys/faceTurnKeys/zIndex）、删幻影字段（`:152-155`）；姿态值明确不迁（渲染从未读片段姿态，文件头理由成立）。
- 迁后消费真存在：modifierKeys/faceTurnKeys 被插值读（`puppet-keyframe-interpolation.ts:354-378`）、zIndex 走 step 插值——非迁了没人读。
- 幂等（构造推导）：重跑时源字段已删、归属已合法、窗已为 number，upsertPoint 同帧同值覆盖，结果不变。非主片段的同类数据不迁、逐片段计数进 report.dropped（`:184-192`），report 仅 console.warn、无 UI 呈现。
- 注释不符：文件头 `:25-26` 称「已是新形状的片段跳过」，代码无显式 skip 分支，是逐字段幂等而非跳过——措辞问题、非行为缺陷。附带陈旧注释：`clone-transpose.ts:14` 仍称复制 clip nodeKeyframes，实际全仓除 migration 外该字段零读者。

---

## 八、表演（ProcPerformance）与操控

### 29. ProcPerformance 编排写入｜通（注意面板归属）
- ProcPerformance 的编辑器是 **BehaviorPanel**，不是 PerformPanel（后者是操控会话面板，两者都审了）。
- ①定义：`unified-types.ts:1152-1180` ProcPerformance{id,name,trigger,duration,envelopeIn/Out,mode,maskNodeIds,graphs,afterimageNodeId?,slashEffect?,slashDefId?,enabled}，挂 Character.performances（`:1452-1453`）。
- ②写入：`BehaviorPanel.tsx:53,65-70` patchPerf（pushUndo 后手术式替换 performances 数组）、新增 `:178-184`、删 `:206-215`（被状态机引用时 confirm 点名）、字段编辑与每节点表演图 `:219-373`、刀光绑定/解绑同片段口径。⑤随 Character 往返。

### 30. ProcPerformance 编辑器播放不求值｜断裂（已明示的设计边界）
- `BehaviorPanel.tsx:8-11,76-80` 面板文案明说：表演是有限时长、**导出时采样烘焙**；行为图主画布播放生效、表演不。
- 全仓核查：unified-render 对 performances 零引用；主画布求值层只有行为图（`unified-render.ts:207-224,556` evaluateBehaviorTransforms 读 behaviorGraphs、vars 来自输入轨采样）。即编辑器播放时 ProcPerformance 的表演图/包络/掩码/表演刀光完全不参与，用户只能去 ProcPreview/导出包看——链是断的，但断点在产品内有明示，不属静默断裂。
- 与片段的关系：共用工程绝对帧轴与同一套 node.tracks、不另存姿态，不冲突也不相交；包内片段被另烘成段表演与 ProcPerformance 并列，运行时仲裁属域 7。

### 31. PerformPanel 操控会话｜写入通，一处口径分叉
- 链：会话状态 `puppet-session-store.ts:12-60`（纯 UI 不进工程）；enterPerform → ensurePuppetClip 把该角色第一个片段设 active（`:88-127`）；录姿 recordFullPose/clearFramePose（`:140-227`，以 interpolateNodeKeyframes 取当前可见姿态整表写/删 node.tracks）、tilt 与图层写入均落 node.tracks；面板读数与画布同源（interpolateNodeKeyframes）。
- **分叉（模式③）**：`PerformPanel.tsx:89-95,183-189` 的当前片段解析带回落——active 片段不属于操控角色时回落到该角色第一个片段并标注「实际片段：X（已回落）」；但渲染端 pickClipStateKeyframes/pickSlashClip **无此回落**（归属不符直接 undefined）。即面板声称的「实际片段」其状态键/刀光在画布上并不生效。enterPerform 会纠正 active，故分叉只在进入操控后又切到他角色片段时出现。

### 32. 表演 convert 交接与警告一致性｜基本一致，两处例外
- 链：`convert.ts:1410-1470` 逐表演翻译——掩码节点不存在/掩码内无图/翻译失败/无贡献/含 unsupported 节点/残影解析不到/slashDefId 悬空/触发键回落 KeyJ，均分别点名；进包字段齐（trigger/triggerKey/duration/envelope/mode/mask/afterimage/slash/graph）。
- 例外一（没说却丢，轻）：`convert.ts:1412` enabled:false 的表演静默跳过、零 warning，与同文件其余丢弃皆点名的口径不一致。
- 例外二核过为一致：cueTrack 事件不进包有明确 warning（`convert.ts:810-815`，与实际丢弃一致）；编辑器侧消费链另行成立（PixelCanvas 发布 cueEventsAt → scheduler observe 定格）。附带：inputTracks 同样不进包且无独立点名，仅借该警告一句带过。

---

## 九、刀光（slash）

### 33. 共享定义 + 活引用唯一口径｜通
- ①定义：`unified-types.ts:1144` SlashDefinition{id,name,spec}，角色级 character.slashDefs（`:1455`）；片段/表演 slashDefId 字段（`types.ts:825`、`unified-types.ts:1177`）。
- ②写入：绑定写 slashDefId 并清私有字段（`AnimationClipPanel.tsx:368`、`BehaviorPanel.tsx:263`）；编辑定义时面板直写 defs 数组、value=解引用后的 def.spec——改一处全引用处生效。
- ③④解引用唯一口径：片段 `src/lib/slash-defs.ts:40-46` resolveClipSlash（绑定→def.spec、悬空→undefined、未绑定→私有字段）；表演 resolvePerfSlash 在 `src/lib/blueprint/slash-sync.ts:216-235`（defs 确为第三参）。全仓 slashEffect 直读点已枚举：仅两面板编辑路径、两解析函数、迁移函数——无第二生效口径。
- ⑤消费：编辑器片段预览 `unified-render.ts:3532`、convert 表演 `convert.ts:1461`、片段 `convert.ts:2190,2234` 均经同一解析。

### 34. 解绑 = 物化｜通
cloneSlashSpec（`slash-defs.ts:49-51`，spread + colors 数组复制，spec 其余全标量、等效深拷贝）；片段解绑写回私有并清 id（`AnimationClipPanel.tsx:370-374`）、表演同法（`BehaviorPanel.tsx:264-267`）；图节点写回规格形态经 performances 变更触发同步（`character-slice.ts:310-313` → slash-sync syncPerfSlash 以 slashNodeForSpec 替换节点 params）。解绑前后解析逐项一致有探针旁证（verify-slash-shared-def）且构造上成立。

### 35. 删定义预防 + 悬空点名｜通，一处点名缺口
- 计数 countSlashDefRefs（`slash-defs.ts:56-70`，本角色表演 + 归属片段——亲读与定案一致）；编辑面 n>0 时删除按钮 disabled 且 title 点名（`SlashEffectEditor.tsx:258-275`），两面板同口径算 refCounts。悬空解析不回落私有字段（slash-defs.ts:44、slash-sync.ts:222-227 均返回 undefined）；编辑面悬空有点名 + 清除引用 UI。
- convert 点名：表演 `convert.ts:1438-1440`、片段 `convert.ts:1667-1672`（逐片段去重）。
- **缺口（亲验）**：convert 表演点名只查 `perf.slashDefId` **字段**（`:1438`）；若悬空来自图内引用形态节点（__defId 指向不存在的定义）而字段为空（手改图/外部数据），resolvePerfSlash 静默返回 undefined、slashForPkg(undefined) 无警告——此形态下点名断裂。

### 36. ★引用形态节点 + 同步通；接线覆盖生产零消费｜断裂（模式⑦⑩）
- 引用形态：`slash-sync.ts:44-53` slashRefNodeForDef 的 params 仅 {enabled, __defId}；syncPerfSlash 绑定分支（`:278-303`）只维护引用、同 id 时 params 相等早返回——定义内容变化不经同步（活引用本色）✓。
- convert 解引用（亲验）：`convert.ts:1461` resolvePerfSlash(perf, **undefined**, character.slashDefs) 先解引用再 slashForPkg；翻译前摘刀光节点（`:1421-1427`）。
- **断裂**：接线覆盖 applySlashWiring（`slash-sync.ts:187-213`，含 gate<0.5 关闭）在调用方传 evalNodeOutput 时才生效；生产代码唯一调用方 convert 明示传 undefined（静态进包口径），编辑器主画布根本不渲染表演刀光——全仓真传求值回调的只有两支探针。即 specs.ts:31-42 宣称 slash_fan 参数「可接线覆盖」，但产品内零生效路径（模式⑩标签/宣称与实况不符）。

### 37. 中心语义 + 扫向双端对齐｜通
- 语义：`src/lib/slash-fan.ts:42-55,141-200` cx/cy = 椭圆中心相对锚点偏移、plug 恒为锚点定格位（layout 中 plug=−ox/−oy、生成时中心=plug+(cx,cy)）；编辑器绘制以 plug 钉定格位（`unified-render.ts:3675-3688`）；面板标注相对锚点、预览画锚点十字（`SlashEffectEditor.tsx:52-66,298-299`）。
- 扫向：`slash-fan.ts:225-228` rel=dirSign·(t−a0) 带符号角距、头部恒领先，逆时针为真反向行进非静态镜像；面板缺省口径 dir===−1 才 −1（与两端一致）。
- 双端逐式一致：包内孪生 `runtime-template.ts:643-760` 与编辑器 slash-fan 同式同常数（辉光 1.22、head/tail 平滑曲线、inRange 带符号角距、镜像整帧翻转）；convert 出包仅 dir=−1 落字段（`convert.ts:1366`），两端缺省同为顺时针——无缺省分歧（非模式⑥）。

### 38. slashCenterVersion 迁移｜通
- 门控 + 时序：`project-slice.ts:493-502` `slashCenterVersion !== 1` 才迁，且排在刀光蓝图同步（`:525-529`）之前；新工程缺省即 1（`:38`）、序列化带标记（`:182,349`）、提交落标记（`:610`）。
- 覆盖面：`slash-sync.ts:365-396` migrateSlashCenterOffsets 覆盖共享定义 spec、表演 slashEffect 字段、表演图规格形态节点 params（引用形态节点跳过 `:384-385`）、片段 slashEffect；**历史快照同门控**：`project-slice.ts:546-567` 对 file.history 每条快照一并迁。
- 归零保真：fixSpec（`slash-sync.ts:373-377`）把 cx/cy 非零置 0（旧语义渲染偏移恒 0 故保真）。幂等双重成立：标记=1 整段跳过；且 fixSpec 对已 0 值不改不计、重入无副作用。
- 未验证小项：autosave/OPFS 恢复路径是否同走这条 importProject 规范化链，本次未追。

---

## 十、脚本与分析面板

### 39. ScriptPanel 脚本模板｜通（定案「真写关键帧」成立）
- 执行链：模板表 `ScriptPanel.tsx:12-117`（4 个）；运行 `runScript:180-239` 先 pushUndo('执行脚本') 一笔（整段一步撤销）→ pluginManager.executeScript（`plugin-manager.ts:314-336`，new Function 沙箱，文件头自认非安全沙箱）→ api 落点 `plugin-api.ts:97-131` addNodeKeyframe 真写 node.tracks 通道点（同帧覆盖、排序；modifiers/faceTurn/zIndex 分走附件轨 setter）。
- 逐模板：batch-keyframes 真写（每角色×片段×节点每 4 帧写静止姿态键；注意同一节点轨被每片段重复写同值、日志计数按片段重复累计——文案数字大于实际新增键数，瑕疵非假写）；random-rotation 真写（第一个片段每 8 帧随机 angle 键 + 末帧归 0）；node-report/export-report 为只读报告类，与标签相符、非空转。历史（localStorage 上限 20）与清输出按钮均属实。

### 40. csv-waveform｜断裂（入口缺失，模式④⑦）
- 产出定义 `src/lib/csv-waveform.ts:12-24` parseCSVWaveform；**写入路径断裂（亲验）**：全仓 parseCSVWaveform 除定义外零调用——没有任何 CSV 导入 UI 把文本变数组。
- 消费端只剩采样一半：sampleWaveformAtFrame（`:37-49`）被 `engine/animation-handlers/bake-transform-handlers.ts:195-199` 真读（wave 修饰器 mod.params.csvWaveform 为数组时驱动 translateX）——但 csvWaveform 参数全仓无 UI 写入，只能靠手改数据/脚本塞入（参数无正常生产端）。
- 死代码：`engine/param-driver.ts:24` 对 sampleWaveformAtFrame 是死导入（全文仅此 1 处、从未调用）；csv-waveform.ts:58-67 sampleWaveformScaled 未 export 且零调用。附带：parseCSVWaveform:20 先取绝对值再钳 [0,1]，负值变正而非钳 0，与注释口径不一（无调用方、实际影响为零）。

### 41. expression-parser 与公式类型的关系｜双规格分叉（模式⑤，非同一功能双实现）
- 程序化「公式」类型的活链不是本文件：是 engine/formula.ts（见 §三-15）。expression-parser.ts 的真实消费者是蓝图 expression 节点（`blueprint/eval.ts:909-938`，vars 含 t/period/phase/amplitude、fps/totalFrames 写死 24）与旧动画处理器三处（bake/realtime/global-transform-handlers 的 expressionX/Y/… 参数）——均为活链。
- 规格不可互换：expression-parser 支持 `**`、三元、比较/逻辑、`%`、clamp/lerp、任意 vars，兜底口径逐运算（除零→0、未知变量抛 ParseError）；formula.ts 只认 `^`、仅 f/F/p/pi、未知标识符整式回 0。用户在两处 UI 互抄表达式会静默失效——规格分叉风险。
- 死代码：`expression-parser.ts:430` validateExpression 未 export、外部零调用（同名需求由 formula.ts 的 validateFormula 承担）。

### 42. motion-analysis｜断裂（整条功能用户不可达，模式④⑦）
- 算法本体在 `src/lib/motion-analysis.ts:340-375`（块匹配运动场 → 累积 → 区域生长聚类），store 动作在 `project-slice.ts:651-682` motionAnalysisSplit（pushUndo 后跑分析、逐 region 裁像素建精灵）。
- **入口断裂（亲验）**：全仓 `.tsx` 中 motionAnalysisSplit **零调用**——没有分析面板/按钮/对话框调用它，整条功能用户不可达。
- 产出无人消费：即便经 store 动作调用，result.motionField、region.avgMotion、region.color 在动作内完全未被使用（只用 bounds/pixels/pivot/id）；生成的精灵不挂任何节点/服装件、散落全局精灵表。
- 双实现：`motion-analysis.ts:326-338` imageDataToPixelGrid 与 `engine/utils.ts:83` 同名同功能并存，本文件的这份零调用（活的是 engine/utils 那份，模式⑤）。

---

## 断裂清单（编号供汇总引用）

| 编号 | 项 | 证据 |
|---|---|---|
| D4-B1 | **node.trajectory 主渲染与进包均无消费方**：手绘/制导产物在主画布不动、包内不动且无点名警告；仅辅助链与蓝图 trajectory_source 读 | unified-render.ts / convert.ts 全文 `traj` 零命中（亲验）；消费仅 puppet-keyframe-interpolation.ts:50-101、blueprint/eval.ts:2113 |
| D4-B2 | 播放调度不读片段窗/loop：loop:false 照样绕圈、窗外照常播、起点恒 0 | playback-scheduler.ts:78 只按工程 totalFrames 取模（亲验，全文不读 animationClips） |
| D4-B3 | 片段级 fx 编辑器不消费：预览与进包不一致 | PixelCanvas.tsx:293 只传工程级 fx；clip fx 仅 convert.ts:1499-1516 进包 |
| D4-B4 | clip.frameTags 不进包且无点名（节拍/DCC 写入端齐全） | convert.ts 全文零 frameTags |
| D4-B5 | 复制片段漏 slashEffect/slashDefId（+thumbnail），刀光静默丢失 | AnimationClipPanel.tsx:70-89 字段表（亲验） |
| D4-B6 | PerformPanel「实际片段（已回落）」与渲染门控不一致：面板回落、渲染不回落 | PerformPanel.tsx:89-95,183-189 vs unified-render.ts:2349-2385 |
| D4-B7 | ProcPerformance 编辑器播放不求值（面板已明示的设计边界，非静默） | BehaviorPanel.tsx:8-11,76-80；unified-render 只消费 behaviorGraphs |
| D4-B8 | 刀光表演图接线覆盖生产零消费：convert 传 undefined、编辑器不渲染表演刀光，仅探针传回调；specs 宣称「可接线覆盖」与实况不符 | convert.ts:1461（亲验）；slash-sync.ts:187-213；specs.ts:31-42 |
| D4-B9 | 刀光图内引用悬空（字段为空时）convert 静默丢弃、无点名 | convert.ts:1438 只查 perf.slashDefId 字段（亲验） |
| D4-B10 | parentKeys 被帧级删除/复制/移动漏掉 | character-slice.ts:218 ALL_TRACK_KEYS vs NodeTrackLane.tsx:13 |
| D4-B11 | presets.ts 修改器预设整模块无 import、无入口 | 全仓 import 零命中（亲验） |
| D4-B12 | csv-waveform 的 CSV 导入端缺失：parseCSVWaveform 零调用、csvWaveform 参数无 UI 生产端 | csv-waveform.ts:12（亲验）；消费仅 bake-transform-handlers.ts:195-199 |
| D4-B13 | motion-analysis 整条功能无 UI 入口：motionAnalysisSplit 零 .tsx 调用，产出字段算后不用 | project-slice.ts:651-682；.tsx 零调用（亲验） |
| D4-B14 | applyProceduralAnimations 旧门控函数死代码残留（活链不受影响，误接即复活门控） | procedural.ts:80-146；仅 engine/index.ts:41 再导出 |

## 实现错误清单

| 编号 | 项 | 证据/机制 |
|---|---|---|
| D4-E1 | 主渲染 interpolateTrack 的 step 在关键帧帧取旧值、晚一帧切换；辅助版同帧取新值——错的是出图的那份 | unified-render.ts:1387-1394（亲验）；behavior-host.ts:25-28 注释自称「怪癖」 |
| D4-E2 | 辅助版 interpolateTrack 的 bezier 未实现、等同 linear，与主渲染真 bezier 不一致 | puppet-keyframe-interpolation.ts:32-33（亲验） |
| D4-E3 | bezier CP 无任何写者（字段无人维护）、缺省三处不一且 A 版 cp1/cp2 取材点左右不对称 | components/store 全量 grep bezierCP 零命中；unified-render.ts:1408-1409 vs interpolation.ts:36-37 |
| D4-E4 | 烘焙 IK 骨长丢 Z：ik-bake 用二维 hypot、活求解/桥接用三维，Z 分离链烘焙骨长系统性偏短、末端落点偏 | ik-bake.ts:58-63 vs unified-render.ts:729,891（亲验）；纯平面链无差 |
| D4-E5 | setNodeFrameInterpolation 无 pushUndo，插值改动不可撤销 | character-slice.ts:638-653 |
| D4-E6 | updateAnimationClip 无 pushUndo，片段改名/改窗/改循环/绑定不可撤销 | project-slice.ts:764-774 |
| D4-E7 | enabled:false 的表演 convert 静默跳过，与其余丢弃皆点名的口径不一致（轻） | convert.ts:1412 |

## 未验证清单

| 编号 | 项 | 缺口 |
|---|---|---|
| D4-U1 | 导入文件轨点乱序/同帧重复：两份活插值不排序、A 版重复帧可出 NaN，导入路径未见规范化段 | 导入规范化段未读到证据；应用内写者全排序故内部安全 |
| D4-U2 | 制导捕获判定的「一步」用全速而非整形步速，与注释对应关系无代码内定案 | motion-guide.ts:197 vs :207 |
| D4-U3 | 辅助版 x/y 无轨缺省 0 vs 主渲染回落 base.x/base.y 的口径差 | 未找到实际发散证据 |
| D4-U4 | FrameTag 的 tag 级 loop 字段下游消费 | 除写入与 DCC 编辑外未找到按它分支的消费端 |
| D4-U5 | autosave/OPFS 恢复是否同走 slashCenterVersion 门控的导入规范化链 | 本次未追该路径 |
| D4-U6 | 包内片段段表演与 ProcPerformance 表演的运行时仲裁 | 属域 7，本域只核到 convert 交接面无去重/优先级字段 |

## 判定为通的（汇总）
节点 tracks 写入路径与存档往返；轨迹辅助链内的优先级/钳制/同帧口径；手绘采样与烘焙换算；制导求解/校验/共用换算；轨迹烘焙为轨道的机制本身；进包 tracks 采样（通道缺口有点名）；程序化条目生效/双通道命中/三口径分工/弹簧/噪声/公式两端/增量落点/面板目标推导；拖拽 IK 全链；IK 进包选项；节拍模板应用与帧分配；包内兜底步态 FB 逐条对定案；片段 CRUD/状态轨/刀光门控/clip-migration 幂等；表演编排写入与 convert 警告（除 D4-E7）；操控会话写入；刀光共享定义/解绑物化/删定义预防/中心语义/扫向双端/slashCenterVersion 迁移；ScriptPanel 四模板；cueTrack 编辑器消费与 convert 点名一致。
