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

## 五、仍待用户拍板

1. P4 阈值实验是否做。
2. P5 Helper 截断链是否并入本线。
3. 乙的「烘焙警告可见化」还做不做（甲后仅剩 ≥64 极端部件与
   其他静默丢弃需要它）。
