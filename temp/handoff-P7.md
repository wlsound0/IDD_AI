# 交接：P7（2026-11-15）

## 结论

- **`custom` 技能清零：22 → 0**。覆盖率 84/23/4 → **95/12/4**；`npm run verify` 全绿（56 组测试 + 效果表校验 + 界面构建 + 界面冒烟）。
- **BP「撤回上一步 + 每步确认」已落地**：`core/bp.ts` 新增 `manualConfirm`（界面默认开）、动作 `undo` / `confirmStep`、`canUndoBp` / `canConfirmBpStep` / `legalBpChoices.canUndo|canConfirm`；撤回只退当前步最后一次选择（BAN/PICK 与预算一并回滚），确认后锁定不可退。界面 BP 顶栏换成「撤回上一步 / 确认本步」。

## 分批落地（7 批）

| 批 | 技能 | 新机制 |
|---|---|---|
| A | 复仇者 / 胆怯 / 格列佛游记 / 牵绊(病患侧·冰环) | `syncAuras()` 动态条件被动、`modStatPer`、规则支持 `condition` |
| B | 特发性震颤 / 庄园老友 / 牵绊(心理学家) | `rescueRule.targetName`、`veteranOfManor` 走 status flag |
| C | 探险幻想 / 应激 / 精准打击 / 二重奏 | `trigger:"itemUse"` + `itemUsed`、`afterAttackOps`、`damaged` 增量触发 |
| D | 独家新闻 / 线路控制 / 隐喻 | `branches[].kCost`、`branches[].uses` + `UnitSkill.branchUses`、`swapBack` |
| E1 | 振奋 / 路易 / 魔术演绎 / 记忆同步 | `cdDelta.selfReady`、`loseHp`、`possession`、`tempHp.rescueAmount`、`wandCap1` |
| E2 | 猿猴咒像 / 野性伙伴 / 即兴演出 / 安抚物 | `parts` 分部分计次、`durationByUse`、`Status.group`、`restrictAttack` 硬禁止 |

## 未决问题

- 12 个 `partial` 技能等裁决，明细见 `temp/decisions.md` 的 P7-A/B/C/D/E 系列（约 20 条）+ `temp/p5-coverage.md`。
  已知缺口举例：魔术棒本体减半（`useItem` 无 victim 上下文）、振奋只能整角色 CD、路易只覆盖 `applyDamage` 扣血、应激「任何时候」用受击近似、即兴演出第二个己方回合从开局计数、安抚物「钢铁护肘」映射到既有道具「护腕」。
- 引擎已无 `custom` 分支；再发现原文有内容但引擎表达不了时，走同一套路：新增 op/条件键 → 同步 `validate-effects.mjs` 白名单与测试 `KNOWN_OPS` → 登记裁决。

## 本次步数

约 60 次工具调用（6 个子智能体分批 + 主线做 A 批与 BP 撤回确认）。
