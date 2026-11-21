# Handoff P7-5 · P7-3 役鸟守护改「临场反应」（已完成，2026-11-21）

## 一句话状态

P7-3 完成：反应窗口从「只服务魔术棒的攻击打断」泛化成 `pendingInterrupt { kind: 'attack' | 'damage' }`；先知「役鸟守护」改为任意伤害前开窗（攻击 + 技能伤害都能反应），魔术棒仍只在被攻击时可用。`npm.cmd run verify` 全绿：**57 组 / 217 条**，覆盖率 107 / 0 / 4，道具 full 10 / partial 5。

## 用户裁决（m00022）

1. 同一个窗口里多个反应，**择一即关窗**（不做逐个询问）。
2. 魔术棒 = **仅被攻击后**可用（`kind === 'attack'`）；役鸟 = **只要受到伤害**就能用（攻击 / 技能伤害都开窗）。

## 改动清单

- `core/game.ts`
  - `GameState.pendingInterrupt?: { kind: 'attack' | 'damage'; targetId; attackerId?; resume: Action }`（取代 `pendingAttack`）。
  - `Action`：`attack` / `useSkill` 加内部 `replay?: boolean`；新增 `resolveInterrupt`、`interruptWithItem {unitId, itemIndex}`、`interruptWithSkill {unitId, skillIndex}`。
  - `GameEvent`：`interruptPending {kind, target, attacker?}`、`interruptSkill {unit, skill, target}`（原 `attackPending` 已删）。
  - `collectReactions(state, target, kind)`：items 只在 `kind === 'attack'` 时收集 `reaction === 'beforeAttack'` 的道具；skills 收集受击者同阵营存活单位的 `effect.reaction === 'beforeDamage'`。
  - `skillReactionReady(skill)`：`usageLimit.perGame` 未超 且（charge 类）`skill.charge >= (effect.cost.charge ?? def.cost ?? 0)`。
  - `useReactionSkill(...)`：跨阵营抛「只能保护己方角色」；扣充能；`runEffect` 跑原 ops；`usedPerGame/usedThisBigTurn += 1`；再重放 `win.resume`。
  - 窗口期间其它动作抛「请先处理反应窗口（使用反应技能/道具或选择不打断）」；`interruptWithItem` 在 `kind !== 'attack'` 时抛「只有被攻击时才能使用魔术棒」。
  - `useSkill` 里 `if (effect.reaction) throw new Error('该技能只能在反应窗口使用（角色将要受到伤害时）')`。
- `core/effects.ts`：`SkillEffect.reaction?: 'beforeDamage'`。
- `scripts/p5-tune.mjs`：新增规则 `xianzhi/役鸟守护`，ops = `immune(ref:target, scope:'all', uses:1, duration:'instant')` + `modStat(ref:self, atk, -1, permanent)`，`reaction: 'beforeDamage'`，`impl: 'full'`；`same()` 判定补 `reaction` 比较，否则 ops 不变时 reaction 永远写不进去。
  - **注意 `scope` 必须是 `'all'`**：`core/combat.ts:139` 对技能伤害传 `'skill'`、攻击传 `'damage'`，而 `core/status.ts:233` 只认 `key === scope` 或 `key === 'all'`。
- `ui/app.js`：遮罩读 `state.pendingInterrupt`，标题按 `kind` 显示「攻击反应窗口 / 伤害反应窗口」，同时列役鸟按钮与魔术棒按钮；无可用反应显示「没有可用的反应」；技能列表用 `if (s.effect.reaction) return;` 隐藏反应技能。
- `scripts/check-ui.mjs`：3c 冒烟改用新窗口对象与 `onInterruptItem/onInterruptSkill/onResolveInterrupt`；新增 3d 冒烟锁「伤害反应窗口 + 役鸟守护 + 免疫本次伤害」。
- `scripts/play.mjs`：`state.pendingInterrupt` + `resolveInterrupt`。
- `test/effects.test.mjs`：全量改名 + 新增 3 个用例（役鸟技能伤害免疫/充能/atk-1/无充能不开窗；攻击伤害也能免疫且魔术棒保留；魔术棒在 damage 窗口抛 `/只有被攻击时/`）。
- `test/qa.test.mjs`：QA-35 改为走反应窗口验证攻击力永久 -1 与跨回合保留，末尾加攻可加回。

## 事故记录（重要，别重演）

第 5 步用 PowerShell `Get-Content -Raw` + `Set-Content -Encoding utf8` 做批量替换，把 `test/effects.test.mjs` 整体写成 mojibake（PS 5.1 按 GBK 解码 UTF-8 字节再按 UTF-8 写出，112KB / 2079 行全毁，且 `?` 会吞掉换行与引号）。文件未入 git，靠 DSH 会话记录（`~/.dsh/sessions/.../session.v4.jsonl.zstd`）里的 read 快照 + 反向解码（UTF-8→GBK→UTF-8，`temp/effects.reversed.txt`）重建，再逐测试按失败信息手工修回。

**教训**：本仓库改文件一律用 `edit`/`write` 工具（Node/UTF-8），**不要**用 PowerShell 的 `Get-Content/Set-Content` 做文本替换；`node --test` 在本沙箱会 `spawn EPERM`，单文件跑用 `node test/xxx.test.mjs`，全量用 `npm.cmd run verify`。

## 下一步（如果有人接手）

- **必做（用户 2026-11-21 定调，尚未开工）**：先知反伤时也要能触发役鸟。现状：`attack` 开窗针对受击方，`useSkill` 开窗针对技能目标，而反伤在 `core/game.ts:852-864` 用裸的 `applyDamage(..., kind:'reflect')` 结算，`collectReactions` 根本不经过 → 先知打带反伤的敌人时役鸟没有询问机会。同类缺口还有 `drainMarks` 标记扣血、`settleDamage` 延迟伤害、无来源伤害、溅射。修法方向是「把伤害前反应下沉到 `applyDamage` 上游统一挂起点」，并让 `pendingInterrupt.resume` 支持回到攻击结算中段继续（现在是整动作重放 + `replay:true` 跳过开窗），属于内核结构改造，不是补个判断。
- 魔术棒仍是「道具栏纯展示、只能在反应窗口用」，属既定口径，不是漏做。
- 若要继续加反应类技能/道具：往 `collectReactions` 的 kind 分派里加分支即可，注意「择一即关窗」是用户裁决，别改成逐个询问。

## 交付状态

P7-3 已完结并验绿；README 的「当前进度」「环境与工具链」已同步（基线 57 组 / 217 条、窗口口径、PowerShell 编码事故教训、反伤待办）。
