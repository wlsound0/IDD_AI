# 交接：P5 收尾（2026-11-07）

## 结论

- P5-9 已完成，`temp/decisions.md` 的 P5-29/30/31 裁决均为「默认」，即当前实现已确认。
- P5-32 裁决为「默认」：**要把 `data/characters.json` 的 `cooldown` 改成 `cd`、并补 `initialCd`**，这是 P5 遗留未完成项。
- P5-16⑥ 当时按默认实现，之后用户回填了裁决，其中 3 处与现实现有偏差，属未完成项。
- 现状：29 组测试全绿，覆盖率 full 76 / partial 31 / none 4，含 `custom` 技能 29 个。P6 未开工。

## 未完成任务（按优先级）

1. **P5-32 CD 字段修复**（改动小、影响 14 个 CD 技能）：`data/characters.json` 的 `"cooldown": n` → `"cd": n`；按 Q26 补 `initialCd`（玛恩纳初始 CD1、之后 CD2；其余 CD 技能的初始值需按原文核对）。改后跑 `npm test`；`data/effects.json` 四步链不涉及该字段。
2. **P5-24 藏锋「扫式」回改**：+1 应「用完即失效」（现为本回合持续）；+1 作用于伤害而非攻击力（已走 `dmgDealt`，别改回攻击力）；边缘角色只溅射一人。
3. **P5-26 附容返生上限回改**：上限 = 战场上己方入殓师数量；同一角色不能持有两个；现只在转移时清理，施放时未限制，双入殓师未支持。
4. **P5-27/28 飞行家回改**：救援血量阈值改为「施救者血量 > 本次扣血 x」；飞行器耐久 0 时技能不触发；「悬停」在耐久 0 时仅免伤、不消耗飞行器。
5. **P6**：42 条 Q&A 逐条落测试，见 `temp/handoff-P6.md`。

## 方案漏洞 / 风险

- 事件充能按 `damageTakenThisBigTurn` 增量结算；大回合边界会重置该计数，若今后出现「同一动作内先受伤再跨回合」的路径会漏充能（当前无此路径）。
- `turnStart` 触发器仍每小回合触发一次，与「大回合开始」语义不符；充能已单独按大回合结算，其他 `turnStart` 技能未审计。
- 回忆碎片「记忆同步期间」前置未实装（P5-31 已接受默认，等记忆同步状态建模再补）。
- `data/effects.json` 禁止手改，改数据走四步链：`p5-tune → merge-effects → validate-effects → coverage-effects`。
- 改过 `core/` 导出后必须 `npm run ui:build`，否则 UI 拿不到新模块。

## 交付物

- 代码：`core/types.ts`、`core/units.ts`、`core/game.ts`（新增导出 `chargeOnBigTurnStart`）、`data/characters.json`、`test/effects.test.mjs`。
- 文档：`README.md`、`temp/decisions.md`（末节 P5-9）、`temp/handoff-P5-8.md`。
- 关键字段：充能技能新增 `chargeInitial` / `chargeMax` / `chargeRate:{turns,amount}` / `chargeOn`。
