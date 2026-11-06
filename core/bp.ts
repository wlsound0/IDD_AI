// BP（选人）规则内核：状态机 + 校验，纯函数，不 import 数据文件。
//
// 规则来源：temp/extract/BP.md（8 步骨架 × 7 变体）+ temp/decisions.md 的 Q34/Q35(Q19)/Q36/Q37/Q38(Q17)/Q39。
// 这里只做「能选谁 / 选完进哪步」，界面负责把结果摆出来。

import type { Rarity } from './types';

export type PlayerKey = 'p1' | 'p2';
export type BpMode = 'single' | 'bo3' | 'bo5';

/** BP 每小局总预算（14k）。见 decisions.md Q12 / QA-01：每小局重置。 */
export const BP_BUDGET = 14000;
/** 单方总人数上限：首轮 2 + 次轮至多 3。 */
export const BP_MAX_PICKS = 5;
/** 单方限定角色上限（Q20：一局内某一方合计最多 2 个，且必不同名）。 */
export const BP_MAX_LIMITED = 2;

export interface BpCharacter {
  id: string;
  name: string;
  rarity: Rarity;
  /** 选角费用（1k = 1000）。数据缺失时为 null，按 0 计入预算。 */
  cost: number | null;
}

/** 一个小局模板。字段含义见 temp/extract/BP.md §1.2 变体表。 */
export interface BpVariant {
  key: string;
  label: string;
  /** 第 1/2 步（第一次 BAN）每人数量。 */
  banFirstRound: 1 | 2;
  /** 第 5/6 步（第二次 BAN）每人数量。 */
  banSecondRound: 1 | 2;
  /** 第 3/4 步是否要求「两个不同」（Q38：标了 is 才要求）。 */
  distinctFirstPicks: boolean;
  /** 第 3/4 步的 pick 是否进入全局 BAN。 */
  entersGlobalBan: boolean;
}

const V = (
  key: string,
  label: string,
  banFirstRound: 1 | 2,
  banSecondRound: 1 | 2,
  distinctFirstPicks: boolean,
  entersGlobalBan: boolean,
): BpVariant => ({ key, label, banFirstRound, banSecondRound, distinctFirstPicks, entersGlobalBan });

export const BP_VARIANTS: Record<BpMode, BpVariant[]> = {
  single: [V('single', '一局一胜', 2, 2, false, false)],
  bo3: [
    V('bo3-1', '三局两胜 BO1', 2, 2, true, true),
    V('bo3-2', '三局两胜 BO2', 2, 1, true, true),
    V('bo3-3', '三局两胜 BO3', 1, 1, false, false),
  ],
  bo5: [
    V('bo5-1', '五局三胜 BO1', 2, 2, true, true),
    V('bo5-2', '五局三胜 BO2', 2, 1, true, true),
    V('bo5-3', '五局三胜 BO3', 1, 1, true, true),
    V('bo5-4', '五局三胜 BO4、5', 1, 1, false, false),
    V('bo5-5', '五局三胜 BO4、5', 1, 1, false, false),
  ],
};

export function variantsForMode(mode: BpMode): BpVariant[] {
  return BP_VARIANTS[mode];
}

/** 系列赛需要赢几局（一局一胜 1、三局两胜 2、五局三胜 3）。 */
export function seriesWinsNeeded(mode: BpMode): number {
  return mode === 'single' ? 1 : mode === 'bo3' ? 2 : 3;
}

export interface BpStep {
  index: number;
  /** 相对「本小局先手/后手」，不是玩家序号。 */
  actor: 'first' | 'second';
  action: 'ban' | 'pick';
  count: number;
  atMost: boolean;
  distinct: boolean;
  entersGlobalBan: boolean;
}

