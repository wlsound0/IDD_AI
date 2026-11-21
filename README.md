# IDD

## 这是什么
这是一个回合制游戏 + 当前版本（V0.2）
总目标：内容上完美复刻这个游戏

## 文件路径
D:\写作（？\IDD(？？

## 目录地图
- `IDD制作实现/`  唯一的写入区
- `角色.docx`  角色技能相关，用子智能体进行概括大致内容
- `道具.docx`  道具相关，用子智能体概括大致内容
- `机制.docx`  机制相关，重要！！！
- `Q&A.docx`  细节相关内容，用子智能体概括大致内容
- `场地.docx`  游戏时的界面大致样子，用子智能体概括大致内容
- `普通对局BP流程`  BP环节内容，用子智能体概括大致内容
- `历史版本/` **不要读**
- `AI工作区/` **不要读**

## 术语表
详情见`机制.docx`

## 规则
- 只在 IDD制作实现/ 写入；其他目录只读或不读
- 所有中间产物均写在 IDD制作实现/temp/ 内。
- 改文件用 edit，禁止整篇重写
- 文档正文用 XML 提取，不用 python-docx
- 除了机制内容，其余所有文件均用子智能体阅读，需要具体内容时再询问小模型
- TASK.md为你每次回复、思考都需要遵守的内容!!!!
- 在你想要修改文件以实现某个内容，但不知从哪里下手时，请一定一定阅读file_README.md！！！它能回答你99%的问题！！不要自己摸索！！！不要自己摸索！！！
- 冲突与歧义：发现后只在回复里说一句“发现了 N 条”，统一写入 `temp/decisions.md`（裁决表），不逐条追问；用户会一次性回复。`temp/open-questions.md` 仅作原始记录。

## 技术决定（已定，不自行变更）
- 语言/框架：TypeScript + React + Vite，纯前端，桌面浏览器运行。
- 范围：仅本地单机。联网对战、打包 exe 为后话，架构上预留但不实现。
- 架构三层，禁止跨层：`core/` 规则内核（纯函数，无框架无 DOM）、`data/` 数据表（角色/道具/技能/场地/BP 的 JSON）、`ui/` 只渲染内核产出的事件流。
- “完美复刻”指规则与内容一致。场景界面**不要求**与 `场地.docx` 一致，仅供参照，功能与信息齐全即可；细节另行商榷。
- 使用者只熟悉 Python、C++、C#、Unity，不熟悉前端。因此：业务逻辑必须留在 `core/` 与 `data/`，写法接近普通脚本；`ui/` 仅由助手维护；每次交付附“零前端知识也能跑起来”的最短步骤。
- 切换成本窗口：P3（界面）开工前若改用 C#/Unity，代价仅在内核重写；P3 之后不建议切换。

## 目录规划
`core/` `data/` `ui/` `scripts/` `test/` `temp/`（中间产物与计划）

## 非目标
- 不追求界面像素级还原；不做联网；不做 exe 打包；不修改 `TASK.md`。

## 环境与工具链（实测，勿踩坑）
- Node v18.14.1 + npm 可用；**pnpm 未安装**，一律用 npm。
- npm 依赖缓存必须在工作区内（`.npm-cache`），默认缓存在用户目录会被沙箱拒绝。
- **本机沙箱禁止子进程管道（spawn EPERM）**，因此：`vite` / `vitest` 在本项目路径下无法运行（Vite 在非 ASCII 路径上会 exec 外部程序求真实路径，直接 EPERM）；`node --test` 也会因每个测试文件被 spawn 而失败。
- 因此测试链路改为：`tsc` 编译 `core/` 到 `temp/build/core`，再 `node test/index.mjs` 单进程运行 `node:test`。入口统一为 **`npm test`**，已验证 PASS。
- `npm test` 全绿是每个阶段的硬性验收；另 `npm run typecheck` 做类型检查。
- 日常入口：`npm run verify`（类型检查 + 59 组测试 + 效果表校验 + 界面构建 + 界面冒烟）、`npm run play`（跑一整局，日志写 `temp/logs/match.json`）、`npm run check`（校验抽取产物）、`npm run check:effects`（校验效果表）、`npm run coverage:effects`（重算覆盖率）、`npm run typecheck`；界面单独跑 `npm run ui:build` / `npm run ui:check`。
- 用户侧一键入口：双击根目录 `start.cmd`（先 `ui:build`，再打开 `temp/build/ui/index.html`）。**该 `.cmd` 必须是 CRLF 换行**：`cmd.exe` 只认 CRLF，LF-only 会逐行解析失败并刷出「'core' 不是内部或外部命令」一类乱码报错（2026-11-21 实测：320 字节 / 13 行 / CR=0 / LF=13，网页本身不受影响）。改过它之后用字节检查确认 `CR ≥ LF` 再交付。
- `data/effects.json` 是技能/道具的唯一效果表（P5 引入）：由 `scripts/merge-effects.mjs` 从 `temp/p5-batches/*.out.json` 合并生成，**不要手改**；改完跑 `npm run check:effects` 与 `npm run coverage:effects`。它是 JSON，被 `scripts/build-ui.mjs` 内联进 `data.js`，`file://` 下可用。
- 效果表改数据的工作链（P5 收尾固定为四步，顺序不能反）：`node scripts/p5-tune.mjs`（幂等，按规则改批次）→ `merge-effects.mjs` → `validate-effects.mjs` → `coverage-effects.mjs`。手改 `data/effects.json` 会在下次 merge 时被覆盖。
- 选择类技能用 `branches:[{label,ops}]` + `useSkill.variant`；回合边界效果用 `OpSpec.when/if`，延迟结算用 `op:'defer'` + `GameState.pending`（defer 的时机字段是 `delay`，不是 `when`）。这些都写在 `scripts/p5-tune.mjs` 规则里，新增分支/排程要同步 `validate-effects.mjs`、`coverage-effects.mjs` 与测试断言。
- 邮差六信件（P5 第二轮）：`ref:"selfAndTarget"` 表示「邮差本人 + 收信者」；`heal` 支持 `amountExpr:{base,minus:'alliesAlive'}`（希望 5-X）与 `healMode:'add'`（加血可破上限，默认是回血）；分支可用条件写 `branches[].if='notFirstBigTurn'`，由 `selectBranch(effect, variant, clock)` 第 3 参判定，界面 `ui/app.js` 同步置灰；「诀别」受击回血在 `core/combat.ts` 的 `applyDamage` 里读 flag `letterFarewell`。新增 ref/filter 要同步 `validate-effects.mjs` 的 REFS 白名单与 `core/game.ts` 的 filter 白名单（未知键现在会报错）。
- 分支级充能消耗写 `branches[].cost`（激励 1/3）；`canUseSkill` 第四个参数可传分支消耗。`OpSpec.unless` = ref 带该 flag 时整条 op 跳过（调律压制组曲加攻）。
- 召唤物主动销毁走 `destroySummon` 动作；能力由 `grantDestroySummon` 在开局授予（`applyAlwaysPassives` 的 CAPABILITY_OPS，不看 trigger）。
- `afterAttack` 现在只在攻击结算后对出手者触发一次（`fire({trigger:'afterAttack', onlyUnitId})`）；新增 trigger 必须同时在 `core/game.ts` 接线并补行为测试，否则数据写了也不生效。`beforeDamage` 自 P7-4 起由统一的反应闸门 `demandReaction(targetId, kind, attackerId?)` 接管：攻击命中、技能/道具伤害、溅射、反伤 `reflect`、`drainMarks` 标记扣血、`settleDeferredDamage` 延迟伤害、`settleTransfers` 无来源伤害、`runScheduled`/`flushPending` 排程伤害，全部在 `applyDamage` 之前过闸门并调 `collectReactions`；新加伤害通道**必须**在 `applyDamage` 前调用闸门（`core/effects.ts` 走 `ctx.reactionGate`，`core/game.ts` 内部走 `demandReaction`），否则役鸟在该通道不开窗。
- P5 收尾新增的三种写法：一次性效果用 `duration:"nextAttack"`（攻击结算完由 `core/game.ts` 按 `Status.consumedOn` 清除）；同一技能条目里的战吼写 `battlecryOps:[...]`（开局结算一次，见 `core/effects.ts` 的 `SkillEffect`）；飞行家飞行器写 `op:'triggerFlyer'`（耐久 0 不触发，触发扣 1 耐久并回 1 血）。新 op/duration 要同步 `validate-effects.mjs` 与测试里的 `KNOWN_OPS`。
- 分支级耐久消耗写 `branches[].durability`（藏锋：转式 1 / 扫式 3），`core/game.ts` 支付段用 `branch?.durability ?? effect.cost?.durability`，耐久不足会抛「耐久度不足」。技能伤害也会走一次 `beforeDamage`（`EffectContext.beforeDamage`，由 `core/game.ts` 的 `useSkill` 注入），悬停免伤 scope 为 `all`。
- 抉择式道具（P7-2 X6，八音盒）：道具条目可写 `branches:[{label,ops}]`，由 `useItem.variant` 选分支（缺 variant 抛「需要选择分支」），界面在道具按钮上自动弹分支小菜单；道具分支里的 `OpSpec.consumedOn:'attack'|'attacked'` 表示该状态在攻击结算后清除（出手方清 `attack`、受击方清 `attacked`，见 `core/game.ts` 的 `clearConsumedStatuses`），来源带 flag `bayinheBuffPersist` 时跳过清除（舞女二重奏）。新增道具分支要同步 `validate-effects.mjs` 的 `checkBranches` 与 `coverage-effects.mjs` 的 op 统计。
- 当前基线（2026-11-21，P7-4 后）：`npm run verify` 全绿 = 59 组测试（220 条）+ 效果表校验 + 界面构建 + 界面冒烟；技能覆盖率 full 107 / partial 0 / none 4，`custom` 技能 0 个（107 是 111 技能口径；八音盒是道具不计入，handoff 旧稿写的 108 有误）；道具 full 10 / partial 5。改动后基线的唯一入口仍是 `npm run verify`，不要单独跑 `vitest`/`node --test`。
- 本机执行策略会拦 `npm.ps1`（报「禁止运行脚本」），**一律用 `npm.cmd`**。
- 读 `data/*.json` 做检查时用 `node -e`（或临时 `.mjs` 脚本），**不要用 PowerShell 的 `Get-Content | ConvertFrom-Json`**：它会按 GBK 解码导致中文乱码并报 JSON 无效。
- **改源码/测试一律用 `edit`/`write` 工具（Node/UTF-8），不要用 PowerShell `Get-Content -Raw` + `Set-Content -Encoding utf8` 做批量替换**：PS 5.1 按 GBK 解码 UTF-8 字节再按 UTF-8 写出，会把整个文件变成 mojibake，且汉字末字节丢失产生的 `?` 会吞掉换行与引号（2026-11-21 把 `test/effects.test.mjs` 整份写坏，最后靠 DSH 会话记录里的 read 快照反向解码重建）。`node --test` 在本沙箱不可用，跑单文件用 `node test/xxx.test.mjs`，全量用 `npm.cmd run verify`。
- 排查内核行为优先写 `temp/probe-*.mjs` 独立脚本；往测试里临时插 `console.log` 不可靠（输出会被丢弃/延迟），容易误判。
- 召唤物按普通角色处理的约定（P7-2 定）：特殊行为用「给召唤物挂一条普通技能」表达，不要新开字段或在回合循环里单开分支。记者幻影的每回合掉血就是 `summon` op 的 `unit.decay` → `makeDecaySkill` 生成一条 `trigger:"ownTurnStart"`、`op:"damage" ref:"self"` 的被动；**不要写 `turnStart`**（它每个小回合都 fire，一个大回合会扣两次）。
- 召唤物死亡的统一通道是 `core/game.ts` 的 `resolveDying(units, events, clock)`：被打死、掉血归零、主动销毁都走这里，归属者的 `summonDeath` 反应（观测视角）也只在这里接一次，不要在攻击结算处再写特判。召唤物不可被救援由 `core/rescue.ts` 的 `if (target.isSummon) return false;` 保证。
- 受击类反应有两条统计口径：`damageTakenThisBigTurn`（只算攻击伤害，`fireDamageReactors` 的 `mode='damage'`）与 `hpLostThisBigTurn`（任何通道落到本体血量的点数，含标记扣血，`mode='hpLoss'`，动作结算末尾用这一条）。新增「扣血就触发」的技能接 `hpLoss`；直接改写 `hp` 的换血（路易 `loseHp`）不计入。
- **反应窗口（P7-2 X5 / P7-3 / P7-4，2026-11-21）**：`GameState.pendingInterrupt` 非空时，除 `interruptWithItem` / `interruptWithSkill` / `resolveInterrupt` / `resign` 外的动作一律抛「请先处理反应窗口（使用反应技能/道具或选择不打断）」。窗口有两个种类 `kind`：`'attack'`（被攻击，挂魔术棒；有役鸟时也一起列出）与 `'damage'`（角色将要受到**任意通道**伤害，只挂役鸟——含技能/道具伤害、溅射、反伤、标记扣血、延迟伤害、无来源伤害）。`pendingInterrupt.resume` 是带内部 `offered: string[]` 的原动作（记录本次动作里已经问过反应的目标，重放时不再问同一个目标并继续往后结算）；P7-4 起**不再**用 `replay:true` 整动作跳窗。任何驱动对局的脚本或界面自动化在 `attack` / 伤害技能 / 反伤之后**必须**检查 `state.pendingInterrupt` 并补一发 `{type:'resolveInterrupt'}`、`{type:'interruptWithItem', unitId, itemIndex}` 或 `{type:'interruptWithSkill', unitId, skillIndex}`（`scripts/play.mjs`、`scripts/check-ui.mjs` 已按此处理），否则会卡在窗口里；写新的对局脚本或 e2e 时同理。
- 反应式道具（`ItemEffect.reaction:"beforeAttack"`，目前只有魔术棒）**不能**用 `useItem` 主动使用（会被拒：「该道具只能在受到攻击时（打断窗口）使用」），只能通过窗口动作 `{type:'interruptWithItem', unitId, itemIndex}`，且窗口 `kind` 必须是 `'attack'`（技能伤害窗口里会抛「只有被攻击时才能使用魔术棒」）；扣费方是**受击者**（`unitId === pendingInterrupt.targetId`），断言资源时别看错 `k.first` / `k.second`。伤害折算走 op `interruptDamage`（只回写 `ctx.interrupt.factor`），由 `core/game.ts` 用 `Math.floor(rawDmg * factor)` 一次算清；**不要**改用 `damageMultiplier`（那条路是 `Math.round`，向下取整会算错）。
- 反应式技能（`SkillEffect.reaction:"beforeDamage"`，目前只有先知「役鸟守护」）同样不能用 `useSkill` 主动施放（「该技能只能在反应窗口使用（角色将要受到伤害时）」），只能 `{type:'interruptWithSkill', unitId, skillIndex}`；只能保护**己方**角色（跨阵营抛「只能保护己方角色」），按 `skill.charge >= cost.charge` 判断可用性，结算完再从挂起处继续原动作（不是重放已生效的 ops）。注意役鸟的 `modStat atk -1` 先于本次攻击伤害结算，所以本次攻击会吃到减攻后的攻击力（P7-3 起就是这个顺序）。
- CD 技能判定（P5-32/D08/R22）：`cdCounter` 开局 = `initialCd ?? 0`；**从未使用过**的技能开局可用；`initialCd=n` 时第 n+1 回合前不可用；使用当回合不计数，之后每个大回合结束 +1。数据字段是 `cd`（14 个技能），不要再写 `cooldown`。
- P6-Q9/Q10 已落地（2026-11-15）：① 首轮资源 = BP 折算值 + 3k（`core/game.ts` 的 `createGame` 里 `k = itemBudget + 3000`，`itemBudget` 仍只作初值）；② 玩具匣改为道具级选择：技能 `target.mode='none'`，ops 用 `item:'$chosen'`，用户选中的道具 id 从动作 `useSkill.itemId` 进 `EffectContext.itemId`；新增 op `itemLock`（锁 `itemLock:<itemId>`）与 `core/items.ts` 的 `itemLocked()`，作用于己方全体（道具属于玩家）。`$chosen` / `itemLock` 要同步 `validate-effects.mjs` 的 OPS 与测试里的 `KNOWN_OPS`。
- P7 新增（2026-11-15）：① **动态条件被动**——`trigger:"always"` 且带 `condition`（或含 `modStatPer`）的技能由 `core/game.ts` 的 `syncAuras()` 在每次动作结算后按场面重算，授予的状态 source 标成 `aura:<unitId>`、重算前整批清除（`applyAlwaysPassives` 会跳过带 condition 的被动，两者不重复）；② 新 op `modStatPer`（按己方受伤人数）、`loseHp`、`possession`、`swapBack`；③ `branches[].kCost`（扣 `GameState.k`）与 `branches[].uses`（分支每局限次，计数在 `UnitSkill.branchUses`）；④ 新触发 `trigger:"itemUse"` + 条件键 `itemUsed`（道具使用后）、`SkillEffect.afterAttackOps`（攻击后，只对出手者）、`SkillEffect.parts`（分部分独立计次）、`durationByUse`；⑤ 条件化能力：`atkCap`（攻击上限）、`wandCap1`（本次受伤 ≤1）、`rescueRule.targetName`（限定救援目标名）。新增 op/条件键必须同步 `scripts/validate-effects.mjs` 的 OPS 白名单与 `test/effects.test.mjs` 的 `KNOWN_OPS`。
- 改数据仍走四步链：`node scripts/p5-tune.mjs` → `merge-effects.mjs` → `validate-effects.mjs` → `coverage-effects.mjs`；`data/effects.json` 不要手改。`scripts/p5-tune.mjs` 的规则现支持 `condition`。
- `trigger:"always"` 且**不带** condition 的被动仍只在开局结算一次，且只跑静态授予类 op（`grantRescue`/`flag`/`reflectMod`/`shield`/`immune`/`untargetable`/`invulnerable`/`selfRescue`/`rescueRule`），见 `core/game.ts` 的 `applyAlwaysPassives`；要随场面变的增减一律写成带 `condition` 的 always 被动，别指望开局一次性结算。
- 充能速率（P5-9）：字段在 `data/characters.json` 的技能上（`chargeInitial`/`chargeMax`/`chargeRate:{turns,amount}`/`chargeOn`），不在 `effects.json`；内核 `core/game.ts` 的 `chargeOnBigTurnStart` 只在大回合开始结算且首回合不充能，受击充能由 `chargeFromDamage` 按 `damageTakenThisBigTurn` 增量算。`chargeOnBigTurnStart` 是 core 新导出，改后必须 `npm run ui:build`。
- 改过 `core/` 的导出或新增 core 模块后，必须 `npm run ui:build`，否则 `ui/app.js` 的 AMD `require` 拿不到新模块。
- 若 `data/*.json` 被写入 BOM，`JSON.parse` 会直接失败（P5 踩过一次）；写 JSON 一律 UTF-8 无 BOM。
- 资源单位：`k` 字段按「原始值」存（1k = 1000，故每大回合 +3000，开局再额外 +3000）；`GameState.itemBudget` 只作开局初值保留、不再扣减，实际花费看 `GameState.k`。道具折扣语义：正=加价、负=减价，`scope:"once"` 用后即清、`scope:"turn"` 每小回合一次。玩具匣（QA-32）已按裁决改为道具级（`itemLock` + `$chosen`）。
- 运行时数据在 `data/`（从 `temp/data/` 复制而来），改数据只改 `data/`；`temp/` 只放中间产物与计划。
- Node 18.14 不认识 TS，浏览器也不认识：所有要在浏览器里跑的东西必须先经 `tsc -p tsconfig.build.json` 编译到 `temp/build/core`。
- **UI 路线已定为“无打包器”（E1=B）**：`tsc -p tsconfig.ui.json`（module=AMD + outFile）把 `core/` 编成单文件 `core.js`，配 25 行迷你 AMD 加载器；`data/*.json` 由 `scripts/build-ui.mjs` 内联成 `data.js`（`file://` 下不能 fetch）；React 用 `node_modules` 里的 UMD 副本、不用 JSX。用户侧只需双击 `start.cmd`。禁止引入任何需要子进程的构建工具。

## 当前进度
- 已完成：技术选型、分层与阶段规划（详见 `temp/plan.md`）。
- P0 素材抽取：**已完成**。产物在 `temp/extract/`（机制/角色/道具/QA/BP/场地）与 `temp/data/`（characters.json 43 条、items.json 15 条），自检脚本 `temp/check-extract.mjs` 结果 PASS。
- 裁决 v1：**已完成**。原始问答备份在 `temp/archive/decisions-v1-2026-11-06.md`，可直接照着写代码的版本在 `temp/extract/裁决落地.md`（D01–D21）。**与旧文档冲突时以裁决落地为准。**
- P1 规则内核：**已完成**。`core/` 七个模块（结算顺序、回合时钟、伤害、濒死救援、事件钩子、胜负、对局状态机），15 组测试全绿。
- P2 单场闭环：**已完成**。`core/game.ts` 跑完整局，`npm run play` 输出事件日志到 `temp/logs/match.json`，金标测试锁定结果。
- P3 界面：**已完成**。`ui/`（源码）+ `temp/build/ui/`（产物），无打包器：`tsc` 把 `core/` 编成 AMD 单文件、`data/*.json` 内联成 `data.js`、React 用 `node_modules` 里的 UMD 副本。**双击 `start.cmd`（或 `temp/build/ui/index.html`）即可游玩**：选人（最简版）→ 点己方卡选中 → 点高亮敌人攻击 → 濒死时在右侧选救援者或「放弃救援」。`npm run ui:check` 在 Node 里用 `renderToString` 冒烟：选人界面、对局界面、43 个角色逐个渲染、以及"只用界面动作打完一整局"。
- 濒死规则补充（B01–B04，见 `temp/decisions.md`）：濒死是**强制队列**，队列非空时只能处理队首；同一次攻击双方都濒死时，被攻击者先于攻击者；救援者「救完本体血量 ≥1」才可救（血 2 救 2 被禁）；无人可救时放弃救援不再报错、直接判死。
- P4 BP 流程：**已完成**。`core/bp.ts` + 界面双栏 BP 面板：8 步骨架、7 变体（一局一胜/三局两胜/五局三胜）、14k 预算（角色 cost 已落库 1k–5k）、同名与稀有度限制、BAN 只作用于对方、私有全局 BAN 跨小局累积、先手逐局轮换、剩余预算 1:2 折算道具花费。界面流程：选赛制 → BP → 站位调整 → 对局 → 记录小局 → 下一小局/冠军页（快速重开或返回首页）。
- 追加修复（用户反馈）：BAN 允许跨玩家重复（仅自己不能重复 BAN）；事件日志/濒死面板显示「玩家X · #站位号 · 角色名」；投降（BP 与对局均可，点两次确认）。
- P5 数据全量：**已完成**（技能 111 + 道具 15 全部有结构化效果规格）。
  - 数据：`data/effects.json`（每条含 `trigger/target/condition/duration/ops/impl`），由 `scripts/merge-effects.mjs` 从 `temp/p5-batches/*.out.json` 合并，`scripts/validate-effects.mjs` 校验 PASS。
  - 覆盖率：full 74 / partial 33 / none 4（纯风味）；明细 `temp/p5-coverage.md`，分类审计 `temp/p5-skill-audit.md`，格式说明 `temp/p5-effect-spec.md`。
  - P5 收尾（已完成两档）：护盾「抵挡一次」分档、反伤通道、救援规则扩展、`untilNextOwnTurnEnd` 时长、`grantRescue`、免死 flag、门之钥目标过滤、选择类技能分支（`branches` + `variant`）、召唤物面板（0/2，耐久挂技能）、回合边界排程（`when/if`）、延迟队列（`defer`）、玛恩纳解放者状态机、记者幻影受击触发。`custom` 从 92 次 / 62 技能降到 54 次 / 36 技能。未完成项与漏洞见 `temp/handoff-P5-4.md`。
  - 内核新增：`core/status.ts`、`core/effects.ts`（op 解释器 + 分支 + 排程）、`core/trigger.ts`（触发调度 + `canAttack`）、`core/items.ts`（道具价格与预算）、`core/units.ts`（角色数据 → 运行时技能）。
  - 对局新增 `useSkill` / `useItem` 动作；`itemBudget` 真正扣费；`canAttack` 按 P5-1 裁决：攻击力 0 能攻击但不计入「有进攻手段」；「双方从未进攻」按裁决判后手胜。
  - 界面：技能/道具按钮（需选目标的技能点一次后再点目标）；有分支的技能直接出分支小菜单；召唤物卡带「召唤物」标签；`data/effects.json` 已内联进 `data.js`。
  - 测试：`test/effects.test.mjs`（效果/道具/召唤/胜负/分支/排程/解放/幻影 + 数据全量回归），全量 26 组。
- P5 第一轮收尾（已完成）：记者幻影主动销毁（`destroySummon` 动作 + 界面「令其消散」）、荣光每击伤害 -1（`rampDown` 累加，含溅射与下限）、激励分支充能 1/3（`EffectBranch.cost`）、调律压制组曲加攻（`unless` + `afterAttack` 触发接线）。覆盖率 73/34/4，含 `custom` 技能 33 个。
- P5 第二轮收尾（已完成）：P5-22 令牌期限、P5-23 目标过滤（`excludeSelf`/`wounded`/未知键报错）、主动销毁幻影按 P5-17 裁决触发观测视角、邮差六信件（`branches` + 新 ref `selfAndTarget` + `heal` 的 `amountExpr`/`healMode` + 分支条件 `if:"notFirstBigTurn"`），`custom` 降到 32 个。详见 `temp/handoff-P5-6.md`。
  - Q41 已完成：激励信件「攻击上限 1」= 本回合有效攻击力按 `min(atk,1)` 计（`atkCap` flag + `core/combat.ts` 读取 + 界面显示），`youcha/邮件` 升 full，覆盖率 74/33/4。
- P5-16⑥ 零碎（已完成，2026-11-07）：藏锋「扫式」的相邻溅射/不反伤/攻击 +1/被击者 -1、击球手「爆发」的 CD 惩罚与命中减攻、入殓师「附容返生」标记自由转移、飞行家「消耗飞行器免伤救援」；`dmgDealt` 已有真实读取方（P5-21 关闭）。覆盖率 76/31/4，含 `custom` 技能 29 个。
- P5-9 充能速率（已完成，2026-11-07，裁决已确认）：数据补 `chargeInitial/chargeMax/chargeRate/chargeOn`，内核改「大回合开始按速率充能、首回合不充能、封顶」，猿猴咒像改为受击充能（P5-29/30/31 = 默认）。
- P5 遗留收尾（已完成，2026-11-07）：P5-32 CD 字段修复（`cooldown`→`cd`，仅玛恩纳 `initialCd:1`；同时补 R22「未用过的 CD 技能开局可用」与「使用当回合不计数」）；P5-24 扫式改为一次性（新增 `duration:"nextAttack"`，攻击结算后自动清除）；P5-26 附容返生（战吼开局自带、施放即「先撤后上」转移、上限=己方入殓师数量，新增 `battlecryOps`）；P5-27/28 飞行家（新增 `triggerFlyer` op：耐久 0 不触发，悬停仅免伤）。覆盖率 77/30/4，含 `custom` 技能 27 个（藏锋耐久差异与悬停技能伤害随后在下一条清零）。
- P5 遗留清零（已完成，2026-11-07，P5-33/35/36）：① P5-33 撤销 P5-25——`cdPenaltyOf` 只在「从未使用过」之外（`usedPerGame>0`）才计 -1，击球手首回合不减攻；② 藏锋两分支耐久消耗（转式 1 / 扫式 3）落地：`branches[].durability`，耐久不足时拒绝施放；③ 悬停免伤改为 `scope:"all"`，技能伤害路径也触发 `beforeDamage`（`EffectContext.beforeDamage` 钩子，由 `game.ts` 注入）。三条均升 `full`，覆盖率 79/28/4，`custom` 技能仍 27 个。`npm run verify` 全绿（30 组）。
- P6 C 块（Q&A 对齐，已完成，2026-11-07）：坚强（`damageToMark` + `drainMarks`，伤害转标记、回合末最多减 3 扣血、濒死清标记）、虫群（召唤物 `durability`，伤害同时扣血与耐久、任一归零即死）、套索技艺（`holdDying` + `deferredRescue`，保持濒死、封技能、他人不可救、牛仔下个己方回合不扣血救援）。新增 `test/qa.test.mjs`（3 组）；覆盖率 81/26/4，含 `custom` 技能 25 个。
- P6 Q4 块（已完成，2026-11-07）：致命伤害先于护盾吸收、直接进延迟队列（`deferDamage`，到点再走护盾/临时血/本体）；巧手匠心溢出伤害 ×2 转给园丁并记为无来源伤害（可被护盾减、不被庄园老友 -1）。`qa.test.mjs` 新增 2 组。
- P6 E 块（已完成，2026-11-07）：道具折扣语义定版——正数=加价、负数=减价，`scope:"once"` 用后即清、`scope:"turn"` 每小回合首次；魔术棒改为 `+1000/once`（下次 +1k），钢铁冲刺改为 `-1000/turn`（每回合首个护腕免花费、数量照扣）。`qa.test.mjs` 新增 1 组。
- P6 D 块（已完成，2026-11-07）：`modStat` 的 `hp`/`maxHp` 改为实体修改（永久时同步 `initialMaxHp`）；`triggerFlyer` 同步初始上限；飞行器从手动技能改为 `ownTurnEnd` 自动触发（耐久 >0 时血量与上限 +1）。`qa.test.mjs` 新增 2 组；覆盖率 82/25/4，`custom` 技能 24 个。
- P6 F 块（已完成，2026-11-07）：① QA-07 后手时点断言（`untilNextOwnTurnEnd` 按「下一己方行动回合」）；② 画作绑名——`OwnedItem.nameKey` + `grantItem.nameFrom:"victim"`（画家获得被攻击者画作），`useItem` 只允许该名下的 1 个角色，UI 按钮显示「画作·人名」；③ 站位断言（常规不可变、【隐喻】可交换）。`qa.test.mjs` 新增 3 组；覆盖率 83/24/4，`custom` 技能 23 个。
- P6 A 块（已完成，2026-11-07）：每方独立资源 `k`（`GameState.k`）——开局 = BP 剩余按 1:2 折算（沿用 `itemBudget` 作初值），每个大回合开始双方各 +3k（3000，首个大回合不加），道具从 `k` 扣、不足拒绝；玩具匣改为 `itemDiscount -1000 常驻` + `itemLockedThisTurn`（本大回合不可用道具，`turns:1`），UI 顶栏显示双方资源、道具按钮显示折后价。`qa.test.mjs` 新增 3 组；覆盖率 84/23/4，`custom` 技能 22 个。
- P6 收尾（已完成，2026-11-07）：① 8 条 impl-only 补断言（QA-14/23/29/31/35/38/39/41）；② 发现并修掉 QA-23 真 gap——前锋 `rescueRule` 不在 `STATIC_OPS`，`p5-tune` 增 `grantRescue`，原 skip 转正式断言；③ `test/qa.test.mjs` 共 15 组，`npm run verify` 全绿（49 组），覆盖率 84/23/4，`custom` 技能 22 个。
- P6-2 两条裁决落地（已完成，2026-11-15）：Q9 首轮资源 = BP 折算值 + 3k（`createGame` 的 `k` 初始化）；Q10 玩具匣改为道具级——`target.mode='none'` + `item:'$chosen'` + 动作 `useSkill.itemId` + 新 op `itemLock`，减价与锁定落到「该道具」而非整名角色，UI 在技能按钮位置改为列己方道具栏里的道具供点选。`npm run verify` 全绿（49 组），覆盖率 84/23/4，`custom` 技能 22 个。
- P7（已完成，2026-11-15）：**`custom` 技能清零（22 → 0）**，覆盖率 84/23/4 → **95/12/4**，测试 49 → 56 组。
  - 新增内核能力：`syncAuras()` 动态条件被动（`trigger:"always"` + `condition` 每次动作后重算，状态用 `source="aura:<unitId>"` 标记、重算前整批清除）；op `modStatPer`（按受伤己方数）、`loseHp`、`possession`、`swapBack`；`branches[].kCost`（扣 `GameState.k`）与 `branches[].uses`（分支限次，`UnitSkill.branchUses`）；`trigger:"itemUse"` + 条件键 `itemUsed`；`SkillEffect.afterAttackOps`；`SkillEffect.parts`（分部分计次）；`durationByUse`；`cdDelta.selfReady`；`atkCap`/`wandCap1`/`rescueTargetName` 等条件化字段。
  - `scripts/p5-tune.mjs` 规则支持 `condition`；四步链不变。语义未写清的一律登记 `temp/decisions.md`（P7-A1…E2-4）。
  - BP「撤回上一步 + 每步确认」已落地：`core/bp.ts` 新增 `manualConfirm`（界面默认开）、动作 `undo` / `confirmStep`、`canUndoBp` / `canConfirmBpStep`，撤回只退当前步的最后一个选择且确认后不可退；界面 BP 顶栏为「撤回上一步 / 确认本步」两个按钮。
- P7 裁决落地（已完成，2026-11-21，裁决原文见 `temp/p7-decisions.md`）：① **BP 无限 BAN 修复**——`core/bp.ts` 的选满判断改为无条件 `if (state.stepChars.length >= step.count) throw new Error('本步已选满')`（BAN 步 `atMost=false` 也要靠「确认本步」推进），界面选满后按钮置灰并提示；② **E4**——`possession` 给 owner 加 `flag restrictAttack`（source `possession:<ownerId>`），附身结束由 `settlePossession` 一并清除，目标在附身期间不可攻击；③ **E2-2**——`tempHp` 在 `op.group` 存在时记 `flag tempHpGrant`，小回合开始把到期 grant 从 `u.tempHp` 扣回（`Math.max(0, tempHp - grant)`）；④ **E2-4**——新增 `SkillEffect.anyPhase`（安抚物，`usageLimit:{perGame:1}`），`useSkill` 与界面在对方回合也放开；⑤ E1 无需改代码（使用后 `cdCounter=0` 已生效），补断言。8 个已获裁决的 `partial` 升 `full`，覆盖率 95/12/4 → **104/3/4**。
- P7-2 第二轮裁决第 1–3 步（已完成，2026-11-21，裁决原文见 `temp/p7-decisions-round2.md`）：
  - **第 1 步（口径）**：X2 陨石磁铁减攻改为永久（`defer` 到 `ownTurnEnd` 落 `modStat`，不带 duration）；X7 钢铁护肘映射 `huwan`；X8 删掉 `scripts/p5-tune.mjs` 里重复的安抚物死规则（RULES 71 → 70）。`core/bp.ts` 注释同步为「双方可各自 BAN 同一角色（2026-11-21 复议维持）」，`test/bp.test.mjs` 补断言锁行为。
  - **第 2 步（伤害通道）**：X3 路易、X4 应激不再只看攻击伤害——`core/combat.ts` 新增 `hpLostThisBigTurn`（`applyDamage` 里按 `hpBefore - next.hp` 累计），`drainMarks` 扣血也计入，`fireDamageReactors` 增加 `mode: 'damage' | 'hpLoss'`，动作结算末尾改用 `'hpLoss'`。顺带修了 `runScheduled` 的修改丢失 bug（解释器改的是只读数组 `units`，改动不回写，现改为 `live` 副本回写）与 `drainMarks` 的 `amount:'full'` 被算成 0 的 bug。
  - **第 3 步（独家新闻）**：X1 幻影每大回合 -1 血、归零即消失、消失触发观测视角，按「召唤物当正常角色处理」落地（见上文约定），`jizhe/独家新闻` 升 `full`。
  - 结果：覆盖率 104/3/4 → **106/1/4**，`npm run verify` 全绿（56 组 / 208 条）。
- P7-2 第二轮裁决第 4 步（已完成，2026-11-21，裁决 X5(a)：魔术棒 = 攻击前打断窗口）：
  - `core/game.ts`：`GameState.pendingAttack`（攻击宣告后挂起）；`Action` 新增 `resolveAttack` / `interruptAttack`，`attack` 增加内部字段 `damageFactor`；`GameEvent` 新增 `attackPending` / `attackInterrupted`。攻击校验通过后若受击方持有 `reaction:"beforeAttack"` 的道具就先开窗；开窗期间除打断/继续/投降外一律报错；关闭窗口后递归结算同一攻击。
  - `core/effects.ts`：`ItemEffect.reaction?: 'beforeAttack'`，`EffectContext.interrupt`，新 op `interruptDamage`（只回写折算系数，不挂状态）。伤害在 `core/game.ts` 里 `Math.floor(rawDmg * factor)` 一次算清（避开 `applyDamage` 的 `Math.round`）。
  - 道具计价/折扣/消耗与 `useItem` 同口径（`useInterruptItem`）：使用魔术棒照常扣 1k、消耗道具、下次 +1k（`itemDiscount:once:moshubang`）；`useItem` 直接使用反应式道具会被拒（「只能在受到攻击时（打断窗口）使用」）。
  - 界面：`ui/app.js` 增加攻击打断遮罩（`pendingAttack` → 卡片 + 每个可用魔术棒一个按钮 + 「不打断，继续结算」），`ui/style.css` 加 `.interrupt-mask` / `.interrupt-card`；事件日志支持两条新事件。`scripts/check-ui.mjs` 新增 3c 冒烟、3)/3b 对局循环遇到窗口一律 `resolveAttack`，`scripts/play.mjs` 同。
  - `scripts/p5-tune.mjs` 的 moshubang 规则改挂 `interruptDamage` + `reaction`；`scripts/validate-effects.mjs` 与 `test/effects.test.mjs` 的 op 白名单同步。
  - 结果：`npm run verify` 全绿（56 组 / **210 条**），覆盖率保持 **106/1/4**（本步不新增可覆盖条目）。
  - 注：本节里的 `pendingAttack` / `attackPending` / `interruptAttack` / `resolveAttack` 已在 P7-3 泛化改名为 `pendingInterrupt` / `interruptPending` / `interruptWithItem` / `resolveInterrupt`（见下文 P7-3），读旧代码片段时按新名对应。
