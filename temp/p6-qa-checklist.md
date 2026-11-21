# P6-1 对齐矩阵：Q&A 42 条 × 实现 × 测试

来源：`temp/extract/QA.md`（QA-01–42）。审计口径：只读，按 `core/`、`data/`、`test/` 现状判定。

## 汇总

| status | 数量 | 含义 |
|---|---|---|
| covered | 42 | 有实现且有测试断言 |
| gap | 0 | — |
| impl-only | 0 | — |
| conflict | 0 | — |
| partial？ | 0 | — |
| 合计 | 42 | — |

结论（2026-11-07，全部块完成）：**42 条全部闭环**。QA-23 的 gap（前锋 `rescueRule` 开局未授予 `hasRescue`）已通过 `p5-tune` 补 `grantRescue` 修掉，原 skip 测试转为正式断言。`npm run verify` 全绿（49 组测试 + 效果表校验 + 界面构建/冒烟）；覆盖率 84/23/4，`custom` 技能 22 个。

## 矩阵

| QA | 主题 | 判据 | 落点 | 测试 | 状态 |
|---|---|---|---|---|---|
| 01 | 资源 | 14k=选角总预算，非每回合资源 | bp.ts:12,259 | qa.test.mjs QA-01/02 | covered |
| 02 | 资源 | 每回合固定 +3k，可累积，局末清零 | game.ts（`k`） | qa.test.mjs QA-01/02 | covered |
| 03 | BP | 每方同名≤2，跨方不占名额 | bp.ts:201,250 | bp.test.mjs:185 | covered |
| 04 | BP | 角色≤5 且选角花费≤14k | bp.ts:258-259 | bp.test.mjs:172,278 | covered |
| 05 | BAN | 全局 BAN 只约束 BAN 方 | bp.ts:247,383-386 | bp.test.mjs:212 | covered |
| 06 | 回合 | 每角色每大回合攻击 1 次，可不攻击 | game.ts:449-452,781 | game.test.mjs:33,79 | covered |
| 07 | 回合 | 下个己方回合=下一己方行动回合 | status.ts:90-96 | qa.test.mjs QA-07 | covered |
| 08 | 伤害 | 基础伤害=攻击方当前攻击力 | combat.ts:67-77;game.ts:459 | game.test.mjs:25 | covered |
| 09 | 伤害 | 反伤=受击方当前攻击力（含降攻） | combat.ts:80-82 | combat.test.mjs:57 | covered |
| 10 | 伤害 | 攻击力 0 仍走反伤 | combat.ts:80-82;game.ts:524 | combat.test.mjs:59 | covered |
| 11 | 伤害 | 首次不减，此后每次攻击 -1 不叠加 | combat.ts:67-77 | combat.test.mjs:41,50 | covered |
| 12 | 伤害 | 巧手匠心转移=无来源伤害 | combat.ts:139;effects.ts:581 | qa.test.mjs QA-12 | covered |
| 13 | 伤害 | 转移伤害可被护盾减、庄园老友不减 | combat.ts:139;effects.ts:581 | qa.test.mjs QA-13 | covered |
| 14 | 伤害 | 扫式相邻 1 点不触发反伤 | game.ts:493-501 | qa.test.mjs QA-14 | covered |
| 15 | 伤害 | 附容返生致命伤害延到下个己方回合末 | effects.ts:575;game.ts:239 | qa.test.mjs QA-15 | covered |
| 16 | 伤害 | 有护盾时致命伤害先延迟、不经护盾 | combat.ts:145;effects.ts:575 | qa.test.mjs QA-16 | covered |
| 17 | 血量 | 临时血量先承伤 | combat.ts:112-118 | combat.test.mjs:68 | covered |
| 18 | 血量 | 飞行器加 1 血并永久抬上限 | effects.ts:704 | qa.test.mjs D 块 | covered |
| 19 | 血量 | 转标记的伤害不算受伤、不触发判定 | combat.ts:139 | qa.test.mjs QA-19 | covered |
| 20 | 血量 | 标记无上限、公开可见 | status.ts:158 | qa.test.mjs QA-19/20 | covered |
| 21 | 血量 | 飞行器上限保留并计入初始上限 | combat.ts:148-149 | qa.test.mjs D 块 | covered |
| 22 | 血量 | 开局无；己方回合末 +1，首伤再 +1 | effects.ts:634 | qa.test.mjs D 块 | covered |
| 23 | 救援 | 前锋只扣 1 血；野人必扣本体 | rescue.ts:185-187 | qa.test.mjs QA-23 | covered |
| 24 | 救援 | 自我救援不扣血，仅上限减半 | rescue.ts:172-177 | rescue.test.mjs:156 | covered |
| 25 | 救援 | 套索：保持濒死、他人不可救、牛仔可救 | effects.ts:671;game.ts:239 | qa.test.mjs QA-25 | covered |
| 26 | 救援 | 虫群受伤害同扣血与耐久，任一归零即死 | combat.ts:139 | qa.test.mjs QA-26 | covered |
| 27 | 充能 | 每大回合开始充能一次 | game.ts:356-374 | effects.test.mjs:794,806 | covered |
| 28 | 充能 | 激励充能无上限 | characters.json:284-286 | effects.test.mjs:828 | covered |
| 29 | CD | CD=N 需等 N 回合才可再用 | trigger.ts:197-205;game.ts:839-845 | qa.test.mjs QA-29 | covered |
| 30 | CD | 每次回合结束 CD 计数 +1 | game.ts:842 | effects.test.mjs:919 | covered（按 P5-32） |
| 31 | 道具 | 所有角色可用，可对敌方使用 | game.ts:701-723 | qa.test.mjs QA-31 | covered |
| 32 | 道具 | 本回合不可用=临时，减费=永久（P6-Q10：道具级） | game.ts（`useSkill.itemId`/`itemLocked`）;effects.ts（`itemLock`/`$chosen`） | qa.test.mjs QA-32 | covered |
| 33 | 道具 | 魔术棒：仅下次 +1k，用后失效 | items.ts;effects.ts:478 | qa.test.mjs QA-33 | covered |
| 34 | 道具 | 画作绑定一个角色名，可指定该名下 1 人 | effects.ts:496;game.ts:804 | qa.test.mjs QA-34 | covered |
| 35 | 技能 | 役鸟守护攻击力永久 -1，可加回 | status.ts:134-137 | qa.test.mjs QA-35 | covered |
| 36 | 技能 | 钢铁冲刺首个护腕不耗 k，数量照扣 | items.ts;effects.ts:478 | qa.test.mjs QA-36 | covered |
| 37 | 技能 | 入殓可任意友方回合无限次转移 | game.ts:592-618 | effects.test.mjs:693-707 | covered |
| 38 | 技能 | 门之钥可交换敌方目标 | trigger.ts:132-134 | qa.test.mjs QA-38/39 | covered |
| 39 | 技能 | 门之钥交换永久，可换回 | effects.ts:481-499 | qa.test.mjs QA-38/39 | covered |
| 40 | 技能 | 期待有实际机制，可只给邮差 | effects.json:2657-2663 | effects.test.mjs:599-602 | covered |
| 41 | 站位 | 固定站位定相邻；BP 可调，开局不变 | game.ts:386,497;trigger.ts:92 | qa.test.mjs QA-41 | covered |
| 42 | 站位 | 常规不可变，技能/道具可改（D20） | effects.ts:545-556 | qa.test.mjs QA-42 | covered |

