# 域7审计报告：运行时包与插件

审计对象：`~/workspace/pixelmorpher-audit`（分支 `audit/full-system`，HEAD = `ca79308`，其下即 main `3a4a55c`）。只读审计，未改任何代码。
方法：每项功能走全链五段（①入口/数据定义 → ②convert 写入包 → ③包内消费调用 → ④包内消费内部判断 → ⑤宿主 API/播放往返），判定四态：通 / 断裂 / 实现错误 / 未验证。行号以审计时读到的文件为准。

---

## 一、断裂（3 项）

### 断裂 1：角色级蓝图 `character.blueprint` 不进包、无点名

- ① 入口：`CharacterBlueprintEditor.tsx:60-62` 经 `updateUnifiedCharacter(character.id, { blueprint })` 写入，是可用的编辑功能；类型定义 `unified-types.ts:1440-1442`（整角色后处理：描边/发光/调色作用于合成后角色）。
- ⑤ 编辑器消费：`unified-render.ts:5350-5362` Step 3 每帧 `evaluateBlueprint(blueprint, { characterPixels, … })` 求值后处理图。
- ② convert：`grep -c "character\.blueprint" convert.ts` = 0，全文零引用；包结构无对应字段。包里的 `globalGraph` 来自工程级 `projectData.globalBlueprint`，是另一个对象，不能替代角色级蓝图。
- ③④ 模板：无任何消费（字段根本不存在）。
- 判定：**断裂**。用户给角色挂了整角色后处理蓝图，编辑器里有效果，导出包里整段消失，且导出警告里没有任何一条提到它（静默丢弃，历史故障模式②）。

### 断裂 2：状态蓝图 `character.stateBlueprint` 不进包、无点名

- ① 入口：`StateBlueprintEditor.tsx:60` 写入；类型定义 `unified-types.ts:1444-1446` 明载生效叠加顺序「静态字段 → clip 状态轨道 → 状态蓝图」。
- ⑤ 编辑器消费：`unified-render.ts:2332-2344` 每帧在服装解析前 `evaluateCostumeState(character.stateBlueprint, …)`，输出可覆盖服装集 id 与逐槽变体。
- ② convert：`grep -c "stateBlueprint" convert.ts runtime-template.ts` 均为 0；无 warnings.push。
- ③④ 包内只有片段状态轨（叠加顺序的第二层），第三层不存在。
- 判定：**断裂**。用状态蓝图按变量切换服装集/变体的角色，导出后该层切换整体失效且无任何提示。与断裂 1 不同，此字段连「不进包」的设计注释都没有（对照行为树/输入轨均在类型注释里明载不进包，见总清单）。

### 断裂 3：服装集逐槽「本集为空」不可表达，模板回落默认集数据

触发条件：某非生效服装集对某槽位无服装件，或该集的服装件把节点动态模式的某个效果槽禁用（解析结果为空），而生效集该槽有内容。

机制链：

- 编辑器解析允许逐集为空：`dynamic-patterns.ts:492-510` `resolveDynamicPatterns` 中，服装件的禁用实例会 `map.delete(inst.slot)`，某集某槽的动态模式解析结果可以是空集；无件槽位在编辑器里不渲染。
- ② convert 表达不出「空」：`dynFor` 解析为空时返回 undefined，于是该集的 `__dynamic` / `__glow` 图不写该槽键，`__sprite` 图不写无件槽（convert 服装集组装段）。对照参数化槽位：convert 明确写 `entry[slotKey] = null`，模板 `resolvePart` 见 null 置 hidden——参数化路可表达缺省，精灵/动态路不可。
- ③④ 模板三处同型回落到默认集：
  - 动态模式：`runtime-template.ts:3519-3523` `dynListFor`：`return (map && map[part.key]) || part.dynamic || []`——集内图缺该键即用部件自带（生效集）列表。
  - 发光：`runtime-template.ts:836-839` `glowEntryOf`：`(map && map[part.key]) || part.glow || null` 同型。
  - 精灵图：`runtime-template.ts:953` 图集组装 `spriteGrid = sgrid || part.sprite`——该集无件时显示默认集的精灵图，而不是隐藏部件。
