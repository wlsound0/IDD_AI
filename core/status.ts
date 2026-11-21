// 状态/增益层（P5）：所有「持续到某回合」的效果都落成带到期时间的 Status。
//
// 时间刻度（唯一标准）：
//   order = (bigTurn * 2 + (phase === 'second' ? 1 : 0)) * 2 + (at === 'end' ? 1 : 0)
// 先手小回合在前、后手小回合在后；同一个时间点 start 先于 end。
// 每次进入/离开小回合时调用 purgeExpired()，到期项一律移除，避免各技能各写一套计时。

import type { Side } from './types';

export type StatKey = 'atk' | 'dmgDealt' | 'dmgTaken' | 'hp' | 'maxHp';

export type StatusKind =
  | 'stat' // 属性增减：key = StatKey，value 为增减量，mode = add/set
  | 'dmgMultiplier' // 伤害倍率：value = 0.5 等，乘在最终伤害上
  | 'flag' // 布尔状态：key = 'cannotAttack' / 'noHeal' ...
  | 'shield' // 护盾点数，先于临时血量承伤
  | 'immune' // 免疫次数：key = 'damage' | 'skill' | 'all'
  | 'extraAttack' // 可再次攻击的次数
  | 'mark' // 标记计数：key = 自定义名
  | 'rescueRule'; // 救援扣血改写：value = 0/1/2

export interface TimePoint {
  bigTurn: number;
  phase: Side;
  /** 在该小回合的开始还是结束时到期。 */
  at: 'start' | 'end';
}

export interface Status {
  id: string;
  kind: StatusKind;
  key: string;
  value: number;
  mode: 'add' | 'set';
  /** null = 永久（或由寄主存活决定）。 */
  expiresAt: TimePoint | null;
  /** 来源角色 id，用于「源死亡后失效」。 */
  source: string;
  /** 只有 source 存活才生效（whileSourceAlive）。 */
  requiresSourceAlive?: boolean;
  /** 触发一次后即移除（P5-24：藏锋「扫式」的 nextAttack 类效果；P7-2 X6：八音盒「被攻击后」）。 */
  consumedOn?: 'attack' | 'attacked';
  /** 文字说明，便于日志排查。 */
  note?: string;
  /** P7 E2：同一次技能结算产生的状态组标记（野性伙伴按临时血量归零整组结束）。 */
  group?: string;
}

const PHASE_INDEX: Record<Side, number> = { first: 0, second: 1 };

export function timeOrder(p: TimePoint): number {
  return (p.bigTurn * 2 + PHASE_INDEX[p.phase]) * 2 + (p.at === 'end' ? 1 : 0);
}

export function currentTimePoint(bigTurn: number, phase: Side, at: 'start' | 'end' = 'end'): TimePoint {
  return { bigTurn, phase, at };
}

/** duration 字符串 → 到期时间点。详见 temp/p5-effect-spec.md §5。 */
export function resolveDuration(
  duration: string | undefined,
  clock: { bigTurn: number; phase: Side },
  side: Side,
): TimePoint | null {
  const other: Side = side === 'first' ? 'second' : 'first';
  const cur = clock.bigTurn;
  switch (duration) {
    case undefined:
    case 'permanent':
    case 'whileSourceAlive':
    case 'nextAttack': // P5-24：下次攻击结算后由攻击流程移除，不按回合到期。
      return null;
    case 'instant':
      return { bigTurn: cur, phase: clock.phase, at: 'end' };
    case 'untilTurnEnd':
    case 'untilBigRoundEnd':
      return { bigTurn: cur, phase: 'second', at: 'end' };
    case 'untilOwnTurnEnd':
      return { bigTurn: cur, phase: side, at: 'end' };
    case 'untilOwnTurnStart':
      return { bigTurn: cur, phase: side, at: 'start' };
    case 'untilNextOwnTurnStart':
      return side === clock.phase
        ? { bigTurn: cur + 1, phase: side, at: 'start' }
        : { bigTurn: cur, phase: side, at: 'start' };
    case 'untilEnemyTurnStart':
      return clock.phase === other
        ? { bigTurn: cur, phase: other, at: 'start' }
        : { bigTurn: cur, phase: other, at: 'start' };
    // 「持续到下个友方/敌方回合结束」：按 QA-07，先判断当前小回合在自己之前还是之后。
    // 处在先手回合、自己是后手 → 本大回合的后手回合结束；其余情况 → 下一个大回合。
    case 'untilNextOwnTurnEnd':
    case 'untilNextAllyTurnEnd':
      return {
        bigTurn: side === clock.phase ? cur + 1 : clock.phase === 'first' ? cur : cur + 1,
        phase: side,
        at: 'end',
      };
    case 'untilNextEnemyTurnEnd':
      return { bigTurn: cur + 1, phase: other, at: 'end' };
    default: {
      // turns:N —— 按「N 个大回合」计，到期于第 N 个大回合的后手小回合结束。
      const m = /^turns:(\d+)$/.exec(duration);
      if (m) return { bigTurn: cur + Number(m[1]) - 1, phase: 'second', at: 'end' };
      return null;
    }
  }
}

/** 是否已到期：当前时间点 >= 到期时间点。 */
export function isExpired(status: Status, now: TimePoint): boolean {
  if (!status.expiresAt) return false;
  return timeOrder(now) >= timeOrder(status.expiresAt);
}

export function purgeExpired(statuses: Status[], now: TimePoint): Status[] {
  return statuses.filter((s) => !isExpired(s, now));
}

