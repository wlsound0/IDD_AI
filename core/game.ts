// 一局对战的状态机（P2 单场闭环）。
//
// 设计约束：
//   - 纯函数：applyAction(state, action) 返回新状态 + 事件日志，不改入参。
//   - 所有随机、时间、IO 都不在这里出现，保证同一脚本重跑结果一致。
//   - 伤害/救援/胜负各自已有独立模块，这里只做编排，不复制规则。

import { applyDamage, attackDamage, reflectDamage, type Combatant } from './combat';
import { createClock, endSmallTurn, type TurnClock } from './turn';
import type { HookRegistry } from './hooks';
import { makeEvent } from './hooks';
import { applyRescue, judgeDying, type RescueTarget, type Rescuer, type RescueOp } from './rescue';
import { checkVictory, createVictoryState, endSmallTurnWithoutAttack, recordAttack, type VictoryState } from './victory';
import type { Side } from './types';

export interface GameUnit extends Combatant, RescueTarget, Rescuer {
  name: string;
  side: Side;
  slot: number;
  dead: boolean;
  /** 本大回合是否已主动攻击过（D10：每角色每大回合限一次）。 */
  attackedThisBigTurn: boolean;
  /** 受击时是否对攻击者造成反伤（Q&A：反伤取受击方当前攻击力）。 */
  hasReflect?: boolean;
}

export type GameEvent =
  | { type: 'battleStart' }
  | { type: 'attack'; attacker: string; target: string; damage: number; hpAfter: number }
  | { type: 'reflect'; attacker: string; target: string; damage: number; hpAfter: number }
  | { type: 'dying'; unit: string }
  | { type: 'death'; unit: string }
  | { type: 'rescue'; rescuer: string; target: string; cost: number }
  | { type: 'smallTurnEnd'; bigTurn: number; phase: Side }
  | { type: 'bigTurnEnd'; bigTurn: number }
  | { type: 'resign'; side: Side }
  | { type: 'victory'; winner: Side; reason: string };

export interface GameState {
  clock: TurnClock;
  units: GameUnit[];
  victory: VictoryState;
  events: GameEvent[];
  winner: Side | null;
  /**
   * 尚未处理的濒死队列（按必须处理的先后顺序）。
   * 新规则：同一次攻击里被攻击者先于攻击者；队列非空时，除「处理队首濒死」外任何动作都会被拒绝。
   */
  dyingQueue: string[];
  /** 本小回合是否已有进攻（用于僵持计数 D12）。 */
  attackedThisSmallTurn: boolean;
  /** BP 剩余预算按 1:2 折算后的道具花费（P5 才会真正消耗）。 */
  itemBudget: Record<Side, number>;
}

export type Action =
  | { type: 'attack'; attackerId: string; targetId: string }
  | { type: 'rescue'; targetId: string; rescuerId: string | null }
  | { type: 'resign'; side: Side }
  | { type: 'endTurn' };

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

const otherSide = (s: Side): Side => (s === 'first' ? 'second' : 'first');

export function createGame(
  units: Omit<GameUnit, 'dead' | 'attackedThisBigTurn'>[],
  setup?: { itemBudget?: Partial<Record<Side, number>> },
): GameState {
  const full: GameUnit[] = units.map((u) => ({
    ...u,
    dead: false,
    attackedThisBigTurn: false,
    damageTakenThisBigTurn: 0,
  }));
  const alive = { first: 0, second: 0 };
  const canAttack = { first: false, second: false };
  for (const u of full) {
    alive[u.side] += 1;
    canAttack[u.side] = true;
  }
  return {
    clock: createClock(),
    units: full,
    victory: createVictoryState(alive, canAttack),
    events: [{ type: 'battleStart' }],
    winner: null,
    dyingQueue: [],
    attackedThisSmallTurn: false,
    itemBudget: {
      first: setup?.itemBudget?.first ?? 0,
      second: setup?.itemBudget?.second ?? 0,
    },
  };
}

const findUnit = (units: GameUnit[], id: string) => units.find((u) => u.id === id);
// 濒死（hp ≤ 0）的单位不能再行动；它要么被救活，要么下一步死亡。
const isActive = (u: GameUnit, phase: Side) => u.side === phase && !u.dead && u.hp > 0;

/** 刷新胜负输入（存活数 / 是否还有进攻手段）。 */
function refreshVictory(units: GameUnit[], victory: VictoryState): VictoryState {
  const alive = { first: 0, second: 0 };
  const canAttack = { first: false, second: false };
  for (const u of units) {
    if (u.dead) continue;
    alive[u.side] += 1;
    canAttack[u.side] = true;
  }
  return { ...victory, alive, canAttack };
}