/** 8 步骨架：ban → pick → ban → pick。 */
export function roundSteps(variant: BpVariant): BpStep[] {
  const mk = (
    index: number,
    actor: 'first' | 'second',
    action: 'ban' | 'pick',
    count: number,
    atMost = false,
    distinct = false,
    entersGlobalBan = false,
  ): BpStep => ({ index, actor, action, count, atMost, distinct, entersGlobalBan });
  return [
    mk(0, 'first', 'ban', variant.banFirstRound),
    mk(1, 'second', 'ban', variant.banFirstRound),
    mk(2, 'first', 'pick', 2, false, variant.distinctFirstPicks, variant.entersGlobalBan),
    mk(3, 'second', 'pick', 2, false, variant.distinctFirstPicks, variant.entersGlobalBan),
    mk(4, 'first', 'ban', variant.banSecondRound),
    mk(5, 'second', 'ban', variant.banSecondRound),
    mk(6, 'first', 'pick', 3, true),
    mk(7, 'second', 'pick', 3, true),
  ];
}

export interface BpPlayer {
  key: PlayerKey;
  /** 按选择顺序记录角色名；同名会重复出现（普通同名最多 2 个）。 */
  picks: string[];
  /** 本小局直接 BAN 的名字（只作用于对方）。 */
  bans: string[];
  /** 系列赛全局 BAN（私有，只约束自己），跨小局累积。 */
  globalBans: string[];
  /** 已花费用。 */
  spent: number;
}

export interface BpLogEntry {
  round: number;
  step: number;
  player: PlayerKey;
  action: 'ban' | 'pick';
  name: string;
}

export interface BpState {
  mode: BpMode;
  roundIndex: number;
  variant: BpVariant;
  /** 本小局先手玩家：第 1 小局 p1，之后逐小局轮换（Q34）。 */
  firstPlayer: PlayerKey;
  /** 0..7；等于 8 表示 BP 结束。 */
  stepIndex: number;
  /** 当前步已提交的名字。 */
  stepChars: string[];
  players: Record<PlayerKey, BpPlayer>;
  finished: boolean;
  log: BpLogEntry[];
}

export interface CreateBpOptions {
  mode: BpMode;
  roundIndex?: number;
  firstPlayer?: PlayerKey;
  globalBans?: Partial<Record<PlayerKey, string[]>>;
}

const emptyPlayer = (key: PlayerKey, globalBans: string[] = []): BpPlayer => ({
  key,
  picks: [],
  bans: [],
  globalBans: globalBans.slice(),
  spent: 0,
});

export function createBp(opts: CreateBpOptions): BpState {
  const roundIndex = opts.roundIndex ?? 0;
  const variants = variantsForMode(opts.mode);
  const variant = variants[roundIndex];
  if (!variant) throw new Error(`赛制 ${opts.mode} 没有第 ${roundIndex + 1} 小局`);
  const firstPlayer = opts.firstPlayer ?? (roundIndex % 2 === 0 ? 'p1' : 'p2');
  const carry = opts.globalBans ?? {};
  return {
    mode: opts.mode,
    roundIndex,
    variant,
    firstPlayer,
    stepIndex: 0,
    stepChars: [],
    players: {
      p1: emptyPlayer('p1', carry.p1),
      p2: emptyPlayer('p2', carry.p2),
    },
    finished: false,
    log: [],
  };
}

export function currentStep(state: BpState): BpStep | null {
  if (state.finished) return null;
  return roundSteps(state.variant)[state.stepIndex] ?? null;
}

export const otherPlayer = (key: PlayerKey): PlayerKey => (key === 'p1' ? 'p2' : 'p1');

/** 当前步由哪个玩家行动。 */
export function stepActor(state: BpState): PlayerKey {
  const step = currentStep(state);
  if (!step) throw new Error('BP 已结束，没有行动方');
  return step.actor === 'first' ? state.firstPlayer : otherPlayer(state.firstPlayer);
}

/** 本小局的「先手方/后手方」分别是谁。 */
export function sidePlayers(state: BpState): { first: PlayerKey; second: PlayerKey } {
  return { first: state.firstPlayer, second: otherPlayer(state.firstPlayer) };
}

const isLimited = (r: Rarity) => r === 'limited' || r === 'legend';
const sameNameLimit = (r: Rarity) => (r === 'normal' ? 2 : 1);

