// 濒死与救援。依据：裁决落地 D01/D02/D03/D06/D17/D18、Q31/Q32（已裁决为默认）。
//
// D01：血量 ≤0 立即判定，不拖到回合结束。
//   有可救援者 → 弹选项；玩家放弃 → 立即死亡。
//   没有可救援者 → 立即死亡。
// D02：救援者扣 2 血；目标满血复活，上限 = ceil(战斗开始上限 / 2)；每人每小局限 1 次。
// D06：召唤物不可被救援、没有濒死状态。
// D17：野人救援只扣 1 血且必扣本体；被封技能后扣 2 血，优先扣临时血量。
// D18：画家可被救 2 次，被救不减上限，救援者扣血 -1。

import { rescuedMaxHp, type Combatant } from './combat';
import type { Side } from './types';

/** 能执行救援的一方。 */
export interface Rescuer extends Combatant {
  /** 阵营。只有同阵营（己方）角色才能互相救援。 */
  side?: Side;
  /** 是否拥有「救援」能力。没有该能力的角色不能救人。 */
  hasRescue?: boolean;
  /** 技能被封：影响救援代价，见 D17。 */
  sealed?: boolean;
  /** 救援基础扣血，默认 2。 */
  rescueCostBase?: number;
  /** 被封技能后的救援扣血，野人为 2。 */
  rescueCostWhenSealed?: number;
  /** 被封技能后是否仍可救援（野人为 true）。 */
  canRescueWhenSealed?: boolean;
  /** 救援必须扣真实血量，不能用临时血量抵扣（野人未封技能时）。 */
  mustUseBodyForRescue?: boolean;
  /** 是否拥有自我救援能力。 */
  canSelfRescue?: boolean;
}

/** 会进入濒死、可被救援的一方。 */
export interface RescueTarget extends Combatant {
  /** 阵营，用于限定「己方角色」才能救援。 */
  side?: Side;
  /** 召唤物：不可救援、无濒死（D06）。 */
  isSummon?: boolean;
  /** 本小局已被救援次数。 */
  rescueCount?: number;
  /** 本小局可被救援次数上限，默认 1，画家为 2。 */
  rescueLimit?: number;
  /** 救援者为此目标支付时的扣血增减，画家为 -1。 */
  rescueCostDelta?: number;
  /** 被救援时不减血量上限（画家）。 */
  noMaxHpHalvingOnRescue?: boolean;
}

export type RescueOp =
  | { kind: 'ally'; rescuerId: string; cost: number; useBodyOnly: boolean }
  | { kind: 'self'; cost: 0 };

/** 救援者救这个目标需要扣多少血。 */
export function rescueCost(rescuer: Rescuer, target: RescueTarget): number {
  const base = rescuer.sealed
    ? (rescuer.rescueCostWhenSealed ?? rescuer.rescueCostBase ?? 2)
    : (rescuer.rescueCostBase ?? 2);
  const delta = target.rescueCostDelta ?? 0;
  return Math.max(0, base + delta);
}

/** 目标是否还可能被救（不考虑救援者）。 */
export function isRescuableAtAll(target: RescueTarget): boolean {
  if (target.isSummon) return false;
  if (target.hp > 0) return false;
  return (target.rescueCount ?? 0) < (target.rescueLimit ?? 1);
}

/** 某个具体救援者能否救这个目标。 */
export function canRescue(target: RescueTarget, rescuer: Rescuer): boolean {
  if (!isRescuableAtAll(target)) return false;
  if (!rescuer.hasRescue) return false;
  if (rescuer.hp <= 0) return false;
  if (rescuer.sealed && !rescuer.canRescueWhenSealed) return false;
  const cost = rescueCost(rescuer, target);
  const payable = rescuer.mustUseBodyForRescue && !rescuer.sealed
    ? rescuer.hp
    : rescuer.hp + rescuer.tempHp;
  if (payable < cost) return false;
  // 机制：「血量小于本次救援应扣血量的角色不可救援其他角色」。
  // 实现取「救完本体血量仍 ≥1」的严格解释：血量正好等于扣血量时也不可救（否则救完自己立刻濒死）。
  const bodyLoss = rescuer.mustUseBodyForRescue && !rescuer.sealed
    ? cost
    : Math.max(0, cost - rescuer.tempHp);
  return rescuer.hp > bodyLoss;
}

