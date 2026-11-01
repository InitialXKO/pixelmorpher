# DOMAIN-5 模式库、蓝图与行为（只读审计，基点 audit/full-system == main 3a4a55c）

判定四态：通／断裂／实现错误／未验证。五段：①入口/数据定义 ②store/写入 ③消费端调用 ④消费端内部判断 ⑤存档/进包往返。
普查方法：参数键集以接口大括号配平提取（`DynamicPatternParams` 共 153 键，含 2 个可选键 glowMask/glowShapeKernel），逐键在全仓 src 内查消费点；段级双实现逐式读码比对；探针只作回归证据、不作正确性头条。

---

## 1. 动态模式参数总表与消费普查（故障模式⑦⑥）

- ①定义：`src/lib/dynamic-patterns.ts:15` `DynamicPatternParams` 153 键；数值滑杆表 `DYNAMIC_PARAM_DEFS`（:1841）92 条，键集 ⊆ 接口（脚本核对，无越界）；余 61 键为布尔/字符串/枚举，由编辑器勾选/下拉/取色控件承载。
- ②缺省：`defaultDynamicParams()`（:311）覆盖全部 153 键、无多余键（脚本逐键核对）；`normalizeDynamicParams`（:354 起）对枚举逐个白名单校验、对数值逐个钳制，钳制界与 DEFS 的 min/max 逐项一致（抽查 arcTilt [0.16,1] :452 ↔ DEFS :1867；arcFanDeg [10,300] :453 ↔ :1868；hostFx 全组 :459-476）。
- ⑦普查结论：**153 个参数全部在 dynamic-patterns.ts 之外至少有一个消费点，无一无消费**（含 follow*/glow* 这类包侧按名零命中者——实际经 convert 烘焙后消费，见 §4.5/§4.6，不是死参数）。
- **判定：通**。

## 2. 图案解析与挂载链

- 链：①实例 `DynamicPatternInstance{patternRef?, overrides?, params}`（dynamic-patterns.ts:295-305），挂载两处：节点 `node.dynamicPatterns`、服装件 `piece.dynamicPatterns` → ②编辑写：RigPanel 节点挂载（`RigPanel.tsx:689-700`）、ParametricAppearanceEditor 件挂载（:112），均经 `onChange → onUpdate/writeDynamic → updateUnifiedCharacterById` 落 store，写后触发蓝图同步（§3）；DynamicPatternEditor 的 patchParam 对库引用实例记 overrides 并重展开、展开失败才直改快照（`DynamicPatternEditor.tsx:124-136`，注释明示）→ ③消费：`resolveDynamicPatterns`（dynamic-patterns.ts:497-498 内含 norm）做双挂载合并（节点为底、件同效果位替换/压制），unified-render 与 convert 共用同一解析 → ④合并口径三处一致：编辑器渲染、面板 glow 排名（glowRankByInstanceId）、进包 dynFor（convert.ts:598-625，其输入已经过解析层规范化）→ ⑤实例随角色整表存档；进包时库引用按钉版本权威重展开，失败点名不静默（convert.ts:586-597 注释与实现）。
- **判定：通**。

## 3. pattern-sync 手术式同步（蓝图铁律核对）

- 链：①触发：character-slice 在角色写入路径调 `syncCharacterPatternBlueprints`（character-slice.ts:308、:491），载入迁移亦调（project-slice.ts:509）→ ②`syncPatternNodes`（pattern-sync.ts）只替换 dyn 节点的 params（`{...n, params}`，保留 inputs/ui/位置）、删除不在 desired 的 dyn 节点、新节点插到 'screen' 节点前，其余节点对象不动 → ③desired 来源：`collectDesiredPatterns` 列表优先 + 图内独有实例并入 → ④`extractPatternInstances`：gate 接线 <0.5 → enabled=false、数值接线覆盖参数后再 normalize（pattern-sync.ts:89）→ ⑤往返：列表↔图双向以 dynNodeId 对齐。
- 附带核对：全仓 `modifiersToBlueprint` 调用点均为读侧回落（`blueprint ?? modifiersToBlueprint(...)`：GlobalModifierPanel.tsx:291、PuppetModifierPanel.tsx:128、use-blueprint-preview-data.ts:76、pattern-sync.ts:193/294），**不存在用它全量重建覆盖用户图的写路径**，与「手术式更新」铁律合。
- 潜伏项：`dynNodeId = dyn_${id.replace(/-/g,'').slice(0,16)}`（pattern-sync.ts:34-36）截断 16 字符，两个实例 id 前 16 字符相同会撞同一图节点——理论碰撞面，无实证触发，记未验证清单。
- **判定：通（碰撞为潜伏未验证）**。

