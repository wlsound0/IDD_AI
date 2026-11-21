# file_README —— 工作区各部分逻辑导读

这份文件回答一个问题：**想改某个东西时，应该去哪个文件、按什么链路改，才不会改坏。**
不写代码风格，不写历史流水账；只写「谁负责什么、数据怎么流、哪里是唯一真相」。

---

## 0. 30 秒速览

- 项目：IDD 回合制游戏的规则复刻（V0.2）。纯前端、本地单机、TypeScript + React，**不用打包器**。
- 三层铁律：`core/`（规则内核，纯函数，无 DOM/无框架）→ `data/`（角色/道具/技能/BP 数据表）→ `ui/`（只渲染内核产出的事件流）。**禁止跨层**。
- 一条验收命令：`npm.cmd run verify`（类型检查 + 59 组测试 + 效果表校验 + 构建界面 + 界面冒烟）。
- 玩家入口：双击根目录 `start.cmd`（内部先构建再打开 `temp/build/ui/index.html`）。
- 改数据/效果的主链路：`node scripts/p5-tune.mjs` → `merge-effects.mjs` → `validate-effects.mjs` → `coverage-effects.mjs`，**禁止手改 `data/effects.json`**。
- 三个「唯一真相」：技能/道具的**计量**（CD、充能、耐久、次数）在 `data/characters.json`；**行为**（触发时机、目标、ops）在 `data/effects.json`；**规则语义**在 `core/`。

### 改动入口速查

| 想做什么 | 先看 | 关键约束 |
|---|---|---|
| 改某个技能/道具的效果 | `scripts/p5-tune.mjs` 的 RULES → 四步链 | 不手改 effects.json；新 op 要四处同步 |
| 加/改角色数值、技能文本 | `data/characters.json` | 改 id 会同时断 effects 与批次 |
| 加新 op / trigger / duration / ref | `core/effects.ts`、`core/game.ts`、`core/trigger.ts` | 白名单 + KNOWN_OPS + 行为测试 |
| 改回合/伤害/濒死/胜负规则 | `core/game.ts`、`core/combat.ts`、`core/rescue.ts`、`core/victory.ts` | 先查 `temp/decisions.md` 是否已裁决 |
| 改 BP 流程 | `core/bp.ts` + `ui/app.js` 的 BpScreen | 8 步骨架与 14k 预算是裁决过的 |
| 改界面 | `ui/app.js`、`ui/style.css` | 不写规则；改完必须 `npm run ui:build` |
| 加测试 | `test/`，入口 `test/index.mjs` | 本机不能 `node --test`，只能 `npm.cmd test` |
| 查某条规则的裁决 | `temp/decisions.md`（最新在末尾）、`temp/extract/裁决落地.md` | 冲突时以裁决落地为准 |

---

## 1. 顶层目录与边界

| 路径 | 是什么 | 能不能改 |
|---|---|---|
| `core/` | 规则内核，14 个 `.ts` | 能，但改导出后必须重建界面 |
| `data/` | 运行时数据表（3 个 JSON） | `characters/items` 可改；`effects.json` 只由脚本生成 |
| `scripts/` | 构建、校验、对局驱动、数据生产链，10 个 `.mjs` | 能 |
| `test/` | 12 个测试文件 + `test/index.mjs` | 能，新增能力必须补行为测试 |
| `ui/` | 界面源码 `app.js` / `index.html` / `style.css` / `vendor/amd.js` | 能 |
| `temp/` | 中间产物：抽取、批次、构建产物、日志、决策/交接文档 | 随便写，但不要当运行时数据源 |
| `temp/build/core/` | `tsc` 编出的 CommonJS 内核，测试用 | 产物，勿手改 |
| `temp/build/ui/` | 可直接双击打开的成品界面 | 产物，勿手改 |
| `start.cmd` | 用户一键启动 | 必须 CRLF；改完做字节检查 |
| `README.md` | 项目说明 + **技术决定** + 159 行进度流水账 | 进度部分当历史看，技术决定段是权威 |
| `TASK.md` | 协作方法约束（读法、输出上限、子智能体用法） | 不改 |
| `node_modules/`、`.npm-cache/`、`.git/` | 依赖/缓存/版本库 | 不读不写 |

`README.md` 的正确读法：先读第 33–88 行「技术决定 / 环境与工具链」，那里是踩坑总结；第 89 行以后是 P0–P7 的进度日志，只在需要追某条裁决时查。

---

## 2. 一局游戏是怎么跑起来的（端到端）

```
start.cmd
  └─ npm run ui:build
       ├─ tsc -p tsconfig.ui.json   → temp/build/ui/core.raw.js（core/ 合成单文件 AMD）
       └─ node scripts/build-ui.mjs → temp/build/ui/core.js
                                       + data.js（三张 JSON 内联成 window.IDD_DATA）
                                       + index.html / style.css / app.js / React UMD
  └─ 打开 temp/build/ui/index.html
       └─ app.js：选赛制 → BP → 站位 → 对局 → 小局记录 → 下一局/冠军页
```

对局内的循环只有一个入口：**`game.applyAction(state, action)`**。

1. `ui/app.js` 根据玩家点击拼一个 `Action`（attack / useSkill / useItem / endTurn / rescue / resolveInterrupt…）。
2. `applyAction` 校验 → 结算 → 返回 `{ state, events }`；界面把 `state` 存进 React state、把本次 `events` 追加进日志。
3. 内核自己保证原子性：一次动作要么整体结算，要么因「反应窗口」整体挂起，不会结算一半。
4. 胜负写进 `state.winner`；界面据此进入小局结算/冠军页。

