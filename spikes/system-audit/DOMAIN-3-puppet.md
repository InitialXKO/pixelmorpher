# 域 3 审计：木偶与服装

审计树：`~/workspace/pixelmorpher-audit`（audit/full-system == main 3a4a55c + 审计立项提交）。全程只读，未改产品代码。
方法：每项走全链五段（①入口/数据定义 → ②store/写入 → ③消费端调用 → ④消费端内部判断 → ⑤存档/进包往返），缺段不写通。承重断言（标★）由审计人本人复读代码坐实，其余为分域通读证据。

先纠一处任务前提：点名的 `SplitImageDialog.tsx` 是零引用孤儿（见断裂表 D9）；2D 拆分活链入口是 `ThreeBakeDialog` + `bake/`。另 `src/lib/ref-image.ts` 只含参考图绘制几何，装配六项实际分布在 editor-store + character-slice + RefAssemblyWizard + MaskBrushOverlay。

---

## 一、节点骨骼

### 1. Node/Character 结构：node.slot vs node.sockets 区分
- ① `unified-types.ts:504-520` Socket 定义；`:815` Node，`:830 sockets: Socket[]`（挂接点）与 `:893 slot?: CostumePiece`（服装件定义）两独立字段、注释各自写明。
- ② `unified-types.ts:1800-1811` createDefaultNode 同写 slot 与 sockets:[]；烘焙线 `bake/skeleton-mapper.ts:649,854` 写 node.slot。
- ③④ 精灵解析读 slot 键：`unified-render.ts:1590` `costumeSet.pieces[node.slot?.slotKey?? node.id]`（:1583-1590 注释「node.slot 只定义槽位，不存精灵」）；挂接解析读 sockets：`unified-render.ts:1083` `parentNode.sockets.find(...)`。全仓无一处把 slot 当 sockets 读；convert 同口径（`proc-runtime/convert.ts:1002,2354`）。
- ⑤ `store/project-slice.ts:364` 整表导出；导入 `backfillNodeSlots`（`unified-types.ts:1861-1871`）只补无 slot 节点、不碰 sockets。
- 附注：`Node.sprite?` 与 `Character.sprites?` 是旧字段残留，渲染代码多处注释明示现行管线从不赋值，未发现活链误读。

### 2. 静态改父 reparentNode + 成环防护
- ① `puppet/RigPanel.tsx:520-557` 连接下拉：候选先 `collectSubtreeIds` 排除自身子树（:525-526）、IK 中间关节先拦、失败 alert 点名循环。
- ② 守卫本体 `node-actions.ts:151-171`：根拒绝、目标不存在拒绝、`:163` 子树拒绝、socketId 须真实存在；`collectSubtreeIds`（:10-38）同时认 parentId 与 attachment.parentSocketId 两条后代关系。
- ③ 写入三处写齐 `node-actions.ts:176-197`：旧父 children 摘除、新父 children 追加、节点 {parentId, attachment} 一并更新（文件头注释明示只改 attachment 会半吊子，代码与之相符）。
- ④ FK 按 children 遍历并在父身上查 socket（`unified-render.ts:1072,1083`），正对该读法。
- ⑤ 本体字段随整表存档/进包，convert 逐帧调同一 FK，无第二套父子关系。
- 说明：`node-cycle.ts` 与成环无关（中键循环命中 cycleHitNodeId），勿误认。

### 3. 抓握切换 planParentSwitch（按帧重挂）
- ① `RigPanel.tsx:281-322`，候选先全量排除子树（:290-291）再调 `parent-switch.ts`。
- ② 函数本体守卫偏弱：`parent-switch.ts:41-46` 只沿静态 parentId 链上行，不认插槽归属后代与 parentKeys 有效父链——绕过 UI 直调会漏。当前唯一调用点即已预筛的 RigPanel，活链不漏。
- ③ 只产 tracks（parentKeys+补偿键），RigPanel:315 落 store。
- ④ 第二道运行时回退：`unified-render.ts:390-417` effectiveCharacterAt 内 DFS 找环、环中最近切换者回退静态父级，够不到根的挂根兜底——写出环也不会无限递归。
- ⑤ convert 逐帧采样同一 computeWorldTransforms（`convert.ts:316,818,1791`）。

### 4. computeWorldTransforms：Socket offset3D 与 Transform 分层
- ① `unified-types.ts:511` Socket.offset3D（父→子 3D 向量、direction 无关）；`:635-659` NodeTransform/createDefaultTransform 全零。
- ② 烘焙写入合定案：`bake/skeleton-mapper.ts:582-587` 明示「Transform 归零、静态 3D 偏移存 Socket.offset3D（选项 A）」；`:679-704` offset3D = joint3D 差值 × 全局像素 scale，`:700` Y 取反（Y-up→Y-down）★。
- ③④ 消费唯一口径 `unified-render.ts:1212-1222 socketOffsetTo3D`：offset3D 存在直接三轴返回、directionOffsets 不参与；不存在才走 2D 映射。FK 合成 `:1093-1101` 总偏移 = socket 3D（静态层）+ 子节点 transform（动态层），两层不混写。关节盘同口径（:1740-1753）。
- ⑤ offset3D 随 Socket 整表存档；convert 同 FK 采样，无两端再解释。
- 例外（在案非漂移）：臂链内 offset3D 拉直为纯 +Y 骨长（`skeleton-mapper.ts:688-696`），靠链根 ∓90° 基础角摆回——「offset3D 恒等于 joint3D 差值」对臂链内不成立。
- 风险点名：`bone-axis-guard.ts:70-81 socketOffsetPx` 是 socketOffsetTo3D 的本地复刻（避循环依赖），逐行比对当前一致，属双实现潜在漂移点。

