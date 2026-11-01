# 全系统审计（2026-11-01，用户下令：梳理整个系统功能，有没有断裂、接线是否正确、实现有没有错误；并检查核心心智模型是否统一）

审计标准（铁律）：每项功能走全链五段——①入口/数据定义 → ②store/写入路径 → ③消费端调用 → ④消费端内部判断 → ⑤存档/进包往返；每段须有 file:line 证据。五段缺一段只能标「未验证」，不许写「通」。判定四态：**通**／**断裂**／**实现错误**／**未验证**。

分域报告（同目录）：DOMAIN-1 外壳与工程 / DOMAIN-2 画布与渲染 / DOMAIN-3 木偶与服装 / DOMAIN-4 动画与表演 / DOMAIN-5 模式蓝图行为 / DOMAIN-6 时间线与效果轨 / DOMAIN-7 运行时包与插件 / DOMAIN-8 心智模型。本文件是汇总：整体总结、状态总表、缺陷总清单、心智模型结论、修复计划。承重缺陷由主会话亲验（标★）。

## 一、整体总结

PixelMorpher 是一个像素木偶动画编辑器 + 运行时包导出器。系统分三层：

- **编辑器**（Next.js/React/Zustand）：搭建骨骼（节点树+槽位）、换装（服装集×8 方向×变体×纬度）、做动画（轨道/轨迹/程序化/IK/预设）、编排（蓝图/行为/表演/刀光）、特效（动态模式/效果轨/画布修改器/全局修改器）、时间线（输入轨/事件轨）。
- **数据模型**（unified-types 为核心）：Character → Node 树为唯一骨骼模型；服装、蓝图（一份 IR 多挂载）、轨族（KeyframeTrack 单一定义）都是挂在角色/节点上的数据。
- **运行时包**（proc-runtime）：convert 把角色烘焙/展开为自包含 HTML 包（WebGL 播放器 + 状态机 + D6 有状态模拟），宿主经 procRuntime 口子供输入变量。

**总体判定：核心链条大面积通，断裂集中在四类地方**——(1) 后加功能的消费端没跟上（轨迹、转面轨、片段级轨道、预览画质）；(2) 进包边界静默丢失（角色蓝图、状态蓝图、转面、蒙皮快照、片段标签）；(3) 旧数据/旧面板的双套并存漂移（DressPanel 手写读写、片段级与工程级双套轨道、两份插值实现）；(4) 文案与文档层过期（槽位称呼反转、README/wiki 基于已删模型）。模式库/蓝图/行为核心（域5）与刀光、服装分层、图案双实现是最健康的部分：153 个模式参数无一死参数、蓝图 99 节点三处注册全等、双实现逐式同。

## 二、功能状态总表

| 域 | 通 | 断裂 | 实现错误 | 未验证 |
|---|---|---|---|---|
| 1 外壳与工程 | 向导/导入/存档主链/开关等 | 6 | 5 | 5 |
| 2 画布与渲染 | 定稿顺序/拾取/显示过滤等 17 项主体 | 2 | 5 | 2 |
| 3 木偶与服装 | 21 | 11 | 9 | 10 |
| 4 动画与表演 | 程序化/IK/刀光/步态等主体 | 14 | 7 | 6 |
| 5 模式蓝图行为 | 11 大项全通 | 0 | 2 | 3 |
| 6 时间线与效果轨 | scheduler/输入轨/事件轨/画布修改器/全局修改器主体 | 2 | 3 | 3+ |
| 7 运行时包与插件 | 导出三选项/插件全链/D6 等主体 | 3 | 7 | 5 |
| 8 心智模型 | 核心概念多数统一 | 同名异义 5 / 异名同义 5 / 语义漂移 3 / 文档不符 8 | | |
| **合计** | | **断裂 38** | **实现错误 38** | |

## 三、缺陷总清单（按危害排序，编号 F-##，域内原编号附后）