阶段分流不是枚举，而是 `App` 里按条件判断（优先级从上到下）：
`!series` → StartScreen；`series.champion` → ChampionScreen；`!series.current.finished` → BpScreen；`!state` → LineupScreen；否则 BattleScreen。

---

## 3. data/ 数据层

三张表都是 UTF-8 无 BOM 的 JSON（**BOM 会让裸 `JSON.parse` 直接报错**）。

### 3.1 `data/characters.json` —— 角色与技能的「计量」

结构：`{"characters":[43 条]}`。

```
CharacterDef { id, name, rarity, atk, hp, cost, skills[] }
SkillDef     { name, type, text, cost, durability, cd,
               initialCd?, chargeInitial?, chargeMax?, chargeRate?, chargeOn? }
```

- `id` 是**拼音**（如 `binghuan`）；`rarity` = normal 25 / epic 10 / limited 8；`atk` 0–4，`hp` 1–6。
- `cost` 是 BP 选角费，单位 k（1000/2000/…/5000）。
- `skills[]` 共 111 条，`type` = passive 64 / battlecry 15 / cooldown 14 / active 11 / charge 7。
- **数值计量全在这一层**：`cd`（14 条）、`initialCd`（仅玛恩纳 =1）、`durability`（4 条）、充能三件套（7 条）、`chargeOn:"selfOrAdjacentDamage"`（仅猿猴咒像）。
- 技能的 `cost` 字段全为 null：**技能花费写在 `effects.json` 的 `cost` / `branches[].cost`**，不在这里。

### 3.2 `data/items.json` —— 道具的「计量」

`{"items":[15 条]}`，`ItemDef { id, name, cost, timing, text }`。`timing` 全是 `active`，`cost` 1k–3k。

### 3.3 `data/effects.json` —— 技能/道具的「行为」

`{"version":1, "skills":[111], "items":[15]}`，由 `scripts/merge-effects.mjs` 生成。**唯一效果表**。

技能条目核心字段（`SkillEffect`）：

- `id`：**`角色拼音id/技能中文名`**，如 `binghuan/牵绊`。运行时 `core/units.ts` 用这个拼 id 去 Map 里查，**查不到就 `effect=null`，技能静默无效果**。
- `character` / `name` / `type` / `impl`：由 merge 从 characters 回填并断言。
- `trigger`、`target{mode,filter}`、`duration`、`ops[]`、`condition[]`：行为主体。
- `manual:true`：主动技能，不参与被动触发调度。
- `impl`：`full | partial | none`（没有 custom 这个 impl 值）。当前技能 **full 107 / none 4**（4 条纯风味），道具 **full 10 / partial 5**。
- `custom` 是**一个 op**，只允许出现在 `partial` 条目上；当前仅 5 处、全在道具。`validate-effects.mjs` 会拒绝「有 custom 却标 full」。
- 可选：`usageLimit{perGame|perTurn}`（18 条）、`branches[]`（9 条）、`battlecryOps`（5）、`afterAttackOps`（1）、`parts`（1）、`durationByUse`（1）、`reaction`（1）、`anyPhase`（1）、`cost{charge|durability}`（2）、`rulings[]`（6）。

道具条目：`{id,name,cost,impl,trigger,target,duration,ops,notes,rulings,timing,originalText}`，可带 `branches`（八音盒）或 `reaction:'beforeAttack'`（魔术棒）。

**两张表的对应关系**：`effects.skills[].id === characters[].id + "/" + skills[].name`，111/111 精确一致；道具按 `id` 一一对应。一句话：**characters 管「能用几次、什么代价」，effects 管「用了会发生什么」**。

---

## 4. core/ 规则内核

### 4.1 模块分工

| 文件 | 职责 |
|---|---|
| `core/types.ts` | 共享类型：Side/Phase、SkillDef、CharacterDef、ItemDef、结算来源 SourceKind |
| `core/turn.ts` | 回合时钟：`endSmallTurn`、`endsBigTurn`、首回合判定 |
| `core/settlement.ts` | R21 结算优先级排序（本角色 > 己方 > 敌方；站位交错；同级稳定序） |
| `core/combat.ts` | 单次伤害结算 `applyDamage`、伤害公式、护盾/临时血/标记/延迟致命、反伤 |
| `core/rescue.ts` | 濒死资格与救援三段式：`isRescuableAtAll` / `canRescue` / `availableRescues` → `applyRescue` |
| `core/status.ts` | 状态机：`Status` 结构、时间刻度、叠加、到期、免疫消耗、`statOf` |
| `core/effects.ts` | 效果解释器：`fire` → `runEffect` → `applyOp`，op 分派、分支、排程、延迟队列 |
| `core/trigger.ts` | 触发调度 `fire`、trigger 种类、`computeCanAttack` |
| `core/hooks.ts` | 外部事件钩子：8 个 HookPoint，`emit` 后按 R21 排序、`true` 可拦截 |
| `core/units.ts` | 纯组装：characters + effects → 运行时 `UnitSkill`（cdCounter/charge/durability/次数） |
| `core/items.ts` | 道具价格、折扣、锁定、预算扣费 |
| `core/bp.ts` | BP 状态机（8 步骨架、赛制变体、预算、BAN、撤回/确认） |
| `core/victory.ts` | 胜负判定 |
| `core/game.ts` | 对局状态机（最大的文件）：`createGame`、`applyAction`、回合推进、反应窗口、濒死队列、召唤物 |