## 4. 各模式段双实现核对（故障模式⑤，本域重灾区逐段过）

### 4.1 形变 / 自转 / 环绕

- 形变：编辑器 `dynamicDeformAt` 与包内 `dynDeformAt`（dynamic-src.ts）同式（sin 相位、sx/sy 乘积），两端均内查 deformEnabled。编辑器侧 dynSx/dynSy 跨实例累乘（unified-render.ts:3335-3343）喂 dynScale（:3499-3500）。
- 自转：`spinAngleDegAt`（dynamic-patterns.ts:896-899，内查 spinEnabled）⇔ `dynSpinRadAt`（dynamic-src.ts:79-82，同查同式，度→弧度在包侧）。
- 环绕：`orbitPointsAt`（dynamic-patterns.ts:542-558）⇔ `dynOrbitPoints`（dynamic-src.ts:456-469）逐式同（world 空间反旋 counter 同），包侧多 `|| 0` 防御、编辑器靠 normalize 保证数值——等价。
- **判定：通**。

### 4.2 置换段（含方向标记绑定）

- 链：编辑器 unified-render.ts:4548-4563 取「第一个 displaceEnabled && displaceAmp>0」实例（故障模式①：标志与幅值都查），displaceDirMark 命中时以 `markDirAngleDeg` 覆盖 displaceDeg 后调 displacePixelGrid → 包侧 `displaceOfRt`（runtime-template.ts:388-415）同口径取第一个、标记解析逐式同（direction 直取、vector 按像素分量 atan2、y 向下，与 sprite-marks.ts:169-181 同），场函数 `dynDisplaceSrcMap`（dynamic-src.ts:51-77）与编辑器同源（内层亦自查 displaceEnabled）。
- 注：编辑器在 `previewQuality==='low'` 时跳过置换（unified-render.ts:4550），包内恒算——编辑器预览质量门（性能取舍，与 host-fx 同门），非包侧断裂，记未验证清单备注。
- **判定：通**。

### 4.3 粒子轨迹升级（sim 双路）

- 编辑器 `simulateDynamicParticles`（dynamic-pattern-sim.ts）与包内 `dynSimulate`/`dynBallisticAt`（dynamic-src.ts:456-725）逐式镜像：弹道分段积分、链派生 cls=1、落地派生 cls=2、rot 哈希、出生窗 extSec、postDither 的 k 层 continue 连带派生跳过——两端同。探针 verify-particle-twin-align（37 过）、verify-particle-trajectory（20 过）、verify-package-particle-trajectory（19 过）作回归证据。
- 潜伏缺省差（故障模式⑥的潜伏形态）：包侧 `GY = params.groundYPx ?? 0`（dynamic-src.ts:475）、chainColor/landEmitColor 包侧 `?? params.color`，与编辑器读法不同；但参数到达包侧前必经规范化（resolveDynamicPatterns norm、extractPatternInstances:89、expandDynamicEntry:162 均调 normalizeDynamicParams，缺省 groundYPx=24），现行数据流下不触发。仅对绕过规范化的手造数据成立——记未验证清单，不判断裂。
- **判定：通（潜伏差另记）**。

### 4.4 弧线段（8 模式 + ring/fan）

- `arcPointsAt`（dynamic-patterns.ts:970 起，arc/vine/stars/beam/glyph/stream/ring/fan 八模式全读参数）⇔ `dynArcPoints`（dynamic-src.ts:126-364）逐式同。回落差两处均良性：glyph 转速编辑器 `|| 0` vs 包 `?? 12`（编辑器缺省即 12，到达消费端前已规范化）；stream 流速 `|| 0` vs `?? 0.6`（缺省 0.6，同理）。
- 消费：编辑器 unified-render.ts:4003 绘制、arcTarget 双锚点在 :3374-3381 按 `arcEnabled && arcTarget` 算；包侧 runtime-template.ts:5194-5206 经 partAnchorsByKey 查同一目标名喂 dynArcPoints。探针 verify-arc-ring-fan 33 过。
- **判定：通**。

