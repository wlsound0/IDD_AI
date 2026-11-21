# 交接：P4 完成，P5 起点（V0.2）

> 给下一个会话看。读完这份就够，不用重读源码。

## 一句话状态
BP 已完整接入内核与界面，`npm run verify` 全绿（20 组测试 + 界面构建 + 界面冒烟）。版本号已升到 V0.2。

## 验证入口
- `npm run verify`：`tsc --noEmit` → core 编译到 `temp/build/core` → `node test/index.mjs`（20 组）→ `ui:build` → `ui:check`。
- `npm run play`：演示对局（直接 createGame，不走 BP）。
- 用户侧：双击 `start.cmd` 或 `temp/build/ui/index.html`。

## 代码地图
- `core/bp.ts`：`BP_VARIANTS`（single/bo3/bo5）、`roundSteps`（8 步）、`createBp` / `legalBpChoices` / `blockReason` / `applyBp` / `forfeitBp`、`toItemBudget`、系列赛 `createSeries` / `recordRoundWinner` / `advanceSeries`。
- `core/game.ts`：`resign` 动作（最先处理，绕过濒死队列）、`GameState.itemBudget`、`createGame(units, { itemBudget })`。
- `core/types.ts`：`CharacterDef.cost`。
- `data/characters.json`：43 条 `cost`（1k–5k），由 `temp/extract-cost.mjs` 生成（可重跑）。
- `ui/app.js`：`StartScreen` / `BpScreen` / `LineupScreen` / `ChampionScreen`；`App` 管系列赛流程；战斗页日志与濒死面板统一显示「玩家X · #站位号 · 角色名」。
- `test/bp.test.mjs`（新增）、`test/game.test.mjs` 里的投降 3 例；`scripts/check-ui.mjs` 覆盖首屏/BP 面板/BP 中间态/站位页/冠军页/投降。
- 计划原文：`temp/plan.md` 第 6 节（P4 最终方案）。

## 关键决定（别改回去）
1. BAN 只作用于对方；**对方已 BAN 的名字仍可 BAN**，只有自己不能重复 BAN 同一个名字（decisions P4-1）。
2. 全局 BAN 私有：只进选它的那位玩家的集合，跨小局累积、不可解除、系列赛结束清空（Q36）。
3. 先手逐局轮换：BO1/BO3 玩家1 先手、BO2 玩家2 先手；BP 先手方＝该小局对局先手方（Q34）。
4. 稀有度：同名限定/史诗 ≤1、同名普通 ≤2、一方限定合计 ≤2 且必不同名、史诗不限（Q20/Q37）。
5. 首轮 pick 是否要求「不同」看变体（Q17/Q38）；「至多 3 个」允许 0–3（Q19）。
6. 投降：任意时候（BP/对局）点两次确认；BP 认负用 `forfeitBp`，已选角色与全局 BAN 保留（decisions P4-2）。
7. 14k 每小局重置，剩余按 1:2 折算道具花费，供 P5 消耗。

## P5 起点与已知缺口
1. 技能 111 个 + 道具 15 件接入，让 `itemBudget` 真正参与战斗。
2. **`canAttack` 目前恒为 true**（只要有人存活），所以「一方无法进攻，两大回合后该方获胜」永不触发——需等技能/道具接入后重算。
3. **从未进攻的僵持判不出胜方**：`victory.ts` 的规则 4 依赖 `lastAggressor`，双方从开局起都没攻击时为空。用户已裁决：**判后手胜**，尚未实现（改 `checkVictory` + 补测试）。
4. 输出格式/验收仍按 `TASK.md`；测试必须走 `test/index.mjs` 单进程。

## 已登记待办（未开工，用户口述）
- **BP 阶段「撤回上一步」+ 每步确认**：每次操作（例如玩家1 先 BAN 两个）完成后需按一次确认键；确认后不可撤销，并进入下一步（例如玩家2 第一轮 BAN 两个）。
  - 实现提示：`applyBp` 是纯函数，界面保留 `BpState` 历史栈即可撤回；确认键需要把「步内多选」先攒在本地草稿，确认后一次性提交（可新增 `applyBpBatch` 或在 App 里暂存）。
- 角色编号：已用 `#站位号` 覆盖事件日志/濒死面板/站位页（同队同名也会拿到不同编号）。

## 已知坑
- 沙箱禁子进程：vite/vitest/`node --test` 都跑不了，测试走 `test/index.mjs`。
- 界面走 AMD：core 编成 `core.raw.js`，`data/*.json` 内联成 `data.js`；`ui/app.js` 里必须 `require(['bp'])` 才拿得到新模块。
- 运行时数据在 `data/`，`temp/data/` 是旧抽取产物，别改错。
- README 的「当前进度」已同步到 P4 完成 + P5 起点。
