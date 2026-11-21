// 触发调度（P5）：技能/道具的「什么时候生效」只在这里决定。
//
// 顺序沿用 R21：先按站位交替（先手1→后手1→先手2→后手2…），同站位再按来源等级与注册顺序。
// 这里不复制任何 op 语义，op 全部交给 effects.ts。

import { sortEffects } from './settlement';
import type { PendingEffect, Side } from './types';
import { effectiveAtk } from './combat';
import type {
  EffectBranch,
  EffectContext,
  EffectUnit,
  SkillEffect,
  UnitSkill,
  Trigger,
  OpSpec,
  TargetSpec,
} from './effects';
import { runEffect } from './effects';
import { hasFlag, markValue } from './status';
import type { TurnClock } from './turn';

export interface TriggerResult {
  events: { type: string; [k: string]: unknown }[];
  unsupported: string[];
}

/** 条件求值：只认文档列出的键，未知键一律 false 并记入 unsupported。 */
export function evalCondition(
  cond: Record<string, unknown> | undefined,
  unit: EffectUnit,
  target: EffectUnit | undefined,
  units: EffectUnit[],
  clock: TurnClock,
  skill: UnitSkill | null,
  unsupported?: string[],
  /** P7 C：本次触发的道具 id（仅在 trigger:"itemUse" 时有值）。 */
  usedItemId?: string,
): boolean {
  if (!cond) return true;
  const alive = units.filter((u) => !u.dead);
  for (const [key, raw] of Object.entries(cond)) {
    const v = raw as number | boolean | string;
    switch (key) {
      case 'hpLt':
        if (!(unit.hp < Number(v))) return false;
        break;
      case 'hpLte':
        if (!(unit.hp <= Number(v))) return false;
        break;
      case 'hpGt':
        if (!(unit.hp > Number(v))) return false;
        break;
      case 'hpEq':
        if (!(unit.hp === Number(v))) return false;
        break;
      case 'isWounded':
        if (!(unit.hp < unit.maxHp) === Boolean(v)) return false;
        break;
      case 'allyAlive':
        if (!(alive.filter((u) => u.side === unit.side).length >= Number(v))) return false;
        break;
      case 'allyWoundedCount':
        if (!(alive.filter((u) => u.side === unit.side && u.hp < u.maxHp).length >= Number(v))) return false;
        break;
      case 'turnGte':
        if (!(clock.bigTurn >= Number(v))) return false;
        break;
      case 'turnEq':
        if (!(clock.bigTurn === Number(v))) return false;
        break;
      case 'firstUse':
        if (!(v ? (skill?.usedPerGame ?? 0) === 0 : (skill?.usedPerGame ?? 0) > 0)) return false;
        break;
      case 'selfUniqueRescuer': {
        const rescuers = alive.filter((u) => u.side === unit.side && u.hasRescue);
        if (!(rescuers.length === 1 && rescuers[0].id === unit.id) === Boolean(v)) return false;
        break;
      }
      case 'hasTempHp':
        if (Boolean(unit.tempHp > 0) !== Boolean(v)) return false;
        break;
      case 'allyName': {
        const wanted = String(v);
        if (!alive.some((u) => u.side === unit.side && u.name === wanted)) return false;
        break;
      }
      case 'targetIsSelf':
        if (Boolean(target?.id === unit.id) !== Boolean(v)) return false;
        break;
      case 'markAtLeast':
        if (!(markValue(unit.statuses, String((cond as Record<string, unknown>).markKey ?? 'mark')) >= Number(v))) return false;
        break;
      case 'itemUsed':
        // P7 C：只对该道具的「使用后」被动生效（空军/舞女）。
        if (usedItemId !== String(v)) return false;
        break;
      default:
        unsupported?.push(`cond:${key}`);
        return false;
    }
  }
  return true;
}

/** R21 排序：把参与本次触发的单位排成 (站位, 阵营) 交替顺序。 */
export function orderUnits(units: EffectUnit[]): EffectUnit[] {
  const alive = units.filter((u) => !u.dead);
  const pending: PendingEffect[] = alive.map((u) => ({
    id: u.id,
    targetSide: u.side,
    targetSlot: u.slot,
    source: 'self',
    seq: u.slot,
  }));
  const ordered = sortEffects(pending);
  const byId = new Map(alive.map((u) => [u.id, u]));
  return ordered.map((p) => byId.get(p.id)).filter((u): u is EffectUnit => Boolean(u));
}

