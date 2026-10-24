# 3D 烘焙改进研究（research/bake3d-improvements）

盘点日期：2026-10-25。基线 main = d80fda3。
**路线已定（2026-10-25 用户拍板）：直接走甲（扩位治本），已落地**
（见文末「执行记录」）。乙（智能编号/警告）未做，丙未议。

## 一、管线现状（代码锚点）

入口：`ThreeBakeDialog.tsx`，三模式——

| 模式 | 实现 | 规模 | 说明 |
|---|---|---|---|
| sixpart（默认） | `threejs-baker-sixpart.ts`（1324 行） | 96 遍 | 六部件（头/躯干/双臂/双腿）+尾/道具；原几何一份、部件为索引视图 |
| twopass | `threejs-baker-twopass.ts`（2029 行） | 16 遍 | 整模颜色+ID 双遍（正/反面），`skeleton-mapper.ts` 按 ID 图拆精灵 |
| manual | `threejs-baker-manual.ts` + `ManualPickPanel` | 单烘 | 点选单骨烘焙：`bakeSingleBone`（twopass.ts:1787） |

模型格式：GLB 走 `load-model.ts`；PMX（MMD）走自研 `pmx-parser.ts` /
`pmx-scene.ts` / `pmx-npr.ts`（NPR 材质预设），汇入同一套烘焙器。

关键环节：

- **姿态**：`droopArmPose`（垂臂，sixpart:484）、`poseFingersOnModel` /
`applyFingerCurl`（手指蜷曲，twopass:1515/1770，探针 verify-finger-curl）。
- **合并**：`computeBoneMerge` / `computeTopologyMerge`（twopass:104/228）——
手指等骨骼并入有效骨骼，压缩需要编号的骨骼数。
- **ID 编码**：`encodeBoneId`（twopass:520）1248 位掩码——bone i → 第
(i%8) 位、第 floor(i/8) 通道，**上限 24**；`decodeBoneMask`（:532）
精确位解码、无阈值。
- **ID 染色**：twopass 顶点级（`assignBoneVertexColors`，:582）——
skinWeight **> 0.2** 的骨骼全部按位或（重叠 = 归双方，即旧讨论的
策略 A 已成现行）；sixpart 三角形级（:955 起）——邻接过滤后逐骨或，
另有候选 ID 材质遍（:1123）。
- **拆分归属**：六部件 = stencil 双面渲外轮廓剔除 + `gateByDirection`
方向线判定（sixpart:780/839，用户拍板口径）；双遍 = ID 图逐像素
decodeBones（skeleton-mapper:112/728）。
- **成图**：单烘按密度比重采样 + 紧包围盒 +2px 裁剪 + plug 全程跟踪
（f267142），渲染端 scaleFactor ≡ 1 已定案。
- **现有探针**：verify-3d-pipeline（4 项公式：transform/plug/scaleFactor/
投影）、verify-finger-curl。**ID 编码/解码无任何探针**（本稿随附的
特征探针是第一份）。

## 二、已知问题（按证据硬度排序）

### P1 · ID 位掩码 24 位上限：骨骼多的部件静默丢三角形

- `encodeBoneId(index > 23)` 直接返回黑（twopass:521），与背景不可区分。
- 六部件局部编号 = 部件骨骼列表的顺序号（sixpart:919-920，场景序），
手指/辅助骨骼排在后面、系统性先出局。
- 实测（2026-10-21，Z23）：单条手臂部件 52 根骨骼，编号 ≥24 的 28 根
编码不进 ID 图——食指/无名指/小指/拇指大部分指节每节丢 60–170 个
三角形、指尖节全丢；肩部辅助骨 `b_L_ShoulderUHelper`（编号 49）
主导 188 个三角形丢 180 个。
- 数值复刻见随附探针 `probe-id-capacity.mts` 第 2/5 项。

### P2 · 缓解只覆盖一种情形，且全程无警告

- sixpart 已有兜底（:982-999）：当三角形过滤集**全部** ≥24（掩码为空）
时，改按合并后有效骨骼编码——像素归属保住，代价是 contrib 锚粒度
降到有效骨骼。
- 但**混合集**（一部分骨骼 <24、一部分 ≥24）时越界骨骼被直接 `continue`
跳过（:977），掩码非空、兜底不触发，该骨骼的份额静默消失
（探针第 4 项复刻）。
- twopass 顶点染色**没有兜底**：单骨主导且编号 ≥24 的顶点染成纯黑，
拆分时无归属（探针第 5 项）。
- 两个烘焙器都**没有任何 warnings 输出**：丢了多少三角形、哪些骨骼
出局，用户在对话框里看不到。

