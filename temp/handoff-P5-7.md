# 交接：P5-16⑥ 零碎收尾之后（2026-11-07）

## 结论

- P5-16⑥ 四件与 P5-21 已落地：藏锋扫式（相邻溅射/不反伤/攻击 +1/被击者攻击 -1）、击球手「爆发」CD 惩罚与命中减攻、入殓师「附容返生」标记自由转移、飞行家「消耗飞行器免伤救援」；`dmgDealt` 已有真实读取方。
- 覆盖率 **full 76 / partial 31 / none 4**，含 `custom` 技能 **29**。
- `npm run verify` 全绿：typecheck + 28 组测试 + 效果表校验 + 覆盖率 + ui:build + ui:check。
- P5 只剩 **P5-9 充能速率**，之后进 P6。

## 交付物

- 内核：`core/combat.ts`（dmgDealt 读取）、`core/effects.ts`（`grantTransferMark`/`grantRescueFlyer`/新能力字段）、`core/game.ts`（`atkDownOnHit`、`atkPenaltyOnCd`、`transferMark` 动作、`rescue.useFlyer`）。
- 数据：`scripts/p5-tune.mjs` 四条规则 → `data/effects.json`（禁手改，走四步链）。
- 界面：`ui/app.js` 救援面板新增「消耗飞行器（无伤）」、右侧新增「附容返生转移」面板。
- 测试：`test/effects.test.mjs` 新增「P5-16⑥ 零碎」4 条，覆盖率断言改 76/31/4。
- 口径记录：`temp/decisions.md` 末节「P5-16⑥ 落地口径」。

## 未决/注意

1. 藏锋「下次攻击 +1」实现为本回合持续，非一次性消耗；「相邻」复用 `splash` 判定（同阵营、|slot 差|=1）。
2. 击球手 CD 惩罚按 `cdCounter < cd` 判定，开局 CD 技能 `cdCounter=0` 也计 -1（沿用 R16 现行语义）。
3. 飞行家「无伤」按直解绕过「救完本体血量 ≥1」限制。
4. 入殓「友方最多一个」只在转移时清理，施放时未硬限制。
5. 新增 op 已同步三处白名单（`validate-effects.mjs`、`test/effects.test.mjs` 的 `KNOWN_OPS`；`coverage-effects.mjs` 自动统计）。