## gap / conflict 明细（按修复块归并）

**A. 每回合 k 资源（QA-02，整块缺失）**：全仓无 +3k 字段与结算点；`game.ts:61` 的 `itemBudget` 只是 BP 余额折算。影响 QA-01 的另一半判据。需新增资源字段 + 大回合开始结算 + 测试；工作量独立成块。

**B. 延缓致死链路（QA-12/13/15/16）——已完成（2026-11-07）**：`applyDamage` 已改为「致命 → 延迟队列（`deferDamage`），否则护盾/临时血/本体」；巧手匠心转移为无来源伤害。见 `combat.ts:139-160`、`qa.test.mjs`。

**C. 佣兵/牛仔/昆虫学者 custom（QA-19/20/25/26）——已完成（2026-11-07）**：`damageToMark`/`drainMarks`/`holdDying`/`deferredRescue` 全部落地；虫群伤害同扣血与耐久。见 `combat.ts:139`、`effects.ts:646-712`、`qa.test.mjs`。

**D. 飞行器上限（QA-18/21）——未做**：core 只消费 `stat:'atk'`（`combat.ts:56`），`modStat hp` 不落地；`triggerFlyer` 只抬 `maxHp` 不抬 `initialMaxHp`，而救援用 `initialMaxHp`（`combat.ts:148-149`），导致救援后上限丢失。QA-22 的「己方回合末 +1」也未接回合边界。

