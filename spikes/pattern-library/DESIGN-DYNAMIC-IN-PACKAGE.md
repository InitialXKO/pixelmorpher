# 乙方向设计：动态三段（形变/发射/粒子）进运行时包

状态：研究设计（2026-10-24，基于 main 334963df 代码实查；未开工实现）。
发光段已进包（乙案印章重算），不在本文范围。

## 结论先行

可行，且比预想便宜：**数据侧已经就位**——动态实例的全套参数（含形变/
发射/粒子三段）早已随发光段一起被 convert 解析并写进包里，模板只是没
消费。缺的是模板侧三件：包里补一个帧率数、形变合成点、粒子模拟移植 +
一条独立粒子绘制路径。包体积除一个帧率数字外零增长。

## 现状证据

- 包内数据：`RuntimePart.dynamic?: RuntimeDynamicInstance[]`，其中
  `RuntimeDynamicInstance = { slot, params: DynamicPatternParams }`——
  params 是全套四段参数（convert.ts:53、93-105）。换装集同理挂在
  `costumes[*].__dynamic`。convert 在 convert.ts:377-380 用
  `resolveDynamicPatterns(nodeDyn, pieceDyn)` 解析（与编辑器同一函数）。
- 编辑器消费点（主画布，unified-render.ts）：
  - 1646-1658：形变——解析后逐实例 `dynamicDeformAt(params, tSec)`，
    tSec = frame / frameRate，sx/sy 连乘进本节点的 stretch/scaleX，
    只动本节点精灵、不沿层级传播；
  - 1827 起 `drawDynamicParticles`：粒子——逐节点按 back/front 两层调
    `simulateDynamicParticles(resolved, sprite, frame, frameRate, mirror,
    layer, nodeId)`，Canvas2D 径向渐变圆绘制，坐标为节点本地（原点=plug）。
- 模拟本体（dynamic-pattern-sim.ts）：纯函数、无 DOM。粒子集合只由
  （实例、精灵网格、帧、帧率、镜像、层、种子键）决定：逐出生帧回放生命
  窗口，发射率受出生时刻形变脉冲调制（linkToDeform），随机性全部来自
  FNV 哈希（hash01/seedFromString），确定性、任意帧可直接求值。
- 形变本体（dynamic-patterns.ts `dynamicDeformAt`）：正弦脉冲
  p∈0..1 → sx = 1+(stretchX-1)p、sy = 1+(squashY-1)p，amount=p。
- 包内可达的像素网格：精灵部件 `part.sprite = { w, h, plug, data }`、
  参数化部件 `part.base.baseSprite`（同形）都在包里，模板建图集时用的
  就是这些网格——轮廓提取不需要新增数据。
- 包里没有帧率：`ProcRuntimePackage` 无 frameRate 字段（convert 内部
  用 opts.frameRate 算时长，缺省 12，未落包）。

## 设计

### 1. 数据侧（仅 convert 一处）

包顶层加 `frameRate: number`（= 导出时工程帧率，与段表演时长同源）。
其余零改动：三段参数已在 `part.dynamic` / `costumes[*].__dynamic` 里。

### 2. 形变段（模板）

- 合成点：模板逐部件算出本帧位姿、打包实例之前。部件的 dynamic 列表
  （按当前服装集取，与 __sprite/__glow 同路）逐实例算
  `dynamicDeformAt(params, behaviorT)`，sx/sy 连乘后乘进该部件实例的
  缩放分量。运行时部件是扁平摆放、无层级传播，与编辑器「只动本节点
  精灵」同义。
- 时钟：用 behaviorT（行为时钟，与行为图同钟、表演开始时归零），
  不用页面墙钟。相位后果见「近似与待决」。

### 3. 发射 + 粒子段（模板）

- 模拟移植：把 dynamic-pattern-sim 的四个函数（hash01、seedFromString、
  extractContour、sourcePoints、simulateDynamicParticles）与
  dynamicDeformAt 逐式移进模板 JS。两处口径适配：
  - 包内网格是像素口径、plug 已是 px，编辑器侧的 subToPx 换算恒等略过；
  - 轮廓缓存键改用「部件 key + 服装集 + 方向变体」（编辑器用像素哈希，
    模板侧无 hashPixelGrid；部件网格在包内不可变，按 key 缓存即可）。