export interface FireOptions {
  /** 触发点。 */
  trigger: Trigger;
  clock: TurnClock;
  /** 只让这些阵营的单位触发（如 ownTurnStart 只让当前回合方触发）。 */
  sideFilter?: Side;
  attackerId?: string;
  victimId?: string;
  targetId?: string;
  /** 只让这一个单位触发（afterAttack 只属于出手者）。 */
  onlyUnitId?: string;
  /** P7 C：本次使用的道具 id（trigger:"itemUse" 用）。 */
  itemUsed?: string;
  /** P7 E：本次触发来自救援流程（木偶师「路易」的救援变体）。 */
  viaRescue?: boolean;
  /** 自动选目标（非手动技能）。 */
  autoTarget?: (skill: SkillEffect, unit: EffectUnit) => EffectUnit | undefined;
  createSummon?: EffectContext['createSummon'];
  /** P7-4：被动触发里产生的伤害也要过统一反应窗口（如回合末掉血）。 */
  reactionGate?: EffectContext['reactionGate'];
}

function autoPick(spec: { target?: { mode: string } }, unit: EffectUnit, units: EffectUnit[]): EffectUnit | undefined {
  const mode = spec.target?.mode;
  const alive = units.filter((u) => !u.dead);
  switch (mode) {
    case 'self':
      return unit;
    case 'allyUnit':
      return alive.filter((u) => u.side === unit.side).sort((a, b) => a.hp - b.hp)[0];
    case 'enemyUnit':
      return alive.filter((u) => u.side !== unit.side).sort((a, b) => a.hp - b.hp)[0];
    case 'anyUnit':
    case 'anyCharacter':
      return alive.find((u) => u.id !== unit.id) ?? unit;
    case 'otherAlly':
      return alive.find((u) => u.side === unit.side && u.id !== unit.id);
    default:
      return undefined;
  }
}

/** 触发一个时机：遍历所有单位的所有技能，条件满足就执行 ops。 */
export function fire(units: EffectUnit[], opts: FireOptions): TriggerResult {
  const events: TriggerResult['events'] = [];
  const unsupported: string[] = [];
  for (const unit of orderUnits(units)) {
    if (opts.sideFilter && unit.side !== opts.sideFilter) continue;
    if (opts.onlyUnitId && unit.id !== opts.onlyUnitId) continue;
    if (hasFlag(unit.statuses, 'sealed')) continue;
    const skills = unit.skills.filter(
      (s) =>
        s.effect &&
        !s.effect.manual &&
        (s.effect.trigger === opts.trigger || (s.effect.parts ?? []).some((p) => p.trigger === opts.trigger)),
    );
    if (!skills.length) continue;
    const targetFor = () =>
      opts.targetId ? units.find((u) => u.id === opts.targetId) : undefined;
    const condOf = (skill: UnitSkill, condition: Record<string, unknown>[] | undefined) =>
      (condition ?? []).every((c) =>
        evalCondition(c, unit, targetFor(), units, opts.clock, skill, unsupported, opts.itemUsed),
      );
    const runOne = (
      skill: UnitSkill,
      ops: OpSpec[],
      duration: string | undefined,
      condition: Record<string, unknown>[] | undefined,
      targetSpec?: { target?: TargetSpec },
    ) => {
      if (!condOf(skill, condition)) return false;
      const effect = effectOf(skill);
      const target =
        targetFor() ??
        (targetSpec?.target
          ? autoPick(targetSpec, unit, units)
          : opts.autoTarget ? opts.autoTarget(effect, unit) : autoPick(effect, unit, units));
      const ctx: EffectContext = {
        units,
        clock: opts.clock,
        sourceId: unit.id,
        targetId: target?.id,
        attackerId: opts.attackerId,
        victimId: opts.victimId,
        events,
        createSummon: opts.createSummon,
        unsupported,
        viaRescue: opts.viaRescue,
        reactionGate: opts.reactionGate,
      };
      runEffect(ctx, { ops, duration });
      return true;
    };
    const effectOf = (skill: UnitSkill): SkillEffect => skill.effect!;
    for (const skill of skills) {
      const effect = effectOf(skill);
      if (skill.durability !== null && skill.durability <= 0) continue;
      // 主效果：技能本身的触发时机（usageLimit 只约束主效果）。
      if (effect.trigger === opts.trigger) {
        const limit = effect.usageLimit;
        const usedUp =
          (limit?.perGame !== undefined && skill.usedPerGame >= limit.perGame) ||
          (limit?.perTurn !== undefined && skill.usedThisBigTurn >= limit.perTurn);
        if (!usedUp && runOne(skill, effect.ops, effect.duration, effect.condition)) {
          skill.usedPerGame += 1;
          skill.usedThisBigTurn += 1;
        }
      }
      // P7 E2：额外触发时机各自独立计次（即兴演出的三个时机）。
      const parts = effect.parts ?? [];
      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i];
        if (part.trigger !== opts.trigger) continue;
        const used = skill.partUses?.[i] ?? { perGame: 0, perTurn: 0 };
        if (part.usageLimit?.perGame !== undefined && used.perGame >= part.usageLimit.perGame) continue;
        if (part.usageLimit?.perTurn !== undefined && used.perTurn >= part.usageLimit.perTurn) continue;
        if (!runOne(skill, part.ops, part.duration, part.condition, part)) continue;
        if (!skill.partUses) skill.partUses = [];
        skill.partUses[i] = { perGame: used.perGame + 1, perTurn: used.perTurn + 1 };
      }
    }
  }
  return { events, unsupported };
}