### 4.2 核心对象

**`GameState`**（`core/game.ts` 顶部）关键字段：

- `units: GameUnit[]`（含召唤物）——结算时整体替换，不改旧数组。
- `clock: { bigTurn, phase:'first'|'second', smallTurnsDone }`——唯一时间源，只有 `endTurn` 能推进。
- `events: GameEvent[]`——全量历史（只增，起于 `battleStart`）；`ApplyResult.events` 只是本次增量。**没有 `log` 字段，日志就是 events。**
- `dyingQueue: string[]`——强制濒死队列，非空时只能处理队首。
- `pending?: DeferredOp[]`——延迟队列（`defer` / `deferredRescue` 入队，回合边界消费）。
- `pendingInterrupt?: { kind:'attack'|'damage', targetId, attackerId?, resume }`——反应窗口挂起点。
- `k: number`——每方资源（原始值，1k=1000）；`itemBudget` 只作开局初值，之后只读。
- `attackedThisSmallTurn`、`victory`、`winner`、`effects?`（道具目录）。

**`Action`** 的语义：

| 动作 | 含义 / 注意 |
|---|---|
| `attack {attackerId,targetId,offered?}` | 普攻；每大回合一次，`extraAttack` 可突破 |
| `useSkill {unitId,skillIndex,targetId?,variant?,itemId?,offered?}` | 主动技能；有 branches 必传 variant；反应技在此被拒 |
| `useItem {unitId,itemIndex,targetId?,variant?,offered?}` | 道具：计价→折扣→消耗→跑效果→触发 itemUse |
| `destroySummon` | 主动销毁召唤物，仍走死亡通道（触发 summonDeath） |
| `transferMark` | 入殓师免费转移附容返生（同侧、最多一持） |
| `rescue {targetId,rescuerId,useFlyer?}` | `rescuerId=null` = 放弃救援 → 直接判死 |
| `resign {side}` | 任意时刻认负，优先于一切（含濒死队列） |
| `resolveInterrupt` | 关窗，按原样继续结算 |
| `interruptWithItem` | 窗口内用反应道具（魔术棒半伤） |
| `interruptWithSkill` | 窗口内用反应技能（役鸟免伤） |
| `endTurn` | 结束本小回合；**不校验当前行动方**（顺序由 UI 保证） |

### 4.3 `applyAction` 主流程（原子性来源）

`applyAction` = 外层 `try applyActionCore` + `catch ReactionWindowSignal`。

Core 的顺序：

1. `winner` 非空直接短路。
2. `resign` 特判。
3. 三个 interrupt 动作优先处理；无窗口时它们抛错。
4. 有 `pendingInterrupt` 时，除 interrupt / resign 外一律拒绝。
5. `syncQueue` 对齐濒死队列；队列非空时只允许救队首。
6. **深拷贝** units 的 statuses/items/skills（一层）。
7. 建 `offered` 集合与 `demandReaction` 闭包，按 `action.type` 分派。
8. 公共收尾（固定顺序）：`settlePossession` → `settleTempHpGroups` → `fireDamageReactors('hpLoss')` → `syncAuras` → `chargeFromDamage` → `checkVictory` → emit 回合末 hook。

**反应窗口的原子机制**：`demandReaction(targetId, kind)` 在每次 `applyDamage` 之前检查该目标有没有可用反应；有就抛内部哨兵 `ReactionWindowSignal`，把**本次结算整体丢弃**，外层用原 state 建 `pendingInterrupt`，并把 `targetId` 记进 `resume.offered`。重放时已问过的目标不再开窗。这就是「一次动作多处伤害 → 逐个开窗、择一即关窗」的实现。

### 4.4 回合推进与 hook 时序

- 一个**大回合** = 先手小回合 + 后手小回合（机制 R08）。
- `endTurn` 内：触发 `ownTurnEnd` / `enemyTurnEnd` → 仅第二小回合再触发 `turnEnd` → 排程 `runScheduled(ownTurnEnd)` + `flushPending` → `settleDeferredDamage` → `settleDamage`（转伤 → 濒死）→ `smallTurnEnd` → `endSmallTurn()`。
- 进入新小回合：清到期状态 / 扣回到期临时血 → `chargeOnBigTurnStart` → `turnStart`（全体）→ `ownTurnStart` → 排程 + `nextOwnTurnStart` 延迟 → `settleDamage` → `enemyTurnStart`。
- 新小回合若是 first（即刚跨过大回合边界）：`bigTurnEnd` → 双方 k+3000 → 记录快照 → CD 结算（**当回合用过的技能不加**）→ emit 一次 `bigTurnEnd`。否则 emit `smallTurnEnd`。
- 回合末 hook 被哨兵打断时**不会 emit**；重放成功后才 emit 一次，且携带推进后的 clock。

### 4.5 伤害结算 `applyDamage`（`core/combat.ts`）

顺序不可换：