### 5. 视图开关 → 骨骼/网格消费端（审计人亲验★）
历史故障「按钮→store 对、渲染不查标志」已不成立：`PixelCanvas.tsx:363` `if (s.showGrid) renderGridOverlay(rc)`；骨骼层 `:394 shouldRender: s.showPuppetSkeleton &&...`、`:406` 同标志把关；旧的双标志（showSkeletons）已不存在，只剩 showPuppetSkeleton 一套。

---

## 二、槽位 Socket

### 6. SocketEditor 增删改主链
- ①② `SocketEditor.tsx:28-34` 纯展示；实际接线 `PuppetAssetPanel.tsx:991-1006`；`socketToInfo`（:66-81）SubPixel→px 含 offset3D 三轴；`handleSocketChange`（:452-479）px→pxToSub 写回，以 `'offset3D' in updates` 区分删 3D；新增三处构造一致（PuppetAssetPanel:481-493 / RigPanel:150-162 / node-actions.ts:202-214）；删除两处同语义（删 socket 后挂其子节点 detach 为 fixed{0,0}，子节点跳父原点——两处一致的既定语义，但 confirm 文案未提示位置跳变）。
- ③④ 消费同 §4；画布拖 socket 亦通（`canvas/tool-handlers.ts:268-312,437-473`，3D 保留深度分量反解、2D 同写 base 与 directionOffsets[viewDir]）。
- ⑤ sockets 随节点整表存档，无独立序列化丢字段点。

### 7. SocketEditor 点方向格清零偏移★
- `SocketEditor.tsx:124-136 handleDirClick`：注释写「create one seeded from base position」，实际 `:134` 写 `[dir]: { x: 0, y: 0}`。
- 消费端 `unified-render.ts:1192 resolveSocketOffset` 是 `directionOffsets[dir]?? basePosition`★——方向条目一存在即压过 basePosition。
- 机制后果：对 basePosition 非零的 socket，用户仅点开某方向查看，该方向生效偏移即静默变 (0,0)，子节点当场移位。注释与代码不符 + 查看动作改写参数。

### 8. offset3D 生效时 base 编辑无消费 + RigPanel 无 3D 编辑面★
- `socketOffsetTo3D`（unified-render.ts:1213-1215）在 offset3D 存在时完全不读 basePosition/directionOffsets。
- 但 SocketEditor 的 base X/Y 输入（`SocketEditor.tsx:184-202`）在 3D 生效时照常可编辑、无提示（只有「方向偏移」区:256 有不生效标注，base 区没有）。
- 第二套活编辑器 `RigPanel.tsx` 对 offset3D **零提及**（grep 计数 0）★：只编辑 name/basePosition/skinning——3D 角色在 RigPanel 改插槽 X/Y 必然改了不生效且无从察觉。两编辑器覆盖面不一致，双实现漂移已成事实。

### 9. 裁剪/plug 对位口径★（与 §10 对照）
- `bake/skeleton-mapper.ts:298-315 splitByBoneId`：jx/jy 取全帧 jointPixels，紧包围盒 pad=2 仅定 x0/y0/cw/ch，jx/jy 不变；`:361-372 plugX = jx − x0` 存裁剪框内偏移、jointX/jointY 全帧值另存。`cropGridToContent`（:453-478）同口径。与定案逐项相符。组装端 attachment.plug 置零防双重偏移（:607）。

### 10. Socket 2D 偏移从未按全帧关节差计算★
- `skeleton-mapper.ts:505-507,666` 注释称 socket 偏移 = 子关节 − 父关节（全帧 2D 坐标），但组装代码 `:673-711` 把 basePosition 与全部 directionOffsets **一律写零**（:704-711 注释「2D 回退时用零值」★），唯一非零来源是 joint3D→offset3D。
- 现行全部 ProcessedBone 生产者都带 joint3D，活链靠 offset3D 对位不塌；一旦出现无 joint3D 的骨骼数据，子节点 socket 偏移恒零、塌到父关节。与注释/定案不符，触发条件明确：joint3D 缺失。

### 11. 向导 attachment.plug 未做 pxToSub
`PuppetCreationWizard.tsx:578-583` 写 `attachment.plug = {x: def.plug.localX,...}` 未 pxToSub（同函数 socket basePosition 在:564 做了），消费端一律 subToPx（unified-render.ts:3297-3298、convert.ts:1285）。现行模板 plug 值全为 0，故未构成现行错误；模板出现非零 plug 即放大 16 倍。

---

## 三、服装系统