- 帧量化：frame = floor(behaviorT * 包帧率），frameRate = 包帧率。
  seedKey 用部件 key（编辑器用 nodeId，同为稳定标识）。
- mirror：包内部件的镜像态（变体镜像解析后）传入 sim 的 mirror 参数，
  实现时须与编辑器指令 mirror 同口径核对（待核，不预设）。
- 轮廓源（2026-10-24 用户拍板：照发光的先例，convert 预提取进包）：
  不在模板里现提，convert 用与发光场同一张代表图
  （representativeGridForSlotEx，逐服装集）预提取，随
  part.dynamic / costumes[*].__dynamic 同路进包：
  - 轮廓点数组（扁平 [x, y, nx, ny] × n，extractContour 同算法）——
    供 contour / contour-top / contour-bottom（top/bottom 在模板按
    ny 符号过滤，与编辑器 sourcePoints 同谓词，含空集回落全集）；
  - 实心位掩码（w/h/bits，与发光掩码同位打包）——供 inside 源，
    模板展开为全部实心点；
  - plug 源不需要数据（模板按部件 plug 现算，与编辑器同式）。
  只给「有启用发射实例（emitEnabled 且 rate/life 有效）」的部件生成，
  无发射的部件零增长。点坐标为代表图像素索引、法线单位向量（小数
  截断到 3 位）；32x48 精灵轮廓约 150 点、约 3-4KB JSON 量级。
  口径继承：点在代表图空间，与发光场同 basis——镜像变体由 sim 的
  mirror 机制覆盖（全程未镜像空间算、最终 x 反号）；非镜像的独立
  方向烘焙与代表图不一致时，轮廓从代表图，即与发光共担既有的
  「代表图方向」口径（承前已知项，非新增风险）。精灵部件与参数化
  部件由此同路：不再区分剪影近似，参数化部件的轮廓 = 代表图
  （编辑器烘焙口径）的轮廓。

### 4. 粒子绘制（模板，独立粒子程序）

部件程序的属性预算已满 16/16（见着色器修复），粒子数据塞不回去，
必须独立程序——它有自己的属性预算，互不影响：

- 属性（每粒子 7 个数、3 个属性槽）：中心 xy、直径、颜色 rgb、透明度。
- 片元：径向衰减（距中心距离 → alpha 平滑衰减到 0），与编辑器
  Canvas2D 径向渐变同视觉；普通 alpha 混合（编辑器非叠加混合）。
- 绘制顺序两遍：背层粒子一遍（部件主绘制之前）→ 部件 → 面层粒子
  一遍。跨节点重叠的近似见下。
- 数量兜底：sim 本身按 maxParticles 截断（分层拆分同编辑器口径）。

备选（不推荐 v1）：逐部件交错绘制（每部件：背粒子→部件→面粒子），
层级完全对齐编辑器，但要拆掉现在的一次性 instanced 主绘制，性能与
改动面都不划算。

### 5. 服装集

模板切服装集时，dynamic 列表与 __sprite/__glow 一样按当前集取
（默认集用 part.dynamic，其余集用 costumes[集][槽位].__dynamic；
解析已由 convert 做完，模板不重做双挂载合并）。

## 成本与风险

- 包体积：+1 个数字（frameRate）+ 发射部件的预提取轮廓数据
  （每件约几 KB，只给有启用发射实例的部件生成）。三段参数本来
  就在包里。
- 模板代码：约 +350~450 行 JS（模拟移植 ~200、形变合成 ~20、
  粒子程序 + 打包 + 两遍绘制 ~150、服装集取数 ~20）。
- 每帧 CPU：sim 回放窗口 = life × fps 个出生帧 × 实例数，与编辑器
  主画布同算法同量级（主画布已在跑）；轮廓按 key 缓存只算一次。
- 风险点不在算法，在三处近似（下节）与 mirror 口径核对。

## 近似与待决（须用户知晓/拍板）

1. **绘制层近似**：两遍绘制下，A 节点的背层粒子会画在 B 节点精灵
   之下，哪怕 A 在 B 之前——编辑器是逐节点交错的。粒子是柔光圆点，
   重叠处误差不易见，但存在。接受此近似，还是 v1 就上逐部件交错？
2. **时钟相位**：形变/粒子用 behaviorT——表演一开始，相位与粒子
   出生回放都从 0 重来（与行为图同钟）。编辑器预览是时间线循环钟，
   长待机时相位与包内不一致。接受 behaviorT，还是用页面连续钟
   （elapsed，相位永不重置，但与行为图脱钩）？
3. **参数化部件轮廓（已拍板）**：照发光的先例——convert 用代表图
   预提取轮廓点 + 实心位掩码进包（见上「轮廓源」），精灵/参数化
   部件同路，不做剪影近似。代价：发射部件每件多几 KB 数据；
   口径与发光场统一（代表图 basis，含其既有方向口径）。

## 验证方案（实现时）

- 等值门（最硬）：同一网格 + 同一参数 + 同一帧，模板移植版 sim 与
  编辑器原版 sim 的粒子数组逐项相等（探针双路比对，含形变采样点）。
- 模板探针复用 T13 解析门 + 新增 dynamic 接线标记；convert 探针
  断言 frameRate 落包。
- 真工程导出 + 浏览器行为检查：粒子出现/形变呼吸/换装后实例跟随。

## 工期口径

模板侧集中改一个文件（runtime-template.ts）+ convert 一行 + 探针，
与发光进包（乙案）同等量级。

## Spike 证据（2026-10-24，spike-sim-check.mts，9 项全过）

模拟本体脱离编辑器、在研究 worktree 里以真工程（发光工程）数据独立
运行：精灵网格取工程真实精灵（16x20），实例参数两路——工程里的真实
动态实例（slot=环境效果，仅发光启用、发射/形变关）证实存储路径在真实
数据里存在；粒子断言用缺省参数实例（发射默认开）配同一真实网格。

- 确定性：同输入两跑粒子数组逐项相等；
- 计数：48 帧内粒子非空，分层上限（front/back 各自 cap）不破；
- 分层：layer=both 时 front/back 都有粒子；
- 镜像：粒子数一致、x 逐项反号、y/alpha 不变；
- 形变：脉冲峰（t=0.25 → sx=1.2/sy=0.8）与谷（t=0.75 → 恒等）准确，
  未启用恒等；
- 调制：linkToDeform=1 且形变关时发射归零（amount 恒 0 → 发射率为零）。

结论：模拟层无 DOM 依赖、可原样移植进模板 JS，移植风险不在算法，
在绘制路径与三处近似（见上）。