### 数据丢失 / 静默失效（最重）

- **F-01 ★轨迹无主消费**（域4-B1）：node.trajectory 在 unified-render 与 convert 全文零引用——手绘轨迹与制导生成的产物主画布不播、进包静默丢。唯一消费是辅助插值链（工具读数/面板）。「轨迹盖过轨道」定案只对辅助链成立；两支轨迹探针只测辅助链故一直全绿（测错对象）。
- **F-02 复制项目复制不出数据**（域1-断3）：asset-store 展开顺序反，副本记录落在原工程键下，副本打开空白。
- **F-03 顶栏打开 .pxm 不绑工程 ID**（域1-错1）：回主页保存把导入内容按旧 ID 覆盖回原 DB 工程。
- **F-04 自动保存恢复不进编辑器**（域1-断5）：恢复后仍停主页、未绑 currentProjectId，随后打开/新建即静默冲掉恢复内容。
- **F-05 效果轨关键帧参数写不进去**（域6-1）：glow/particle/afterimage/pixel_displace/motion_blur 五类关键帧 UI 无 params 写入路径（建帧落 `{}`、对话框无新增字段控件），用户打的帧永远是缺省参数（text_pop 例外）。
- **F-06 预览画质全链断裂**（域1-断1/域2-断1，两域独立命中）：previewQuality 无任何读方，renderUnified 画质实参写死 'high'，7 处低画质门控皆死代码，切画质零效果。
- **F-07 转面轨主渲染不消费**（域3-D1）：faceTurnKeys 写入/插值/时间线齐全，unified-render 只用静态值（代码留 TODO 自认），时间线打点不改变主画布。
- **F-08 SAM「提取为 Part」必抛**（域3-D6）：调用已退役的 parts/addPart/setPartPixels，store 已无此三名；另 SAM 非 ready 态点击无动作无回落（D7）。

### 进包静默丢失（convert 不点名）

- **F-09 角色级蓝图不进包**（域7-断1）：character.blueprint 编辑器每帧消费（整角色后处理），convert 零引用、无警告。
- **F-10 状态蓝图不进包**（域7-断2）：服装叠加第三层（stateBlueprint 每帧覆盖服装集/变体），包内只有第二层，静默缺失且无设计注释。
- **F-11 转面与蒙皮快照不进包**（域3-D2/D3）：node.faceTurn/faceTurnConfig、skinningSnapshot 在 proc-runtime 零引用、无点名。（faceTurnConfig 的 enabled 门控另见域7-错3。）
- **F-12 片段标签 frameTags 不进包**（域4-B4）：写入端齐全，convert 零引用无点名。
- **F-13 服装集逐槽「本集为空」包内不可表达**（域7-断3）：convert 解析为空不写键，模板三处回落默认集——切到该集时本应消失的槽错误显示默认集精灵/图案/发光。

### 接线断裂 / 双套漂移