### 12. 分层写 ↔ 读侧孪生（八方向解析核心）
- ① `unified-types.ts:395` DirectionIndex 0..7；`:1203-1210` CostumePiece.sprites / variantSprites / latitudeSprites；`:1427-1431` variantDefs + slotVariants（角色级）。
- ② 写侧 `store/character-slice.ts:120-156 applySpriteToPieceLayer`：纬度≠0 只落 latitudeSprites[latitude]（:138-144）；纬度=0+变体落 variantSprites[variantId][dir]（:146-153）；否则落 sprites；null 删格。store 包装 `setUnifiedCostumeSpriteLayered`（:825，落点:856）；顺带指派仅纬度=0+变体写+该槽原无指派时。
- ③ 渲染 `unified-render.ts:1547,1591` 与 convert 五处（`convert.ts:388,438,1309,1596,2341`）同调 `resolvePieceSprite`。
- ④ 读侧孪生 `character-slice.ts:162-179 readPieceLayerSpriteId` 与写侧同一层序、精确键（纬度≠0 变体参数被忽略，两侧一致）；解析链 `sprite-resolve.ts:35-105`：纬度层→变体直达→变体镜像→基础直达→基础镜像（mirrorMap 缺省表 unified-types.ts:432-438）。
- ⑤ 工程导出/导入整表原样（project-slice.ts:332,364,376），无剥层规范化；撤销快照同口径。latitudeSprites 键经 JSON 变字符串、读写均数字键访问，不丢。
- 附：非分层版 `setUnifiedCostumeSprite`（character-slice.ts:795）全仓无调用方，是死代码，勿当活写侧。

### 13. 纬度层：值域三套 + 写精确/读模糊★
- ② 写入值域互不一致：装配向导五档离散（`RefAssemblyWizard.tsx:1407-1413` 仅 0/±45/±90）；烘焙线只有正值（`bake/threejs-baker.ts:31 FULL_ANGLE_LATITUDES=[45,90]`、`skeleton-mapper.ts:644-645,849-850` 以 dirLat 为键直写）；角色纬度滑杆是 **0–90 连续**（`DirectionWheel.tsx:188-193`，经 PerformPanel/PuppetPanel 写 character.latitude）——负纬度在此入口不可达，任意非档位值（如 30）可写入、无吸附校验。
- ④ 渲染消费是模糊最近邻：`sprite-resolve.ts:47-58`★ 取差 ≤22.5° 的最近已存纬度整套优先。即纬度=30 显示 45° 层、纬度=22 差 23° 回落变体/基础链。与写侧「纬度≠0 只落纬度层」的精确键语义不对称，仅在档位值上恰好重合。
- ⑤ convert 传 character.latitude，但每集每槽塌缩一张代表图（见 §14），多纬度层不分别进包。

### 14. 换装三处口径：渲染 / convert / 面板
- 渲染：生效状态三层叠加（静态→clip 状态轨→状态蓝图）`unified-render.ts:2323 resolveEffectiveCostumeState`，`:3018-3068` 按生效集/生效 slotVariants/当前纬度逐方向解析。
- convert：同函数但输入不同——生效集 = `activeCostumeSetId?? costumeSets[0]`（`convert.ts:835-836`，不吃 clip 轨/状态蓝图）；变体取静态 slotVariants；方向按 `[homeDir,2,0,6,4,1,3,5,7]` 回落序塌缩一张代表图（:372-395）；altSprites 只收 clip 点名过的变体（:1300-1332，注释自认近似）。包内冻结的是导出时刻静态口径——此为已点名的包格式限制，非静默，但与编辑器逐帧生效状态不是同一口径。
- 面板（DressPanel）双实现漂移★：`DressPanel.tsx:371-427 handleSpriteAssign` 手写拼 sprites/variantSprites，**不调 applySpriteToPieceLayer**（grep 计数 0）★、完全没有纬度维度；读侧 `:429-443 getSpriteFor` 只直读 table[direction]——无镜像回落、无纬度、无变体→基础回落（靠:445+ 单独显示「回落基础」徽标）；且内嵌 Sprite 形态 `'spriteId' in ref` 为假直接返回 null，而共享解析 `sprite-resolve.ts:17-27 resolveEntry` 认内嵌——旧数据在面板显示为空、渲染却有图。
- 另一分叉：activeCostumeSetId 未设时 convert/面板/getActiveCostumeSet 都回落第一集，**主渲染不回落**（unified-render.ts:3022 find 不到即 undefined、整角色无图）。

---

## 四、参考图装配

### 15. 装配六项
- 4a 目标集可选已有套（深快照）：`RefAssemblyWizard.tsx:1292-1318` 选择；已有集开会话先 `structuredClone(pieces)` 快照 + prevActiveCostumeSetId（:636-637）；新建走 addUnifiedCostumeSet（:640）。
- 4b 分层写：遮罩完成（`MaskBrushOverlay.tsx:933-945`）与向导派生（RefAssemblyWizard:924）都汇入同一 `setUnifiedCostumeSpriteLayered`；向导外单独用遮罩走手写基础层，与 editor-store.ts:76-88 注释明示口径一致，属明示回落。
- 4c 按（方向×纬度）分槽：`editor-store.ts:50-52 refImageSlotKey = dir|lat`；向导槽表/切槽归档/选图三入口都只写当前槽。
- 4d 进度组合键：`editor-store.ts:55-69 refAssemblyComboKey`（纬度≠0 时变体部归一空，与写侧层序同口径）；向导:695-730 记进度、:1803,1826 确认步同键合并。方向取写入时刻根节点 variantIndex，与遮罩写侧落格方向同源。
- 4e 覆盖确认（限定）：门在向导侧 `RefAssemblyWizard.tsx:867-887`（用读侧孪生查目标格占用），两个发起端齐全（绘遮罩:1555-1556、派生:913-914 均先确认）；MaskBrushOverlay 本体确认不再查门——只能经向导入口进入遮罩态，前置成立；若将来出现第二个遮罩入口，此门被绕过。
- 4f 指派回滚：`character-slice.ts:193-213 computeSlotVariantsAfterAssemblyDiscard` 只删仍等于顺带值的指派；调用方 RefAssemblyWizard:342-371 配套回滚 pieces（新建集删套/已有集快照还原+生效集还原）。
- 附带文案不符：关闭确认文案（RefAssemblyWizard:1007）称放弃将删除「含已抠出的精灵」，但 discard 路径只删服装集/还原 pieces，装配期间新建的全局精灵（写入 s.sprites 者）无任何删除调用——精灵成孤儿留在全局表。
- ⑤ 会话态（refAssemblyTarget/writes/进度/槽图）是 editor-store+模块级变量，不进工程文件，重载即失——代码事实如此，是否有意未验证。

