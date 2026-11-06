# 交接：P2 完成，P3 起点

> 给下一个会话看。读完这份就能接着干，不需要重读源码。

## 一句话状态
规则内核已能跑完整局（`npm run play`），P0/P1/P2 全绿；下一步是界面（P3），尚未动工。

## 验证入口
- `npm run verify`：`tsc --noEmit` 类型检查 + `tsc -p tsconfig.build.json` 编译到 `temp/build/core` + `node test/index.mjs`。当前 15 组测试全绿，退出码 0。
- `npm run play`：编译后跑 `scripts/play.mjs`，日志写 `temp/logs/match.json`，可用来看真实对局长什么样。
- `npm run check`：校验抽取产物（temp 下）。

## 代码结构（不要重读，按此表找人）
- `core/types.ts` —— 共享类型（Side / SkillDef / PendingEffect）。
- `core/settlement.ts` —— R21 结算顺序，**唯一排序来源**，钩子也复用它。
- `core/turn.ts` —— 大/小回合时钟、首回合攻击 -1。
- `core/combat.ts` —— 攻击伤害、反伤、临时血、庄园老友、加血/回血、救援上限。
- `core/rescue.ts` —— 濒死判定、救援选项、野人/画家特例、召唤物不可救。
- `core/hooks.ts` —— 事件钩子注册表（8 个点），支持拦截与按角色注销。
- `core/victory.ts` —— 胜负四分支与僵持计数。
- `core/game.ts` —— 对局状态机：`createGame` / `applyAction` / `legalAttackTargets`，动作有 `attack` / `rescue` / `endTurn`。
- `data/characters.json`、`data/items.json` —— 运行时数据（从 temp/data 复制）。
- `scripts/play.mjs` —— 演示对局，纯脚本替玩家决策。

## 规则依据（有冲突时按顺序取）
1. `temp/extract/裁决落地.md`（D01–D21，最高优先级）
2. `temp/decisions.md`（原始问答，含第二批 Q30–Q33）
3. `temp/extract/*.md`（从 docx 抽取，部分已被裁决覆盖）

## 已知坑（踩过，别再踩）
- 沙箱禁止子进程：vite/vitest/`node --test` 都跑不了。测试必须走 `test/index.mjs` 单进程。
- 注入 JSON 时注意 `side` 字段：`createGame` 不校验阵营归属，全是 first 会直接判出胜负。
- 救援只有同阵营才能做（`rescue.ts` 里有 side 校验）。
- 濒死（hp≤0 未死）单位不能行动，`isActive` 已加 `hp > 0`。

## P3 待办（按顺序）
1. 用 `tsc` 产出浏览器可加载的 `core` 模块；不要引入打包器。
2. React 本地副本放 `ui/vendor/`，不用 JSX，用 `h()`。
3. 页面：BP 区（先手/后手、全局 BAN、两次个人 BAN、14k、5 人、稀有度提示）+ 战斗区（角色卡、攻击/血量、技能、道具栏、日志）。
4. 先只读渲染 `data/*.json`，再接 `applyAction` 做真实操作。

## 尚未做的
- 技能系统未接：111 个技能只有文本，没有任何执行逻辑（P5）。
- 道具未接：15 件道具同样只有数据。
- BP 流程未实现（P4，骨架在 `temp/extract/BP.md`）。
- 42 条 Q&A 只落到 D 系列，尚未逐条写成测试（P6）。
