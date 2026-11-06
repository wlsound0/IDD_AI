// 伤害结算。依据：机制 R11/R15/R18/R19、裁决落地 D05/D10、Q&A 反伤与庄园老友条。
//
// 关键区分（文档反复强调）：
//   攻击力 ≠ 造成伤害。攻击力只是攻击伤害的计算来源，技能伤害与攻击力无关。
//   临时血量只承伤，不加上限；加血则可能反过来抬高上限（D05）。

import { isFirstTurnPenaltyActive, type TurnClock } from './turn';

export type DamageKind = 'attack' | 'skill' | 'item' | 'reflect' | 'effect';

export interface Combatant {
  id: string;
  /** 当前攻击力面板值，可被增减益修改。 */
  atk: number;
  hp: number;
  maxHp: number;
  /** 战斗开始时的上限，救援减半永远以它为基准（D02/D04）。 */
  initialMaxHp: number;
  /** 临时血量：先于真实血量承伤，不影响上限（D05 / Q&A）。 */
  tempHp: number;
  /** 庄园老友：本大回合内已受过伤害后，后续受到的攻击伤害 -1，不叠加。 */
  veteranOfManor?: boolean;
  /** 本大回合内已受到的伤害次数，用于庄园老友。 */
  damageTakenThisBigTurn?: number;
  /** 免疫：本次伤害及附带效果无效。 */
  immune?: boolean;
  /** 无敌：不可被选中。 */
  invincible?: boolean;
}

export interface DamageContext {
  clock: TurnClock;
  kind: DamageKind;
}

/** 有效攻击力：R15 首回合全体 -1，下限 0（R11）。 */
export function effectiveAtk(c: Combatant, clock: TurnClock): number {
  const penalty = isFirstTurnPenaltyActive(clock) ? 1 : 0;
  return Math.max(0, c.atk - penalty);
}

/**
 * 攻击伤害（R07 庄园老友 / R15 首回合）。
 * 庄园老友只减「攻击」伤害：首次不减，之后每次 -1，不叠加；技能/道具/无来源伤害不减。
 */
export function attackDamage(attacker: Combatant, defender: Combatant, clock: TurnClock): number {
  const base = effectiveAtk(attacker, clock);
  if (!defender.veteranOfManor) return base;
  const taken = defender.damageTakenThisBigTurn ?? 0;
  return taken > 0 ? Math.max(0, base - 1) : base;
}

/** 反伤：取受击方「当前」攻击力，被降攻同样生效，攻击力 0 仍触发（Q&A）。 */
export function reflectDamage(defender: Combatant, clock: TurnClock): number {
  return effectiveAtk(defender, clock);
}

export interface DamageResult {
  /** 实际扣掉的血量（可能为 0）。 */
  applied: number;
  /** 由临时血量吸收的部分。 */
  absorbedByTemp: number;
  target: Combatant;
  /** 结算后是否进入濒死（hp ≤ 0）。召唤物另有规则（D06）。 */
  dying: boolean;
}

/**
 * 施加伤害，返回新的目标快照（不修改入参，方便做快照回归）。
 * 免疫直接吞掉本次伤害（R18）。
 */
export function applyDamage(target: Combatant, amount: number, ctx: DamageContext): DamageResult {
  if (target.immune) {
    return { applied: 0, absorbedByTemp: 0, target: { ...target }, dying: target.hp <= 0 };
  }
  const dmg = Math.max(0, amount);
  const absorbed = Math.min(target.tempHp, dmg);
  const rest = dmg - absorbed;
  const next: Combatant = {
    ...target,
    tempHp: target.tempHp - absorbed,
    hp: target.hp - rest,
  };
  if (dmg > 0) {
    next.damageTakenThisBigTurn = (target.damageTakenThisBigTurn ?? 0) + 1;
  }
  return { applied: rest, absorbedByTemp: absorbed, target: next, dying: next.hp <= 0 };
}

/**
 * 加血（D05）：先加当前血量；若加后超过上限，则把上限抬到当前血量。
 * 注意：抬高的只是 maxHp，initialMaxHp 不变（D04），救援减半仍按初始值算。
 */
export function healByAdding(c: Combatant, amount: number): Combatant {
  const next = { ...c, hp: c.hp + Math.max(0, amount) };
  if (next.hp > next.maxHp) next.maxHp = next.hp;
  return next;
}

/** 回血（D05）：不能突破当前上限。 */
export function healByRestoring(c: Combatant, amount: number): Combatant {
  return { ...c, hp: Math.min(c.maxHp, c.hp + Math.max(0, amount)) };
}

/** 救援后的血量上限：初始上限减半向上取整（D02/D04）。 */
export function rescuedMaxHp(c: Combatant): number {
  return Math.ceil(c.initialMaxHp / 2);
}
