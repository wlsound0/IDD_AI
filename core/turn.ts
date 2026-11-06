// 回合时钟（机制 R08 / R26 / R34）。
//
// R08：除非特殊声明，否则「一回合」= 先手回合 + 后手回合。
// R26/R34：「回合结束时」默认指大回合结束；「己方/敌方/先手/后手结束时」指小回合结束。
// 因此所有触发器都必须声明自己属于哪个时间单位，不能混用。

import type { Phase } from './types';

export type TimeUnit = 'small' | 'big';

export interface TurnClock {
  /** 大回合序号，从 1 开始。 */
  bigTurn: number;
  /** 当前处于哪一方的……小回合。 */
  phase: Phase;
  /** 本大回合内已结束的小回合数（0..2）。 */
  smallTurnsDone: number;
}

export function createClock(): TurnClock {
  return { bigTurn: 1, phase: 'first', smallTurnsDone: 0 };
}

/**
 * 结束当前小回合，返回新时钟。
 * 先手小回合结束 -> 进入后手小回合；后手小回合结束 -> 大回合 +1，回到先手小回合。
 */
export function endSmallTurn(clock: TurnClock): TurnClock {
  if (clock.phase === 'first') {
    return { bigTurn: clock.bigTurn, phase: 'second', smallTurnsDone: 1 };
  }
  return { bigTurn: clock.bigTurn + 1, phase: 'first', smallTurnsDone: 0 };
}

/** 该小回合的结束是否同时构成大回合结束。 */
export function endsBigTurn(clock: TurnClock): boolean {
  return clock.phase === 'second';
}

/**
 * 判断一个「回合结束」事件当前应当触发哪一类效果（R26）。
 * 大小回合是两套语义，实现里必须分开挂载。
 */
export function turnEndUnits(clock: TurnClock): TimeUnit[] {
  return endsBigTurn(clock) ? ['small', 'big'] : ['small'];
}

/** 第一回合所有角色攻击 -1（机制 R15）：只在大回合 1 期间生效。 */
export function isFirstTurnPenaltyActive(clock: TurnClock): boolean {
  return clock.bigTurn === 1;
}
