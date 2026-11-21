# P7 计划（custom 技能清零 + BP 撤回）

## 已完成：A 批（2026-11-15）

动态条件被动基础设施 + 4 个技能清零，`custom` 22 → 18，覆盖率 84/23/4 → **88/19/4**。

- `core/game.ts` 新增 `syncAuras()`：`trigger:"always"` 且带 `condition`（或含 `modStatPer`）的技能每次动作结算后重算；
  授予的状态 source 标成 `aura:<unitId>`，重算前整批清除（幂等）。`applyAlwaysPassives` 跳过带 condition 的被动，避免重复授予。
- `core/effects.ts` 新增 op `modStatPer`（`per:"woundedAllies"` 按己方受伤角色数重复）。
- `scripts/p5-tune.mjs` 规则支持 `condition` 字段。
- 清零：`leide/“复仇者”`、`jixieshi/胆怯`、`maoxianjia/格列佛游记`、`binghuan/牵绊`。

## 已完成：B 批（2026-11-15）

`custom` 18 → 15，覆盖率 88/19/4 → **91/16/4**。
- 清零：`feixingjia/特发性震颤`、`lvshi/庄园老友`、`xinlixuejia/牵绊`。

## 已完成：C 批（2026-11-15）

`custom` 15 → **11**，覆盖率 91/16/4 → **93/14/4**。
- `core/effects.ts` / `core/trigger.ts`：新增 `trigger:"itemUse"`、条件键 `itemUsed`、`SkillEffect.afterAttackOps`。
- `core/game.ts`：`useItem` 后触发 itemUse；攻击后结算 `afterAttackOps`；动作末尾按 `damageTakenThisBigTurn` 增量触发 `damaged`。
- `core/status.ts`：`statOf` 改为按施加顺序结算 set/add（攻击后改为 2 之后的 +2 仍生效）。
- 清零：`maoxianjia/探险幻想`（full）、`kongjun/精准打击`（full）、
  `xinlixuejia/应激`（partial，受击近似）、`wunv/二重奏`（partial，八音盒本体仍 custom）。
- 裁决登记：`temp/decisions.md` 的 P7-C1 ~ P7-C4。

## 已完成：D 批（2026-11-15）

`custom` 11 → **8**，覆盖率维持 93/14/4（三个技能按纪律保持 partial，歧义已登记）。
- `core/effects.ts`：`EffectBranch.kCost` / `EffectBranch.uses`；`UnitSkill.branchUses`；`swapPosition` 记录 `swapOrigin`；新 op `swapBack`。
- `core/game.ts`：`useSkill` 内校验并扣分支 `kCost`（从 `GameState.k` 扣 1000）、分支次数用尽拒绝、成功后累加 `branchUses`。
- `core/trigger.ts`：`canUseSkill` 补技能级 `usageLimit`（perTurn/perGame，主动使用也生效）与分支 `uses` 拒绝路径。
- `core/units.ts`：构造技能时初始化 `branchUses: []`。
- 清零：`jizhe/独家新闻`、`qiutu/线路控制`、`xiaoshuojia/隐喻`（均 partial）。
- 裁决登记：`temp/decisions.md` 的 P7-D1 ~ P7-D4。

## 已完成：E 批（2026-11-15）

`custom` 8 → **4**，覆盖率维持 93/14/4（四个技能均按原文歧义保持 partial）。
- `core/effects.ts`：`cdDelta.selfReady`（振奋：目标为自己时 CD 拉满）、新 op `loseHp` / `possession`、`tempHp.rescueAmount`（路易救援变体）、`EffectContext.viaRescue`。
- `core/trigger.ts`：`FireOptions.viaRescue` 透传。
- `core/game.ts`：rescue 分支在扣血前触发 `beforeDamage(viaRescue)`；新增 `settlePossession`（记忆同步在目标临时血扣完时结束）。
- `core/status.ts`：`immune` 的 `value < 0` 视为无次数上限。
- `core/combat.ts`：伤害结算读取 `wandCap1`，下一次受伤至多 1 点（一次性，魔术演绎）。
- 清零：`laladuiyuan/振奋`、`muoushi/“路易”`、`moshushi/魔术演绎`、`xiaonvhai/记忆同步`（均 partial）。
- 裁决登记：`temp/decisions.md` 的 P7-E1 ~ P7-E4。

## 已完成：E2 批（2026-11-15，最后一批）

`custom` 4 → **0**，覆盖率 93/14/4 → **95/12/4**。
- `core/effects.ts`：`SkillEffect.parts`（额外触发时机）、`SkillEffect.durationByUse`、`OpSpec.group` / `Status.group`、`UnitSkill.partUses`；`restrictAttack` 无 `filter` 时落成硬禁止攻击（带 `filter` 的旧数据改写独立 key，不误伤）。
- `core/trigger.ts`：`fire` 同时匹配主 trigger 与 `parts`，part 独立计次；`computeCanAttack` 认 `restrictAttack`。
- `core/game.ts`：`useSkill` 按 `usedPerGame` 选时长；救援成功后补发 `fire({trigger:'rescue'})`；新增 `settleTempHpGroups`（临时血归零整组结束）。
- 清零：`zhoushushi/猿猴咒像`（full）、`yeren/野性伙伴`（full）、`zajiyanyuan/即兴演出`（partial，计数口径已登记）、`wanjushang/安抚物`（partial，钢铁护肘映射到 `huwan`）。
- 裁决登记：`temp/decisions.md` 的 P7-E2-1 ~ P7-E2-4。

## 剩余

无含 `custom` 的技能。待裁决项见 `temp/decisions.md` 的 P7 各批条目。

## 规矩（每批必须遵守）

1. 数据只经 `scripts/p5-tune.mjs` 规则改，顺序：`p5-tune` → `merge-effects` → `validate-effects` → `coverage-effects`；不手改 `data/effects.json`。
2. 新增 op/condition 键必须同步 `scripts/validate-effects.mjs` 白名单与 `test/effects.test.mjs` 的 `KNOWN_OPS`。
3. 每个技能补 1 条行为断言（`test/effects.test.mjs` 末尾追加 describe）。
4. 覆盖率基线数字写在 `test/effects.test.mjs`「覆盖率不低于当前记录值」一条里，改完同步。
5. 验收唯一入口 `npm run verify`（E2 后 55 组测试全绿，95/12/4，custom 0）。
6. 语义歧义不猜：写进 `temp/decisions.md` 待裁决，技能保持 partial。