---

## 五、2D 拆分

### 16. IK 解析求解器按段数自动选
- ① `unified-types.ts:1284-1285 IKChain.solver:'2bone'|'fabrik'`，注释即定案口径。
- ③④ 消费端选择 `unified-render.ts:963-1001`：非 fabrik 且 ≥2 段时 2 段→solveIK2Bone3D、3 段→solveIK3Bone3D（null 回落 FABRIK）、4 段末段尖端→剥尖端 3 骨、其余 FABRIK；显式 fabrik 优先。烘焙桥同口径（`blueprint/ik-bake.ts:82`）。
- ⑤ ikChains 随 Character 整体序列化（project-slice.ts:164,194）；`node-split.ts:775-777` 插关节后按新段数点名口径一致。
- 未验证：各建链入口的缺省 solver 写入未逐一追踪（已知 stroke-build.ts:298 写 '2bone'）。

### 17. 胶囊/关节分段只用于臂腿、torso 走 ID 掩码
`bake/skeleton-mapper.ts:873-876 LIMB_SEGMENT_PARTS={armL,armR,legL,legR}`（注释明示躯干靠 ID 遍改写、必须走 ID 掩码）；分流判断两处同口径（:1063-1064、:1394-1395）：肢体走 segmentPartOwners（:886-963 按关节段最近距离归属），非肢体走 decodeBones 位掩码解码。

### 18. 链头帮手几何判定
`bake/threejs-baker-twopass.ts:462-472`：`segLen(0,1)*4 < segLen(1,2)` 才判链首为髋辅助并入大腿（几何近重合才算），否则链首本身即大腿；注释明示旧「无条件取次节」口径已废。

### 19. 手动前缀拆分甲/乙双选项
① `bake/threejs-baker-manual.ts:108-113 bonePrefixSplit?:'none'|'parts'|'layers'` 与定案一致；② UI `ThreeBakeDialog.tsx:815,1250,1603-1606`；③④ 消费:915-986 词干分组，甲（:1073-1105）非基底组各成独立条目、枢轴取组主导骨骼、父级沿骨骼链解析，乙（:1106-1134）一个部件条目 + layeredParts；⑤ 乙走 mapBonesToNodesLayered（skeleton-mapper.ts:766-860）、甲走 mapBonesToNodes。

### 20. 堆叠按骨骼建
六部件：`bake/threejs-baker-sixpart.ts:782 buildBoneStacks` 逐骨聚合（一骨一摞，:156 注释），调用:1116-1124，UI 开关 ThreeBakeDialog:812-814。手动线：`threejs-baker-manual.ts:1135-1149 buildManualPartStacks` 按**部件条目**建摞——因手动线无骨骼节点、条目即节点，属设计差异非断裂，但汇报口径须分线。

### 21. 拆分产物挂载链
- 烘焙线：`skeleton-mapper.ts:547 mapBonesToNodes`——node id/slotKey 规则化、piece.sprites[dir]/latitudeSprites 落图（:640-648）、node.slot=piece（:649）、精灵 plug=(jx−x0, jy−y0)（:625-646）；sockets 与 offset3D 见 §4/§10。store 一次性写入：`ThreeBakeDialog.tsx:1360-1395 handleImport`（addUnifiedCharacter 传 skipPlaceholderRoot:true + 一次 updateUnifiedCharacter + 单次 setState 合并精灵）；堆叠经 `bake/stack-attach.ts:46-110` 按宿主节点挂 piece.stack。
- 段中插关节线：`canvas/tool-handlers.ts:2007` → `store/character-slice.ts:457-475 splitUnifiedNode` → `node-split.ts:317 splitNodeSegment`：新节点 M、S 的 children 改指 M、sockets/attachment 重接、精灵切两幅挂 S/M、堆叠按层断两摞（:674-680）+ 远段原点静止帧回填（:723-755），store 单次写回。

---

## 六、伪 3D

### 22. faceTurnConfig + facingAngle 方向混合/单图模式
① `unified-types.ts:1483-1492`；② `puppet/PerformPanel.tsx:226-275` 三控件走 updateUnifiedCharacter；③④ `unified-render.ts:3029-3049` 门控 `facingAngle!==undefined && faceTurnConfig?.enabled`：单图→singleImageYaw 不切图，否则 `skin/face-turn.ts:229-242 facingAngleToBlend` 双向混合（:3251-3271 双向 applyFaceTurn 后 alphaBlendGrids）；执行端 applyFaceTurn（:4497-4510，像素定稿后、蒙皮前）。⑤ 随 Character 往返；convert 不读 faceTurnConfig，此机制编辑器侧闭环。

