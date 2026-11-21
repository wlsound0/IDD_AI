# 交接 P7-4（P7-2 第 5 步收尾）

日期：2026-11-21。上一份交接：`temp/handoff-P7-3.md`。本阶段完成 P7-2 第二轮裁决第 5 步（X6(a) 八音盒抉择式道具），工作已暂停。

## 当前基线

- 唯一验收入口 `npm.cmd run verify`：类型检查 + 57 组测试（214 条）+ 效果表校验 + 界面构建 + 界面冒烟，全绿。
- 技能覆盖率：full **107** / partial **0** / none **4**，`custom` 技能 0 个。口径：111 个技能；106 + 舞女二重奏 = 107。旧稿的 108 是笔误（八音盒是道具，不计入技能口径）。
- 道具覆盖率：full 10 / partial 5。
- 无新增依赖、无新增构建/测试工具；`data/effects.json` 仍是生成物，四步链顺序不变：`node scripts/p5-tune.mjs` → `merge-effects.mjs` → `validate-effects.mjs` → `coverage-effects.mjs`。

## 第 5 步做了什么

1. 数据（`scripts/p5-tune.mjs` 规则 + 重跑四步链生成 `data/effects.json`）
   - `bayinhe` 从 `custom:modalChoice` 改成结构化 `branches` 两条：A = 目标攻击力 +1、`consumedOn:"attacked"`（被攻击后清）；B = 目标攻击力 −1、`consumedOn:"attack"`（攻击后清）。`target:anyUnit`，`impl:"full"`，保留原文。
   - `wunv/二重奏` 升 `full`：`bayinheBuffPersist` flag 让分支 A 不被攻击结算清除。
2. 内核
   - `core/status.ts`：`Status.consumedOn` 放宽为 `'attack' | 'attacked'`。
   - `core/effects.ts`：`ItemEffect.branches?: EffectBranch[]`；`OpSpec.consumedOn?`；`addStatus` 优先用显式 `consumedOn`，否则 `duration === 'nextAttack'` 时落 `'attack'`；普通属性 `modStat` 透传 `consumedOn`。
   - `core/game.ts`：`Action.useItem` 增 `variant?: string`；有 `branches` 时走 `selectBranch` + `runBranch`，缺 `variant` 抛「需要选择分支」；offensive 判定改看所选分支 ops；新增模块级 `clearConsumedStatuses(units, unitId, on)`，攻击结算处对出手方清 `attack`、受击方清 `attacked`，状态来源存活且带 `bayinheBuffPersist` 时不清。
3. 界面（`ui/app.js`）
   - 道具按钮有分支时渲染 `branch-group` 小菜单，点选后把 `b.label` 作为 `variant` 传给 `beginAction`；`onItem` 与 `beginAction` 的 `variant` 一路带到 `useItem` 动作。
4. 校验与测试
   - `scripts/validate-effects.mjs`：抽出 `checkBranches(entry, branches)` 供 skills/items 共用；`consumedOn` 进白名单校验；items 段支持「ops 为空但有 branches」。
   - `scripts/coverage-effects.mjs`：道具 op 统计纳入 branches。
   - `test/effects.test.mjs`：覆盖率断言改 107/0/4；新增「P7-2 X6：八音盒的两种抉择增益」4 条（两种分支的清除时机、`bayinheBuffPersist` 保留、缺 variant 抛错）。

## 踩坑记录

- `statOf` 的签名是 `statOf(base, statuses, stat)`：断言 delta 时 base 要传 0，只传 statuses 会拿到数组而不是数值（曾连挂 3 条）。
- `edit` 定位 `consumedOn: ...` 那类短字符串会同时命中 `modStat` 与 `modStatPer` 两处（matched 2 times），必须带上 `case 'modStatPer'` 之类上下文。
- 覆盖率断言写死在 `test/effects.test.mjs`（旧值 106/1/4），改数据后要同步，否则 verify 红。
- 读完 `data/*.json` 做检查请用 `node -e`；PowerShell `ConvertFrom-Json` 会按 GBK 解码出乱码。

## 未开工项（等用户指令，不要自行开工）

1. **先知「役鸟守护」改临场反应**：原文「当有角色将要受到伤害时，可选择免疫此次伤害，先知攻击力减一」。用户 2026-11-21 明确要修，且要求与魔术棒区分：魔术棒仅在**被攻击时**开窗、伤害减半；役鸟要在**任意角色将受到伤害前**（任意伤害来源，含技能/掉血通道）开窗、免疫整次伤害。
   - 现状：`data/effects.json` 的 `xianzhi/役鸟守护` 只是普通 `manual` 充能技能（`immune` 1 次 / `duration:"instant"` + 先知 atk 永久 −1），没有 `reaction` 也没有 `anyPhase`；`instant` 在本小回合结束到期（`core/status.ts` 的 `resolveDuration`），因此自己回合挂的免疫挡不住对方下回合攻击。引擎目前只有 `pendingAttack` 一条反应窗口（魔术棒专用），没有「伤害前」通用窗口；`beforeDamage` 只接被动。
   - 实现方向（未定稿，待用户裁决）：把 `pendingAttack` 泛化成 `pendingInterrupt`（记录伤害来源/受击者/原始伤害），在 `applyDamage` 之前开窗；役鸟走技能侧反应入口（消耗充能、免疫整次、先知 −1 atk），魔术棒仍走道具侧减半。涉及 `core/game.ts` 攻击/技能/掉血三条伤害通道、`ui/app.js` 遮罩复用、`scripts/check-ui.mjs` 与 `scripts/play.mjs` 对窗口的自动处理、以及 reactions 的触发顺序（同一窗口多个可用反应怎么选）。
2. 魔术棒本体仍只在攻击打断窗口可用，道具栏纯展示——这是第 4 步既定口径，不是漏做。

## 关键文件速查

- 效果表与生成链：`data/effects.json`、`scripts/p5-tune.mjs`（RULES + 道具规则，现有 71 条）、`scripts/merge-effects.mjs`、`scripts/validate-effects.mjs`、`scripts/coverage-effects.mjs`。
- 内核：`core/status.ts`（`resolveDuration`、`StatStatus.consumedOn`）、`core/effects.ts`（`EffectBranch`、`ItemEffect.branches`、`addStatus`、`selectBranch`/`runBranch`）、`core/game.ts`（`Action.useItem.variant`、`clearConsumedStatuses`、`pendingAttack`、`resolveAttack`/`interruptAttack`、`useInterruptItem`）。
- 界面：`ui/app.js`（技能/道具分支菜单、攻击打断遮罩）、`ui/style.css`（`.branch-group`、`.interrupt-mask`）、`scripts/check-ui.mjs`、`scripts/play.mjs`。
- 测试：`test/effects.test.mjs`（数据全量断言 + 覆盖率断言 + 道具/技能分支）、`test/qa.test.mjs`（QA 逐条，含 `P6 收尾：QA-35 役鸟守护攻击力永久 -1`）。
