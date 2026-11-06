# 交接：P3 完成，P4 起点

> 给下一个会话看。读完这份就够，不用重读源码。

## 一句话状态
界面能玩，`npm run verify` 全绿（16 组测试 + 界面构建 + 界面冒烟）。下一阶段是 P4（BP 规则）；P3 收尾时又补了 4 条濒死规则并落了测试。

## 验证入口
- `npm run verify`：`tsc --noEmit` → 编译 core 到 `temp/build/core` → `node test/index.mjs`（16 组）→ `ui:build` → `ui:check`。
- `npm run ui:build`：`tsc -p tsconfig.ui.json`（module=AMD + outFile）出 `core.raw.js`，再 `node scripts/build-ui.mjs` 复制静态文件、内联数据成 `data.js`、复制 React UMD → `temp/build/ui/`。
- `npm run ui:check`：Node 里 `renderToString` 冒烟（选人界面、对局界面、43 角色逐个渲染、只用界面动作打完一整局、濒死面板）。
- `npm run play`：演示对局，日志写 `temp/logs/match.json`。
- 用户侧：双击根目录 `start.cmd`（重新构建并打开 `temp/build/ui/index.html`）。

## 代码地图（只列本轮新增/改动）
- `core/game.ts`：`GameState.dyingQueue`、`pendingDying()`、`legalRescueOps()`；rescue 分支不再抛「不可被救援」，无人可救直接判死；攻击后按 `[被攻击者, 攻击者]` 入队。
- `core/rescue.ts`：`canRescue` 末尾改为「救完本体血量 ≥1」才可救（血 2 救 2 被禁）。
- `ui/index.html`、`ui/app.js`（全部界面逻辑，h()，无 JSX）、`ui/style.css`、`ui/vendor/amd.js`（迷你 AMD 加载器）。
- `tsconfig.ui.json`、`scripts/build-ui.mjs`、`scripts/check-ui.mjs`、`test/dying.test.mjs`（新增）；`test/index.mjs` 已登记。
- 规则补充：`temp/decisions.md` 的 B01–B04。

## 关键决定（别改回去）
1. **不用 `<script type="module">`**：`file://` 下浏览器拦 ES module 与 fetch。core 走 AMD+outFile 合成单文件，数据内联成 `data.js`。
2. **AMD 工厂参数是位置参数**：tsc 输出 `define("game", ["require","exports","turn"], function(require,exports,turn_2){...})`，加载器必须按 deps 顺序传参。
3. **界面不写规则**：能打谁问 `legalAttackTargets`，救援选项问 `legalRescueOps`，动作全交 `applyAction`，出错显示红条。
4. **濒死是强制队列**：队列非空时只允许处理队首，其余动作被内核拒绝；脚本必须先 flush 队列。

## P4 要做的（BP）
1. `core/bp.ts`：先手/后手、全局 BAN、两次个人 BAN、14k 预算、5 人、稀有度限制。骨架见 `temp/extract/BP.md`。
2. 把界面选人区（现为明确标注「规则未接入」的最简版）替换成真实 BP 流程。
3. **阻塞**：14k 预算缺角色价格数据（`data/characters.json` 无 cost 字段），需先补价格或补一条裁决，否则 BP 只能做「名义 BAN」。

## 已登记待办（用户要求，尚未开工）
- **角色编号**：界面上给每个角色一个编号/记号，用于区分同名角色——包括敌我之间的同名角色，以及我方两个可选同名角色。涉及 `ui/app.js` 的卡片渲染（`#slot` 目前只有站位号，不足以区分同名）。

## 已知坑
- 沙箱禁止子进程：vite/vitest/`node --test` 都跑不了，测试必须走 `test/index.mjs` 单进程。
- `hasReflect` 是 opt-in：核心只有 `target.hasReflect === true` 才反伤；界面 `makeUnit` 默认给全体 `true`（文档口径是全员默认反伤）。
- 渲染冒烟测试里造濒死场景，必须同阵营放一个血量足够的「救援」角色，否则内核直接判死。