- **F-14 片段级轨道双套无人维护**（域6-2/域4-B3）：clip.effectTracks/strokes 无编辑面、「片段优先」注释无代码实现、project-slice 两处同步块为空；编辑器只消费工程级、包内却会双画（域6-E3：effectTracks 迁移双写无防线、canvasModifierTracks 有）。
- **F-15 播放调度不读片段窗/loop**（域4-B2）：scheduler 只按工程 totalFrames 取模，loop:false 照样绕圈、窗外照常播。
- **F-16 DressPanel 双实现漂移**（域3-D8）：手写读写不走分层写函数、无纬度、不认内嵌精灵、无镜像回落；activeCostumeSetId 未设时主渲染不回落第一集（整角色无图）、convert/面板却回落。
- **F-17 两份插值实现语义不一致**（域4-E1/E2）：主渲染 interpolateTrack 的 step 在关键帧帧取旧值（晚一帧切换）、辅助版同帧取新值——错的是出图那份；辅助版 bezier 未实现等同 linear。
- **F-18 宿主变量 speed01/phase 包内二值化**（域7-错1）：编辑器连续量 (4+26·speed01)/60，包内恒二值，宿主喂模拟量进不了。
- **F-19 刀光 frameCount 上限漂移**（域7-错2）：编辑器无上限、包内钳 12。
- **F-20 覆盖层重算缺三份上下文**（域2-断2）：computeWorldTransforms 的 clampCtx/simCtx/procDeltas 无 store 兜底，覆盖层/几何拾取以 undefined 重算——程序化增量/钳制/模拟生效时骨骼线、IK 手柄、枢轴读数与出图不一致（编号图 tier 0 不受影响）。
- **F-21 SocketEditor 两错**（域3-E1/E2）：点方向格把 directionOffsets 写成 {0,0} 压过 basePosition（仅查看即移位，活链亲验）；offset3D 生效时 base 编辑无消费端且无提示。
- **F-22 全局蓝图不进存档/撤销快照**（域1-断6）：exportProjectFile 与 _captureSnapshot 名单双缺，保存重开丢失、撤销后蓝图与列表不一致。
- **F-23 addGlobalModifier 首次添加双节点**（域1-错2）：蓝图为空分支先 set 再 get，新修改器被计两遍。
- **F-24 mark 工具切换联动缺位**（域1-断2）：CanvasToolRail 自动进 sprite_edit 的枚举漏 mark，普通模式点该工具无反应无 toast。
- **F-25 复制片段漏刀光**（域4-B5）：复制不带 slashEffect/slashDefId/thumbnail，刀光静默丢失。
- **F-26 parentKeys 被帧级删/复制/移动漏掉**（域4-B10）：ALL_TRACK_KEYS 不含 parentKeys，时间线车道却含。
- **F-27 刀光表演图接线覆盖生产零消费**（域4-B8/B9）：convert 传 undefined 回调、编辑器不渲染表演刀光，specs「可接线覆盖」宣称与实况不符；图内引用悬空时 convert 静默丢弃无点名。
- **F-28 ProcPerformance 编辑器播放不求值**（域4-B7，已明示「导出时采样烘焙」，非静默，记此备核）、**PerformPanel 回落与渲染门控不一致**（B6）。
- **F-29 效果轨 `Number(params.x) || 缺省` 吞 0**（域6-E1）：编辑器五类与包内 num() 口径不一致（画布修改器侧已修、效果轨漏修）。
- **F-30 画布轨关键帧全轨共享参数袋**（域6-E2）：同轨第二个同类型修改器的关键帧快照覆盖第一个的差异参数（数据模型层，两端同病）。
- **F-31 烘焙 IK 骨长丢 Z**（域4-E4）：ik-bake 二维 hypot、活求解三维，Z 分离链烘焙骨长系统性偏短。
- **F-32 裁剪/变换不重映射 marks**（域3-E4）：派生精灵直接丢 marks（landmarks 有重映射、marks 没有），存档存失效坐标；包内 marks 解析与编辑器漂移（E5：种类优先 vs 数组先到先得）。
- **F-33 value 值标记无消费**（域3-D4）、**marks 载入规整不存在**（D5：注释称有、导入不调 normalize）。
- **F-34 Socket 2D 偏移潜伏错位**（域3-D11）：组装恒写零、全靠 offset3D 兜底，joint3D 缺失的骨骼数据子节点塌到父关节，与注释/定案不符。

### 实现错误（其余）与死代码

