# 交接：P5-16 第一轮收尾之后（2026-11-07）

> 状态以本文件为准。交接时 `npm run typecheck`、`npm test`（25 组）、效果表校验、界面构建与冒烟均 PASS。**不要重跑全量验证去重新发现。**

## 一句话状态

P5-16 的 ①守护、②延迟队列、③玛恩纳解放者、④观测视角（受击侧）已落地，另做了幸运包裹与选择类技能分支；覆盖率 **full 69 / partial 38 / none 4**，`custom` 技能数 36。剩下的都是窄口径补丁，不是重建。

## 已完成（不用重做）

### 内核

- `OpSpec.when` / `OpSpec.if`：回合边界排程 op，由 `game.ts` 的 `runScheduled` 在 `ownTurnStart` / `ownTurnEnd` 执行；条件只支持 `noAttackLastTurn`、`gloryLastTurn`。
- `op:'defer'` + `GameState.pending`：延迟结算队列，用 **`delay`（ownTurnEnd / nextOwnTurnStart）** 指定时机，`flushPending` 在回合边界结算。**不要用 `when` 写 defer**，`when` 是给排程 op 的，defer 自己会被 `runEffect` 跳过（踩过）。
- `op:'liberate'`：加 `liberated` / `splash` / `minDamage` / `extraAttack` 四个状态；`unliberated` 在 `effectiveAtk` 里压成 0，在 `applyAction.attack` 与 `computeCanAttack` 里禁止进攻。
- 攻击分支新增：溅射（`splash` 打目标相邻同阵营）、伤害下限（`minDamage`）、攻击者 `noReflect` 时不吃反伤、召唤物（`ownerId`）被攻击致死后对该阵营触发 `summonDeath`。
- `computeCanAttack` 按 P5-1 裁决改为「攻击力 0 不计入有进攻手段」。
- GameUnit 新增 `attackedLastBigTurn`、`lastUsedSkills`、`ownerId`，在大回合结束时写入。
- `applyAction` 返回值补上了 `effects`（此前每次动作后都会丢，道具表在用第二次动作时会失效）。

### 数据（`scripts/p5-tune.mjs`，35 条规则，幂等）

- 规则支持三种写整块的方式：`ops:`（整组替换）、`branches:`（分支替换）、`drop/removeOps`（逐 op 替换）。
- 已回填：园丁守护、鼓舞、激励（雀跃/亢奋分支）、陨石磁铁（两抉择分支）、玛恩纳三技能、记者观测视角、幸运包裹（9 件可获取道具分支）、藏锋、安抚物、独家新闻、昆虫研究。
- `validate-effects.mjs` 与 `coverage-effects.mjs` 已把 `branches` 里的 op 纳入校验/统计；`test/effects.test.mjs` 的白名单与覆盖率断言同步（69/38/4）。

### 界面

- 技能有 `branches` 时，按钮渲染成「技能名：分支A / 分支B」，点分支带 `variant` 进内核；分支可覆盖 target。
- 召唤物卡带「召唤物」标签。

## 未完成（按此顺序接力）

1. **记者幻影主动销毁**：原文「记者存活时可主动使幻影死亡」仍是 `custom`。需要新 action（如 `destroySummon`）+ 界面按钮；`观测视角` 的受击分支已完成，别重做。
2. **玛恩纳「未照耀的荣光」每击衰减**：本回合每次攻击后所有伤害 -1，未实装（逐次递减的状态层）。荣光仍标 partial。
3. **激励两分支充能消耗**：雀跃 1 / 亢奋 3 的差异未落 DSL（分支级 cost 没有字段）。
4. **陨石磁铁降攻时长**：原文未写，暂按 `untilNextOwnTurnEnd`，有裁决再改。
5. **P5-16⑤ 邮差六信件**：邮件分支仍是骨架，六封信的触发/持续/上限全未做。
6. **P5-16⑥ 零碎**：藏锋相邻伤害、击球手 CD 惩罚、入殓师标记转移、飞行家「消耗飞行器免扣血」。
7. **P5-9 充能速率**：仍按每小回合 +1，用户要求以后必须改为原文速率（「每两回合一次」等）。
8. **调律**：「本回合可再次攻击但不触发组曲加成」未做（partial）。

## 方案漏洞（写给自己）

1. **`when` 字段被 defer 复用**：defer 一开始用 `when` 表示延迟时机，结果被 `runEffect` 当成排程 op 跳过，测试直接红。排程/延迟必须分字段。
2. **校验与统计容易漏分支**：加 `branches` 后必须同时改 `validate-effects`、`coverage-effects`、测试白名单，否则「覆盖率下降/unknown op」是假信号。
3. **数据回填前先确认 op 能否表达**：陨石磁铁/邮件卡在机制缺口上，先补内核再改数据，仍是默认姿势。
4. **覆盖率断言是硬编码数字**：每次数据改动都要同步 `test/effects.test.mjs`，否则全量回归会红在数字上而不是行为上。
5. **召唤物「耐久」不在召唤物上**：耐久是技能属性（`def.durability` / `cost.durability`），别再往 summon 面板塞。

## 入口

- 数据工作链固定四步：`node scripts/p5-tune.mjs` → `merge-effects.mjs` → `validate-effects.mjs` → `coverage-effects.mjs`（顺序不能反）。
- `data/effects.json` 是生成物，不要手改；改数据只改 `temp/p5-batches/*.out.json` 或 `scripts/p5-tune.mjs`。
- 待裁决：`temp/decisions.md` P5 段；覆盖率明细：`temp/p5-coverage.md`；上一份交接：`temp/handoff-P5-3.md`。