- 结果：切到该服装集时，本应消失/无图案的槽位在包里仍显示默认集的精灵图、动态图案与发光；编辑器里是空的。判定：**断裂**（convert 缺省表达缺失 + 模板回落口径错误，历史故障模式②⑥复合）。

---

## 二、实现错误 / 口径漂移（7 项）

### 错误 1：宿主变量 `speed01` / `phase` 两端二值 vs 连续漂移

- 编辑器宿主模拟：`behavior-host.ts:66` phase 速率 `(4 + 26 * input.speed01) / 60`，speed01 是 0..1 连续量（输入轨可给中间值）。
- 包内：`runtime-template.ts:4782` `phaseAcc += dt * (onGround ? ((ix!==0 || iy!==0) ? 30 : 4) : 18) / 60` 二值速率；`runtime-template.ts:4790` `speed01: (ix !== 0 || inp.iy !== 0) ? 1 : 0` 二值。
- 模板虽有 `setVar`/`setMove` 宿主口（`runtime-template.ts:3818` 起），但 hostVars 组装时 t/phase/moveX/speed01/grounded 恒以本帧二值计算覆盖，宿主喂的模拟量 moveX 进不了 speed01/phase。
- 端点一致（speed01=1 时同为 0.5 圈/秒、静止同为 4/60、腾空包内 18/60 编辑器无对应分支），中间值不一致：编辑器里用输入轨把 speed01 拉到 0.5 预览出的步态相位速度，包内要么全速要么静止。判定：**实现错误（双实现口径漂移）**，影响所有以 speed01/phase 为输入的行为图在中间速度下的表现。

### 错误 2：刀光 `frameCount > 12` 两端帧数不一致

- 编辑器：`slash-fan.ts:281` `Math.max(2, Math.round(spec.frameCount))` 只有下限；编辑 UI `SlashEffectEditor.tsx:123-141` 的数字输入无 min/max，用户可填任意大。
- 包侧双重钳制：convert `slashForPkg` 钳 2..12；模板 `runtime-template.ts:1084` `Math.max(2, Math.min(12, sl.frameCount || 6))` 同钳。
- frameCount 填 20 时编辑器渲染 20 帧、包内只有 12 帧，挥砍的帧密度不同。durationSec 缺省两端一致（convert 写 `?? 0`，包内 `runtime-template.ts:5540` 与编辑器 `unified-render.ts:3544-3546` 同为「>0 用之、否则回落表演/片段时长」），仅 frameCount 上限漂移。判定：**实现错误（轻微）**。

### 错误 3：`faceTurnConfig` 不进包，朝向闸门两端不一

- 编辑器：`unified-render.ts:3029-3032` 以 `faceTurnConfig?.enabled` 为闸决定 facingAngle 是否生效，`singleImageMode` 另改解析路径；类型定义 `unified-types.ts:1483`。
- convert 处理了 `character.facingAngle`（静态预转世界变换），但 `grep -c "faceTurnConfig" convert.ts runtime-template.ts` 均为 0。
- 后果：用户关掉转面（enabled=false）但 facingAngle 仍存量时，编辑器不转、包内照转；singleImageMode 在包内无任何对应行为。判定：**实现错误（条件性漂移）**——仅当 facingAngle 已存量且 enabled 被关时触发。

### 错误 4：有状态模拟 `bounce` 缺省回落两端不一（0.42 vs 0.45）

- 模板：`runtime-template.ts:2554` `params.bounce` 非数时回落 **0.42**（段首注释 `runtime-template.ts:2470` 同载）。
- 编辑器轨迹升级缺省 bounce = **0.45**。
- 经 convert 的正常路径 params 恒经 `normalizeDynamicParams` 带 0.45，0.42 只在参数缺失/损坏时触达。判定：**实现错误（轻微，缺省值两端不一）**。

### 错误 5：警告文案与实际行为不符——altSprites 近似注释称会点名，实际无点名

- `convert.ts:1291-1294` 注释：「跨集+变体同时切换时变体图仍取生效集件——近似，已知会点名在 AUDIT」。
- 该回填块内无任何 `warnings.push`，导出警告列表里不会出现这条近似。注释把点名推给了「AUDIT」，用户导出时看不到。判定：**实现错误（轻微，模式⑩）**——行为本身（近似取图）已在注释中自认，缺的是承诺的用户可见点名。