function findChar(catalog: BpCharacter[], name: string): BpCharacter | null {
  for (const c of catalog) if (c.name === name) return c;
  return null;
}

function countName(names: string[], name: string): number {
  let n = 0;
  for (const x of names) if (x === name) n += 1;
  return n;
}

/** 本小局已被任意一方直接 BAN 的名字。 */
export function bannedNamesThisRound(state: BpState): string[] {
  return [...state.players.p1.bans, ...state.players.p2.bans];
}

export interface BpChoices {
  player: PlayerKey;
  action: 'ban' | 'pick';
  /** 本步还能提交几个。 */
  remaining: number;
  chars: BpCharacter[];
  /** 仅 atMost 步为 true：可以提前结束本轮选择（允许 0–3 人，Q35/Q19）。 */
  canEndStep: boolean;
}

/** 某个玩家不能选某个名字的原因；可选时返回 null。界面用它做置灰提示。 */
export function blockReason(
  state: BpState,
  player: PlayerKey,
  action: 'ban' | 'pick',
  ch: BpCharacter,
  catalog: BpCharacter[],
): string | null {
  const step = currentStep(state);
  if (!step) return 'BP 已结束';
  if (action === 'ban') {
    // 只禁止自己重复 BAN 同一个名字；对方已 BAN 的名字仍然可以 BAN（用户 2026-11-06 明确）。
    if (state.players[player].bans.includes(ch.name)) return '自己本局已 BAN 过该角色';
    return null;
  }
  const me = state.players[player];
  const foe = state.players[otherPlayer(player)];
  if (foe.bans.includes(ch.name)) return '被对方 BAN';
  if (me.globalBans.includes(ch.name)) return '自己全局 BAN 中';
  if (step.distinct && state.stepChars.includes(ch.name)) return '本步要求两个不同角色';
  const same = countName(me.picks, ch.name);
  if (same >= sameNameLimit(ch.rarity)) return '同名角色上限';
  if (isLimited(ch.rarity)) {
    const limited = me.picks.filter((n) => {
      const c = findChar(catalog, n);
      return c ? isLimited(c.rarity) : false;
    }).length;
    if (limited >= BP_MAX_LIMITED) return '限定角色已达 2 个';
  }
  if (me.picks.length >= BP_MAX_PICKS) return '人数已满 5 人';
  if (me.spent + (ch.cost ?? 0) > BP_BUDGET) return '预算不足 14k';
  return null;
}

export function legalBpChoices(state: BpState, catalog: BpCharacter[]): BpChoices | null {
  const step = currentStep(state);
  if (!step) return null;
  const player = stepActor(state);
  const chars = catalog.filter((ch) => blockReason(state, player, step.action, ch, catalog) === null);
  return {
    player,
    action: step.action,
    remaining: step.count - state.stepChars.length,
    chars,
    canEndStep: step.atMost && !state.finished,
  };
}

function finalizeStep(state: BpState, player: PlayerKey, step: BpStep): BpState {
  const players = { ...state.players };
  if (step.action === 'pick' && step.entersGlobalBan && state.stepChars.length > 0) {
    const p = players[player];
    const merged = p.globalBans.slice();
    for (const name of state.stepChars) if (!merged.includes(name)) merged.push(name);
    players[player] = { ...p, globalBans: merged };
  }
  const next = state.stepIndex + 1;
  return {
    ...state,
    players,
    stepIndex: next,
    stepChars: [],
    finished: next >= roundSteps(state.variant).length,
  };
}

export type BpAction =
  | { type: 'ban'; charId: string }
  | { type: 'pick'; charId: string }
  | { type: 'endStep' };

