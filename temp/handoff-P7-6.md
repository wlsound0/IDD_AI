# handoff P7-6：P7-4 反应窗口统一挂起点（2026-11-21）

## 状态

P7-4 完成，`npm.cmd run verify` 全绿：**59 组 / 220 条**，技能覆盖率 107 / 0 / 4，道具 full 10 / partial 5。P7-2 第 1–5 步、P7-3、P7-4 均已收尾，本轮无新增依赖、无构建工具改动。

## 本轮解决什么

README 待办①「先知反伤也要能触发役鸟」：P7-3 只给攻击与技能伤害两条路挂了反应窗口，反伤 `reflect`、`drainMarks` 标记扣血、延迟伤害、无来源伤害、溅射仍是裸 `applyDamage`，役鸟没有询问机会。本轮把「伤害前反应」从两处预开窗改成一个统一闸门，所有伤害通道都在 `applyDamage` 之前过闸门。

## 改动

- `core/game.ts`
  - `applyAction` 拆成外层 wrapper + `applyActionCore`。内层新增 `demandReaction(targetId, kind, attackerId?)`：目标已在 `action.offered` 里或已死就跳过；`collectReactions` 有可用反应就抛内部哨兵 `ReactionWindowSignal(targetId, kind, attackerId)`。
  - 外层 `applyAction` catch 哨兵 → 返回 `{ state: {...state, pendingInterrupt:{kind,targetId,attackerId,resume:{...action, offered:[...已问过, targetId]}}, events:[...state.events, interruptPending] }, events:[interruptPending] }`。抛出的那次结算整体丢弃。
  - `applyActionCore` 的 `units` 改为深拷贝（`statuses` / `items` / `skills` 数组与元素都 clone），配合哨兵丢弃半成品状态；`useReactionSkill` 同样深拷贝。
  - `Action.attack/useSkill/useItem/endTurn` 加内部 `offered?: string[]`；`replay?` 保留但不再决定是否开窗（旧字段，别新增用法）。
  - 删除 attack / useSkill 原来的两处预开窗块，改为在所有 `applyDamage` 前调 `demandReaction`：攻击命中 `kind:'attack'`、溅射 `'damage'`、反伤 `'damage'`。
  - `runScheduled` / `flushPending` / `settleDeferredDamage` / `settleTransfers` / `settleDamage` 加可选 `gate` 参数，内部在 `applyDamage` 前调 `gate?.(id,'damage')`；endTurn 三处 `fire(...)` 传 `reactionGate: demandReaction`。
  - `collectReactions` 签名改为 `(units, effects, target, kind)`；`interruptWithItem` 改成 `{ ...win.resume, damageFactor: used.factor }`（保留 `offered`，不再硬编码 `replay:true`）。
- `core/effects.ts`：`EffectContext` 新增 `reactionGate?: (targetId, kind) => void`；`dealDamage` 在 `beforeDamage` 之前调它；`drainMarks` 在扣血前调它并 `tryConsumeImmune(u.statuses,'skill')`，免疫时 push `{type:'immune', source:'markDrain'}` 并跳过扣血/扣标记。
- `core/trigger.ts`：`FireOptions` 加 `reactionGate`，`fire` 内把 `opts.reactionGate` 传给 `EffectContext`。
- `test/effects.test.mjs`：新增两个 describe——反伤开窗（先知役鸟免疫 2 点反伤，攻击力永久 -1、充能 -1、B 受 2 点）与「坚强」回合末标记扣血开窗（免疫 3 点、标记保留 2 层）；各带一条「无充能不开窗」的对照组。
- `scripts/check-ui.mjs`：`pendingInterrupt` 伪造 fixture 的 `resume` 从 `replay:true` 改为 `offered:['first-1']`。
- 收尾清理：`Action` 类型删掉 `replay`（P7-3 遗留，无代码引用）；`hooks.emit` 挪到成功返回前；`test/hooks` 集成回归测试 1 条（用 `HookRegistry` 数 `smallTurnEnd`）。

## 行为口径（写测试/改数据前必看）

- 一次动作里多处待反应伤害 = 逐个开窗：每次只挂一个 `targetId`，处理完 `offered` 追加该目标，重放动作时跳过它继续往后结算；同一个目标在一次动作里只问一次。
- 役鸟 `modStat atk -1` 先结算、再结算本次攻击伤害（P7-3 起就是这个顺序，测试里 A atk4 → 役鸟后 3 → 首回合 -1 → 本次伤害 2）。
- 魔术棒仍只在 `kind === 'attack'` 窗口可用；技能伤害/反伤窗口只列役鸟。
- 新加伤害通道必须过闸门：`core/effects.ts` 里走 `ctx.reactionGate`，`core/game.ts` 内部走 `demandReaction`，**在 `applyDamage` 之前**调用，否则役鸟在该通道不开窗。

## 已知小瑕疵

- 无。原先「被哨兵丢弃的结算里 `hooks.emit` 会先响一次」已修：`hooks.emit('smallTurnEnd'|'bigTurnEnd')` 现在只在整个动作成功返回前触发（`applyActionCore` 里 `turnEndHook` 暂存），并加了回归测试锁「挂起时 emit 0 次、正式结算后 1 次」。

## 验证方式

`npm.cmd run verify`（typecheck + test + check:effects + ui:build + ui:check）。typecheck 在本机约 3 分钟以上，180s 超时会转后台，等它跑完再看输出。`npm run test` 单独跑 → 220 tests / 59 suites / 0 fail。`npm run ui:check` 改了冒烟 fixture 后单独复跑也通过。

## 下一步候选

- README 待办只剩一条：魔术棒是否放开到「任意伤害窗口可用」（现行口径：只在 `kind==='attack'` 可用，属第 4 步既定裁决，改动需用户重新拍板）。
- 若日后加新伤害通道，记得在 `applyDamage` 前过闸门（`ctx.reactionGate` / `demandReaction`），并给 `offered` 去重逻辑补测试。