### 23. facingAngle 连续偏航：门控与 §22 不一致
同一字段两套消费：偏航消费**不查 enabled**——`unified-render.ts:3095-3096` 仅门控 `geometryDirection===undefined && facingAngle!==undefined` 即整表旋转世界变换；`sketch-pose.ts:75-76` 同条件复刻；进包同口径（convert.ts:819-823、1748-1749）。UI 已自知：PerformPanel:237-238 滑杆在「enabled 或有堆叠件」时显示、tooltip 明写未启用时平面精灵只按离散朝向选图。即行为可预期，但属「缺省/门控两端不一」。另 nodeTurn3D 开时偏航被压制（:3095），而 §22 的 dirBlend 计算不查 geometryDirection（:3032），两者叠加的选图口径无显式裁决——未验证。

### 24. nodeTurn3D
①② `store/editor-store.ts:271` 缺省 false、`:383 toggleNodeTurn3D`；入口 PixelCanvas 右键菜单（:848-849）。③④ `unified-render.ts:1199-1204` 开→几何基准方向 6；调用方遍布画布渲染/工具/拾取；拾取戳记含此开关（pick-buffer.ts:17,30-33），切换即旧编号图作废，同口径。⑤ editor-store 无 persist、不进工程/包——会话级视图开关，存档段不适用（按设计）。附：types.ts:1668 有一份同名旧 EditorState 接口双定义，同名同型，暂无漂移证据。

### 25. node.faceTurn 静态值
编辑器全链：定义 unified-types.ts:864；写入 FaceTurnPanel.tsx:41-54；指令 unified-render.ts:3485-3496；执行 applyFaceTurn:4497-4510。⑤ **proc-runtime/ 全目录对 faceTurn 零引用**（grep 无结果）★，且 convert 无点名警告——静态转面进包静默丢失。

### 26. faceTurnKeys 转面轨★
- ①② 定义 `unified-types.ts:924-925`（注释「优先于 node.faceTurn 静态值」）；写入齐全：character-slice.ts:577-590 setNodeFaceTurnKey、FaceTurnPanel:58-61 打点、plugin-api.ts:125、clip-migration.ts:122-126 迁移入轨、时间线有子轨显示（timeline/FaceTurnSubTrackLane.tsx:24-27）。
- ③ 插值函数存在：`engine/render-helpers/puppet-keyframe-interpolation.ts:374-387 getInterpolatedTrackFaceTurn`，:131-132 合并（轨优先）。
- ④ **断点**：该结果只流进辅助路径 interpolateNodeKeyframes 的调用方（Timeline/tool-handlers/PerformPanel 等）；主渲染 interpolateTransform（unified-render.ts:1261+）不读 faceTurnKeys，指令构建处留明文 TODO（:3482-3484：「当前用 node 静态值」）★。用户在时间线打的转面关键帧不改变主画布渲染。另插值函数要求 prev 与 next 同时存在（:378），单点/区间外恒回落静态值，辅助路径内亦不完整。
- ⑤ 进包同 §25，静默丢失。

### 27. proportion-guide
① `proportion-guide.ts:12-18,57-98,118-167` 预设/关节点位/绘制；③④ 消费 `PixelCanvas.tsx:551-556 applyProportionGuide` → setReferenceImageUrl+Visible 走既有参考图通道，入口右键菜单:841-846，绘制:103-110,282,449-459。⑤ 垫图是会话状态不入工程，按其定位不适用存档段。

---

## 七、蒙皮与堆叠

### 28. 网格蒙皮 mesh-skin（socket.skinning='mesh'）
① `unified-types.ts:510-517` skinning/skinRadius/skinCurve；② RigPanel.tsx:775,801-835 模式/半径/曲线走 socket patch；③④ unified-render 计划期：父 socket 为 mesh 时算相对关节角，`radius?? 8`、`curve?? 'smoothstep'` 与写入缺省一致，执行端 applyMeshSkin（skin/mesh-skin.ts:44，unified-render:4520-4540 一带），门控 |角|>0.01 && radius>0，位于 faceTurn 之后。⑤ convert.ts:1272-1290 同字段回填 part.skin、缺省同为 8/smoothstep；运行时公式本体在包外，convert 注释自称同公式，无本仓证据——未验证。

### 29. 蒙皮快照弯曲 snapshot-capture
①② `skin/snapshot-capture.ts:33-141` 克隆角色只渲父/子两节点产 SkinningSnapshot；写回 PerformPanel.tsx:454-475（合并精灵 + attachment.skinningSnapshot），前置开关 allowSkinning 在 RigPanel:599-602。③④ 消费门控 `unified-render.ts:1515-1544 computeActiveSnapshots`：allowSkinning===true && 快照存在 && direction===当前方向，一父只被首个子认领；计划期:3167-3224 被认领父跳过、子以合并精灵出 snapshotSkin 指令；执行 applySnapshotBend（skin/mesh-skin.ts:175）。⑤ **convert 对 skinningSnapshot 零引用、无点名警告**★——进包静默丢失（与 §28 mesh 蒙皮进包形成对照）。

### 30. 堆叠合成 stack-render
① `unified-types.ts:1216 CostumePiece.stack`；③④ `unified-render.ts:3437-3447` 生效件带 stack 时 computeStackOps（stack-render.ts:163）+ stackBendForNode 接缝弯曲（:2905-2957，now/rest 双帧同口径，连续偏航时 rest 同步旋转:3100-3112）；执行端:4616-4633 rasterizeStackOps 逐层栅格化替换 spriteCanvas。⑤ convert 引同一对函数（convert.ts:22），静止图:889-891、逐帧:1826,1933 同口径。