/** 移除来源已死亡的效果（whileSourceAlive）。 */
export function purgeDeadSource(statuses: Status[], alive: (id: string) => boolean): Status[] {
  return statuses.filter((s) => !s.requiresSourceAlive || alive(s.source));
}

export function sumStat(statuses: Status[], stat: StatKey): number {
  let total = 0;
  for (const s of statuses) {
    if (s.kind !== 'stat' || s.key !== stat || s.mode !== 'add') continue;
    total += s.value;
  }
  return total;
}

export function setStat(statuses: Status[], stat: StatKey): number | null {
  const sets = statuses.filter((s) => s.kind === 'stat' && s.key === stat && s.mode === 'set');
  if (!sets.length) return null;
  return sets[sets.length - 1].value;
}

/**
 * 读取属性当前值。
 * P7 C：`set` 不再永久吞掉后续的 `add`——按状态施加顺序结算：
 * 遇到 set 时把当前值替换为定值，之后施加的 add 继续累加（冒险家「探险幻想」：
 * 攻击后攻击力改为 2，之后的回合结束 +2 仍应生效）。
 */
export function statOf(base: number, statuses: Status[], stat: StatKey): number {
  let value = base;
  for (const s of statuses) {
    if (s.kind !== 'stat' || s.key !== stat) continue;
    if (s.mode === 'set') value = s.value;
    else value += s.value;
  }
  return value;
}

export function hasFlag(statuses: Status[], flag: string): boolean {
  return statuses.some((s) => s.kind === 'flag' && s.key === flag);
}

export function flagValue(statuses: Status[], flag: string): number {
  return statuses.filter((s) => s.kind === 'flag' && s.key === flag).reduce((n, s) => n + s.value, 0);
}

export function markValue(statuses: Status[], key: string): number {
  return statuses.filter((s) => s.kind === 'mark' && s.key === key).reduce((n, s) => n + s.value, 0);
}

let markSeq = 0;

/** 增加标记（P6：坚强把伤害转成等量标记）。标记无上限，按数量累加。 */
export function addMark(statuses: Status[], key: string, amount: number, source: string): Status[] {
  if (amount <= 0) return statuses;
  return [
    ...statuses,
    { id: `mark#${++markSeq}`, kind: 'mark', key, value: amount, mode: 'add', expiresAt: null, source },
  ];
}

/** 扣除指定数量的标记，返回剩余标记与实扣数。 */
export function removeMark(statuses: Status[], key: string, amount: number): { statuses: Status[]; removed: number } {
  let left = amount;
  const next: Status[] = [];
  for (const s of statuses) {
    if (left > 0 && s.kind === 'mark' && s.key === key) {
      if (s.value > left) {
        next.push({ ...s, value: s.value - left });
        left = 0;
      } else {
        left -= s.value;
      }
      continue;
    }
    next.push(s);
  }
  return { statuses: next, removed: amount - left };
}

export function totalShield(statuses: Status[]): number {
  // value = -1 是「抵挡一次伤害」的哨兵，不折算成点数，界面上单独标注。
  return statuses.filter((s) => s.kind === 'shield' && s.value > 0).reduce((n, s) => n + s.value, 0);
}

export const hasShieldOnce = (statuses: Status[]): boolean =>
  statuses.some((s) => s.kind === 'shield' && s.value < 0);

/** 消耗护盾点数，返回剩余护盾的点数（用于扣减 hp 前）。 */
export function consumeShield(statuses: Status[], amount: number): { statuses: Status[]; absorbed: number } {
  let left = amount;
  const next: Status[] = [];
  for (const s of statuses) {
    if (s.kind !== 'shield' || left <= 0) {
      next.push(s);
      continue;
    }
    // 「抵挡一次伤害」：整次伤害归零并移除该护盾。
    if (s.value < 0) {
      left = 0;
      continue;
    }
    const use = Math.min(s.value, left);
    left -= use;
    const remain = s.value - use;
    if (remain > 0) next.push({ ...s, value: remain });
  }
  return { statuses: next, absorbed: amount - left };
}

/** 免疫判定并消耗一次（scope 匹配或 all）。 */
export function tryConsumeImmune(
  statuses: Status[],
  scope: 'damage' | 'skill' | 'all',
): { statuses: Status[]; blocked: boolean } {
  const idx = statuses.findIndex((s) => s.kind === 'immune' && (s.key === scope || s.key === 'all'));
  if (idx < 0) return { statuses, blocked: false };
  const next = statuses.slice();
  const s = next[idx];
  // P7 E：value < 0 表示无次数上限（小女孩「记忆同步」的附身免疫，结束由本体技能控制）。
  if (s.value < 0) return { statuses, blocked: true };
  if (s.value <= 1) next.splice(idx, 1);
  else next[idx] = { ...s, value: s.value - 1 };
  return { statuses: next, blocked: true };
}

export function damageTakenAdjust(statuses: Status[]): number {
  return sumStat(statuses, 'dmgTaken');
}

/**
 * 造成伤害的调整（P5-16②「未照耀的荣光」逐击衰减）：
 * 每攻击一次记一层 rampDown，本次行动内所有后续伤害 -1，可叠加。
 */
export function outgoingAdjust(statuses: Status[]): number {
  return -flagValue(statuses, 'rampDown');
}

export function damageMultiplier(statuses: Status[]): number {
  return statuses
    .filter((s) => s.kind === 'dmgMultiplier')
    .reduce((m, s) => m * s.value, 1);
}