export function applyBp(state: BpState, action: BpAction, catalog: BpCharacter[]): BpState {
  if (state.finished) throw new Error('BP 已结束');
  const step = currentStep(state);
  if (!step) throw new Error('BP 已结束');
  const player = stepActor(state);

  if (action.type === 'endStep') {
    if (!step.atMost) throw new Error(`本步必须选满 ${step.count} 个`);
    return finalizeStep(state, player, step);
  }

  if (step.action !== action.type) {
    throw new Error(step.action === 'ban' ? '当前是 BAN 阶段' : '当前是选人阶段');
  }
  if (step.atMost && state.stepChars.length >= step.count) {
    throw new Error('本步已选满');
  }

  const ch = catalog.find((c) => c.id === action.charId);
  if (!ch) throw new Error('角色不存在：' + action.charId);
  const reason = blockReason(state, player, step.action, ch, catalog);
  if (reason) throw new Error(reason);

  const players = { ...state.players };
  const me = players[player];
  let nextStepChars: string[];
  if (step.action === 'ban') {
    players[player] = { ...me, bans: [...me.bans, ch.name] };
    nextStepChars = [...state.stepChars, ch.name];
  } else {
    players[player] = { ...me, picks: [...me.picks, ch.name], spent: me.spent + (ch.cost ?? 0) };
    nextStepChars = [...state.stepChars, ch.name];
  }
  const log: BpLogEntry[] = [
    ...state.log,
    { round: state.roundIndex + 1, step: step.index + 1, player, action: step.action, name: ch.name },
  ];
  const next: BpState = { ...state, players, stepChars: nextStepChars, log };
  if (nextStepChars.length >= step.count) return finalizeStep(next, player, step);
  return next;
}

/** 剩余预算按 1:2 折算成道具花费（decisions.md Q12 / Q21）。 */
export function toItemBudget(leftover: number): number {
  return Math.max(0, leftover) * 2;
}

/**
 * 认负：任意时刻结束本小局 BP（未选满也算结束），由调用方再把对手记为小局胜者。
 * 已经选出的角色照常保留（含已计入的全局 BAN）。
 */
export function forfeitBp(state: BpState): BpState {
  if (state.finished) return state;
  return { ...state, finished: true };
}

export interface BpSeries {
  mode: BpMode;
  /** 当前小局序号（0 起）。 */
  roundIndex: number;
  wins: Record<PlayerKey, number>;
  /** 跨小局累积的私有全局 BAN。 */
  globalBans: Record<PlayerKey, string[]>;
  current: BpState;
  champion: PlayerKey | null;
}

export function createSeries(mode: BpMode): BpSeries {
  return {
    mode,
    roundIndex: 0,
    wins: { p1: 0, p2: 0 },
    globalBans: { p1: [], p2: [] },
    current: createBp({ mode, roundIndex: 0 }),
    champion: null,
  };
}

/** 记录一小局胜者；达到胜局数即产生冠军。必须在 BP 结束后调用。 */
export function recordRoundWinner(series: BpSeries, winner: PlayerKey): BpSeries {
  if (series.champion) throw new Error('系列赛已结束');
  if (!series.current.finished) throw new Error('BP 尚未结束，不能记录小局结果');
  const wins = { ...series.wins, [winner]: series.wins[winner] + 1 };
  const globalBans = {
    p1: mergeBans(series.globalBans.p1, series.current.players.p1.globalBans),
    p2: mergeBans(series.globalBans.p2, series.current.players.p2.globalBans),
  };
  const champion = wins[winner] >= seriesWinsNeeded(series.mode) ? winner : null;
  return { ...series, wins, globalBans, champion };
}

/** 进入下一小局：先手逐局轮换、携带全局 BAN、预算重置。 */
export function advanceSeries(series: BpSeries): BpSeries {
  if (series.champion) throw new Error('系列赛已结束');
  if (!series.current.finished) throw new Error('BP 尚未结束，不能进入下一小局');
  const roundIndex = series.roundIndex + 1;
  return {
    ...series,
    roundIndex,
    current: createBp({
      mode: series.mode,
      roundIndex,
      firstPlayer: roundIndex % 2 === 0 ? 'p1' : 'p2',
      globalBans: series.globalBans,
    }),
  };
}

function mergeBans(a: string[], b: string[]): string[] {
  const out = a.slice();
  for (const x of b) if (!out.includes(x)) out.push(x);
  return out;
}