### 31. 拾取编号图 × 堆叠剪影
同源证据：编号图画的是执行端最终 workingCanvas——堆叠栅格图已在:4616-4633 替换 spriteCanvas、镜像成 workingCanvas（:4672-4683）后，:4734-4740 以相同变换 drawPickSilhouette 描入；关节盘同法覆盖（:5043-5044）。faceTurn/蒙皮弯曲均已作用在像素上。故新鲜编号图反映堆叠合成后剪影，readPick 权威口径见 pick-buffer.ts:13-33,67-85。降级：编号图不新鲜时，堆叠件被排除在几何 tier 0 外（node-picking.ts `!hasStack &&!bufferAuthoritative`），只剩 tier 1 胶囊且端点来自回落精灵而非合成剪影——设计上的兜底近似，文件头已声明。潜在缺口（未验证）：戳记不含 effectTracks/canvasModifierTracks 等工程级轨道输入，若其能改变剪影，编号图可能在戳记「新鲜」下过期，本次未追踪影响面。

### 32. 旧 render-pipeline.ts
文件已删（find 无结果）、全仓零 import；仅剩 3 处过期注释（engine/canvas-pool.ts:74、engine/param-driver.ts:285、engine/render-helpers/types.ts:2）。注意 engine/render-helpers/ 不是死代码（puppet-keyframe-interpolation 被多处活引用）——正因它活着，§26 的双实现漂移才成立。

---

## 八、精灵编辑工具群

### 33. sprite-marks 点/选区/方向/矢量主链（编辑器侧）
① `unified-types.ts:336-354` SpriteMark 五类联合挂 Sprite.marks；`sprite-marks.ts:1-6` 自述唯一解析口、找不到/种类不符返回 undefined 永不抛错。② 写入经 normalize：tool-handlers.ts:853、ToolOptionPanels.tsx:458 → store/sprite-slice.ts:106-112。③ 消费确经同一解析层：dynamic-pattern-sim.ts:124,280、unified-render.ts:2562,3399,4559、dynamic-patterns.ts:1303、motion-guide.ts:341、canvas-render-helpers.ts:282（:264 直读仅枚举绘制，非按名解析）。④ 缺名静默回落：findMark（sprite-marks.ts:135-145）→ undefined，消费端 `?? params.directionDeg` 等回落，不崩。⑤ sprites 整表进工程；convert.ts:397,849,1327 把 marks 带入包。

### 34. value 值标记★
UI 可建（ToolOptionPanels.tsx:466-468）、解析函数有（sprite-marks.ts:157-159 markValue），但全仓生产代码对 markValue **零调用**（grep 仅定义处与探针）★。值标记可建、可存、无人读。（direction 种类经 markDirAngleDeg 被消费，不在此列。）

### 35. 包内 marks 解析与编辑器口径漂移
编辑器 `sprite-marks.ts:175-190 markDirAngleDeg` 先找 direction、再找 vector（种类优先于数组顺序）。包内重写：`proc-runtime/runtime-template.ts:398-412` 置换方向按数组顺序首个同名命中即 break（首个若是 point/零 vector，后面的 direction 被跳过、回落 displaceDeg）；`:1029-1060` marksDir 构建同样先到先得★（vector 先出现则 direction 写不进）。同名多类标记或 vector 排在 direction 前时，编辑器预览与进包运行方向可不同。

### 36. marks 载入规整缺失
sprite-marks.ts:93 注释称「载入时规整」，但 normalizeSpriteMarks 调用方只有两处写入路径；导入路径 project-slice.ts:549-597 只做 backfillSpriteBirth，**不对 marks 调用 normalize**。外部/旧工程的非法 marks 原样进表，靠各消费端防御。

### 37. landmarks 特征点
与 marks 是两套独立字段（unified-types.ts:354-355，landmarks 为固定四点、蒙皮转面用；marks 为自由命名），互不转换。链：landmarkHandler（tool-handlers.ts:659-682）→ sprite-slice.ts:98-104 → 消费 face-turn.ts:76-87（缺点位走缺省）、unified-render.ts:3260-3261,4506。selector 现造对象已修：`ToolOptionPanels.tsx:373 EMPTY_LANDMARKS` 常量在、:379-381 两路回落都用它★，注释明示防 Maximum update depth。

### 38. 裁剪/变换/派生不重映射 marks★
`store/sprite-slice.ts:174-242 resizeSprite` 对像素、plug、heightmap、**landmarks（:212-229 按偏移重归一）都重映射，唯独 marks 只靠...sprite 展开原样保留**（grep 该文件 marks 仅出现在 updateSpriteMarks）★；transformSprite（:250-325）同病（landmarks 两路重映射、marks 不动）；deriveSpriteFrom（:328-407）新精灵**完全不带 marks**，标记直接丢失。而系统别处证明 marks 本应随几何走：bone-axis-guard.ts:347 rotateMark、node-split.ts:284-293 splitMarks、convert.ts:1964-2028 shiftMarks。后果：裁掉左/上边后 point 标记相对内容漂移、region 掩码按旧 w/h 错位；旋转/镜像后 direction/vector 不跟转。marks 字段不丢但内容失效，等同存档里存了错坐标。

### 39. 套索（附死代码点名）
入口 CanvasToolRail.tsx:51-55 自动进 sprite_edit；分发 tool-handlers.ts:2049 → **nodeLassoHandler:1571**（旧 lassoHandler:1020 不再被分发，是死代码）。写入仅会话态 selectionMaskRef（use-canvas-state.ts:64），选区本为会话态、无存档往返需求；消费端按局部坐标对齐：Delete（use-canvas-interaction.ts:252-268）、提取选区（use-canvas-state.ts:438-508）、覆盖层 PixelCanvas:367。

