# 交接：P4 完成，P5 起点

> 给下一个会话看。读完这份就够，不用重读源码。

## 一句话状态
BP 已接入内核与界面：`npm run verify` 全绿（20 组测试 + 界面构建 + 界面冒烟）。P4 按 `temp/plan.md` 第 6 节方案完成；之后按用户反馈修了 4 处（BAN 重复规则、日志/濒死显示的玩家+站位号、冠军页双出口、投降）。

## 验证入口
- `npm run verify`：`tsc --noEmit` → core 编译到 `temp/build/core` → `node test/index.mjs`（20 组）→ `ui:build` → `ui:check`。
- `npm run play`：演示对局（不经过 BP，直接用 createGame）。
- 用户侧：双击 `start.cmd` 或 `temp/build/ui/index.html`。

## 代码地图（本轮新增/改动）
- `core/bp.ts`（新增）：变体表 `BP_VARIANTS`（single/bo3/bo5）、8 步骨架 `roundSteps`、`createBp` / `legalBpChoices` / `blockReason` / `applyBp`、`toItemBudget`（1:2）、系列赛 `createSeries` / `recordRoundWinner` / `advanceSeries`。
- `core/types.ts`：`CharacterDef.cost`。
- `core/game.ts`：`createGame(units, { itemBudget })`，`GameState.itemBudget` 原样透传。
- `data/characters.json`：43 条新增 `cost`（1k–5k），由 `temp/extract-cost.mjs` 生成。
- `ui/app.js`：新增 `StartScreen` / `BpScreen` / `LineupScreen` / `ChampionScreen`；`App` 改为系列赛流程（BP → 站位 → 对局 → 记录 → 下一小局/冠军）。
- `ui/style.css`：BP 面板样式（追加）。
- `test/bp.test.mjs`（新增，已登记 `test/index.mjs`）；`scripts/check-ui.mjs` 改为断言首屏/BP 面板/BP 中间态/站位页。

## 关键决定（别改回去）
1. **BAN 只作用于对方**（机制 R12）：自己的 BAN 不挡自己选，对方 BAN 才挡。
2. **全局 BAN 私有**（Q36）：只进「选它的那一位玩家」的集合，对手可正常选；跨小局累积、不可解除、系列赛结束清空。
3. **先手逐局轮换**（Q34）：BO1/BO3 由玩家1先手，BO2 由玩家2先手；BP 先手方 = 该小局对局先手方。
4. **同名口径**（Q20/Q37）：同名限定/史诗 ≤1，同名普通 ≤2；一方限定合计 ≤2 且必不同名；史诗不限量。
5. **首轮 pick 是否「不同」**：标了 `distinctFirstPicks` 的才要求（Q17/Q38）。
6. **14k 每小局重置**，剩余按 1:2 折算成道具花费，接入点 `createGame` 的 `itemBudget`（P5 才真正消耗）。
7. **BAN 可跨玩家重复**：对方 BAN 过的名字仍可 BAN；只有自己不能重复 BAN 同一个名字（decisions P4-1）。
8. **投降**：`resign` 动作在 `applyAction` 最前面处理，绕过濒死队列；BP 阶段用 `forfeitBp` 结束本小局（decisions P4-2）。界面都是「点一次出确认条、再点确认」。

## P5 要做（建议）
1. 技能全量（111 个）与 15 件道具的结算，接到 `core/`，让 `itemBudget` 真正参与战斗。
2. BP 界面可加「角色编号」细节确认（当前用 `#站位号` 区分同名，已能覆盖同名敌我与同队同名）。
3. `README.md` 的「当前进度 / 当下任务」还停在 P4 开工前，需要更新。

## 已知坑
- 沙箱禁子进程：vite/vitest/`node --test` 都跑不了，测试必须走 `test/index.mjs` 单进程。
- 界面走 AMD：core 编译成 `core.raw.js`，`data/*.json` 内联成 `data.js`；新增 core 模块无需改构建脚本，但 `ui/app.js` 里要 `require(['bp'])` 才能拿到。
- 数据目录是 `data/`（运行时），`temp/data/` 是旧抽取产物，别改错。
