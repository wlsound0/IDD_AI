// 伤害结算。依据：机制 R11/R15/R18/R19、裁决落地 D05/D10、Q&A 反伤与庄园老友条。
//
// 关键区分（文档反复强调）：
//   攻击力 ≠ 造成伤害。攻击力只是攻击伤害的计算来源，技能伤害与攻击力无关。
//   临时血量只承伤，不加上限；加血则可能反过来抬高上限（D05）。

import { isFirstTurnPenaltyActive, type TurnClock } from './turn';
import type { Side } from './types';
import {
  addMark,
  consumeShield,
  damageMultiplier,
  damageTakenAdjust,
  flagValue,
  hasFlag,
  outgoingAdjust,
  resolveDuration,
  statOf,
  sumStat,
  tryConsumeImmune,
  type Status,
} from './status';

export type DamageKind = 'attack' | 'skill' | 'item' | 'reflect' | 'effect';

export interface Combatant {
  id: string;
  /** 所属阵营（延迟伤害需要按「己方回合」排期；纯伤害计算可不填）。 */
  side?: Side;
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
  /**
   * P7-2 X3/X4：本大回合内已通过任何通道（伤害、直接扣血、标记流失、延迟伤害、道具）
   * 落到本体血量上的总点数，用于「路易」与「应激」这类受击触发的增量判定。
   */
  hpLostThisBigTurn?: number;
  /** 召唤物（P6：虫群的耐久与血量同时承伤）。 */
  isSummon?: boolean;
  /** 召唤物耐久度；null/undefined 表示不参与致死。 */
  durability?: number | null;
  /** 免疫：本次伤害及附带效果无效。 */
  immune?: boolean;
  /** 无敌：不可被选中。 */
  invincible?: boolean;
  /** P5 状态层：增减益、护盾、免疫次数、标记等，见 core/status.ts。 */
  statuses?: Status[];
}

export interface DamageContext {
  clock: TurnClock;
  kind: DamageKind;
  /** P6 Q4：延迟伤害到点结算时置 true，避免再次进入延迟队列。 */
  ignoreDefer?: boolean;
}

/** 有效攻击力：R15 首回合全体 -1，下限 0（R11）。 */
export function effectiveAtk(c: Combatant, clock: TurnClock): number {
  // 玛恩纳「解放者」：未解放时攻击力恒为 0。
  const statuses = c.statuses ?? [];
  if (hasFlag(statuses, 'unliberated') && !hasFlag(statuses, 'liberated')) return 0;
  const penalty = isFirstTurnPenaltyActive(clock) ? 1 : 0;
  const base = statOf(c.atk, statuses, 'atk');
  const value = Math.max(0, base - penalty);
  // Q41：激励信件「本回合攻击上限 1」——有效攻击力取 min。
  const cap = flagValue(statuses, 'atkCap');
  return cap > 0 ? Math.min(value, cap) : value;
}

/**
 * 攻击伤害（R07 庄园老友 / R15 首回合）。
 * 庄园老友只减「攻击」伤害：首次不减，之后每次 -1，不叠加；技能/道具/无来源伤害不减。
 */
export function attackDamage(attacker: Combatant, defender: Combatant, clock: TurnClock): number {
  // P5-16②：荣光的逐击衰减先于庄园老友的 -1。
  // P5-21：藏锋「扫式」的「造成伤害 +1」走 dmgDealt，只作用于攻击伤害（技能伤害不受影响）。
  const base = Math.max(
    0,
    effectiveAtk(attacker, clock) + outgoingAdjust(attacker.statuses ?? []) + sumStat(attacker.statuses ?? [], 'dmgDealt'),
  );
  // 关键词可由 flag 表达（律师「庄园老友」），也可由旧字段直接置位（测试/旧调用方）。
  if (!defender.veteranOfManor && !hasFlag(defender.statuses ?? [], 'veteranOfManor')) return base;
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
  /** P6 坚强：本次伤害被转化为标记的数量（>0 时未造成任何伤害）。 */
  converted?: number;
  /** P6 Q4（QA-15/16）：本次致命伤害被整体延迟，值为待结算量；目标未掉血、护盾未消耗。 */
  lethalDeferred?: number;
  /** P6 巧手匠心（QA-12/13）：溢出伤害已 1 血保底，需转给 toId（已含 2 倍）。 */
  transferred?: { toId: string; amount: number };
}

/** P6 新增的临时状态统一在这里造 id。 */
let q4Seq = 0;
const q4Status = (key: string, value: number, source: string, expiresAt: Status['expiresAt']): Status => ({
  id: `st#q4-${++q4Seq}`,
  kind: 'flag',
  key,
  value,
  mode: 'add',
  expiresAt,
  source,
});

/**
 * 施加伤害，返回新的目标快照（不修改入参，方便做快照回归）。
 * 免疫直接吞掉本次伤害（R18）。
 */