/**
 * 结算濒死：D01 立即判定。
 * 单场闭环里默认所有玩家放弃救援（P3 接入界面后再由玩家选择）。
 */
function resolveDying(units: GameUnit[], events: GameEvent[]): GameUnit[] {
  let next = units;
  for (const u of next) {
    if (u.dead || u.hp > 0) continue;
    events.push({ type: 'dying', unit: u.id });
    const judgement = judgeDying(u, next.filter((x) => !x.dead));
    if (judgement.outcome === 'dead') {
      next = next.map((x) => (x.id === u.id ? { ...x, dead: true } : x));
      events.push({ type: 'death', unit: u.id });
    }
    // outcome === 'choice' 时保持濒死，等待外部传入 rescue 动作
  }
  return next;
}

/** 当前仍处于濒死（hp ≤ 0 且未死）的单位 id。 */
const isDying = (units: GameUnit[], id: string) => {
  const u = findUnit(units, id);
  return Boolean(u && !u.dead && u.hp <= 0);
};

/** 让队列与场上实际情况对齐：去掉已处理/已死的，按既有顺序保留，新出现的按指定顺序追加。 */
function syncQueue(units: GameUnit[], queue: string[], prependOrder: string[] = []): string[] {
  const out: string[] = [];
  for (const id of [...prependOrder, ...queue]) {
    if (!isDying(units, id)) continue;
    if (!out.includes(id)) out.push(id);
  }
  for (const u of units) {
    if (!u.dead && u.hp <= 0 && !out.includes(u.id)) out.push(u.id);
  }
  return out;
}

/** 还没处理的濒死单位（队首 = 必须优先处理的那个）。界面用。 */
export function pendingDying(state: GameState): GameUnit[] {
  return state.dyingQueue
    .map((id) => findUnit(state.units, id))
    .filter((u): u is GameUnit => Boolean(u));
}

/** 某个濒死目标当前有哪些合法救援操作（不含「放弃救援」）。界面用。 */
export function legalRescueOps(state: GameState, targetId: string): RescueOp[] {
  const target = findUnit(state.units, targetId);
  if (!target || target.dead || target.hp > 0) return [];
  return judgeDying(target, state.units.filter((u) => !u.dead)).ops;
}