/**
 * 列出当前可用的救援操作。
 * 自我救援（D03）不额外扣血，且只有目标自己具备该能力时才出现（Q31：同样可选、可放弃）。
 */
export function availableRescues(target: RescueTarget, units: Rescuer[]): RescueOp[] {
  const ops: RescueOp[] = [];
  if (!isRescuableAtAll(target)) return ops;

  for (const u of units) {
    if (u.id === target.id) continue;
    // 机制 R02：「若有其他己方角色进入濒死状态」——只有同阵营能救。
    if (u.side && target.side && u.side !== target.side) continue;
    if (!canRescue(target, u)) continue;
    ops.push({
      kind: 'ally',
      rescuerId: u.id,
      cost: rescueCost(u, target),
      useBodyOnly: Boolean(u.mustUseBodyForRescue) && !u.sealed,
    });
  }

  const self = units.find((u) => u.id === target.id);
  if (self?.canSelfRescue) ops.push({ kind: 'self', cost: 0 });

  return ops;
}

export interface RescueResolution {
  target: RescueTarget;
  rescuer?: Rescuer;
  /** 结果：被救活 / 立即死亡 / 等待玩家选择。 */
  outcome: 'rescued' | 'dead' | 'choice';
  ops: RescueOp[];
}

/** D01 的第一步：扣血后立即判定。不传入选择时只做“是否有得选”。 */
export function judgeDying(target: RescueTarget, units: Rescuer[]): RescueResolution {
  const ops = availableRescues(target, units);
  if (ops.length === 0) return { target: { ...target }, outcome: 'dead', ops };
  return { target: { ...target }, outcome: 'choice', ops };
}

/**
 * D01 的第二步：玩家做出选择。
 * choice 为 null 表示放弃救援 → 立即死亡。
 */
export function applyRescue(
  target: RescueTarget,
  units: Rescuer[],
  choice: RescueOp | null,
): { target: RescueTarget; rescuer?: Rescuer; dead: boolean } {
  if (!choice) return { target: { ...target }, rescuer: undefined, dead: true };
  // 救援名额已用尽（或目标根本不是可救援单位）时，任何选择都不成立。
  if (!isRescuableAtAll(target)) return { target: { ...target }, rescuer: undefined, dead: true };

  if (choice.kind === 'self') {
    const next: RescueTarget = { ...target, rescueCount: (target.rescueCount ?? 0) + 1 };
    if (!next.noMaxHpHalvingOnRescue) next.maxHp = rescuedMaxHp(next);
    next.hp = next.maxHp;
    next.tempHp = 0;
    return { target: next, dead: false };
  }

  const rescuer = units.find((u) => u.id === choice.rescuerId);
  if (!rescuer) return { target: { ...target }, dead: true };

  // 扣血：野人未封技能时必须扣本体，其余情况优先扣临时血量。
  const cost = choice.cost;
  const fromTemp = choice.useBodyOnly ? 0 : Math.min(rescuer.tempHp, cost);
  const fromBody = cost - fromTemp;
  const nextRescuer: Rescuer = { ...rescuer, tempHp: rescuer.tempHp - fromTemp, hp: rescuer.hp - fromBody };

  const next: RescueTarget = { ...target, rescueCount: (target.rescueCount ?? 0) + 1 };
  if (!next.noMaxHpHalvingOnRescue) next.maxHp = rescuedMaxHp(next);
  next.hp = next.maxHp;
  next.tempHp = 0;

  return { target: next, rescuer: nextRescuer, dead: false };
}