1. `immune` 布尔 → 整笔归零。
2. `tryConsumeImmune`：`kind==='attack'` 走 `damage` 桶，**其余（技能/道具/反伤/标记…）全走 `skill` 桶**。
3. `scaled = max(0, round(amount × damageMultiplier) + damageTakenAdjust)`。
4. `wandCap1`：一次性把本次伤害压到 ≤1，读完立刻删状态。
5. `damageToMark`：等量转标记，不扣血不扣盾、不计受伤次数。
6. `deferLethal`：**致命判定发生在护盾之前**，整笔转延迟伤害，护盾不消耗、本体不动。
7. `consumeShield`。
8. 剩余伤害：召唤物同时扣 `durability`；然后临时血先吃，余量进本体。
9. `keepHpMin1` → 留 1 血并挂转移；`lethalSave` 有临时血 → 保 1；`letterFarewell` 非致死回 1。
10. 统计与濒死：`dying = hp<=0`。

两套易混的统计口径：

- `damageTakenThisBigTurn`：**穿透护盾的命中次数**（被临时血吸掉也算，纯护盾吸收不算）→ 庄园老友 -1、八音盒等用这条。
- `hpLostThisBigTurn`：**真正落到本体血量的点数**（tempHp 吸收、保底 1 都不计）→ 路易、应激等「扣血就触发」用这条。

取整：combat 内部只用 `Math.round`；魔术棒链路在 `core/game.ts` 先 `Math.floor(rawDmg × factor)` 再取 `minDamage`。**两层混用会差 1。**

### 4.6 反应窗口（`pendingInterrupt`）

- `kind:'attack'`：只给 `reaction:'beforeAttack'` 的道具（当前仅魔术棒）。
- `kind:'damage'`：给 `reaction:'beforeDamage'` 的技能（当前仅役鸟守护），覆盖**任意通道**伤害。
- 所有伤害通道都必须在 `applyDamage` 之前过闸门：攻击命中、技能/道具伤害、溅射、反伤、标记扣血、延迟伤害、无来源转伤、排程伤害。新增通道漏了闸门，役鸟就不会在这条路开窗。
- 窗口期间除 `interruptWithItem` / `interruptWithSkill` / `resolveInterrupt` / `resign` 外全部报错。
- 魔术棒扣费方是**受击者**；伤害折算用 op `interruptDamage`（只回写 `ctx.interrupt.factor`），不要改用 `damageMultiplier`（`round` 会算错）。
- 任何驱动对局的脚本/自动化在攻击、伤害技能、反伤之后都必须检查 `state.pendingInterrupt` 并补一个 resolve/interrupt 动作，否则卡死。

### 4.7 濒死与救援（`core/rescue.ts` + `game.ts`）

- 濒死是**强制队列**：`dyingQueue` 非空时只能处理队首；同一次攻击双方都濒死时，被攻击者优先。
- 救援资格：不能是召唤物、不能 `cannotBeRescued`、不能已死/已救满（默认 1 次，画家 2 次）；救援者需 `hasRescue`、同阵营、未死，封印时需特例。
- 硬条件：**救完救援者本体血量必须 ≥1**，`hp` 恰好等于扣血量也不可救。
- 成功：`rescueCount+1`、`maxHp=ceil(initialMaxHp/2)`（画家跳过）、`hp=maxHp`、`tempHp=0`；救援者先扣临时血再扣本体。
- 无人可救时放弃救援不报错，直接判死。
- 特例：套索「保持濒死」用 `holdDying` 把人排除出队列；牛仔的延迟救援用 `deferredRescue` 排到 `nextOwnTurnStart`。

### 4.8 效果解释器（`core/effects.ts`）

主线：`trigger.ts 的 fire` 命中 → 建 `EffectContext` → `runEffect` 逐 op → `applyOp` 分派。

要点：

- **触发匹配**：主效果看 `trigger`，`parts[]` 各自带 trigger/ops，独立计次。`manual` 技能不参与 fire。
- **usageLimit** 只约束主效果；`parts` 用自己的 `partUses`。
- **目标**：`TargetSpec.mode`（self/allAllies/allEnemies/allyUnit/enemyUnit/anyUnit/anyCharacter/none）+ `filter`（只支持 `atkNotZero` / `excludeSelf` / `wounded`，未知键直接报错）。
- **分支**：`branches[]` 由 `selectBranch(effect, variant, clock)` 选；不传 variant 必抛；`if:'notFirstBigTurn'` 在首大回合禁选。分支可覆盖 target/duration/cost/durability/kCost/uses。
- **排程**：顶层 `when` 的 op 不由 `runEffect` 执行，而由 `game.ts` 的 `runScheduled` 在回合边界按 `if` 结算；`defer` 把 `op.ops` 入 `pending`，`delay` 决定 `ownTurnEnd` / `nextOwnTurnStart`（**defer 的时机字段是 `delay`，不是 `when`**）。
- **`unless`**：目标带该 flag 时整条 op 跳过。
- **时长**：`duration` 由 `status.ts` 翻译成时间点（instant / untilTurnEnd / untilOwnTurnEnd / untilNextOwnTurnStart / turns:N / permanent / nextAttack…）。`nextAttack` 的 `expiresAt=null`，靠 `consumedOn` 在攻击结算后清除。
- **未知东西不炸**：未知 op 会 push `unsupported` 并返回 false（静默降级，覆盖率靠它统计）；拼错的 ref 返回空数组、效果直接消失。这是「数据写了不生效」的头号原因。

op 按主题分组（完整清单看 `core/effects.ts` 的分派 switch + `scripts/validate-effects.mjs` 的 OPS 白名单）：

