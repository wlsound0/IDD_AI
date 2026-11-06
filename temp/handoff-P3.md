# 交接：P2 完成，P3 起点

## 状态
`npm run verify` 全绿（15 组测试）。`npm run play` 可跑完整一局。

## 新增（本轮）
- `core/game.ts` 对局状态机：动作 attack / rescue / endTurn，事件日志，胜负联动。
- `scripts/play.mjs` 演示对局，日志写入 `temp/logs/match.json`。
- `test/game.test.mjs`（10 条）、`test/match.test.mjs`（金标 2 条）。
- `data/characters.json`、`data/items.json` 已就位（从 temp/data 复制）。

## 修复的 bug（值得记住）
1. 救援原先不检查阵营 → 敌方也能救人。已在 `rescue.ts` 加 `side` 校验。
2. 濒死单位仍能行动 → `isActive` 增加 `hp > 0`。

## P3 要做的事
1. 无打包器方案：`tsc` 编译 `core/` 为浏览器可加载模块（ESM 或挂到 window），页面直接 `<script type="module">`。
2. React 本地副本放 `ui/vendor/`，不用 JSX（用 `h()`）。
3. 页面结构：BP 区（先手/后手、全局 BAN、两次个人 BAN、14k、5 人、稀有度提示）+ 战斗区（角色卡、攻击/血量、技能、道具栏、日志）。
4. 先用 `data/*.json` 渲染只读界面，再接 `applyAction`。

## 注意
- 环境：Node v18.14.1，npm；禁止任何需要子进程的构建工具（vite/vitest 不可用）。
- 界面不追求像素级还原，只要信息与操作齐全。
- 所有规则疑问已裁决完毕，新疑问写入 `temp/decisions.md`。