- P7-2 第二轮裁决第 5 步（已完成，2026-11-21，裁决 X6(a)：八音盒抉择式道具）：
  - 数据：`bayinhe` 从 `custom:modalChoice` 改为两条 `branches`（A 攻击力 +1，`consumedOn:"attacked"`；B 攻击力 −1，`consumedOn:"attack"`），`target:anyUnit`，升 `full`；`wunv/二重奏` 同步升 `full`（`bayinheBuffPersist` 阻止分支 A 被清）。
  - 内核：`ItemEffect.branches` + `Action.useItem.variant`（缺 variant 抛「需要选择分支」）；`OpSpec.consumedOn` 放宽为 `attack | attacked`；攻击结算处 `clearConsumedStatuses` 按出手方/受击方清状态，来源带 `bayinheBuffPersist` 时跳过。
  - 界面/校验：道具按钮有分支时弹小菜单并传 `variant`；`validate-effects.mjs` 新增 `checkBranches`（skills/items 共用）并校验 `consumedOn`；`coverage-effects.mjs` 道具 op 统计纳入 branches。
  - 结果：`npm run verify` 全绿（57 组 / **214 条**），覆盖率 **107 / 0 / 4**，道具 full 10 / partial 5。旧稿写的 108 是口径笔误：八音盒是道具，不在 111 技能口径内（106 + 二重奏 = 107）。