- 伤害/生命：`damage`、`loseHp`、`tempHp`、`heal`、`damageReduce`、`damageMultiplier`、`interruptDamage`、`damageToMark`、`drainMarks`。
- 属性：`modStat`、`modStatPer`、`setStat`、`copyAtk`、`swapStat`。
- 状态：`immune`、`invulnerable`、`untargetable`、`sealSkills`、`extraAttack`、`restrictAttack`、`mark`、`flag`、`holdDying`、`selfRescue`、`liberate`、`reflectMod`。
- 召唤/救援：`summon`、`grantRescue`、`grantDestroySummon`、`grantTransferMark`、`grantRescueFlyer`、`rescueRule`、`deferredRescue`、`rescueHeld`。
- 资源/道具：`grantItem`、`itemDiscount`、`itemLock`、`cdDelta`、`chargeDelta`。
- 排程：`defer`（配合顶层 `when` / `runScheduled`）。
- 特殊：`possession`、`swapPosition`、`swapBack`、`transferDamage`、`triggerFlyer`、`revive`、`custom`。

`EffectContext` 提供的能力：`units/clock/sourceId/targetId/attackerId/victimId/events`、`createSummon`、`pending`、`unsupported`、`interrupt{factor}`、`beforeDamage`、`reactionGate(targetId,'attack'|'damage')`、`itemId`（`$chosen` 用）、`viaRescue`、`currentGroup`。

### 4.9 状态系统（`core/status.ts`）

`Status { id, kind, key, value, mode, expiresAt, source, requiresSourceAlive, consumedOn, group }`。

- `kind`：stat / dmgMultiplier / flag / shield / immune / extraAttack / mark / rescueRule。
- 时间刻度：`order = (bigTurn*2 + phaseIndex)*2 + (end?1:0)`；到期靠 `purgeExpired`，来源死了靠 `purgeDeadSource`。
- 叠加：`statOf` 按施加顺序，遇 `set` 覆盖、其后 `add` 继续累加。
- 护盾 `value<0` 是「挡一次」哨兵。
- 免疫：`tryConsumeImmune` 只认 `key===scope` 或 `'all'`；`<0` 无上限、`<=1` 整条删、否则递减。**写 `'damage'` 会漏掉技能伤害通道**，要全覆盖就写 `'all'`。
- 召唤物「当正常角色处理」：特殊行为写成挂在召唤物身上的普通技能（如记者幻影每回合掉血 = `trigger:'ownTurnStart'` 的被动），不要新开字段或回合循环特判。

### 4.10 触发与钩子（`core/trigger.ts` / `core/hooks.ts`）

- trigger 种类：manual / battlecry / turnStart / turnEnd / ownTurnStart / ownTurnEnd / enemyTurnStart / enemyTurnEnd / beforeDamage / afterDamage / afterAttack / itemUse / attacked / damaged / lethalDamage / selfDeath / allyDeath / enemyDeath / enteringDying / rescue / rescued / summonDeath / always。
- `fire`：按 R21 站位交替排序 → sideFilter/onlyUnitId → 跳过封印 → 命中主效果或 parts → 计次 → 条件 → autoPick 目标 → `runEffect`。
- `afterAttack` 只在攻击结算后对**出手者**触发一次（`fire({trigger:'afterAttack', onlyUnitId})`）；`afterAttackOps` 是同一位置的补充。
- `hooks.ts` 的 8 个 HookPoint：battleStart / turnStart / smallTurnEnd / bigTurnEnd / afterAttack / afterDamaged / afterSkillUsed / onDeath；`emit` 后按 R21 排序，handler 返回 true 可中断。
- `computeCanAttack`：存活、未被禁攻、非未解放玛恩纳、`effectiveAtk>0`。**攻击力 0 能攻击，但不计入「有进攻手段」。**

### 4.11 胜负（`core/victory.ts`）

- 双方全灭：`lastAggressor` 胜（可能没有）。
- 单方全灭：另一方胜。
- 一方无法进攻且僵持 ≥2 大回合（4 小回合）：**无法进攻方获胜**（反直觉，别按「能打者赢」重写）。
- 双方都能打但 4 小回合无进攻：`lastAggressor ?? 'second'`（后手胜）。

### 4.12 BP 状态机（`core/bp.ts`）

- 预算 14000，5 人，限定（limited+legend）≤2。
- 8 步骨架：ban(先) → ban(后) → pick(先,2) → pick(后,2) → ban(先) → ban(后) → pick(先,3,atMost) → pick(后,3,atMost)。
- `actor` 是「本局先手/后手」，首局 p1，之后逐局轮换；赛制变体 single / bo3（3 套）/ bo5（5 套，其中 bo5-4 与 bo5-5 模板相同）。
- BAN 规则：**只禁止自己重复 BAN，双方可各自 BAN 同一角色**；`globalBans` 是「自缚」，只约束自己后续小局。
- 选角约束：对方 bans、自己 globalBans、本步 distinct、同名上限（normal 2，其余 1）、限定 2、`spent+cost≤14000`。
- `manualConfirm`（界面默认开）：选满不前进，必须 `confirmStep`；确认后锁定，`undo` 只能退当前步最后一条并退钱。关闭时选满自动进下一步，靠「本步已选满」异常防溢出。
- 剩余预算折算道具：`toItemBudget = max(0,leftover)*2`（1:2）。

---

## 5. ui/ 界面层

### 5.1 无打包器方案（E1=B）

