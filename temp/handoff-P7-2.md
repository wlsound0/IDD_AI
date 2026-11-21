# 交接：P7 / P7-2 裁决落地（2026-11-21）

## 结论

- 第一轮 19 条裁决（`temp/p7-decisions.md`）已全部落地：E1 / E4 / E2-2 改内核，E2-4 新增 `anyPhase`，其余按默认实现并补断言。
- 修 **BP 无限 BAN** bug：第一次 ban 选满 2 人后可继续选、溢出到下一组 BAN 槽位。
- 第二轮 8 条裁决（`temp/p7-decisions-round2.md`）中的 **第 1–4 步已落地**（X1 / X2 / X3 / X4 / X5 / X7 / X8）；**仅第 5 步（X6 八音盒抉择式道具）尚未开工**。
- 覆盖率 95/12/4 → 104/3/4 → **106/1/4**（第 4 步不新增可覆盖条目）。`npm run verify` 全绿 = 56 组 / **210** 测试 + 效果表校验 + 界面构建 + 界面冒烟。`custom` 技能 0 个。

## 改动

### P7（第一轮）

| 文件 | 改动 |
|---|---|
| `core/bp.ts` | 选满判断去掉 `step.atMost &&`，改为无条件抛「本步已选满」（BAN 步必须点「确认本步」推进）；`:249` 注释改为「双方可各自 BAN 同一角色（2026-11-21 复议维持）」 |
| `core/effects.ts` | `possession` 追加 `flag restrictAttack`（source `possession:<ownerId>`）；`tempHp` 在 `op.group` 存在时记 `flag tempHpGrant`；`SkillEffect` 新增 `anyPhase?: boolean` |
| `core/game.ts` | 小回合开始把到期 `tempHpGrant` 从 `u.tempHp` 扣回；`useSkill` 对 `anyPhase` 放开「只能在自己行动小回合」 |
| `ui/app.js` | 选满提示「本步已选满，请点「确认本步」」；`anyPhase` 技能与分支在对方回合也可点 |
| `scripts/p5-tune.mjs` | 野性伙伴 `tempHp` op 加 `group:'tempHp:wildPartner'`；安抚物 `anyPhase:true` + `usageLimit:{perGame:1}`；branches 的 `same` 判定与复制支持 `anyPhase`/`usageLimit`；8 个技能 `partial→full` 并更新 notes |
| `test/bp.test.mjs` | 新增 2 组：选满再选被拒、撤回后可重选（含 atMost 选人步） |
| `test/effects.test.mjs` | 新增/加强 E4、E2-2、E1、D2/D3、E2-1、E2-4 断言 |

### P7-2（第二轮，第 1–3 步）

| 文件 | 改动 |
|---|---|
| `scripts/p5-tune.mjs` | 删除安抚物旧死规则（含 `custom:missingItem` 分支），RULES 71 → 70；陨石磁铁减攻分支改为 `defer` 到 `ownTurnEnd` 落 `modStat`（不带 duration，即永久）；`jizhe/独家新闻` 两个分支的 `summon.unit` 加 `decay:1`，`impl:'full'` |
| `core/combat.ts` | `Combatant` 新增 `hpLostThisBigTurn?: number`；`applyDamage` 里按 `hpBefore - next.hp` 累计（覆盖护盾/临时血吸收后的真实落血） |
| `core/effects.ts` | `drainMarks` 扣血计入 `hpLostThisBigTurn`；修 `amount:'full'` 被算成 `max=0` 导致标记一点都减不掉的 bug（改为 `Number.POSITIVE_INFINITY`） |
| `core/game.ts` | `fireDamageReactors(..., mode: 'damage' \| 'hpLoss')`，动作结算末尾改用 `'hpLoss'`（受击反应按「血量实际减少」判定）；修 `runScheduled` 的改动丢失 bug（解释器改的 `live` 副本需回写 `units`）；新增 `makeDecaySkill()`，`buildSummon` 在 `spec.decay` 存在时给召唤物挂一条 `trigger:"ownTurnStart"` + `op:"damage" ref:"self"` 的被动；`resolveDying(units, events, clock)` 增加 clock 参数，并在这里统一触发召唤物归属者的 `summonDeath`（删掉攻击结算处的特判） |
| `test/effects.test.mjs` | 新增 X2（陨石磁铁永久减攻）、X3（路易换血）、X4（应激按血量减少触发）、X1（幻影每大回合 -1 血、自然消失并触发观测视角）用例；覆盖率基线改 106/1/4 |
| `test/bp.test.mjs` | BAN 行为用例名标注「2026-11-21 复议维持」 |

### P7-2（第二轮，第 4 步：X5 魔术棒打断窗口）