### P3 · 编号顺序按场景序，不按重要性

出局的永远是骨骼表尾部（手指多节、方向辅助骨骼）。其中辅助骨骼可能
主导大量三角形（P1 的肩 Helper 例），与「排后面 = 不重要」的隐含
假设不符。

### P4 · 染色口径未实验定案

权重阈值现行 0.2（拍板讨论时提过 0.15，落地为 0.2）、重叠归双方
（策略 A）均为现行事实，但从未做过对照实验：阈值高低影响关节处
双归属像素量、进而影响拆分后精灵边缘的互渗程度。属可量化未量化。

### P5 · Z23 Helper 截断链（待拍板悬置）

手指链被 Helper 骨骼截断的问题单独在案（verify-finger-curl 已沉淀
复现），未动。与 P1 相关但不同：P1 是编号容量，P5 是链结构识别。

### 非问题（验证欠账，不在本研究范围）

单烘 f267142 真机复验、六部件斜视颈口/肩口、Xbot 顶部断口归属、
hips 截图暗团成因——均为等用户真机的一批，不在代码侧研究内。

## 三、改进候选

### 甲 · 扩位（治本，动编码格式）

第二张 ID 图或第二渲染目标承载 24..47 位（RGBA 四通道中 A 现恒 255，
先吃 A 通道可得 +8 位 = 32；双图 = 48 位，覆盖 Z23 的 52 需 56 位
或双图+A）。触点已定位：`encodeBoneId`/`decodeBoneMask`（twopass）、
sixpart 三处编码点（:979/:995/:1123）、skeleton-mapper 三处解码点
（:112/:728 及调用）。旧数据无兼容负担（ID 图是烘焙中间产物、
不落盘存档）。成本：中。风险：ID 遍渲染目标与读回路径要成对改，
探针可先行（纯函数层扩位 + 往返）。

### 乙 · 智能编号 + 兜底推广 + 警告（不治本，最便宜）

1. 局部编号按主导三角形数降序分配（重要的先拿号），出局者恒为
最末位骨骼；
2. sixpart 的有效骨骼兜底推广到混合集，twopass 补同款兜底；
3. 烘焙结果带 warnings：出局骨骼名 + 受影响三角形数，对话框可见。
成本：小。代价：仍是降级归属，contrib 粒度损失只是变得可见、
可控，不消失。

### 丙 · 合并前置（动语义，需拍板）

强化 `computeTopologyMerge`：编号前把手指链/辅助骨骼更积极地并入
有效骨骼，把部件骨骼数压回 24 内。问题：辅助骨骼有真实主导
三角形（肩 Helper 例），并入后其精灵内容语义变化——这正是
P5 一直悬置的原因。成本：小，但语义代价最大。

### 建议次序（盘点时）

乙先行（一并把「丢多少」变成可见数字），甲随后治本，丙只在甲
落地后仍有个别超限模型时再议。P4 阈值实验可挂在乙里顺手做
（同一批 Z23 数据跑 0.15/0.2/0.25 三档，比拆分后双归属像素量
与边缘互渗）。**用户未采此序，直接选甲。**

## 四、执行记录

### 甲 · 扩位 24 → 64 位（2026-10-25 落地）

- **编码**：掩码改为 8 字节（bone i → 第 floor(i/8) 字节第 (i%8)
  位），新 API `boneMaskSet` / `encodeBoneQuad` / `maskQuad` /
  `decodeBoneMask64`（twopass.ts），旧 `encodeBoneId` /
  `decodeBoneMask` / `decodeBoneId` 已删除（仓内调用方全量迁移）。
- **传递**：掩码分两半渲染——低半 = 字节 0..3（bone 0..31）、
  高半 = 字节 4..7（bone 32..63）；每半输出一个 RGBA quad，第 4
  字节走 A 通道。
  - twopass：顶点色改 4 分量（低半）+ `userData.idColorHi`（高半），
    ID 遍经 `setIdHalf` 换绑属性多渲一遍（MeshBasicMaterial 的
    USE_COLOR_ALPHA 路径，three 0.186 源码核过）；组数据加
    `idPixelsHi`。
  - sixpart：每三角形 2 个 texel 存两半，ID 材质加 `uPass` 取
    对应 texel；候选 ID 材质改双 quad uniform + `uPass` 选择；
    ID 渲染每方向两半各走一遍候选+本部件两段式；组数据加
    `idPixelsHi`。
  - skeleton-mapper：两处 decodeBones 改吃 (lo, hi, offset) 合并
    8 字节解码。
