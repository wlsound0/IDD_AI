# P7-3 役鸟守护（反应窗口）方案

裁决：同窗多反应「择一即关窗」；魔术棒仅被攻击时可用（现状已如此），役鸟任意受伤害时可用。

## 模型
- `GameState.pendingInterrupt?: { kind:'attack'|'damage'; targetId; attackerId?; resume: Action }` 取代 `pendingAttack`。
- 动作：`resolveInterrupt`（不反应，重放 resume）、`interruptWithItem`（魔术棒，仅 kind='attack'）、`interruptWithSkill`（役鸟）。
- resume 带内部 `replay:true`，重放时不再开窗。
- 开窗点：① attack 校验后（受击者有 `reaction:"beforeAttack"` 道具或有役鸟）；② useSkill 选定 ops 后（ops 含 `damage` 且技能目标身上有役鸟）。
- 役鸟：`SkillEffect.reaction:'beforeDamage'`，窗口内由先知支付充能、跑原 ops（immune 1 次 + 先知 atk 永久 -1），再重放 resume —— 免疫状态自然吃掉这次伤害。
- 覆盖范围：攻击伤害 + 技能伤害。标记扣血（drainMarks）不是「伤害」，不进窗口（记录 decisions）。
- 保护范围：役鸟只能保护与先知同阵营的角色（记录 decisions）。

## 验收
`npm.cmd run verify` 全绿；新增测试：技能伤害可免疫、攻击可免疫、魔术棒不开非攻击窗、无反应不开窗、充能/atk-1 落账、择一即关窗。