### 错误 6：死代码——convert 片段级点名空循环

- `convert.ts:1482-1484`：注释「片段级点名（缺口 5/6）：片段内的状态切换与特效数据不进包」之下是空循环体 `for (const c of opts?.clips ?? []) {}`。
- 实际的片段级点名由其后片段状态轨/特效组装段完成，此空循环什么都不做，注释却让它看起来是点名发生地。判定：**实现错误（死代码/误导性占位，模式④）**，无功能影响。

### 错误 7：输入轨不进包有点名口径不一致（行为有据）

- `inputTracks` 不进包是设计：`unified-types.ts:1470-1477` 明载「运行时包用真实输入（键盘），不读此数据」。
- 但同界的事件轨 cueTrack 在 convert 有点名（`convert.ts:813-815`），convert 注释自称两者「同界」，输入轨有内容时却无任何警告。判定：**实现错误（轻微）**——仅点名口径不一致，行为本身有据、无功能损失。

---

## 三、逐项核查为「通」的（摘要证据）

- **部件/服装/变体解析**：convert 组装 parts（base/8 向变体/服装集条目）→ 模板 `resolvePart`（`runtime-template.ts:292-318`）变体解析→镜像→服装件 18 个派生字段全量覆盖（pal/size/shapeKind/roundness/poly/polyPivot/off/light/outline/rim/glint/rimI/glintI/surface/surfaceGraph/composite/haloWidth/baseSprite），null 条目置 hidden；图集组装（953 起）与落位循环同口径。
- **导出选项三样（选了真的不一样）**：
  - 入口：`ExportDialog.tsx:1631-1673` 三组 Select + live 档警告文案（1671-1673「导出包将携带插件代码，并在打开时执行该代码」）；`editor-store.ts:351-353` 缺省 drop/standard/drop 与 convert 缺省一致；两个调用方 `ExportDialog.tsx:1060`、`ProcPreview.tsx:76` 同传 `bake` 选项与全量 projectData。
  - 插件链：drop = 去除插件节点并逐个点名；bake = 逐服装集烘代表图回填；live = 携带源码进 `pkg.plugins`，未装/禁用/无源码（编程式注册）分别点名。包内 `PLUGIN_BRIDGE_SRC`（pixel-src.ts:1694 起）逐插件 try/catch，失败插件 id 经 `runtime-template.ts:4089-4091` 写进页面 #warn 提示。
  - 逐帧修正：off 短路、standard 现行口径、extended 补载体表演与窗长（convert 约 1630-1760 段），包内替代瓦片消费与之对应。
  - IK：drop 保留 `stripped.ikChains` 并对 var 节点目标蓝图点名；bake 走烘焙蓝图。
