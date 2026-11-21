# 交接：P5 收尾完成（2026-11-07）

## 结论

- P5 遗留四项全部完成：P5-32（CD 字段）、P5-24（扫式一次性）、P5-26（附容返生上限）、P5-27/28（飞行家）。`npm run verify` 全绿（30 组测试）。
- 覆盖率：full 77 / partial 30 / none 4，含 `custom` 技能 27 个（原 76/31/4、29 个）。
- 过程中新发现 2 条口径歧义，已按默认实现并写入 `temp/decisions.md`（P5-33/P5-34），等裁决回填。

## 关键改动

1. P5-32：`data/characters.json` 的 `cooldown` 全部改名 `cd`；仅玛恩纳 `cd:2` + `initialCd:1`。同时补 R22/D08：**从未使用过**的 CD 技能开局可用，`initialCd=n` 需第 n+1 回合起，**使用当回合不计数**（`core/game.ts` 大回合结束处按 `usedThisBigTurn` 跳过）。
2. P5-24：新增一次性时长 `duration:"nextAttack"`（`Status.consumedOn='attack'`，攻击结算完由 `core/game.ts` 清除）。藏锋扫式的 +1 伤害/不反伤/溅射/被击减攻全部改为一次性；溅射复用玛恩纳判定，边缘角色自然只命中一人。
3. P5-26：新增 `SkillEffect.battlecryOps`（开局结算一次）。入殓=战吼开局自带标记；施放即「先撤后上」转移，上限=战场上己方入殓师数量，同一角色不可两个。`rulianshi/入殓` 升 full。
4. P5-27/28：新增 op `triggerFlyer`（耐久 0 不触发；触发扣 1 耐久、回 1 血、上限 +1）。悬停改为 `[immune, triggerFlyer]`，并把 `beforeDamage` 在攻击路径接线；`core/game.ts` 的攻击结算前对受击者触发一次。

## 交付物

- 代码：`core/status.ts`、`core/effects.ts`、`core/trigger.ts`、`core/game.ts`、`ui/app.js`（技能行显示 `initialCd`）
- 数据：`data/characters.json`、`data/effects.json`（由四步链生成）、`scripts/p5-tune.mjs`、`scripts/validate-effects.mjs`
- 测试：`test/effects.test.mjs`（新增 P5-32 CD 组、入殓两组、悬停、R16 计数，共 30 组）
- 文档：`README.md`、`temp/decisions.md`（P5-33/34）、本文件

## 未决问题

- P5-33：开局「可用」与「处于 CD」并存（击球手首回合攻击 -1 是否仍成立）。
- P5-34：cd=1 的再释放时机（默认：用后隔一个大回合）。
- 悬停的免伤只在攻击伤害路径生效；技能伤害不走 `beforeDamage`，需等触发层重构或单独接线。
- 藏锋转式/扫式的耐久消耗（1/3）差异仍未实装。

## 本次步数

约 30 步工具调用（含 1 个子代理）。