- `tsc -p tsconfig.ui.json`：`module=AMD`、`outFile=temp/build/ui/core.raw.js`，把 `core/` 编成单文件，模块名 = 文件名。
- `scripts/build-ui.mjs`（**不启动子进程**）：校验 `define("game")` → 复制成 `core.js`；把三张 JSON 拼成 `window.IDD_DATA={characters,items,effects}` 写 `data.js`（`file://` 不能 fetch）；复制 ui 源码与 React UMD；断言角色 ≥40、道具 ≥14、core 含关键符号。
- 加载顺序固定：react → react-dom → amd.js（25 行迷你 AMD）→ core.js → data.js → app.js。
- `start.cmd`：`chcp 65001` → `cd /d "%~dp0"` → `call npm run ui:build` → `start "" temp\build\ui\index.html`。**必须 CRLF**（LF 会让 cmd 报「'core' 不是内部或外部命令」）。

### 5.2 `ui/app.js` 结构

- 手写 `React.createElement`（无 JSX），约 1000 行。
- 8 个 useState：`series`、`order`、`state`、`selected`、`rescueFor`、`error`、`bpError`、`pendingAction`。
- 两种派发：
  - `run(action)` → `game.applyAction` → `setState(res.state)`；异常写 `error`。
  - BP → `BP.applyBp(series.current, action, bpCatalog())`，写回 `series.current`。
- 组件：StartScreen、BpScreen、LineupScreen、ChampionScreen、BattleScreen、UnitCard，以及 `renderActions`、`eventText`、`makeUnit`、`charById`、`fxIndex`。
- 事件日志：`state.events.map(eventText)`；`eventText` 是纯 switch（attack/reflect/dying/death/rescue/smallTurnEnd/bigTurnEnd/resign/interruptPending/attackInterrupted/interruptSkill/damage/heal/tempHp/swapStat/swapPosition/unsupportedEffect/victory…），未知 type 原样输出。

### 5.3 操作 → 内核动作

| 玩家操作 | 提交的 Action |
|---|---|
| 点己方卡选中、点高亮敌人 | `attack` |
| 技能按钮 / 分支小菜单 | `useSkill{unitId,skillIndex,targetId?,variant?,itemId?}` |
| 道具按钮（八音盒弹分支） | `useItem{unitId,itemIndex,targetId?,variant?}` |
| 需选目标的技能/道具 | 先挂 `pendingAction`，再点角色补 targetId |
| 反应窗：魔术棒 / 役鸟 / 跳过 | `interruptWithItem` / `interruptWithSkill` / `resolveInterrupt` |
| 濒死救援 / 放弃 / 用飞行器 | `rescue{targetId,rescuerId,useFlyer?}` |
| 附容返生转移 / 召唤物消散 | `transferMark` / `destroySummon` |
| 结束小回合 / 投降 | `endTurn` / `resign`（BP 投降走 `BP.forfeitBp` + `recordRoundWinner`） |

站位 ↑↓ 只改本地 `order`；`startGame` 时按 `BP.sidePlayers` 逐人 `makeUnit`（id=`side-slot`），道具预算 `BP.toItemBudget(14000-spent)`。

### 5.4 界面边界（重要）

- 界面**不写规则**：可用性一律问内核：`legalAttackTargets`、`legalRescueOps`、`pendingDying`、`canUseSkill`、`blockReason`、`itemPrice`、`canUndoBp`、`canConfirmBpStep`。
- 内核抛错只显示成 `error` 文本，不在 UI 里补判断。
- 技能/道具的「谁可以点」由 core 的 `blockReason` 决定，UI 只负责置灰。
- 改 `core/` 导出或新增 core 模块后必须 `npm run ui:build`，否则 AMD `require` 找不到模块。
- `scripts/check-ui.mjs` 在 Node `vm` 里加载 amd + `core.raw.js` + `app.js`，用 `renderToString` 做冒烟：首屏、BP 各中间态、站位、对局、43 个角色逐个渲染、投降、濒死、攻击打断窗、伤害反应窗、只用界面动作打完一局。

---

## 6. scripts/ 工具链

| 脚本 | 职责 |
|---|---|
| `split-skills.mjs` | 把 43 角色技能切成 6 批（b0 是道具）写 `temp/p5-batches/` |
| `p5-tune.mjs` | **数据生产核心**：硬编码 RULES 规则表（约 70 条），对批次做 ops/branches/drop 替换与字段覆写；幂等；只写 `*.out.json`，不碰 data/ |
| `merge-effects.mjs` | 合并 `b*.out.json` → 回填 character/name/type、道具字段、排序 → 写 `data/effects.json` |
| `validate-effects.mjs` | 7 张白名单（OPS/TRIGGERS/DURATIONS/REFS/IMPL/TYPES/TARGET_MODES）+ 逐条结构校验 + checkBranches；失败 exit 1 |
| `coverage-effects.mjs` | 统计 full/partial/none 与各 op 引用数，写 `temp/p5-coverage.md` |
| `audit-skills.mjs` | 按文本把技能分 mechanical/needsRuling/flavor |
| `p7-dump-custom.mjs` | 导出含 custom 的条目 |
| `build-ui.mjs` | 组装 `temp/build/ui/`（见 5.1） |
| `play.mjs` | 固定 2v2 跑整局、写 `temp/logs/match.json`；**必须处理 pendingInterrupt 与 dyingQueue** |
| `check-ui.mjs` | 界面冒烟（见 5.4） |

**数据改动四步链（顺序不能反）**：

```
node scripts/p5-tune.mjs        # 按 RULES 改 temp/p5-batches/*.out.json（幂等）
node scripts/merge-effects.mjs  # 合并生成 data/effects.json
node scripts/validate-effects.mjs
node scripts/coverage-effects.mjs
```