| 文件 | 改动 |
|---|---|
| `core/game.ts` | `GameState.pendingAttack?: {attackerId; targetId}`；`Action` 新增 `resolveAttack` / `interruptAttack`，`attack` 加内部字段 `damageFactor`；`GameEvent` 新增 `attackPending` / `attackInterrupted`。applyAction 开头分派窗口动作（无窗口时 `resolveAttack` 抛「当前没有待处理的攻击」；有窗口时其它动作抛「请先处理攻击打断窗口…」）；attack 校验后若受击方持有 `reaction:"beforeAttack"` 道具则只置 `pendingAttack` 并早返回；正式结算 `dmg = Math.max(Math.floor(rawDmg * (action.damageFactor ?? 1)), flagValue(attacker.statuses,'minDamage'))`；`useItem` 拒绝反应式道具；新增 `findInterruptItem()` 与 `useInterruptItem()`（与 useItem 同口径计价/折扣/消耗 + `fire(itemUse)` + `attackInterrupted`） |
| `core/effects.ts` | `ItemEffect.reaction?: 'beforeAttack'`；`EffectContext.interrupt?: {factor}`；新 op `interruptDamage`（只写 `ctx.interrupt.factor`，不挂状态） |
| `scripts/p5-tune.mjs` | moshubang 规则改 `interruptDamage`(factor:0.5) + `reaction:'beforeAttack'`；ops 替换分支支持 `r.reaction` / `r.clearReaction` |
| `scripts/validate-effects.mjs` | OPS 白名单加 `interruptDamage` |
| `test/effects.test.mjs` | 白名单加 `interruptDamage`；原「魔术演绎」用例改写并新增两组「魔术棒」用例（开窗/关闭/减半向下取整/扣 1k/道具消耗/下次 +1k；`resolveAttack` 吃满伤害；无道具不开窗；wandCap1 在窗口内生效） |
| `ui/app.js`、`ui/style.css` | 打断遮罩 `interrupt-mask`（攻击者/受击者、每个可用魔术棒一个按钮、「不打断，继续结算」）；`onInterrupt` / `onResolveAttack` 接到 `run()`；事件日志渲染新事件 |
| `scripts/check-ui.mjs`、`scripts/play.mjs` | 攻击后若 `state.pendingAttack` 一律 `resolveAttack`（脚本对局不卡窗口）；check-ui 新增 3c 遮罩冒烟 |

## 关键约定（后续别走回头路）

- **召唤物按普通角色处理**：特殊行为用「挂一条普通技能」表达，不要新开字段或在回合循环里单开分支。掉血用 `ownTurnStart` 而**不是** `turnStart`（后者每个小回合都 fire，一大回合会扣两次）。
- **召唤物死亡走统一通道**：`resolveDying` 一处覆盖被打死 / 掉血归零 / 主动销毁，`summonDeath` 反应也只在那里接一次。
- **召唤物不可被救援**已由 `core/rescue.ts` 的 `if (target.isSummon) return false;` 保证，无需另加。
- **受击两条统计口径**：`damageTakenThisBigTurn`（仅攻击伤害）与 `hpLostThisBigTurn`（任何通道落到本体血量的点数）。「扣血就触发」的技能接 `hpLoss`；直接改写 `hp` 的换血（路易 `loseHp`）不计入，符合 X3 裁决。

## 未决问题

- **第 5 步未开工**：X6 = (a) 实装八音盒抉择式道具。`wunv/二重奏` 因此仍是唯一的 `partial`（八音盒本体未实装）。
- **第 4 步已落地**（X5(a) 魔术棒 = 攻击前打断窗口，2026-11-21）：开窗点在 `core/game.ts` 的 attack 分支校验之后、`beforeDamage` 之前；出口只有 `interruptAttack` / `resolveAttack` / `resign`，其余动作在窗口内一律抛错。`useItem` 直接使用 `reaction:"beforeAttack"` 的道具会被拒。用例在 `test/effects.test.mjs`（搜「魔术棒」），界面遮罩在 `ui/app.js`（搜 `interrupt-mask`），`scripts/check-ui.mjs` 3c 冒烟。
- 路易 / 应激 语义已落地；魔术棒减伤由 `interruptDamage` + `Math.floor` 保证向下取整，**不要**改回给 `damageMultiplier` 挂 0.5（那条路是 `Math.round`，会算错）。

## 坑

- 本机 `npm` 在 pwsh 被「禁止运行脚本」拦截，一律用 **`npm.cmd`**。
- 用 PowerShell `ConvertFrom-Json` 读 `data/*.json` 会因 GBK 乱码报错；检查 JSON 用 `node -e` 或临时 `.mjs` 脚本。`node -e` 里直接写中文字面量也会出问题，用 `\u...` 转义或写脚本文件。
- 往测试里临时插 `console.log` 输出会被丢弃/延迟，排查请写 `temp/probe-*.mjs` 独立脚本。
- 一次性脚本批量替换（如把 ctx 的 `units:` 换成 `units: live`）容易误伤其他函数的同名片段并引出 TS2304，改完务必 `npm.cmd test` 类型检查。
- `skill()` 的 `def` 默认必须显式给 `type`（被动写 `'passive'`、主动写 `'active'`），且形状为 `{def, effect, cdCounter, charge, durability, usedPerGame, usedThisBigTurn}`；`fx()` 辅助只在部分 describe 内可见，外部用 `FX.skills.find(...)`。
- status 的字段是 `kind` + `key`（如 `{kind:'stat', key:'atk'}`），不是 `stat`；写断言时容易看走眼。
- 改过 `core/` 的导出后必须 `npm.cmd run ui:build`，否则 `ui/app.js` 拿不到新模块。
- **打断窗口会让攻击「不落地」**：任何在 `attack` 之后继续假设「伤害已结算」的脚本/测试（`scripts/play.mjs`、`scripts/check-ui.mjs` 的对局循环、界面自动化）都必须先判断 `state.pendingAttack`，调用 `{type:'resolveAttack'}` 或 `{type:'interruptAttack'}`，否则下一步会抛「请先处理攻击打断窗口」。
- 打断窗口里 `interruptAttack` 的扣费方是**受击者**（`unitId === pendingAttack.targetId`），不是当前行动方；断言资源时别看错 `k.first` / `k.second`。