- P7-3（已完成，2026-11-21，用户裁决：役鸟「只要受到伤害就能用」、魔术棒「只响应被攻击」、同窗反应择一即关窗）：
  - 内核：`GameState.pendingAttack` 泛化为 `pendingInterrupt: { kind: 'attack' | 'damage'; targetId; attackerId?; resume }`；`Action` 新增 `resolveInterrupt` / `interruptWithItem` / `interruptWithSkill`（`attack` / `useSkill` 加内部 `replay` 字段，P7-4 已删除、改用 `offered`）；`GameEvent` 改名 `interruptPending`（带 `kind`）并新增 `interruptSkill`；新函数 `collectReactions(state, target, kind)`、`skillReactionReady(skill)`、`useReactionSkill(...)`。
  - 口径：`attack` 记录只会因 `kind === 'attack'` 开窗（魔术棒 `reaction:'beforeAttack'` 仅此一路），役鸟 `reaction:'beforeDamage'` 在攻击与技能伤害两条路都开窗；同一个窗口里列出所有可用反应，用一个后窗口即关闭（择一即关窗）。
  - 数据：`scripts/p5-tune.mjs` 给 `xianzhi/役鸟守护` 挂 `reaction:'beforeDamage'`，`immune` 的 `scope` 用 `'all'`（`core/status.ts:233` 的 `tryConsumeImmune` 只认 `key === scope` 或 `'all'`，写 `'damage'` 会漏掉技能伤害通道）。
  - 界面：`ui/app.js` 遮罩读 `state.pendingInterrupt`，技能按钮列表隐藏反应技能（`if (s.effect.reaction) return;`），遮罩里同时给出役鸟与魔术棒按钮；`scripts/check-ui.mjs` 新增 3d 冒烟锁「伤害反应窗口」渲染。
  - 结果：`npm run verify` 全绿（57 组 / **217 条**），覆盖率 **107 / 0 / 4**，道具 full 10 / partial 5。
