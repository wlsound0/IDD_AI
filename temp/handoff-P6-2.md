# 交接：P6 两条裁决落地（2026-11-15）

## 结论

- P6-Q9 已落地：开局 `k` = BP 折算值 + 3000（`core/game.ts` 的 `createGame`）；`itemBudget` 仍只作初值、不参与扣费；之后每个大回合开始仍各 +3000。
- P6-Q10 已落地：玩具匣改为**道具级**选择——技能 `target.mode:"none"`，ops 用 `item:"$chosen"`，动作新增 `useSkill.itemId` → `EffectContext.itemId`；新增 op `itemLock`（状态 key `itemLock:<itemId>`）与 `core/items.ts` 的 `itemLocked()`。减价（`itemDiscount:<itemId>`，permanent）与锁定（`turns:1`）都挂在**己方全体**身上，因为道具属于玩家而非某个角色。
- 候选道具 = 己方所有存活角色道具栏里出现过的道具 id（去重）；未指定或不在己方道具栏 → 内核报错。UI 在技能按钮位置改列道具小菜单（点击即带 `itemId` 下发）。
- 数据仍由 `scripts/p5-tune.mjs` 生成（该规则同时新增「ops 路径也能改 `target`」），四步链已跑，覆盖率不变：84/23/4，`custom` 技能 22 个。

## 验证

- `npm run typecheck` PASS。
- `npm test` 49/49 PASS。
- `npm run verify` 全绿（类型检查 + 49 组测试 + 效果表校验 + 界面构建 + 界面冒烟）。
- `npm run play` 正常跑完一局（后手胜）。
- `qa.test.mjs` 的 A 块断言已按新口径更新（8600/5000 起步、玩具匣道具级 + 队友同享减价 + 另一个道具不受影响）。

## 改动文件

- 内核：`core/game.ts`（k 初始化、`useSkill.itemId` 校验与注入、`useItem` 用 `itemLocked`）、`core/effects.ts`（`EffectContext.itemId`、`resolveItem`、`itemDiscount` 支持 `$chosen`、新 op `itemLock`）、`core/items.ts`（`itemLocked`）。
- 数据链：`scripts/p5-tune.mjs`、`scripts/validate-effects.mjs`（OPS 白名单 + 测试 `KNOWN_OPS`）、`data/effects.json`（生成物）。
- 界面：`ui/app.js`（道具小菜单 + `itemId` 透传）。
- 测试：`test/qa.test.mjs`、`test/effects.test.mjs`。
- 文档：`README.md`、`temp/decisions.md`、`temp/p6-qa-checklist.md`。

## 收尾状态（2026-11-15）

- P6 全部完成：六块 + Q9/Q10 两条裁决已落地，代码/数据/界面/测试/文档同步完毕。
- 基线：`npm run verify` 全绿（49 组测试 + 效果表校验 + 界面构建 + 界面冒烟），覆盖率 84/23/4，`custom` 技能 22 个；无新增依赖或构建工具。
- 彻底完工尚余两项：① 22 个含 `custom` 的技能（`temp/p5-coverage.md`）；② BP「撤回上一步 + 每步确认」（未开工）。
- 本阶段到此为止，不再顺手开工新内容。

## 未决问题

- 剩余 22 个含 `custom` 的技能（见 `temp/p5-coverage.md`）。
- BP 阶段「撤回上一步 + 每步确认」未开工。
- 玩具匣候选道具目前只取己方道具栏；若日后允许「指定任意道具（哪怕没人持有）」需再对齐文档。

## 本次步数

约 25 步工具调用（无子代理，改动集中在 3 个内核文件 + UI + 测试）。