- **插件系统编辑器侧**：`plugin-manager.ts` 注册时三注册齐全（求值器 105-127 包 ir 形态归一 + 中文标签 `插件:${mod.name}`、规格、标签）；启停在求值层生效（所属插件禁用时直通输入像素，113-115）；卸载真注销求值器/规格/标签三处并清落盘（142-168）；localStorage 落盘与恢复走同一注册路并还原启停（283-320）；`getPluginSource`（182-184）编程式注册返回 undefined——正是 convert live 档「无源码回落」点名的数据来源。
- **插件节点包内执行**：pixel-src.ts:1282-1311 经 `ctx.plugins` 查表执行，节点求值 try/catch 兜底（pixel-src.ts:1216）；编辑器侧执行签名同为 `execute(pixels, params)`（plugin-manager.ts:120），两端入参口径一致。
- **画布后处理与特效**：`types.ts:438-446` 的 8 种 CanvasModifierType 在模板 `fxRunPostChain`（2177-2310）全有分发（field_wipe/block_shift 的 uEffect 号 10/11 在 2105-2110）；`fxRenderSet`（4546-4725）6 种 EffectType 全有分支，text_pop 逐关键帧事件语义在位；四笔与 pixel_displace 锚点统一走 `fxW2`（runtime-template.ts:4466，用 `charOriginY()`，PR #77 修复在位；调用点 4582/4630/4647/4657/4678/4690/4705-4707）。
- **D6 三件生命周期**：链摆/有状态模拟的重置点齐全——录制起点（4275-4276）、回放起点（4281-4282）、`hardRelockTo`（5751-5757）三处同清 `simStates`/`stateSimPools`/`anchorState`；实例消失在状态模拟段 delete（2421 一带）；stateSim 120Hz 定子步与 seek>0.5s 重置口径有注释明载。
- **表演状态机**：作者规格直通进包、缺省按表演自动生成、悬空 performanceId 降级常驻并点名；模板 `smUpdate` 永不自动转入表演态（只经意图进入），与编辑器侧 `state-machine-edit.ts:5` 的口径注释一致，非断裂。宿主口 `window.procRuntime`（3807-3845）含 intent/setVar/setMove/state/onEvent/hitboxes/setPaletteSwap/clearPaletteSwap/stop/stopAll；setVar 拒收保留名（t/phase/speed01/grounded/wall/ledge）。
- **行为图方言**：包内求值器节点集 = `dialect.ts` 的 BEHAVIOR_LIVE_NODES（减包内生成的 curve）；convert 侧 graph-translate 对不支持节点、字面值通道、enabled=false、nodeRef 无对应部件逐条点名，包内未知节点静默回 0 与 convert 点名互补，无静默丢弃。
- **表面图 op 集**：编辑器规格表 `surface-ops.ts` 的 52 个 op 全部能在 bake-src.ts 的 `compileSurfaceGraph` 找到对应 case（含 overlay2@366、u01/v01）；bake 侧多出的 all/band/bands/dome/edge/gradLt/side/top 属图层程序（compileTileLayers）方言，非表面图 op，无缺失。
- **GIF/录制回放**：录制/回放状态机（4258-4330）+ 回放抓帧 + 模板内自带 GIF89a 编码器（4377-4407），路径完整。
- **场景 scene**：编辑器无 scene 实体数据源（`solids` 全仓只出现在 convert 与模板）；convert 的 `projectData.scene` 入口（2419-2431，逐条校验、非法条目点名丢弃）是给编程式调用方的口子，模板缺省用内置关卡（2308-2315）。属设计口径，非断裂。两个 UI 调用方不传 scene 与「编辑器无此数据」一致。
- **包组装**：`buildRuntimeHtml`（runtime-template.ts:14-23）单点注入包 JSON 与 eval/bake/dynamic/pixel/plugin-bridge 五段源码；`format: 'procedural-pixel-runtime-1'` 由 convert 写出（2450）。

---

## 四、进包数据总清单

| 数据 | 进包 | 不进时点名 | 证据 |
|---|---|---|---|
| 部件 base / 8 向变体 / 精灵代表图 | 进 | — | convert parts 组装；模板 resolvePart |
| 服装集条目（含逐集 __dynamic/__glow/__sprite/__stack 图） | 进（但逐槽「空」不可表达，见断裂 3） | — | convert 服装集组装段；模板 dynListFor/glowEntryOf |
| 片段状态轨变体替代图 altSprites | 进（跨集近似） | **否**（注释称点名、无 warnings.push，见错误 5） | convert.ts:1291-1330 |
| 网格蒙皮 skin 回填 | 进 | — | convert.ts:1270-1287 |
| 骨骼名/父子表 skeleton | 进 | — | convert.ts:2434-2448 |
| 行为图 behaviorGraphs | 进（方言翻译） | 是（逐节点/逐通道点名） | graph-translate.ts；convert 行为层段 |
| 表演 performances（含 slash 解引用、pattern_cue、蓝图接线固化） | 进 | 是（类型报告逐类点名） | convert 表演组装段 |
| 状态机 stateMachine（作者规格或缺省生成） | 进 | 是（悬空 performanceId 降级点名） | convert 状态机段 |
| 程序化动画 proceduralAnimations | 进（双通道解析到槽位） | 是（无挂载点名） | convert 程序化段 |
| 模拟链 chains（链摆/布料参数） | 进 | 是 | convert simChainsPkg |
| 节点轨道（姿态通道关键帧） | 进（烘焙为轨道/钳制快照） | 是 | convert.ts:1479 起轨道段 |
| 逐帧修正 spriteFrames | 按导出档（off/standard/extended） | 是 | convert 约 1630-1760 |
| IK 链 | 按导出档（drop/bake） | 是 | convert IK 段 |
| 插件像素链 | 按导出档（drop/bake/live） | 是（三档各自点名） | convert 约 1010-1170 |
| 工程级全局蓝图 globalBlueprint → globalGraph | 进（须全局修改器非空闸门） | 是 | convert 全局图段 |
| 全局修改器 globalModifiers | 进 | — | convert |
| 工程特效 fx（画布修改器轨/特效轨/笔触） | 进 | — | convert fxPkg 组装 |
| 事件轨 cueTrack | **不进** | **是** | convert.ts:813-815 |
| 输入轨 inputTracks | **不进**（设计：包内用真实输入） | 否（见错误 7） | unified-types.ts:1470-1477 |
| 行为树 behaviorTree | **不进**（设计：归宿主） | 否（类型注释明载口径） | unified-types.ts:1461-1465 |
| 角色级蓝图 character.blueprint | **不进** | **否（断裂 1）** | convert 零引用；unified-render.ts:5350 消费 |
| 状态蓝图 character.stateBlueprint | **不进** | **否（断裂 2）** | convert/模板零引用；unified-render.ts:2332 消费 |
| 转面配置 faceTurnConfig | **不进**（facingAngle 本体进，作静态预转） | 否（错误 3） | unified-types.ts:1483；convert facingAngle 段 |
| 调色板 userPalettes / activeUserPaletteId | 进 | — | convert.ts:2458-2467 |
| 场景实体 scene.solids | 编程式入口进；UI 导出恒不进（编辑器无此数据） | 非法条目点名 | convert.ts:2419-2431；模板 2308-2315 |
| simMode / frameRate / format | 进（simMode 恒 'frame' 写出，预览侧改墙钟） | — | convert.ts:2450-2453 |