- 洋葱皮擦除参考图 + 暂停双绘（域2-错1/2）；sprite_edit 修改器清单漏 cleanup（域2-错4）；网格透明度公式非单调（域2-错5）。
- 撤销缺失：setNodeFrameInterpolation、updateAnimationClip 无 pushUndo（域4-E5/E6）；coalesceKey 'behavior' 三功能共用并步（域1-错3）。
- 项目缩略图生产者缺位（域1-断4）；ResizePreviewDialog 锚点预览/落库不一致（域1-错4）；Spritesheet atlas 越界写 NaN 颜色串（域1-错5）。
- 纬度值域三套（域3-E3：向导五档/滑杆连续/烘焙两档）；装配放弃文案与实际删除范围不符（E9）。
- 蓝图 10 个节点类型缺中文标签（域5-错1：bump_light/face_turn/local_inflate/path_follow/path_move/screen/stroke_emitter/stroke_source/trajectory_emitter/trajectory_source，菜单与节点头显英文 id）。
- host-fx slice 包内 GLSL 无 RGB 分色（域5-错2，已自陈的声明偏差）。
- stateSim bounce 缺省包内 0.42 vs 编辑器 0.45（域7-错4）；altSprites 点名注释与实际不符——注释称会点名、无 warnings.push（域7-错5）；convert 片段级点名空循环死代码（域7-错6）；inputTracks 不进包无点名、与 cueTrack 点名口径不一致（域7-错7，轻）；enabled:false 表演 convert 静默跳过（域4-E7，轻）。
- 死代码：presets.ts 整模块（域4-B11）、csv-waveform 导入端（B12）、motion-analysis 无 UI 入口（B13）、applyProceduralAnimations 旧门控函数（B14）、SplitImageDialog/PlugConnectionEditor 孤儿组件（域3-D9/D10）、updateSkeletonNode.ts 等（域8）。
- 「Telea 填补」名实问题（域3-E6）：实现为边界逐层加权平均（自注 Telea-style、无 fast-marching）；holeFill 标签仍叫「边缘复制」而实现已换。按算法替换铁律须正名或换实现，归修复计划裁断项。

### 待用户裁（语义分叉，不擅自改）

- **辉光方向缺省**：实现缺省 'sprite'，2026-10-23 立规为默认世界——两端一致、无漂移，冲突在规则与实现之间（域2-错3，沿袭未裁）。
- **Telea 正名**：改标签为实名（边界加权填补）还是把实现换成真 Telea——二选一须裁。
- **槽位文案**（域8-T1）：UI 现把服装件槽叫「槽位」、Socket 叫「插槽」，与既定口径（槽位=socket、服装件不叫槽位）相反——修复方向是文案归正（服装件槽改称「服装槽」类称呼、Socket 归名「槽位」），动 UI 文案面较大，归修复计划首批。

## 四、心智模型结论（域8）

核心数据模型内部是统一的：Character/Node 单一骨骼模型、KeyframeTrack 全仓唯一定义、蓝图一份 IR 多挂载（限定词=挂载点）、刀光共享定义、轨/轨道/轨迹区分在数据层守住、方向/纬度/偏航三分清楚、plug 全仓精确统一。不统一集中在四处：①旧类型文件 types.ts（3652 行、44 文件 import）与 Puppet* 命名残留、activePuppetSkeletonId（141 处）未清；②UI 中文词占用冲突——「槽位」三角占用且与口径反转、「宿主」两指、「事件」三套、「锚点」四指、修改器/修饰器并存（163 vs 26）；③包边界改名与语义漂移——包内 RuntimePart、「轨道」表演是合成名、包内「表演」集合三源、帧率兜底 convert 12 vs 包内 60；④根目录文档过期——README 写不存在的 Node.costumePiece（实际 slot）、MIGRATION_STATUS 基于已删文件、wiki 教已退役的 Part 模型且 Socket/Plug 定义错位。规范术语表（30 条）已随域8 报告给出，README 重写即按此表述。

## 五、未验证汇总（不下结论，逐项在域报告）

SDF 描边内部算法、mesh-skin 包内公式本体、包内 GLSL 真出图、dynamic-src 其余段逐式同式性、轨点乱序规范化、存量工程缺 sockets 字段的 FK 直读风险、装配会话态不落盘意图、条带播放头目检类等——共约 40 项，分散在各域报告末尾，本 PR 修复阶段对其中可代码判读的逐项补验，须真机/真 GL 的继续挂账。