export function applyDamage(target: Combatant, amount: number, ctx: DamageContext): DamageResult {
  if (target.immune) {
    return { applied: 0, absorbedByTemp: 0, target: { ...target }, dying: target.hp <= 0 };
  }
  let statuses = target.statuses ?? [];
  // P5：免疫次数（R18）优先于一切减伤。
  const immune = tryConsumeImmune(statuses, ctx.kind === 'attack' ? 'damage' : 'skill');
  if (immune.blocked) {
    return { applied: 0, absorbedByTemp: 0, target: { ...target, statuses: immune.statuses }, dying: target.hp <= 0 };
  }
  const scaledBase = Math.max(0, Math.round(amount * damageMultiplier(statuses)) + damageTakenAdjust(statuses));
  // P7 E：魔术师使用魔术棒后，下一次受到的伤害至多 1 点（一次性，读后即清）。
  const wandCap = statuses.find((s) => s.kind === 'flag' && s.key === 'wandCap1');
  const scaled = wandCap ? Math.min(scaledBase, wandCap.value || 1) : scaledBase;
  if (wandCap) statuses = statuses.filter((s) => s !== wandCap);
  // P6 坚强（QA-19/20）：伤害改为等量标记，不扣血/不扣盾、不计入受伤次数。
  const convert = statuses.find((s) => s.kind === 'flag' && s.key.startsWith('damageToMark:'));
  if (convert && scaled > 0) {
    const key = convert.key.slice('damageToMark:'.length);
    const next: Combatant = { ...target, statuses: addMark(statuses, key, scaled, convert.source) };
    return { applied: 0, absorbedByTemp: 0, target: next, dying: next.hp <= 0, converted: scaled };
  }
  // P6 Q4（QA-15/16）：致命判定先于护盾吸收；有 deferLethal 时整笔伤害进延迟队列。
  const deferFlag = statuses.find((s) => s.kind === 'flag' && s.key === 'deferLethal');
  const wouldBeLethal = scaled > 0 && target.hp > 0 && scaled >= target.hp + target.tempHp;
  if (!ctx.ignoreDefer && deferFlag && wouldBeLethal) {
    const side = target.side ?? 'first';
    const marker = q4Status('deferredDamage', scaled, deferFlag.source, resolveDuration('untilNextOwnTurnEnd', ctx.clock, side));
    return {
      applied: 0,
      absorbedByTemp: 0,
      target: { ...target, statuses: [...statuses, marker] },
      dying: false,
      lethalDeferred: scaled,
    };
  }
  const shielded = consumeShield(statuses, scaled);
  statuses = shielded.statuses;
  const dmg = Math.max(0, scaled - shielded.absorbed);
  // P6 虫群（QA-26）：召唤物受伤害时同时扣耐久与血量，任一 ≤0 即死亡。
  const durable = target.isSummon && target.durability !== null && target.durability !== undefined;
  const durability = durable ? Math.max(0, (target.durability as number) - dmg) : target.durability;
  const absorbed = Math.min(target.tempHp, dmg);
  const rest = dmg - absorbed;
  const next: Combatant = {
    ...target,
    statuses,
    durability,
    tempHp: target.tempHp - absorbed,
    hp: target.hp - rest,
  };
  if (durable && typeof durability === 'number' && durability <= 0) next.hp = 0;
  // P6 巧手匠心（QA-12/13）：友方血量保底 1，溢出部分 ×2 作为无来源伤害转给施放者。
  let transferred: DamageResult['transferred'];
  const keep = statuses.find((s) => s.kind === 'flag' && s.key === 'keepHpMin1');
  if (keep && keep.source !== target.id && next.hp <= 0) {
    const overflow = 1 - next.hp;
    next.hp = 1;
    next.tempHp = 0;
    const amount = overflow * (keep.value > 0 ? keep.value : 2);
    next.statuses = [...(next.statuses ?? []), q4Status(`transferPending:${keep.source}`, amount, target.id, null)];
    transferred = { toId: keep.source, amount };
  }
  // 牛仔「马背英雄」：有临时血量时受致命伤害，血量保留 1（flag: lethalSave）。
  if (next.hp <= 0 && hasFlag(statuses, 'lethalSave') && next.tempHp > 0) next.hp = 1;
  // 邮差「诀别」信件：受击后回 1 血（回血不破上限；致死伤害不触发）。
  if (dmg > 0 && next.hp > 0 && next.hp < next.maxHp && hasFlag(statuses, 'letterFarewell')) {
    next.hp = Math.min(next.maxHp, next.hp + 1);
  }
  if (dmg > 0) {
    next.damageTakenThisBigTurn = (target.damageTakenThisBigTurn ?? 0) + 1;
    // P7-2 X3/X4：本条通道里真正落到本体血量上的点数（临时血吸收与保底 1 不计）。
    const hpBefore = target.hp;
    const lost = Math.max(0, hpBefore - next.hp);
    if (lost > 0) next.hpLostThisBigTurn = (target.hpLostThisBigTurn ?? 0) + lost;
  }
  return { applied: rest, absorbedByTemp: absorbed, target: next, dying: next.hp <= 0, transferred };
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