**E. 数据/符号错（QA-33/36）——已完成（2026-11-07）**：`items.ts` 折扣语义定为「正=加价、负=减价」并支持 `once`/`turn`；魔术棒 `+1000/once`、钢铁冲刺 `-1000/turn`。见 `items.ts`、`qa.test.mjs`。

**F. 口径/判据已裁（QA-07/30/34/42）**：裁决结果见下节与 `temp/decisions.md` 的 P6 条目。QA-30 维持现状（改标 covered），QA-07/34/42 需改代码或补断言。

## 裁决落地（2026-11-07，8 条已定）

| 条目 | 裁决 | 对实现的要求 |
|---|---|---|
| Q1 / QA-02 | 默认：本轮实装 | `GameState` 每方 `k`，大回合开始 +3，道具从 `k` 扣，局末清零 |
| Q2 / QA-30 | 默认：维持 P5-32 | 不改代码；把 QA-30 标注为表述粗糙，矩阵改 covered |
| Q3 / QA-18/21 | 默认 | `modStat` 支持 `stat:"hp"`（加当前血+上限），并同步 `initialMaxHp` |
| Q4 / QA-15/16 | 默认：致命先于护盾 | 修 `applyDamage`：致命判定 → 延迟队列，绕过护盾；到点结算 |
| Q5 / QA-26 | 伤害同时扣耐久和血量 | 伤害同时扣 `hp` 与 `durability`；任一 ≤0 即死亡 |
| Q6 / QA-34 | 画作获取时已绑人名 | 物品实例带 `nameKey`（画家【艺术敏感】取得被攻击者画作）；使用时只选该名下 1 人 |
| Q7 / QA-42 | 默认：允许技能/道具改站位 | 维持 `swapPosition`，补测试即可 |
| Q8 / QA-07 | 默认：按 QA 枚举修 | 改 `status.ts` 的 `untilNextOwnTurnEnd`，使后手在先手回合时算到本大回合后手回合末 |

## P6-2 执行结果

1. ~~C 块：坚强/套索/虫群（QA-19/20/25/26）~~ 已完成。
2. ~~Q4 块：延缓致死重排（QA-12/13/15/16）~~ 已完成。
3. ~~E 块：道具折扣语义（QA-33/36）~~ 已完成。
4. ~~A 块：每回合 k 资源（QA-01/02）~~ 已完成。
5. ~~D 块：飞行器三处（QA-18/21/22）~~ 已完成。
6. ~~F 块：QA-07 时点、QA-34 画作 `nameKey`、QA-42 站位断言、QA-32 玩具匣~~ 已完成。
7. ~~补断言：QA-14/23/29/31/35/38/39/41~~ 已完成。

收尾后基线：`npm run verify` 全绿，49 组测试。

**唯一遗留（QA-23）**：前锋救援的 `rescueRule` 是 `trigger:"always"`，但 `core/game.ts:188` 的 `STATIC_OPS` 不含 `rescueRule`，`applyAlwaysPassives` 直接跳过，导致 `hasRescue` 从未授予 —— 前锋在实战中无法救援。机制本身（扣 1 血、可扣临时血）在 `core/rescue.ts` 已实现，只差接线。测试已用 `skip` 记录，修法二选一：把 `rescueRule` 加入 `STATIC_OPS`，或在数据里补 `grantRescue`。

## P6-3 补充（2026-11-15）：Q9/Q10 已落地

- Q9：开局 `k` = BP 折算值 + 3k（`core/game.ts` 的 `createGame`）；`itemBudget` 仍只作初值。
- Q10：玩具匣改为道具级——`target.mode:"none"`、`ops` 用 `item:"$chosen"`、动作 `useSkill.itemId` → `EffectContext.itemId`；新增 op `itemLock`（锁 `itemLock:<itemId>`）与 `core/items.ts` 的 `itemLocked()`；减价/锁定都作用于己方全体（道具属于玩家）。数据由 `scripts/p5-tune.mjs` 生成，四步链已跑。
- 验证：`npm run verify` 全绿（49 组），覆盖率 84/23/4，`custom` 技能 22 个。