## 六、修复计划（本 PR 内）

1. 首批（数据丢失/静默失效）：F-01 轨迹接主渲染+进包（或烘焙）、F-02/03/04 工程存取三 bug、F-05 效果轨参数写入、F-06 画质接线、F-07 转面轨消费、F-08 SAM 退役 API。
2. 进包点名批：F-09/10/11/12 能进则进、不能进则 convert 点名（与 cueTrack 同口径）；F-13 空槽表达。
3. 漂移批：F-14~F-21、F-25~F-34 逐项按域报告修法落地；死代码按「有新实现代替才删」铁律处理（孤儿组件/整模块死代码删除前全仓复核引用）。
4. 文案批：槽位归正、修饰器统一为修改器、蓝图 10 节点补中文标签、README 按规范术语表重写（已随本汇总同批落地）、wiki 与旧报告加过期标注。
5. 每批配探针（夹具须能证伪），全套 verify + 真 build 收口。

## 七、修复状态（2026-11-01 本 PR 内完成，125 支探针全绿 + tsc + 真 build）

- **F-01 轨迹**：已修。主渲染 interpolateTransform 在源头以共享的 interpolateTrajectoryPoints 整段替换 x/y（出图/拾取/覆盖层/convert 采样全链生效）；convert 采样门控纳入只带轨迹的节点（否则仍会整块跳过）。verify-trajectory-render 24 项测出图对象，还原自查摘接线 16 红。
- **F-02/03/04 工程存取**：已修（展开顺序、顶栏打开委托 importProjectFromFile 统一绑定、恢复补进编辑器收尾两件）。verify-project-lifecycle 23 项；DB 落键后果为构造+接线级验证，浏览器端到端未验（如实标注）。
- **F-05 效果轨参数**：已修。新 effect-track-params.ts 为参数表单一口径（五类字段+六类播种+对话框垫底合并），存量空帧可编全字段。**F-29** 同批修：13 个数值 + 2 个颜色读点改与包内 num() 同口径（颜色读法另挖出 `'undefined'` 永不回落一并修）；部件级修饰器渲染函数的同病 16 处在漂移批 B 一并改齐。verify-effect-keyframe-params 80 项。
- **F-06 预览画质**：已修。store→renderUnified→计划→指令盖戳→7 处门控全链接通，洋葱画质一并接上。verify-preview-quality 20 项、7 个突变逐环转红。
- **F-07 转面轨**：已修。主渲染两处读点改走 getInterpolatedTrackFaceTurn（与辅助链同一函数），TODO 摘除。**F-11**：转面/转面轨/转面配置/蒙皮快照进包点名（正反 8 例）。verify-faceturn-consume 22 项。
- **F-08 SAM**：已修。提取改走现行精灵落点（与画布选区提取共用纯核心 buildSpriteFromCanvasMask），非 ready 态给节流提示+降级路径；verify-sam-extract 28 项。
- **F-09 角色蓝图**：点名（判据：编辑器消费形态是整角色合成图后处理，包内无此求值通道，真进须新建模板合成遍、超出接线修复范围）。**F-10 状态蓝图**：真进包——convert 逐帧采样 resolveEffectiveCostumeState、三层差分折成 stateFx（与第二层同载体），变体 id 并入 altSprites 需求集。**F-12 frameTags**：点名（包内无命名子区段播放语义的消费形态）。**F-13 空槽**：真进——非生效集空槽写显式标记（__dynamic []、__glow null、__sprite null），模板按「键存在」判读（含审计未点名的 simPartParams 同式一并改）。
- **F-14 片段级双套**：convert 对 effectTracks/两类 strokes 补逐项比对防双写+点名；失实注释（types/project-slice 三处空块）改实况。**F-15**：调度器抽 advancePlaybackFrame 读片段窗/loop（无片段旧口径不变）。**F-17**：主渲染 step 改关键帧帧取新值、bezier 抽共享模块两链共用、辅助链补真 bezier，6 轨×16 帧逐值对拍。**F-25** 复制片段补刀光三字段；**F-26** ALL_TRACK_KEYS 补 parentKeys；**F-28** PerformPanel 摘除回落第一片段；**F-31** IK 烘焙骨长改三维；撤销两处补 pushUndo；**F-27** 刀光图内悬空引用 convert 点名 + specs 文案改实况。死代码删除：presets.ts、applyProceduralAnimations、parseCSVWaveform、motion-analysis、isPlaybackRunning（均全仓复核零引用，证据在漂移批 A 报告）。
- **F-16 DressPanel**：已修——改走分层写函数与共享解析，主渲染服装集解析走 getActiveCostumeSet 回落第一集（行为变化点名：变体层首次写入顺带指派 slotVariants，与装配口径一致）。**F-20**：新 computeEditorWorldTransforms 按主画布同口径装配三上下文，覆盖层五处+枢轴+几何拾取改走（数值一致性属真机目检）。**F-21**：方向格以 base 为种子写偏移（仅查看不再移位）、offset3D 生效时 base 编辑禁用并明示。**F-30**：关键帧 paramsByModifier 按修改器分键，两端同改，存量扁平袋回落兼容、slice 动作双形态入参。**F-32**：marks 裁剪/变换/仿射三路重映射、包内解析改种类优先。**F-33**：导入/恢复两路补 normalizeSpriteMarks；value 值标记**判后不动**——证据：markValue 生产代码零调用、设计文档消费端清单无 value 的具体消费设计、无注释谎称有消费——不发明接线、不删数据，已在本节存档。**F-34**：父 socket 改按全帧关节差组装（分层组装线的同骨层叠写零是正确设计、未动）。
- **域1/域2 小项**：F-24 mark 联动补枚举；coalesceKey 三拆；缩略图生产者落地（主画布抓图落库、抓不到保留旧值）；ResizePreviewDialog 锚点对齐中心；atlas 越界钳制+NaN 兜底；洋葱皮擦参考图与暂停双绘已修（删离屏 clearRect + 池化临时画布染色、删第二遍叠加）；sprite_edit 清单改共用 PIXEL_MOD_TYPES 补 cleanup；网格透明度改单调不负。死代码 SplitImageDialog/PlugConnectionEditor 已删（零引用复核）。
- **域7 小项**：bounce 缺省对齐 0.45；altSprites 补真点名；空循环删除；inputTracks 点名；enabled:false 表演跳过点名。
- **文案批**：槽位归正（服装件→「服装槽」约 90 处、Socket「插槽」→「槽位」约 55 处、多义点单独判为色位/场槽/占位/输入口）；修饰器→修改器 26 处全清；蓝图 10 节点补中文标签；9 个旧文档加过期声明、wiki 两条错误定义就地更正；宿主两指头注消歧。verify-terminology 59 项。**phase 单位一条复核结论**：域8 所指 types.ts:1409 矛盾注释在现行树与审计基线均定位不到（域8 报告文件在仓内截断、无从复核原点位）；全仓 phase 注释逐处核对均与实现一致（宿主 phase=圈、图案相位=周期数、蓝图 phase=度、内部累积相位=弧度），无自相矛盾，未做改动。
- **workflowSummary 整条删除**（用户 2026-11-01 点删）：状态字段 + refresh/update 两动作 + WorkflowSummary/WorkflowType 类型一并删净——无任何界面读该状态、两动作零调用，是旧工作区模式设计的残留；SAM 批曾把它改读现行数据（不再读退役字段），本次按用户裁定整条删除。
- **真机未验（代码口径已对齐、观感待目检）**：F-20 数值一致性、洋葱皮与参考图同显、SocketEditor 点按观感、项目缩略图主页显示、F-02/03/04 的浏览器端到端落盘后果。
