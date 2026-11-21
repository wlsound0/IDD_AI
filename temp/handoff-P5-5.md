# 交接：P5 第一轮收尾之后（2026-11-07）

> 给下一个会话：状态以本文件为准。交接时 `npm run typecheck`、`npm test`（26 组）、效果表校验、`npm run ui:build`、`npm run ui:check` 均 PASS，不要重跑全量去重新发现。

## 一句话状态

P5 第一轮四项已落地（幻影主动销毁、荣光逐击衰减、激励分支充能 1/3、调律压制组曲），覆盖率 **full 73 / partial 34 / none 4**，含 `custom` 技能 **33** 个。但自检发现两个本轮范围内的行为 bug（见「未完成 0」），**下一轮开工先修**，再继续邮差六信件与 ⑥ 零碎。

## 已完成

### P5 第一轮（本轮）

- 内核：新动作 `destroySummon`（仅记者本回合、仅自己的召唤物）；`grantDestroySummon`（开局授予能力，不受 trigger 限制）；`outgoingAdjust` 读 `rampDown`，逐击 -1 作用于攻击/溅射/技能伤害；`EffectBranch.cost`（分支充能消耗，`canUseSkill` 第 4 参）；`OpSpec.unless`（带 flag 时跳过该 op）；`afterAttack` 触发接线（`onlyUnitId`，此前从未触发）。
- 数据（`scripts/p5-tune.mjs`，37 条规则）：观测视角、未照耀的荣光、激励、调律、组曲 5 条回填，均标 full。
- 界面：召唤物卡在主人存活且轮到自己时出「令其消散」；分支按钮显示充能消耗（`雀跃（1）`）；分支按 `b.cost` 单独判可用。
- 测试：`test/effects.test.mjs` 新增「P5 第一轮收尾」5 条（26 组）；覆盖率断言同步 73/34/4；`KNOWN_OPS` 与 `validate-effects.mjs` 加 `grantDestroySummon`。

### 更早（不用重做）

守护、延迟队列（鼓舞/激励/陨石磁铁）、玛恩纳解放者状态机、观测视角受击分支、选择类技能分支、幸运包裹、召唤物面板、护盾分档、反伤通道、救援规则扩展。

## 未完成（严格按此顺序）

0. **先修两处自检 bug**：
   - `zuoqujia/调律` 的 `extraAttack` 无 `duration`、技能级 `duration` 也为空 → 令牌永久，连续两回合发动不攻击可攒到 2 层、之后一回合打 3 次。修法：该 op 补 `duration:"untilOwnTurnEnd"`；测试改成断言数据里的 effect，不要再在测试里补 duration 掩盖。
   - `core/game.ts` 的 `useSkill` 目标过滤只实现 `atkNotZero`；`激励` 的 `excludeSelf`、`烈性多夫林` 的 `wounded` 未校验，会静默放行。修法：补 `excludeSelf`，其余未知 filter 键报错。
1. 邮差六信件（触发/持续/上限，`youcha/邮件` 仍是骨架）。
2. P5-16⑥ 零碎：藏锋相邻伤害、击球手 CD 惩罚、入殓师标记转移、飞行家「消耗飞行器免扣血」。
3. P5-9 充能速率：仍每小回合 +1，须改原文速率（用户要求以后必须改）。
4. 待裁决：陨石磁铁降攻时长（原文未写）、`dmgDealt` 属性无人读取（藏锋「造成伤害 +1」无效）。

## 方案漏洞（写给自己）

1. **`when` 与 defer 混用**：defer 的时机字段是 `delay`；`when` 是排程 op 的，混用会被 `runEffect` 跳过。
2. **触发写了但没接线**：`afterAttack` 类型、数据、测试都有，但 `game.ts` 从未 fire，导致组曲/艺术敏感长期静默失效。新增 trigger 必须同时接 fire 点并补一条行为测试。
3. **测试自补 duration 会掩盖数据缺口**：构造 effect 时顺手加 `duration` 让测试变绿，真实数据仍是永久状态。断言尽量走 `data/effects.json` 里的真实条目或完整复刻其字段。
4. **filter 静默放行**：目标过滤只认少量键且未知键直接通过；新增 filter 必须让未知键报错。
5. **校验/覆盖率/测试三处白名单**：加 op 或 `branches` 时同步 `validate-effects.mjs`、`coverage-effects.mjs`、`test/effects.test.mjs`，否则「unknown op / 覆盖率下降」是假信号；覆盖率断言是硬编码数字（现 73/34/4）。
6. **`data/effects.json` 是生成物**：只改 `temp/p5-batches/*.out.json` 或 `scripts/p5-tune.mjs`，四步链顺序不能反。
7. **召唤物耐久**记在技能 `durability`/`cost.durability`，不要塞进 summon 面板。

## 入口

- 数据链：`node scripts/p5-tune.mjs` → `merge-effects.mjs` → `validate-effects.mjs` → `coverage-effects.mjs`。
- 验证：`npm run typecheck`、`npm test`、`npm run check:effects`、`npm run ui:build`、`npm run ui:check`；一键 `npm run verify`。
- 待裁决/默认：`temp/decisions.md` 的 P5-17…P5-23（用户尚未最终回复，动手前先看）；覆盖率明细 `temp/p5-coverage.md`；格式说明 `temp/p5-effect-spec.md`；上一份交接 `temp/handoff-P5-4.md`。