- **连带解决**：P1 容量（52 ≤ 64，Z23 手臂全编码）；P2 的混合集
  静默丢位（≤64 不再发生）；六部件「掩码为空」兜底保留，但触发
  条件收窄为局部编号 ≥64 的极端部件；双遍侧同理（紧凑编号
  ≥64 才丢）。
- **未含**：P2 的「无警告」部分（属乙）、P3 编号顺序、P4 阈值
  实验、P5 截断链——均未动。
- **验证**：探针 probe-id-capacity 改写为新口径 6 项全过（0..63
  往返、52 根逐根可编码、混合集 {5,40,63} 全解出、两半不串扰、
  ≥64 边界）；verify-3d-pipeline 9 项、verify-finger-curl、
  verify-proc-runtime 322 项回归全过；tsc + 真实 build 过。
  **未验证**：WebGL 实渲路径（ID 两半渲染/读回的 alpha 字节、
  texelFetch 高半取样）shell 无 GL 上下文，只能真机烘焙 Z23
  对照（指节/肩 Helper 三角形是否回归）——这是本项的真机闸门。

### 三裁定落地（2026-10-25，用户拍板）

1. **P4 不做实验，改用户可调参数**：`BakeOptions.weightThreshold`
   （默认 0.2 = 旧行径），贯通双遍 assignBoneVertexColors 与六部件
   bakeSkinnedMesh 两处写死点；对话框顶栏加「权重阈值」下拉
   （0.10/0.15/0.20/0.25/0.30，非手动模式可见）。手动模式不用权重。
2. **P5 并入本线已修**：buildDownChain 选孩子时跳过 Helper
   （/helper/i）——同名 Helper 不再抢走下一节；Helper 是唯一孩子时
   穿过它继续下探、且不入链。verify-finger-curl 补两条 Z23 型合成
   夹具（抢链/串中）全过，Xbot 原断言无回归。
3. **警告可见化改为「标出 + 用户自决归入」**（取代乙的弹窗警告）：
   - 标出：手动点选面板三视图里未分配网格由暗灰改醒目红，图例
     计数变红并注明「烘焙将丢失」。
   - 选项 `absorbUnassigned`（默认关 = 丢弃）：六部件
     groupTrianglesByPart 对无归属三角形按共享顶点投票归入邻近
     部件，完全孤立的仍丢弃；SixPartBakeData 新增 droppedTriCount/
     absorbedTriCount 计数。手动 prepareManualParts 对未分配网格
     同口径归入（共享顶点投票优先，无共享时包围盒中心最近），
     PreparedManual.absorbedMeshes 记录归入结果。对话框加「无归属
     归入邻近部件」勾选（六部件/手动模式可见）。
   - 边界（已被下条裁定覆盖）：六部件归入只改几何归属时，被归入
     三角形的像素能否在拆分时落到该部件，取决于其顶点权重集里
     有没有该部件的骨骼——故有下一条补强。
   - 补强（2026-10-25 用户追加裁定「勾选归入则归入的三角形权重
     暂时修改为邻近骨骼」）：groupTrianglesByPart 归入孤儿时，
     同步把孤儿 3 个顶点的权重集（vertBones）加上邻近骨骼——
     获胜部件中与孤儿共享顶点的三角形里出现最多的该部件骨骼。
     只在本烘焙的静态几何副本上改，不回写模型文件；共享顶点的
     其他部件三角形在各自掩码构建时按部件过滤，不受影响。计数
     absorbedReweightedCount 随 SixPartBakeData 带出。消费端已核：
     ID 纹理构建按「vertBones 并集 → 本部件过滤 → 主骨骼邻接
     过滤」生成掩码，加进去的邻近骨骼成为孤儿的主骨骼、自带
     通过邻接过滤，像素真正落入归入部件。探针 probe-bake-options
     增至 19 项（改权重生效、孤立不动、关选项不改）全过。
- **验证**：新探针 probe-bake-options 19 项全过（阈值三档归属集、
  六部件 absorb 开/关与归入改权重、手动 absorb 投票优先于距离）；verify-3d-
  pipeline 9、probe-id-capacity 6、verify-finger-curl（含新夹具）、
  verify-proc-runtime 322 回归全过；tsc + 真实 build 过。
  **未验证**：对话框新控件与三视图红标的真机观感、阈值改档后的
  实际烘焙重叠变化、Z23 真模型握拳（Helper 修复的真机闸门与甲
  的 WebGL 闸门同一批）。

