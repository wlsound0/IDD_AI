# 交接：P5 第二轮之后（2026-11-07）

> 给下一个会话：状态以本文件 + `temp/decisions.md` 末节为准。交接时 `npm run verify` 全绿：typecheck、28 组测试、效果表校验、覆盖率、ui:build、ui:check 均 PASS。不要重跑全量去重新发现。

## 一句话状态

P5 只剩 **P5-9 充能速率**。P5-16⑥ 四件（藏锋扫式/击球手 CD/入殓师标记/飞行家免伤救援）与 P5-21 已落地，覆盖率 **full 76 / partial 31 / none 4**，含 `custom` 技能 **29**。下一步只做 P5-9，别顺手开工 P6。

## 已完成（本轮，不用重做）

- P5-22：`zuoqujia/调律` 的 `extraAttack` 补 `duration:"untilOwnTurnEnd"`；测试不再自补 duration，直接断言 `data/effects.json` 真实条目。顺带修 `laladuiyuan/鼓舞` 的 `defer` 把时机写成 `when`（应为 `delay`），此前会被当成回合结束结算。
- P5-23：`core/game.ts` 的 `useSkill` 目标过滤实现 `excludeSelf`、`wounded`；未知 filter 键直接抛错，不再静默放行。
- P5-17：`destroySummon` 分支补 `fire({trigger:'summonDeath'})`，主动销毁幻影同样给记者临时血量。
- 邮差六信件：`youcha/邮件` 改为 6 个 `branches`（急切/诀别/冷静/勇敢/激励/希望），并新增通用能力——ref `selfAndTarget`（邮差与收信者同享，同一人只算一次）、`heal` 的 `amountExpr:{base,minus:'alliesAlive'}` 与 `healMode:'add'`（加血可破上限）、分支条件 `branches[].if='notFirstBigTurn'`（`selectBranch` 第 3 参传 clock）、`core/combat.ts` 的 `applyDamage` 读 flag `letterFarewell` 实现「受击后回 1 血」。
- 测试从 26 组增到 **27 组**（新增邮编六信件一组 + P5-23 过滤用例）。

## 未完成（严格按此顺序）

0. ~~Q41 已完成~~、~~P5-16⑥ 已全部完成（2026-11-07）~~：藏锋扫式（相邻溅射/不反伤/+1/被击者 -1）、击球手 CD 惩罚、入殓师标记转移、飞行家飞行器免伤救援；`dmgDealt` 已接读取方，P5-21 关闭。覆盖率 **76/31/4**，custom 技能 29。
1. **P5-9 充能速率**（唯一剩余 P5 项）：仍每小回合 +1，须改原文速率（用户明确要求以后必须改；数据层需新增速率字段）。
2. 之后才进 P6（42 条 Q&A 逐条落测试）。

## 方案漏洞（写给自己）

1. `when` 与 defer 混用：defer 的时机字段是 `delay`；`when` 专给排程 op，混用会被 `runEffect` 跳过/错判（本轮刚修了鼓舞一处）。
2. 触发写了但没接线：新增 trigger 必须同时在 `core/game.ts` 接 fire 点并补行为测试，否则数据写了也静默失效。
3. 测试自补 `duration` 会掩盖数据缺口：断言尽量走 `data/effects.json` 真实条目。
4. filter 静默放行：未知 filter 键现在会报错，新增 filter 要继续加白名单（`excludeSelf`/`wounded`/`atkNotZero`）。
5. 三处白名单要同步：`scripts/validate-effects.mjs`（含 REFS/DURATIONS/OPS）、`scripts/coverage-effects.mjs`、`test/effects.test.mjs` 的 `KNOWN_OPS`。本轮已把 `selfAndTarget` 加进 REFS。
6. `data/effects.json` 是生成物：只改 `scripts/p5-tune.mjs` 或 `temp/p5-batches/*.out.json`，四步链顺序不能反。
7. `restrictAttack` op 目前只写 flag、无任何读取方（本轮未使用，别误以为它生效）。
8. 加血/回血是两个概念：`healMode:'add'` 才破上限并抬 maxHp；别把「加血」写成 `heal` 默认行为。
9. 改过 `core/` 导出后必须 `npm run ui:build`，否则 AMD require 拿不到新模块。

## 入口

- 数据链：`node scripts/p5-tune.mjs` → `merge-effects.mjs` → `validate-effects.mjs` → `coverage-effects.mjs`。
- 验证：`npm run verify`（typecheck + tests + 效果表 + ui build + ui smoke）。
- 待裁决/默认：`temp/decisions.md`（P5-17…P5-23、Q41 已裁）。
- 覆盖率明细 `temp/p5-coverage.md`；格式说明 `temp/p5-effect-spec.md`；上一份交接 `temp/handoff-P5-5.md`。