### 40. 魔棒
入口参数 ToolOptionPanels.tsx:24-38 容差滑杆 → editor-store.ts:286 缺省 **32**。分发 tool-handlers.ts:2050 → nodeMagicWandHandler:1636 三路（sprite_edit 局部漫水/节点精灵逆映射/旧全局回退；旧 magicWandHandler:1046 同为未分发死代码）。三路判据同（RGB 曼哈顿距 ≤ tolerance×3），但节点两路写 `s.magicWandTolerance?? 10`（:1655,1696）、旧回退直用原值——store 缺省恒 32 使?? 10 永不触发，属潜伏「缺省两端不一」，现行行为一致。

### 41. AI 选区 SAM：会话生命周期
入口 constants.tsx:55 smart_select → smartSelectHandler（tool-handlers.ts:1152）。单例 sam.ts:14-17；store 镜像 editor-store.ts:291-299,432-497：init 先 dispose 再 init、出错置 status:'error'+errorMessage；sam.ts:123-128 init 失败清单例抛错、:210-222 dispose 释放。遮罩面 MaskBrushOverlay:408-424 按输入键缓存编码、:166-180 卸载时恢复原始参考图。消费与套索/魔棒同 selectionMaskRef 通路（tool-handlers.ts:1112-1129,1157-1188）。sam-input.ts 纯几何，活消费方 MaskBrushOverlay + 探针。

### 42. SAM 模型不可用无功能回落
smartSelectHandler:1156-1157 只处理 idle→init 与 ready 两态；loading/encoding/segmenting/error 时点击直接无动作——不降级为套索/魔棒、不提示改用手动选区。UI 侧只有报错+重试（ToolOptionPanels.tsx:85-95）。向导侧稍好：RefAssemblyWizard:1144-1152 失败可跳过该步。

### 43. SAM「提取为Part」★
ToolOptionPanels.tsx:66-74 按钮与 use-canvas-interaction.ts:271 Shift+E 都调 `editor-store.ts:501-596 extractSAMMaskAsPart`，其:585 调 `projectStore.addPart`、:590 调 `projectStore.setPartPixels`、:508,522 直读 projectStore.parts——但现行 ProjectStore **已无 parts/addPart/setPartPixels**（store/types.ts、project-slice.ts grep 无此三名）★，活名是 sprites/addSprite/setSpritePixels。此路径运行时必抛/无果，是 Part 退役残骸被当活链。附带：RefAssemblyWizard:460-461 直接赋值 store.samState.currentMask 绕过 zustand set，订阅方不会被通知（会话状态双写不规范）。

### 44. 修复 inpainting：选项与标签★
- 现行选项表只有两项（repair-patterns.ts:70-73）：`Telea 填补`（inpaintPixels 半径 3）/ `Telea 填补·大半径`（半径 5）——同一函数只差半径，但标签已如实写明大半径，不构成欺骗，属当年裁决后保留的双半径形态。
- 纹理类选项（Bayer/噪点/镜像延伸）**现行表中不存在**，未被换成重复实现；残留死代码：repair-patterns.ts:61-67 BAYER_4X4 常量、:24-41 getBoundaryColors 均无人调用。
- Telea 名实：`inpainting.ts:28-131` 是边界向内逐层传播 + 半径内邻居距离平方反比加权（:83 自注 Telea-style）★，**没有** Telea 原算法的 fast-marching/T 场与方向/法向权重。严格按算法名核对属近似实现挂名。包内 pxInpaint（proc-runtime/pixel-src.ts:92-147）同算法重写、逐行同构，两端无漂移。
- 附带标签不符★：修改器参数 holeFill 的值名/标签仍叫 `edge_copy`／「边缘复制」，但实现已换 Telea：`engine/modifier-renderers/geometric.ts:13-23` 注释自承「用 Telea 填补（替代简单 edge_copy）」而门控仍是 `holeFill!== 'edge_copy'`★；包内 pixel-src.ts:150-160 同。行为不是边缘复制，名实不符。

---

## 九、素材库

### 45. 精灵「当前用途」是活读
先澄清文件分工：asset-types.ts/asset-store.ts 不是精灵库（前者只剩 ProjectMeta/WorkflowSummary、文件头自注跨项目资产库已退役；后者是项目列表 store）。精灵类型上只有 folder（归档）与 origin（出生）两来源字段（unified-types.ts:356-357），**没有「当前用途」副本字段**。删除确认的引用数是渲染时现算：PuppetAssetPanel.tsx:420-432 countSpriteRefs 深走全部 costumeSets.pieces 计数，调用:1171-1176；渲染解析同样活读（sprite-resolve.ts:37-110）。origin 明示是出生非用途（PuppetAssetPanel:130-135 文案、sprite-folder.ts:5-8 口径、backfillSpriteBirth:84-102 只填未设者），不会过期冒充用途。局限（未验证级）：面板除删除确认外不展示挂载清单；countSpriteRefs 靠字符串计数、内嵌 Sprite 形态引用计不到——呈现缺失，非副本过期。附带未验证：asset-store.ts:~318-330 refreshWorkflowSummary 还读已退役的 projectStore.parts/keyframes，未核其活调用方。