## 五、仍待用户拍板

（本节三项已于 2026-10-25 全部裁定并落地，见上「三裁定落地」。）
后续悬置：P3 编号顺序（甲后紧迫性低）、P2 中 ≥64 极端部件的
兜底提示。

## 六、3Dto2Dshape 借用落地 + 双遍真机报错修复（2026-10-25，用户令「按此结论开工」）

调研对象 ANGJustinl/3Dto2Dshape（MIT）四项可借中的三项已落地：

- **一、原始法线蒙皮变换**：sixpart 的 bakeSkinnedMesh 原先丢弃源
  法线、整模 computeVertexNormals 几何重算（与 twopass 的原生蒙皮
  法线口径不一致，PMX 脸部吃亏）。改为法线与位置同口径做骨骼矩阵
  3×3 混合并归一化；无源法线时才几何重算兜底。探针
  probe-authored-normals 6 项（旋转骨骼下法线随转、非蒙皮原样、
  无源不产出）全过。
- **二、PMX 重合加算附加层剔除**：新模块 bake/material-overlays.ts
  （移植上游判定）：候选 = 有球面贴图且 sphereMode=2（加算）的材质
  组；仅当其每个三角形能在非候选组找到位置完全重合、蒙皮权重与
  morph 逐顶点一致的孪生三角形时整组剔除。pmx-scene 加载时执行
  （材质置 visible=false，被剔除名单记 mesh.userData）。探针
  probe-material-overlays 8 项（重合剔除/微偏不剔/权重不同不剔/
  乘算不剔/本体半透明不剔/场景级生效）全过。
- **三、拆分小碎片清理**：skeleton-mapper 两条 ID 拆分路径共用
  filterSmallMaskComponents——每骨骼每方向的归属掩码在裁 bbox 前做
  连通域（8 连通）清理：除最大域外面积 <4 的整域清除；眼/眉/口等
  小部件骨骼（isProtectedDetailBone，中英日名）豁免；
  SplitOptions.fragmentMinArea 可调（0 关闭）。探针
  probe-fragment-filter 8 项全过（首版曾因名单漏「目」字被探针抓出
  并已补）。

- **双遍真机报错「t.dispose is not a function」已修**：PMX 场景是
  单网格材质数组，twopass 与 threejs-baker 两份 applyToonMaterials
  都把 mesh.material 当单个材质调 dispose——数组无此方法，换材质
  第一步即抛。改为基色/贴图取首个材质、旧材质逐个 dispose。
  探针 probe-material-array-dispose 5 项全过。
- **六部件真机报错「reading 'elements'」未定位**：拿用户上传的
  三个 PMX（reze/塞尔凯特/武器）实跑全部 CPU 阶段（解析→骨骼→
  拓扑→下垂→蒙皮静态化→部件几何）无此错；六部件渲染段与双遍/
  手动确实不同（部件相机、块内 ID 纹理着色器、轮廓掩码、候选
  方向线门控），嫌疑在此段内，但本环境无 WebGL 未能复现——
  已用无头 Firefox 软件 GL 实跑复现中/待真机堆栈。

- **验证**：新探针 6 个全过（见上）；probe-bake-options 19、
  probe-id-capacity 6、verify-3d-pipeline 9、verify-finger-curl、
  verify-proc-runtime 322 回归全过；tsc + 真实 build 过。
  **未验证（真机闸门）**：法线口径变化后的实际明暗观感、附加层
  剔除的实际烘焙对照、碎片清理对真实精灵的影响、双遍修复后
  PMX 完整烘焙。

## 七、Live2D / moc3 导出（2026-10-25，用户令加到现有导出功能）

- **写入器移植**：src/lib/live2d/ 整体移植上游 live2d 内核
  （moc3.ts 写入器 + serialize.ts 往返 + keyforms.ts 求值器 +
  model/types/zip/order/decomposition 等 12 文件，MIT 声明头已加；
  modelParts 仅类型存根）。本地适配仅一处：FaceParamId 词表扩入
  全身标准参数（BodyAngle/Breath/EyeBall/Brow 等）。探针
  probe-moc3-writer 13 项全过：魔数/版本、关键形绑定口径（静止
  图元也绑 AngleX 追踪绘制顺序——上游既定策略、无 AngleX 时静止
  图元 1 关键形）、buildMoc3Archive 三件套结构、serialize 往返
  零差异。
