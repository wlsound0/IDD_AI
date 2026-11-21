# P5 效果规格（DSL v1，`data/effects.json` 的唯一格式说明）

只描述「引擎能执行的原子操作」。原文永远在 `data/characters.json` 里，本文件不复制、不改写原文。

## 1. 顶层结构

```jsonc
{
  "version": 1,
  "skills": [ SkillEffect, ... ],   // 111 条，顺序不限，id 唯一
  "items":  [ ItemEffect, ... ]     // 15 条
}
```

- `SkillEffect.id` = `"<角色id>/<技能名>"`，例：`"youcha/邮件"`。角色 id 见 `data/characters.json`。
- `ItemEffect.id` = `"<道具id>"`，例：`"wangyouzhixiang"`。
- 每条必须原样带上 `character`（或 `cost`）、`name`、`type`，便于校验对齐。

## 2. SkillEffect 字段

| 字段 | 必填 | 取值 | 说明 |
|---|---|---|---|
| `id` | 是 | string | 见上 |
| `character` | 是 | string | 角色名，用于校验 |
| `name` | 是 | string | 技能名 |
| `type` | 是 | battlecry/charge/cooldown/active/passive | 与数据一致；`unknown` 已按 Q40 改为 passive |
| `impl` | 是 | `full` / `partial` / `none` | full=所有效果都能被下面的 op 表达；partial=部分靠 `custom`；none=纯风味 |
| `manual` | 是 | bool | 玩家主动发动=true；自动触发=false |
| `trigger` | 是 | 见 §3 | `manual:true` 时写 `"manual"` |
| `target` | 否 | 见 §4 | 无目标技能省略 |
| `condition` | 否 | `[Cond,...]` | 全部满足才触发 |
| `cost` | 否 | `{charge:n,durability:n,hp:n,atk:n,itemCost:n}` | 只写该技能实际支付的项 |
| `usageLimit` | 否 | `{perGame:n,perTurn:n,perBigRound:n}` | 「限一次/限三次」等 |
| `duration` | 否 | 见 §5 | 效果持续；`ops` 内部可逐条覆盖 |
| `ops` | 是 | `[Op,...]` | 无效果写 `[]` |
| `notes` | 否 | string | ≤40 字的原文要点，只写引擎吃不准的地方 |
| `rulings` | 否 | `[string]` | 引用的裁决号，如 `["Q40"]` |

## 3. trigger 取值

`manual`（主动）｜`battlecry`（开局战吼）｜`turnStart`｜`turnEnd`｜`ownTurnStart`｜`ownTurnEnd`｜`enemyTurnStart`｜`enemyTurnEnd`｜`beforeDamage`（伤害结算前，可改数值）｜`afterDamage`｜`afterAttack`｜`attacked`｜`damaged`｜`lethalDamage`（致命伤害时）｜`selfDeath`｜`allyDeath`｜`enemyDeath`｜`enteringDying`｜`rescue`（自己救援别人时）｜`rescued`（自己被救时）｜`always`（常驻状态类被动）

## 4. target 结构

```jsonc
{ "mode": "self|none|anyUnit|allyUnit|enemyUnit|otherAlly|anyCharacter", "optional": true, "filter": {...} }
```

- `mode`：`self` 自己；`none` 无目标；`anyUnit` 场上任意角色（含召唤物）；`allyUnit` 友方；`enemyUnit` 敌方；`anyCharacter` 角色（不含召唤物）。
- `optional:true` = 可不指定（见 Q40：邮件不指定时只对自己生效）。
- `filter` 只允许：`{"wounded":true}`、`{"hpEq":1}`、`{"excludeSelf":true}`、`{"tag":"summon"}`、`{"atkNotZero":true}`（门之钥：攻击力 0 不可选，内核在 useSkill 时校验）。
- `flag` 的常用键：`cannotAttack`、`noHeal`、`noReflect`、`noReflectVsHp1`（对血量为 1 的攻击者不反伤）、`reflect`（数值为反伤增减）、`noMaxHpHalve`、`noSkillSeal`、`noUntargetable`、`noInvulnerable`（不会获得不可攻击效果）、`noCannotAttack`、`immuneToSeal`、`cannotBeRescued`（不可被救援）、`lethalSave`（有临时血量时致命伤害保留 1 血）、`hasRescue`、`rescueLimit`、`rescueCostDelta`、`mustUseBodyForRescue`、`sealedRescueCost`。
- `usually trigger:"always"` 的被动只结算「静态授予」类 op（`grantRescue` / `flag` / `reflectMod` / `shield` / `immune` / `untargetable` / `invulnerable`），在开局由 `core/game.ts` 的 `applyAlwaysPassives` 跑一次；`modStat` 这类动态增减不会在这里生效。

## 5. duration 取值

`instant`｜`untilOwnTurnStart`｜`untilOwnTurnEnd`｜`untilNextOwnTurnStart`｜`untilNextOwnTurnEnd`｜`untilNextAllyTurnEnd`（同 `untilNextOwnTurnEnd`）｜`untilNextEnemyTurnEnd`｜`untilEnemyTurnStart`｜`untilTurnEnd`｜`untilBigRoundEnd`｜`turns:N`｜`whileSourceAlive`（邮差死亡后失效）｜`permanent`

