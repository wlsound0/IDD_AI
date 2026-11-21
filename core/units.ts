// 从数据表构建单位（P5）：把 CharacterDef + effects.json 的技能规格拼成 UnitSkill。
// 只做组装，不含规则；规则在 effects.ts / game.ts。

import type { CharacterDef, SkillDef } from './types';
import type { OwnedItem, SkillEffect, UnitSkill } from './effects';

export interface EffectsIndex {
  skills: Map<string, SkillEffect>;
  items: Map<string, { id: string; name: string; cost: number | null; effect: unknown }>;
}

export function indexEffects(data: { skills?: SkillEffect[]; items?: { id: string }[] }): EffectsIndex {
  const skills = new Map<string, SkillEffect>();
  for (const s of data.skills ?? []) skills.set(s.id, s);
  const items = new Map<string, { id: string; name: string; cost: number | null; effect: unknown }>();
  for (const i of (data.items ?? []) as { id: string; name?: string; cost?: number | null }[]) {
    items.set(i.id, { id: i.id, name: i.name ?? i.id, cost: i.cost ?? null, effect: i });
  }
  return { skills, items };
}

/** 技能 id 与 data/effects.json 一致：`角色id/技能名`。 */
export const skillEffectId = (characterId: string, skill: SkillDef): string => `${characterId}/${skill.name}`;

export function buildUnitSkills(
  characterId: string,
  skills: SkillDef[],
  index: EffectsIndex,
): UnitSkill[] {
  return skills.map((def) => ({
    def,
    effect: index.skills.get(skillEffectId(characterId, def)) ?? null,
    cdCounter: def.initialCd ?? 0,
    charge: def.type === 'charge' ? def.chargeInitial ?? 0 : 0,
    durability: def.durability,
    usedPerGame: 0,
    usedThisBigTurn: 0,
    branchUses: [],
    partUses: [],
  }));
}

/** 把技能里「战吼获得道具」这类效果的初始道具栏预置为空；由 battlecry 触发时再填。 */
export function initialItems(): OwnedItem[] {
  return [];
}

/** 角色的 BP 花费（P5 只做展示，不进对局预算）。 */
export function characterCost(c: CharacterDef): number | null {
  return c.cost ?? null;
}