- **模型构建器**：live2d/build-from-model.ts——与六部件同口径的
  骨骼/拓扑/垂臂后静态烘焙，按（网格×材质组×部件）拆图元，
  中立姿态正交投影，隔离贴图经注入渲染（浏览器实现
  renderDrawableWebGL 与六部件同光照口径），骨骼姿态采样三族
  关键形（頭 AngleX/AngleY、上半身 BodyAngleX；驱动不了任何
  顶点的参数自动不生成）。探针 probe-live2d-builder 用真 PMX
  （reze）+ 存根渲染跑通：34 图元/34558 三角形，头部图元 ±30°
  位移 ±6.9px 反对称、腿部零驱动，buildMoc3 产出 2.2MB 二进制。
- **导出入口**：ThreeBakeDialog 在 MMD 模型时于烘焙按钮旁加
  「导出 Live2D (.moc3)」——加载当前模型 → 构建 → 打包 zip
  （文件夹/model.moc3 + texture_00.png + model3.json）下载。
- **v1 边界（诚实口径）**：眼/口表情参数依赖 PMX morph，本管线
  PMX 场景未接 morphAttributes，未生成（不假造）；绘制顺序按
  中立深度中位数静态排，无动态顺序关键形；刚性道具暂归 torso。
  **未验证**：导出包在 Cubism/VTube Studio 的实际加载（本环境
  无 Cubism Core），与隔离渲染的真机像素正确性，同批真机验。

## 八、主界面导出补 Live2D 页签（2026-10-25 用户点名「主界面右上角那个导出按钮」）

上一轮把 moc3 入口只放进了烘焙对话框，用户问「主界面右上角那个导出按钮里加了新导出格式没有」——答案是没有，本节补上。主 ExportDialog 新增「Live2D」页签（在「运行时」之后）：`live2d/build-from-character.ts` 从编辑器角色构建——几何与画序直接取 generateRenderPlan 的 sortedInstructions（与主画布同一消费链），每条带精灵指令成一个图元：纹理 = 精灵网格，位置 = 指令位姿作用于以枢轴（sprite.plug + attachment.plug、无则居中，与计划生成端同口径）为原点的四角，镜像并入横向缩放符号。参数只声明 AngleX/AngleY/BodyAngleX（无关键形族，静态绑定追踪画序——探针验每图元关键形数 ≥3）。与 PMX 路径的分工写进了页签文案：本页签 = 第 0 帧静态姿态版；带骨骼关键形的走烘焙对话框。探针 probe-live2d-character 11 项（两图元/纹理颜色/上下关系/画序/旋转 90° 宽高互换/无精灵抛错/moc3 魔数与静态绑定）全过；tsc + build + 既有回归过。未验证：真机点按与导出包在 Cubism/VTS 的加载（并入真机批）。

## 九、六部件真机崩溃「reading 'elements'」定案并修复（2026-10-25）

根因：PMX 的 SkinnedMesh.material 是材质**数组**。bakeSkinnedMesh 把数组整体存进 BakedMesh.material（类型断言掩盖），makeToonFromSource 用 `'map' in src && src.map` 取贴图——`in` 命中数组继承的 Array.prototype.map（函数），函数被当贴图塞进 MeshToonMaterial；three 渲染时 refreshTransformUniform 读 map.matrix.elements，matrix 为 undefined → 崩溃。单材质网格（GLB 常见）不触发；手动路径早已逐个材质调用所以不中招；双遍不走此函数。复现与验证靠本机软件 GL 台（Xvfb + Playwright Firefox 非 headless，llvmpipe WebGL2）：修复前同堆栈（copy ← refreshTransformUniform ← bakeSixParts），修复后 reze 全流程 SIXPART OK（148 骨 / 48 组）。
修法（结构层）：BakedMesh 增 materials + triMaterial（按 geometry.groups 逐三角形记材质号）；buildPartGeometry 按材质拆视图、视图自带单个 material；两处颜色遍改用 view.material。单材质网格行为不变。makeToonFromSource 另加数组防御（取第一个）兜底误传。探针 probe-material-groups 8 项（数组防御/triMaterial 分组/视图拆分/颜色对位）+ 既有回归 + tsc + build 全过。
同轮 GL 台顺带验掉两笔旧账：双遍在真实 GL 下完整跑通（ID 遍 alpha 像素 2502，甲的两半 ID 读回有数）；Live2D 的 renderDrawableWebGL 真实隔离渲染出图（34 图元、不透明贴图像素 13276、zip 2.24MB）——余下未验只剩 Cubism/VTS 加载与 ID 解码逐骨正确性（探针已在编码层验过）。