`untilNextOwnTurnEnd` 固定取「下一个大回合的己方小回合结束」（每个大回合各有一个己方小回合，所以与当前处在谁的回合无关）。op 可自带 `duration` 覆盖技能级取值（`{op:'shield', duration:'untilNextOwnTurnEnd'}`）。

## 6. ops（原子操作，只许用这里列出的）

所有 `ref` 取：`"self"`（技能拥有者）｜`"target"`（§4 选的目标）｜`"attacker"`｜`"victim"`｜`"allAllies"`｜`"allEnemies"`｜`"owner"`（同 self，用于召唤）。

| op | 参数 | 含义 |
|---|---|---|
| `modStat` | `ref, stat: atk\|hp\|maxHp\|dmgDealt\|dmgTaken, delta` | 属性增减，持续由 duration 决定 |
| `setStat` | `ref, stat, value` | 设为定值（如「攻击力改为2」） |
| `heal` | `ref, amount: n\|"full"` | 回复血量 |
| `damage` | `ref, amount, kind: skill\|attack, ignoreInvulnerable?` | 造成伤害 |
| `tempHp` | `ref, amount` | 临时血量（不占上限、超出上限可溢出） |
| `shield` | `ref, amount, mode?: points\|once` | 抵挡 n 点伤害；`mode:"once"` = 抵挡一次伤害（整次数值归零并移除） |
| `reflectMod` | `ref, delta` | 只改「反伤造成的伤害」（-1 = 反伤减一），不影响普通受伤 |
| `damageReduce` | `ref, amount, vs: attack\|all, minDamage?` | 减伤 |
| `damageMultiplier` | `ref, factor` | 伤害倍率（0.5=减半向下取整） |
| `immune` | `ref, scope: damage\|skill\|all, uses: n` | 免疫（消耗次数） |
| `invulnerable` | `ref` | 不可被攻击/选中 |
| `untargetable` | `ref, by: enemySkill\|enemyItem\|attack\|all` | 不可被指定 |
| `sealSkills` | `ref` | 封印技能 |
| `extraAttack` | `ref, count` | 可再次攻击 |
| `grantItem` | `ref, item: <id>, count` | 获得道具 |
| `itemDiscount` | `ref, item: <id>\|"*", amount, scope: once\|turn` | 道具花费减少 |
| `summon` | `ref:"owner", unit: {name, atk, hp}, tags?` | 召唤物（Q24：占位不占阵容、可被攻击） |
| `cdDelta` | `ref, delta` | CD 计数变化 |
| `chargeDelta` | `ref, delta` | 充能层数变化 |
| `swapStat` | `refA, statA, refB, statB` | 交换两项数值（门之钥） |
| `swapPosition` | `refA, refB` | 交换站位 |
| `transferDamage` | `from, to, ratio, keepHpMin` | 溢出伤害转移 |
| `deferDamage` | `ref` | 伤害延后到本回合结束时结算 |
| `revive` | `ref, hp` | 死亡后复活 |
| `mark` | `ref, key, delta, autoReduce?` | 标记/计数（坚强） |
| `flag` | `ref, key` | 布尔状态：`cannotAttack`、`noHeal`、`noReflect`、`noMaxHpHalve`、`noSkillSeal`、`noUntargetable`、`immuneToSeal`… |
| `restrictAttack` | `ref, filter` | 攻击限制（如不可攻击血量=1 的角色） |
| `selfRescue` | `ref` | 获得自我救援 |
| `grantRescue` | `ref` | 获得「救援」关键词能力（开局常驻被动授予） |
| `grantDestroySummon` | `ref` | 获得「主动令自己的召唤物死亡」能力（开局授予，动作 `destroySummon`） |
| `rescueRule` | `ref, hpCost, limit?, costDelta?, noHalve?, fromBaseHp?, sealedCost?` | 救援扣血改写；`limit`=可被救次数，`costDelta`=救援者扣血增减，`fromBaseHp`=必扣本体，`sealedCost`=被封技能后的扣血 |
| `copyAtk` | `from, to` | 复制攻击力 |
| `custom` | `key, note` | 引擎未覆盖，必须同时把 impl 标 partial/none |

- `branches[].cost`：分支级充能消耗（激励 雀跃 1 / 亢奋 3），优先于 `SkillDef.cost`。
- `OpSpec.unless`：ref 带该 flag 时整条 op 跳过（调律压制组曲加攻）。
- `rampDown`：每层使该角色造成的所有伤害 -1，由 `outgoingAdjust` 读取，作用于攻击/溅射/技能伤害。

## 7. 写法纪律

1. **不许发明 op**：上表没有的机制一律 `custom`，`key` 用简短英文，`note` 写中文关键词。
2. **不许补规则**：原文没写死的（次数、上限、取整）不猜，写进 `notes` 并留 `custom`。
3. **原文有数字必落到参数**：`持续两回合` → `duration:"turns:2"`；`CD：1` → `cost` 不写（CD 在数据层已有），只写效果。
4. **同一技能多效果** → `ops` 数组，按原文顺序。
5. 类型对照：`battlecry` 一律 `trigger:"battlecry"`、`manual:false`；`charge`/`cooldown`/`active` 一律 `manual:true`；`passive` 看文本选触发时机，常驻写 `always`。