### 4.5 follow 段（烘焙型，包侧按名零命中是设计）

- 编辑器：unified-render.ts:3346-3371 消费 `followAnchoredDeltaAt`（:3348 查 followEnabled && followSource），现算锚点差。
- 包侧：convert.ts:2112 起把 follow 烘成 `followCurve`（:2127 查 fp.followEnabled；followSource 为空时点名警告），runtime-template.ts:4996 消费 inst.followCurve；dynamic-src.ts:365 注释明示包内已删现算。两端语义一致（编辑器现算、包内烘焙曲线），非漂移。
- **判定：通**。

### 4.6 发光段

- 分组：`resolveGlowGroups`（dynamic-patterns.ts:755-767，前 3 个各自成组、第 4 个起按 glowFollowTargetOf 并入所选组，非法值回落组 2）为编辑器与 convert **共用同一实现**（convert import），无双实现可漂移；normalize 把 glowFollowGroup 钳到 0/1/2、缺省 2，与回落口径一致。convert 通道组装（convert.ts:556）以同一规则映射 idx<3 自占通道、其余按 followTarget 并入，与编辑器分组逐项对应。
- 选区：`glowMaskCells`（dynamic-patterns.ts:1292，内查 glowEnabled——故障模式①不成立）三源齐全：'mark' 经 resolveRegionCells 解精灵选区标记、'marked' 解位图掩码、其余取色（容差按 RGB 距离，:1340-1362）。编辑器与 convert 都调这一个函数取选区。
- 进包：convert.ts:466-583 `glowEntryFor` 把选区/印章烘成 RuntimeGlowEntry：同通道印章签名一致且非自绘 → 存掩码、片元按印章参数现算（glowStampOf 钳制与 dynamic-patterns 的 glowStamp 一致，convert.ts:490 注释与实现）；含自绘或签名不一致 → 存烘焙权重场（shape 代码 4）。运行时 packGlowSidecar（runtime-template.ts:791）+ 片元 fetchGlow 消费。
- 未验证：片元印章现算的真出图未在真机/WebGL 下验（包内 GLSL 观感归真机堆）。
- **判定：通（GLSL 出图未验证）**。

### 4.7 残影段

- 包侧 runtime-template.ts:927、5560-5574：取第一个启用实例、查 trailEnabled、用 trailIntervalSec/trailCount（`||` 缺省 0.06/3，与 DEFS 缺省一致）。
- trailOpacity 仅编辑器消费（残影不透明度），包内残影为残影色剪影——接口注释已明示此差异（dynamic-patterns.ts trailOpacity 定义处），属声明差异非断裂。
- **判定：通**。

### 4.8 图案场（团块/火焰/环境）与「范围和位置跟、形态不跟」口径

- 场函数两端逐式同：`blobFieldAt`（dynamic-patterns.ts:662-700）⇔ `dynBlobField`（dynamic-src.ts:743-776）；`flameFieldAt`（:702-740）⇔ `dynFlameField`（:778-812）；`envSamplesAt`（:622-660）⇔ `dynEnvSamples`（:815-856）。常量、噪声盐、相位口径全同。
- 跟随口径核对（2026-10-27 用户定案）：blob 种子位置/摆动乘 dsx/dsy、瓣半径 r 不乘（dynamic-patterns.ts:688-693），场域 RX/RY 按 ds 放大；flame 的 W/H 乘 ds（取整）、噪声频率 f=0.16 恒定（:711-714、:735）——「范围和位置跟、形态不跟」在函数本体成立。
- ds 链：编辑器 dynSx/dynSy 累乘（unified-render.ts:3335-3343）→ instruction.dynScale（:3499-3500）→ 场画布以 ds 生成（:3756、:3902-3904）、绘
...[truncated 5579 chars]