注意 `p5-tune.mjs` 的规则要求 id 能在批次里找到，否则 throw；**新技能必须先进入批次文件**。手改 `data/effects.json` 会在下次 merge 时被覆盖。

### package.json 的入口

| 命令 | 作用 |
|---|---|
| `npm.cmd test` | `tsc -p tsconfig.build.json` → `node test/index.mjs` |
| `npm.cmd run typecheck` | 全量类型检查（不产物） |
| `npm.cmd run verify` | typecheck + test + check:effects + ui:build + ui:check（**唯一验收入口**） |
| `npm.cmd run play` | 编译 core → 跑一整局 → `temp/logs/match.json` |
| `npm.cmd run check` | 校验抽取产物 |
| `npm.cmd run check:effects` / `coverage:effects` | 效果表校验 / 覆盖率 |
| `npm.cmd run ui:build` / `ui:check` | 界面构建 / 冒烟 |
| `npm.cmd run dev` / `build` / `preview` | Vite 残留，本机沙箱跑不了，别用 |

---

## 7. test/ 验证层

`test/index.mjs` 按序 `import` 12 个文件，**同一进程**跑 `node:test`。之所以不 `node --test`：它会给每个文件 spawn 子进程，本机沙箱禁止管道（EPERM）。

| 文件 | 组/条 | 测什么 |
|---|---|---|
| settlement | 1/5 | R21 结算顺序：站位交错、同级稳定、不改入参 |
| turn | 1/6 | 回合时钟、事件分流、首回合 -1 |
| combat | 3/14 | 伤害公式、反伤、免疫、临时血、加血、救援上限 |
| rescue | 6/15 | 濒死判定、救援扣血、自我救援、召唤物、特例 |
| hooks | 1/6 | 钩子顺序、入队序、true 拦截、注销 |
| victory | 1/8 | 全灭、同死、僵持、无法进攻方胜 |
| game | 2/14 | 单场闭环：攻击/回合/濒死/胜负/非法目标/不可变 + 投降 |
| dying | 1/5 | 强制队列：只能处理队首、双方同濒死被攻击者优先 |
| match | 1/2 | 整局金标（固定阵容比对推算结果） |
| bp | 4/25 | BP 数据/8 步/预算/全局 BAN/撤回确认 |
| effects | 19/88 | 效果层主力：111 技能 + 15 道具全量、白名单、条件被动、反应窗口 |
| qa | 19/32 | P6 Q&A 逐条闭环 |

基线：**59 组 / 220 条**，`npm run verify` 全绿。

新增能力时的同步清单：

1. `core/` 里接线（新 trigger 必须接进 `fire`，新伤害通道必须在 `applyDamage` 前过 `demandReaction`）。
2. `scripts/validate-effects.mjs` 的 `OPS` / `TRIGGERS` / `DURATIONS` / `REFS` / `TARGET_MODES` 白名单。
3. `test/effects.test.mjs` 的 `KNOWN_OPS` 与行为断言；数据量断言（111 技能 / 15 道具 / 覆盖率下限）。
4. `scripts/p5-tune.mjs` 的规则（若改的是具体技能）。
5. `npm.cmd run verify` 全绿；覆盖率变化跑 `coverage:effects`。

---

## 8. temp/ 中间产物与决策体系

| 路径 | 内容 |
|---|---|
| `temp/extract/` | P0 抽取产物：机制/角色/道具/QA/BP/场地 7 份 md + `raw/` + **`裁决落地.md`（D01–D21，可落代码，优先级高于旧文档）** |
| `temp/data/` | 初版 JSON（根 `data/` 是运行时副本） |
| `temp/p5-batches/` | `b0–b6.json` 输入 + `*.out.json` 产物 + `index.json`；effects.json 的唯一来源 |
| `temp/build/core/` | tsc CommonJS 产物（测试用） |
| `temp/build/ui/` | 界面成品（双击可用） |
| `temp/logs/match.json` | `npm run play` 的事件日志 |
| `temp/archive/` | decisions v1 备份 |
| `temp/p7-shots/` | 空 |
| `temp/*.md` | plan、open-questions、decisions、p5-effect-spec、p5-coverage、p5-skill-audit、p6-qa-checklist、p7-plan、p7-decisions(-round2)、handoff-* |
| `temp/probe-*.mjs` | 内核行为探针（排查首选方式：独立小脚本，不往测试里插 log） |

决策文件阅读优先级：

1. `temp/extract/裁决落地.md`（v1 可直接执行，冲突时以此为准）
2. `temp/decisions.md`（56KB，按时间累积，**最新裁决在末尾**；开头有 A/B/C/D/E 分类）
3. `temp/p7-decisions.md` / `temp/p7-decisions-round2.md`（P7 两轮裁决）
4. `handoff-*.md`：会话交接，只读最新一份
5. `temp/open-questions.md`：原始问题记录（不是最终结论）

规则冲突时的约定：发现冲突只在回复里说「发现了 N 条」，统一写入 `temp/decisions.md`，由用户一次性裁决；不逐条追问。

---

## 9. 常见修改任务 SOP

### A. 改一个已有技能/道具的效果

1. 在 `scripts/p5-tune.mjs` 的 RULES 里找该 id（或新增一条）。
2. 用 `ops` / `branches` / `drop` 表达改动；需要新 op 时先做第 B 条。
3. 跑四步链，`validate-effects` 必须 PASS。
4. 补/改 `test/effects.test.mjs` 的行为断言。
5. `npm.cmd run verify`。

