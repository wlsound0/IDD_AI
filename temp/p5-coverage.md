# P5 覆盖率报告（自动生成）

- 技能：**111**（full 107 / partial 0 / none 4）
- 道具：**15**（full 10 / partial 5）
- 引擎已实现的原子操作被引用次数：

flag=39、modStat=31、grantItem=31、itemDiscount=18、tempHp=11、rescueRule=11、heal=10、grantRescue=7、untargetable=6、damage=6、summon=5、defer=5、custom=5、immune=4、sealSkills=4、restrictAttack=3、reflectMod=3、extraAttack=3、shield=3、deferDamage=2、damageReduce=2、triggerFlyer=2、selfRescue=2、liberate=2、invulnerable=2、mark=2、grantRescueFlyer=1、atkPenaltyOnCd=1、swapStat=1、modStatPer=1、grantDestroySummon=1、cdDelta=1、revive=1、copyAtk=1、setStat=1、loseHp=1、holdDying=1、deferredRescue=1、damageMultiplier=1、grantTransferMark=1、itemLock=1、possession=1、swapPosition=1、damageToMark=1、drainMarks=1、transferDamage=1、interruptDamage=1

## 含 custom（未实装分支）的技能

| 技能 id | custom 键 |
|---|---|

## 纯风味（impl=none，无机制）

- 幸运儿「庄园老友」
- 医生「庄园老友」
- 邮差「期待」
- 园丁「庄园老友」

## 说明

- `custom` 只表示「原文有内容但引擎暂未覆盖的分支」，数值与目标已在数据里如实记录，未被静默丢弃。
- 判定口径见 `temp/p5-effect-spec.md`；数据改动走 `scripts/merge-effects.mjs` + `scripts/validate-effects.mjs`。
