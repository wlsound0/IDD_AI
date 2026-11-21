# 交接：P7-2 第 4 步收尾（2026-11-21）

## 一句话现状

P7-2 第二轮裁决的 **第 1–4 步已全部落地并验绿**；**第 5 步（X6 八音盒抉择式道具）未开工**，用户已要求暂停，等明确指令再做。本轮只做收尾（README + 本文件），没有改动任何代码或数据。

## 已验证基线（2026-11-21，第 4 步后）

- `npm run verify` 全绿 = **56 组 / 210 条测试** + 效果表校验 + 界面构建 + 界面冒烟（选人页、对局页、43 个角色逐个渲染、新增的打断遮罩 3c）。
- 覆盖率 **full 106 / partial 1 / none 4**；唯一 `partial` 是 `wunv/二重奏`（八音盒本体未实装，属第 5 步）；`custom` 技能 0 个。
- 数据链四步（顺序不能反）：`node scripts/p5-tune.mjs`（RULES 70 条）→ `merge-effects.mjs` → `validate-effects.mjs` → `coverage-effects.mjs`。`data/effects.json` 仍是生成物，不要手改。

## 第 4 步（X5(a)：魔术棒 = 攻击前打断窗口）改动

| 文件 | 改动 |
|---|---|
| `core/game.ts` | `GameState.pendingAttack?: {attackerId, targetId}`；`Action` 新增 `resolveAttack` / `interruptAttack`，`attack` 加内部字段 `damageFactor`；`GameEvent` 新增 `attackPending` / `attackInterrupted`。attack 校验通过后、`beforeDamage` 之前：受击方持有 `reaction:"beforeAttack"` 道具就只置 `pendingAttack` 并返回。窗口内除 `interruptAttack` / `resolveAttack` / `resign` 外一律抛「请先处理攻击打断窗口（使用魔术棒或选择不打断）」；无窗口时 `resolveAttack` 抛「当前没有待处理的攻击」。正式结算：`dmg = Math.max(Math.floor(rawDmg * (action.damageFactor ?? 1)), flagValue(attacker.statuses, 'minDamage'))`。`useItem` 拒绝反应式道具。新增 `findInterruptItem()` 与 `useInterruptItem()`（与 useItem 同口径计价/折扣/消耗 + `fire(itemUse)` + `attackInterrupted`）。 |
| `core/effects.ts` | `ItemEffect.reaction?: 'beforeAttack'`；`EffectContext.interrupt?: {factor}`；新 op `interruptDamage`（只写 `ctx.interrupt.factor`，不挂状态）。 |
| `scripts/p5-tune.mjs` | moshubang 规则改 `interruptDamage`(factor 0.5) + `reaction:'beforeAttack'`；ops 替换分支支持 `r.reaction` / `r.clearReaction`。 |
| `scripts/validate-effects.mjs` | OPS 白名单加 `interruptDamage`。 |
| `test/effects.test.mjs` | `KNOWN_OPS` 同步；原「魔术演绎」用例改写，新增「魔术棒」两组（开窗/关闭、减半向下取整、扣 1k、道具消耗、下次 +1k、`resolveAttack` 吃满伤害、无道具不开窗、wandCap1 在窗口内生效）。 |
| `ui/app.js` / `ui/style.css` | 打断遮罩 `.interrupt-mask` / `.interrupt-card`：攻击者/受击者、每支可用魔术棒一个按钮、「不打断，继续结算」；`onInterrupt` / `onResolveAttack` 接 `run()`；事件日志渲染两条新事件。 |
| `scripts/check-ui.mjs` / `scripts/play.mjs` | 攻击后若 `state.pendingAttack` 一律 `resolveAttack`；check-ui 新增 3c 遮罩冒烟。 |
| `temp/decisions.md` | 新增 P7-2-X5 条目：README/handoff 写「打断窗口」而 `temp/p7-decisions-round2.md:33` 写「伤害减半」的口径冲突，按用户裁决（m00020）取**打断窗口**。 |

## 关键约定（后续别走回头路）

- **打断窗口的出口只有三个**：`interruptAttack` / `resolveAttack` / `resign`。写任何新的对局驱动（脚本、e2e、AI）都要在 `attack` 后处理 `state.pendingAttack`，否则卡窗。
- **减伤在 game.ts 一次算清**：`Math.floor(rawDmg * factor)`。不要改回给 `damageMultiplier` 挂 0.5——`applyDamage` 里那条是 `Math.round`，向下取整会算错。
- **打断道具的扣费方是受击者**，不是当前行动方；`interruptAttack` 必须传 `unitId === pendingAttack.targetId`。
- 魔术棒唯一的产出仍是魔术师「魔术演绎」（战吼给 3 支）；道具栏是纯展示，没有主动使用入口。阵容里没有魔术师就看不到遮罩，属既定口径。
- 第 1–3 步的约定继续有效：召唤物按普通角色处理、掉血用 `ownTurnStart`、死亡统一走 `resolveDying`、受击两条口径（`damageTakenThisBigTurn` vs `hpLostThisBigTurn`）。详见 `temp/handoff-P7-2.md`。

## 未决问题 / 下一步

- **第 5 步 X6(a) 未开工**：实装八音盒抉择式道具。做完 `wunv/二重奏` 才能升 `full`（当前唯一 `partial`），覆盖率目标 108/0/4。**等用户说开工再做，不要顺手开始。**
- 其它无未开工项；第 4 步之后没有遗留 TODO。

## 坑（沿用）

- 一律 **`npm.cmd`**（`npm.ps1` 被「禁止运行脚本」拦截）。
- 沙箱禁止子进程管道：不能跑 `vitest` / `node --test` / `vite`；测试走 `tsc` 编译到 `temp/build/core` 再单进程 `node test/index.mjs`。
- PowerShell `ConvertFrom-Json` 读 `data/*.json` 会 GBK 乱码，检查 JSON 用 `node -e` 或临时 `.mjs`。
- 改过 `core/` 的导出后必须 `npm run ui:build`，否则界面拿不到新模块。
- 同一文件多处修改尽量合并；改数据走四步链，不要手改 `data/effects.json`。