### B. 加一个新 op / trigger / duration / ref / target filter

触点（少一个就「数据写了不生效」）：

1. `core/effects.ts` 的 `applyOp` 分派 + `OpSpec` 类型；trigger 在 `core/trigger.ts` / `core/game.ts` 接线。
2. `scripts/validate-effects.mjs` 的白名单。
3. `test/effects.test.mjs` 的 `KNOWN_OPS`。
4. `scripts/coverage-effects.mjs` 的统计（若按 op 名统计）。
5. 若是新伤害通道：在 `applyDamage` 前调用 `demandReaction`/`reactionGate`。
6. `npm run ui:build`（若 core 导出有变）+ `verify`。

### C. 加角色 / 改数值

1. 改 `data/characters.json`（`id` 用拼音，别改已有 id）。
2. 需要效果就在批次里加条目并写 `p5-tune` 规则；技能 id 必须是 `角色id/技能名`。
3. 主题/稀有度/BP 费用会直接影响 `core/bp.ts` 的约束。
4. `test/effects.test.mjs` 的数量断言、`verify`。

### D. 改规则（core）

1. 先查 `temp/decisions.md` / `裁决落地.md` 是否已有裁决；有就按裁决实现。
2. 改纯函数，保持「无 DOM、无框架、不读全局」。
3. 补行为测试（不要只改实现）。
4. 若改了导出：`npm run ui:build`。
5. `verify`。

### E. 改界面

1. 只改 `ui/app.js` / `ui/style.css`；不要改 `temp/build/ui/` 里的拷贝。
2. 可用性问 core，不在 UI 重算规则。
3. `npm run ui:build` → `npm run ui:check`。
4. 新增事件类型时同步 `eventText` 的 switch。

### F. 改 BP

`core/bp.ts` 的 8 步骨架、`VARIANTS`、`blockReason`、`manualConfirm`；界面 `BpScreen` 的按钮与置灰；测试 `test/bp.test.mjs` 锁行为。

---

## 10. 环境约束与坑（浓缩版）

- **一律 `npm.cmd`**：`npm.ps1` 被执行策略拦截，报「禁止运行脚本」。
- **不能用的工具**：`vite`、`vitest`、`node --test`（本机沙箱禁子进程管道，非 ASCII 路径下 Vite 还会 EPERM）。测试只能 `npm.cmd test`。
- **编码**：所有 JSON / TS / MD 用 UTF-8 **无 BOM**；BOM 会让 `JSON.parse` 直接失败。
- **不要用 PowerShell 处理中文文本**：`Get-Content` / `ConvertFrom-Json` 按 GBK 解码会乱码，`Get-Content -Raw | Set-Content -Encoding utf8` 会把 UTF-8 文件写成 mojibake。读用 read 工具，改文件用 `edit`/`write`。
- **`start.cmd` 必须 CRLF**：cmd.exe 只认 CRLF，LF-only 会刷「'core' 不是内部或外部命令」。
- **非 ASCII 路径**：项目在 `D:\写作（？\IDD(？？\IDD制作实现`，任何「求真实路径」的工具都可能 EPERM。
- **改 core 导出 → 必须 `ui:build`**；改 `data/*.json` → 界面不重建不生效（data.js 是构建期快照）。
- **`data/effects.json` 不要手改**；`data.js`、`temp/build/**` 是产物不要手改。
- **读大文件**：`core/game.ts` 76KB、`core/effects.ts` 45KB、`test/effects.test.mjs` 112KB、`data/effects.json` 85KB。先 grep 结构，再 `read` 指定段，禁止整读；单次工具输出控制在 4–8KB。
- **排查内核行为**：写 `temp/probe-*.mjs` 独立脚本，不要往测试里插 `console.log`（输出可能被丢弃）。
- **改文件用 `edit` 定位替换**，不要整篇重写（新建文件除外）。

---

## 11. 术语与规则速查

- **小回合 / 大回合**：先手小回合 + 后手小回合 = 一个大回合（R08）。CD、充能、资源刷新都按大回合算。
- **站位**：1 起编号；结算顺序按站位交错（R21），来源优先级：本角色 > 己方 > 敌方。
- **k**：资源单位，原始值存（1k=1000）；开局 = BP 折算 + 3000，每个大回合 +3000。
- **BP 预算**：14000；剩余按 1:2 折算成道具预算（即 1 点预算 = 2 点 k）。
- **濒死**：hp≤0 进强制队列；救援者救完本体必须 ≥1 血。
- **反应窗口**：`pendingInterrupt`；attack 窗口只给魔术棒，damage 窗口只给役鸟；择一即关窗。
- **impl**：full = 全部机制可执行；partial = 有 custom/未覆盖；none = 纯风味。覆盖率当前 107 / 0 / 4（技能），道具 10 / 5。
- **custom**：op，只允许出现在 partial 条目；validate 会拒绝「custom + full」。

---

## 12. 一句话总结

`data/` 决定「有哪些角色、技能长什么样」，`core/` 决定「这些效果按什么规则结算」，`ui/` 只把内核的事件流画出来；`scripts/` 负责把批次数据编译成 `effects.json`，`test/` 负责锁住行为。改任何东西都先问：这是数据（走四步链）、规则（改 core + 补测试）、还是展示（改 ui + 重建）？确认层级后再动手，`npm.cmd run verify` 全绿才算完成。