/** 单位能否主动使用该技能（CD / 充能 / 耐久 / 封印 / 使用次数 / 分支次数）。 */
export function canUseSkill(
  unit: EffectUnit,
  skill: UnitSkill,
  clock: TurnClock,
  branchCost?: number,
  branch?: EffectBranch,
  branchIndex?: number,
): string | null {
  if (unit.dead) return '单位已阵亡';
  if (hasFlag(unit.statuses, 'sealed')) return '技能被封印';
  if (hasFlag(unit.statuses, 'cannotAct')) return '无法行动';
  const def = skill.def;
  if (def.type === 'passive' || def.type === 'battlecry') return '被动技能不可主动使用';
  // P7 D：技能级使用次数上限（perTurn 在主动使用时也必须生效，原先只在被动 fire 里检查）。
  const limit = skill.effect?.usageLimit;
  if (limit?.perGame !== undefined && skill.usedPerGame >= limit.perGame) {
    return `本局使用次数已用尽（${skill.usedPerGame}/${limit.perGame}）`;
  }
  if (limit?.perTurn !== undefined && skill.usedThisBigTurn >= limit.perTurn) {
    return `本回合使用次数已用尽（${skill.usedThisBigTurn}/${limit.perTurn}）`;
  }
  // P7 D：分支级每局次数上限（独家新闻 3/1、线路控制升级 1）。
  if (branch && branch.uses !== undefined) {
    const used = branchIndex !== undefined ? skill.branchUses?.[branchIndex] ?? 0 : 0;
    if (used >= branch.uses) return `「${branch.label}」已用尽（${used}/${branch.uses}）`;
  }
  if (def.type === 'charge') {
    // P5-16③：分支可覆盖充能消耗（激励 1/3）。
    const need = branchCost ?? def.cost ?? 0;
    if (skill.charge < need) return `充能不足（${skill.charge}/${need}）`;
  }
  if (def.type === 'cooldown') {
    const cd = def.cd ?? 0;
    // 裁决落地 D08（机制 R22）：初始CD=n → 第 n+1 回合起才可用；无初始CD → 开局即可用。
    if (def.initialCd != null && clock.bigTurn < def.initialCd + 1) {
      return `初始 CD 未就绪（第 ${def.initialCd + 1} 回合起可用）`;
    }
    // 从未用过的技能不受 CD 计数约束（R22），用掉之后才按 R16 计数。
    if (skill.usedPerGame > 0 && skill.cdCounter < cd) return `CD 未就绪（${skill.cdCounter}/${cd}）`;
  }
  if (def.type === 'active' && skill.durability !== null && skill.durability <= 0) return '耐久度已耗尽';
  return null;
}

/** 一方的进攻手段（R25 第 5 条）：至少一个存活单位能攻击，或有可用的伤害/减益技能。 */
export function computeCanAttack(units: EffectUnit[], clock: TurnClock): Record<Side, boolean> {
  const out: Record<Side, boolean> = { first: false, second: false };
  for (const u of units) {
    if (u.dead) continue;
    if (out[u.side]) continue;
    // R11 + P5-1：攻击力 0 仍可攻击，但不计入「有进攻手段」；未解放的玛恩纳不能攻击。
    if (hasFlag(u.statuses, 'cannotAttack') || hasFlag(u.statuses, 'restrictAttack')) continue;
    if (hasFlag(u.statuses, 'unliberated') && !hasFlag(u.statuses, 'liberated')) continue;
    if (effectiveAtk(u, clock) <= 0) continue;
    out[u.side] = true;
  }
  return out;
}