### 46. 缩略图失效链
精灵：sprite-thumb.ts:41 WeakMap 按对象身份缓存；store 更新恒换新对象（{...sprite}），新对象未命中重栅格化、旧条目随 GC 回收——失效靠不可变更新成立；SpriteThumb.tsx:22-33 useEffect([sprite,size]) 重绘；封顶降采样 THUMB_MAX=96。模式库：library-entries.ts 条目稳定 id+不可变版本+草稿纪律（:1-10,99-110,719-733），localStorage 往返含 legacy 双旧 key 只补不覆盖合并（:801,843-878）；library-thumbs.ts:112-147,176+ 与进包同路展开/着色；缓存 cachedThumb（:390-412）为无上限 Map、key 只含版本（PatternLibraryPanel.tsx:365,370,374）——发布换 key、旧图永不淘汰，长会话只涨；草稿不上缩略图，故无「草稿改了图不更新」的现行错误。

---

## 断裂清单

| # | 项 | 断点 |
|---|---|---|
| D1 | faceTurnKeys 转面轨（§26） | 写入/插值/时间线显示齐全，主渲染不消费（unified-render:3482 TODO 自认），打点不改变主画布 |
| D2 | node.faceTurn 静态值 + faceTurnConfig 进包（§25） | proc-runtime 零引用、convert 无警告，包内静默丢失 |
| D3 | 蒙皮快照弯曲进包（§29） | convert 对 skinningSnapshot 零引用、无警告，静默丢失 |
| D4 | value 值标记（§34） | 可建可存，生产代码零消费 |
| D5 | marks 载入规整（§36） | 注释称载入规整，导入路径不调 normalize，只有写入时规整 |
| D6 | SAM「提取为Part」（§43） | 调已退役的 parts/addPart/setPartPixels，运行时必抛/无果 |
| D7 | SAM 不可用回落（§42） | 非 ready 态点击无动作，无降级到手动选区 |
| D8 | 换装面板口径（§14） | DressPanel 手写读写双实现（无纬度/不认内嵌/无镜像回落）；主渲染 activeCostumeSetId 未设不回落、convert 与面板回落第一集 |
| D9 | SplitImageDialog（§21 附） | 零引用死代码；且其 splitImageToSprites 只产精灵不挂节点，复活也不是拆分链 |
| D10 | PlugConnectionEditor | 零引用死代码；其只改 attachment 的写路径若接活即断裂（node-actions 注释警告的半吊子写法） |
| D11 | Socket 2D 偏移（§10，潜伏） | 从未按全帧关节差计算、恒写零，靠 offset3D 兜底；joint3D 缺失即塌 |

## 实现错误清单

| # | 项 | 机制 |
|---|---|---|
| E1 | SocketEditor 点方向格清零（§7） | 注释称 seeded from base，实际写 {0,0}；directionOffsets 条目存在即压过 basePosition，查看即改位 |
| E2 | 3D 生效时 base 编辑无消费 + RigPanel 无 3D 面（§8） | offset3D 优先使 base/directionOffsets 不被读；SocketEditor base 区无不生效提示，RigPanel 根本无 offset3D 编辑/显示 |
| E3 | 纬度层口径（§13） | 写精确键、渲染模糊最近邻 ≤22.5°；值域三套（向导五档/滑杆 0–90 连续且负值不可达/烘焙仅 +45,+90） |
| E4 | 裁剪/变换/派生不重映射 marks（§38） | landmarks 有重映射、marks 无；派生直接丢 marks；存档里存的是失效坐标 |
| E5 | 包内 marks 解析漂移（§35） | 编辑器种类优先（direction>vector），包内数组先到先得，同名多类时两端方向可不同 |
| E6 | Telea 名实（§44） | 实为边界逐层加权平均的 Telea-style 近似，无 fast-marching/T 场 |
| E7 | holeFill「边缘复制」名实（§44） | 值名 edge_copy、标签「边缘复制」，实现已是 Telea inpaint，两端同 |
| E8 | facingAngle 门控漂移（§23） | 同字段两套消费：方向混合查 faceTurnConfig.enabled、连续偏航不查；行为已被 UI tooltip 明示 |
| E9 | 装配放弃文案（§15 附） | 文案称删除已抠精灵，discard 不删全局表孤儿精灵 |

## 未验证清单

| # | 项 | 缺口 |
|---|---|---|
| U1 | 存量工程 node 缺 sockets 字段 | 导入只补 slot 未见补 sockets；FK 在 unified-render:1083,1748 无?. 直读.find——无缺字段样本，不下断裂结论 |
| U2 | 向导 plug 未 pxToSub（§11） | 模板值全 0 未触发，属潜伏 |
| U3 | facingAngle 偏航 × dirBlend 在 nodeTurn3D 开时叠加（§23） | 选图口径无显式裁决，未追踪 |
| U4 | mesh-skin 包内公式（§28） | convert 回填字段与缺省同；运行时公式本体在包外，无本仓证据 |
| U5 | 拾取戳记覆盖面（§31） | 戳记不含 effectTracks 等轨道输入，其改变剪影时编号图是否过期未追踪 |
| U6 | 装配会话态不落盘（§15） | 代码事实明确，是否有意未验证 |
| U7 | IK 建链缺省写入（§16） | 各建链入口 solver 缺省未逐一追踪 |
| U8 | asset-store 退役字段读取（§45） | refreshWorkflowSummary 读 parts/keyframes，活调用方未核 |
| U9 | 模式库缩略图缓存无界（§46） | 实际内存影响未量 |
| U10 | parent-switch 守卫单独强度（§3） | 函数只认静态 parentId 链；活链靠 UI 预筛 + FK 运行时回退补齐，若将来出现第二个调用方须重估 |