export function applyAction(
  state: GameState,
  action: Action,
  hooks?: HookRegistry,
): ApplyResult {
  if (state.winner) return { state, events: [] };
  // 投降：任意一方、任意时刻（含濒死队列未处理时）都可以直接认负。
  if (action.type === 'resign') {
    const winner = otherSide(action.side);
    const events: GameEvent[] = [
      { type: 'resign', side: action.side },
      { type: 'victory', winner, reason: '对方投降' },
    ];
    return {
      state: { ...state, winner, events: [...state.events, ...events] },
      events,
    };
  }
  const events: GameEvent[] = [];
  let queue = syncQueue(state.units, state.dyingQueue);
  // 濒死必须先处理：队列非空时只允许「处理队首」，避免玩家继续普通操作。
  if (queue.length > 0) {
    const must = findUnit(state.units, queue[0]);
    if (action.type !== 'rescue' || action.targetId !== queue[0]) {
      throw new Error(`必须先处理濒死单位：${must ? must.name : queue[0]}`);
    }
  }
  let units = state.units.map((u) => ({ ...u }));
  let victory = state.victory;
  let clock = state.clock;
  let attackedThisSmallTurn = state.attackedThisSmallTurn;

  if (action.type === 'attack') {
    const attacker = findUnit(units, action.attackerId);
    const target = findUnit(units, action.targetId);
    if (!attacker || !target) throw new Error('单位不存在');
    if (!isActive(attacker, clock.phase)) throw new Error('当前不是该角色的行动小回合');
    if (attacker.attackedThisBigTurn) throw new Error('该角色本大回合已攻击过（D10）');
    if (target.dead || target.invincible) throw new Error('目标不可被攻击');

    const dmg = attackDamage(attacker, target, clock);
    const hit = applyDamage(target, dmg, { clock, kind: 'attack' });
    events.push({ type: 'attack', attacker: attacker.id, target: target.id, damage: dmg, hpAfter: hit.target.hp });

    units = units.map((u) => {
      if (u.id === target.id) return { ...u, ...hit.target } as GameUnit;
      if (u.id === attacker.id) return { ...u, attackedThisBigTurn: true };
      return u;
    });

    // 反伤：取受击方当前攻击力（它刚刚受到的伤害不影响攻击力）
    if (target.hasReflect) {
      const back = reflectDamage({ ...target, ...hit.target } as Combatant, clock);
      if (back > 0) {
        const counter = applyDamage(findUnit(units, attacker.id)!, back, { clock, kind: 'reflect' });
        units = units.map((u) => (u.id === attacker.id ? { ...u, ...counter.target } as GameUnit : u));
        events.push({ type: 'reflect', attacker: target.id, target: attacker.id, damage: back, hpAfter: counter.target.hp });
      }
    }

    units = resolveDying(units, events);
    // 新规则：同一次攻击下双方都濒死时，被攻击者必须先处理，攻击者的濒死排在后面。
    queue = syncQueue(units, queue, [target.id, attacker.id]);
    attackedThisSmallTurn = true;
    victory = recordAttack(refreshVictory(units, victory), attacker.side);
  }

  if (action.type === 'rescue') {
    const target = findUnit(units, action.targetId);
    if (!target || target.dead) throw new Error('目标不存在或已死亡');
    if (target.hp > 0) throw new Error('该单位不是濒死状态，无需救援');
    const pool = units.filter((u) => !u.dead);
    const ops = judgeDying(target, pool);
    // 没人能救（无可救援者 / 名额用尽 / 扣血不够）时直接判死，不再抛错，
    // 否则界面上的「放弃救援」会被内核挡回。
    if (ops.outcome !== 'choice') {
      units = units.map((u) => (u.id === target.id ? { ...u, dead: true } : u));
      events.push({ type: 'death', unit: target.id });
      queue = syncQueue(units, queue.filter((id) => id !== target.id));
      victory = refreshVictory(units, victory);
    } else {
      const chosen: RescueOp | null = action.rescuerId === null
        ? null
        : ops.ops.find((o) => o.kind === 'ally' && o.rescuerId === action.rescuerId)
          ?? ops.ops.find((o) => o.kind === 'self' && action.rescuerId === target.id)
          ?? null;
      if (action.rescuerId !== null && !chosen) throw new Error('该救援者当前不可救援该单位');
      const result = applyRescue(target, pool, chosen);
      if (result.dead) {
        units = units.map((u) => (u.id === target.id ? { ...u, dead: true } : u));
        events.push({ type: 'death', unit: target.id });
      } else {
        units = units.map((u) => {
          if (u.id === target.id) return { ...u, ...result.target } as GameUnit;
          if (result.rescuer && u.id === result.rescuer.id) return { ...u, ...result.rescuer } as GameUnit;
          return u;
        });
        events.push({
          type: 'rescue',
          rescuer: chosen?.kind === 'self' ? target.id : action.rescuerId ?? '',
          target: target.id,
          cost: chosen?.kind === 'ally' ? chosen.cost : 0,
        });
      }
      // 救援者可能把自己扣到濒死（规则上已被 canRescue 拦住，这里只做兜底排队）。
      queue = syncQueue(units, queue.filter((id) => id !== target.id));
      victory = refreshVictory(units, victory);
    }
  }

  if (action.type === 'endTurn') {
    if (!attackedThisSmallTurn) {
      victory = endSmallTurnWithoutAttack(refreshVictory(units, victory));
    } else {
      victory = refreshVictory(units, victory);
    }
    const endedPhase = clock.phase;
    events.push({ type: 'smallTurnEnd', bigTurn: clock.bigTurn, phase: endedPhase });
    clock = endSmallTurn(clock);
    attackedThisSmallTurn = false;

    if (clock.phase === 'first') {
      events.push({ type: 'bigTurnEnd', bigTurn: clock.bigTurn - 1 });
      units = units.map((u) => ({ ...u, attackedThisBigTurn: false, damageTakenThisBigTurn: 0 }));
      if (hooks) hooks.emit('bigTurnEnd', makeEvent('bigTurnEnd'), { clock });
    } else if (hooks) {
      hooks.emit('smallTurnEnd', makeEvent('smallTurnEnd'), { clock });
    }
  }

  const result = checkVictory(victory);
  if (result.winner) {
    events.push({ type: 'victory', winner: result.winner, reason: result.reason ?? '' });
  }

  return {
    state: {
      clock,
      units,
      victory,
      events: [...state.events, ...events],
      winner: result.winner,
      dyingQueue: syncQueue(units, queue),
      attackedThisSmallTurn,
      itemBudget: state.itemBudget,
    },
    events,
  };
}

/** 合法的攻击目标：对方存活且未被无敌保护。 */
export function legalAttackTargets(state: GameState, attackerId: string): GameUnit[] {
  const attacker = findUnit(state.units, attackerId);
  if (!attacker) return [];
  return state.units.filter((u) => u.side !== attacker.side && !u.dead && !u.invincible);
}

export { otherSide };