---

## 五、三清单

### 断裂清单
1. 角色级蓝图 `character.blueprint` 不进包、无点名（convert 零引用；编辑器 unified-render:5350 在消费）。
2. 状态蓝图 `character.stateBlueprint` 不进包、无点名（convert/模板零引用；编辑器 unified-render:2332 在消费，服装叠加第三层缺失）。
3. 服装集逐槽「本集为空」不可表达：模板 dynListFor（3519-3523）/glowEntryOf（836-839）/精灵图（953）三处回落默认集，禁用或无件的槽位在包里错误显示默认集内容。

### 实现错误清单
1. 宿主变量 speed01/phase 二值（模板 4782/4790）vs 编辑器连续量（behavior-host:66）口径漂移。
2. 刀光 frameCount 上限漂移：编辑器无上限（slash-fan:281），convert 与模板钳 12（模板 1084）。
3. faceTurnConfig 不进包：enabled=false 而 facingAngle 存量时两端朝向不一致；singleImageMode 包内无对应。
4. stateSim bounce 缺省回落 0.42（模板 2554）vs 编辑器 0.45（仅参数缺失/损坏时触达）。
5. altSprites 跨集近似注释称「会点名在 AUDIT」，实际无 warnings.push（convert:1293）。
6. convert 片段级点名空循环死代码（convert:1483-1484）。
7. inputTracks 不进包无点名，与 cueTrack 点名口径不一致（行为有据，仅点名问题）。

### 未验证清单
1. dynamic-src 其余段（dynOrbitPoints、dynBlobField/dynFlameField、dynEnvSamples、噪声与图案段函数）与编辑器 dynamic-patterns/dynamic-pattern-sim 的逐段同式性未抽核（粒子/弧线/画布算子/宿主后处理四段已在 pixelfx 线对拍，本域未重复）。
2. bake-src 各表面 op 的内部数学与编辑器求值的逐 op 数值同式性未核（只核了 op 集合包含关系：规格表 52 op ⊆ bake 求值器）。
3. 模板 2720–3695（兜底步态 FB 等）与 4900–4991（落位前段）未逐行读；部件绘制主循环已读 4991 起的关键段。
4. 包 format 版本字段模板侧从不校验：HTML 由同批代码+数据生成，版本错位在单个产物内不可达；JSON 包被外部宿主单独加载时的版本契约未验证。
5. PluginPanel 组件的按钮接线未逐行读（plugin-manager 层注册/启停/卸载/恢复链已核为通）。