- P7-4（已完成，2026-11-21，用户裁决「一次动作产生多处待反应伤害时逐个开窗、择一即关窗」）：
  - 内核：反应窗口从「攻击/技能两处预开窗」下沉成统一闸门。`applyAction` 拆成外层 wrapper + `applyActionCore`；内层 `demandReaction(targetId, kind, attackerId?)` 在每次 `applyDamage` 前检查 `collectReactions`，有可用反应就抛内部哨兵 `ReactionWindowSignal`，外层接住转成 `pendingInterrupt` 并把 `targetId` 追加进 `resume.offered`（抛出的那次结算整体丢弃，`units` 已深拷贝 statuses/items/skills，不会污染原 state）。
  - 接线通道：攻击命中（`kind:'attack'`）、技能/道具伤害（`EffectContext.reactionGate` → `core/effects.ts` 的 `dealDamage`）、溅射、反伤 `reflect`、`drainMarks` 标记扣血（免疫走 `tryConsumeImmune`，事件 `{type:'immune', source:'markDrain'}`）、`settleDeferredDamage`、`settleTransfers`、`runScheduled`/`flushPending` 排程伤害，全部在 `applyDamage` 前过闸门。
  - 兼容：`Action.attack/useSkill/useItem/endTurn` 加内部 `offered?: string[]`（`replay` 保留但不再决定是否开窗）；`interruptWithItem` 改成 `{...win.resume, damageFactor}`，保留 `offered` 以便继续结算同一动作里剩余的伤害。`collectReactions` 签名改为 `(units, effects, target, kind)`。
  - 结果：新增 3 条测试（反伤开窗 → 役鸟免疫；「坚强」回合末标记扣血开窗 → 役鸟免疫 3 点、标记仍保留 2 层；回合结束钩子在挂起时**不** emit、正式结算后只 emit 一次），`npm run verify` 全绿（**59 组 / 220 条**），覆盖率 **107 / 0 / 4**，道具 full 10 / partial 5。
  - 收尾：`Action` 里不再有 `replay` 字段（P7-3 遗留，已删；开窗与否只看 `offered`）；`hooks.emit('smallTurnEnd'|'bigTurnEnd')` 从 endTurn 分支中段挪到 `applyActionCore` 成功返回前（`turnEndHook` 变量暂存），被哨兵丢弃的结算不会再提前 emit。
- 待办：① 魔术棒本体仍只在攻击反应窗口可用，道具栏是纯展示（第 4 步既定口径，非漏做；要放开成「任意伤害窗口可用」需用户重新裁决）。② 其余无。
- 收尾状态（2026-11-21）：P7-2 第 1–5 步 + P7-3 + P7-4 全部完成并验绿，工作暂停；无新增依赖/构建工具，入口仍是 `npm run verify` / `npm run play` / `start.cmd`。
- 2026-11-21 收尾修复：用户双击 `start.cmd` 报「'core' 不是内部或外部命令」一类乱码——原因是该文件为 **LF 换行**（`cmd.exe` 只认 CRLF），与网页无关；已把 `start.cmd` 重写为 **CRLF（CR=13 / LF=13，UTF-8 无 BOM）**，内容不变。同类交付的 `.cmd`/`.bat` 一律先转 CRLF 再做字节检查。