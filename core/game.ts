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
import { applyRescue, judgeDying, withRescueStatuses, type RescueTarget, type Rescuer, type RescueOp } from './rescue';
import { checkVictory, createVictoryState, endSmallTurnWithoutAttack, recordAttack, type VictoryState } from './victory';
import type { Side } from './types';
import type { EffectUnit, OwnedItem, UnitSkill } from './effects';
import { applyOp, runBranch, runEffect, selectBranch, type DeferredOp, type EffectBranch, type EffectContext, type OpSpec } from './effects';
import { canUseSkill, computeCanAttack, evalCondition, fire } from './trigger';
import { flagValue, hasFlag, isExpired, outgoingAdjust, purgeExpired } from './status';
import type { EffectsIndex } from './units';
import { canPay, consumeItemDiscounts, itemLocked, itemPrice, pay } from './items';

export type GameUnit = EffectUnit &
  RescueTarget &
  Rescuer & {
    /** 受击时是否对攻击者造成反伤（Q&A：反伤取受击方当前攻击力）。 */
    hasReflect?: boolean;
    /** 上个大回合是否攻击过（园丁「守护」重获护盾用）。 */
    attackedLastBigTurn?: boolean;
    /** 上个大回合用过的技能名（玛恩纳「未宽解的悲哀」用）。 */
    lastUsedSkills?: string[];
    /** 召唤物归属（记者幻影死亡触发）。 */
    ownerId?: string;
  };

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
  /** P7-2（X5）/ P7-3：伤害前反应窗口开启（界面遮罩用）。kind='attack' 为攻击宣告，'damage' 为技能伤害。 */
  | { type: 'interruptPending'; kind: 'attack' | 'damage'; target: string; attacker?: string }
  /** P7-3：使用反应技能（役鸟守护），免疫本次伤害。 */
  | { type: 'interruptSkill'; unit: string; skill: string; target: string }
  /** P7-2（X5）：受击方使用打断道具，本次受到的伤害按 factor 折算。 */
  | { type: 'attackInterrupted'; unit: string; item: string; factor: number }
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
  /** 初始道具资源（BP 剩余预算按 1:2 折算），只在开局读取一次。 */
  itemBudget: Record<Side, number>;
  /** P6（QA-02）：每方独立的每回合资源 k；开局 = itemBudget + 3k（P6-Q9），每大回合开始再 +3k。 */
  k: Record<Side, number>;
  /** P5-16②：延迟结算队列（己方回合结束 / 下个己方回合开始）。 */
  pending?: DeferredOp[];
  /**
   * P7-2 第 4 步（X5）/ P7-3：伤害前反应窗口。攻击宣告或技能伤害结算前挂起，
   * 等受击方决定是否用「魔术棒」（仅攻击）或反应技能（役鸟守护，任意伤害）。
   * 非空时除 interruptWithItem / interruptWithSkill / resolveInterrupt / resign 外的动作一律拒绝。
   */
  pendingInterrupt?: {
    kind: 'attack' | 'damage';
    targetId: string;
    attackerId?: string;
    /** 关窗后从同一起点重放的动作；`offered` 记录本动作里已经问过反应的目标，重放时跳过。 */
    resume: Action;
  };
  /** P5：道具效果表（由调用方注入，见 core/units.ts 的 indexEffects）。 */
  effects?: EffectsIndex;
}

export type Action =
  | { type: 'attack'; attackerId: string; targetId: string; damageFactor?: number; offered?: string[] }
  | { type: 'rescue'; targetId: string; rescuerId: string | null; useFlyer?: boolean }
  /** P5：主动发动技能（索引对应 unit.skills）。 */
  | {
      type: 'useSkill';
      unitId: string;
      skillIndex: number;
      targetId?: string;
      variant?: string;
      itemId?: string;
      offered?: string[];
    }
  /** P5：使用道具（索引对应 unit.items）。P7-2 X6：抉择式道具用 variant 选分支。 */
  | { type: 'useItem'; unitId: string; itemIndex: number; targetId?: string; variant?: string; offered?: string[] }
  /** P5-16④：记者主动令自己的幻影死亡。 */
  | { type: 'destroySummon'; unitId: string; summonId: string }
  /** P5-16⑥：入殓师在己方回合转移附容返生标记。 */
  | { type: 'transferMark'; unitId: string; fromId: string; toId: string }
  | { type: 'resign'; side: Side }
  /** P7-2（X5）：关闭反应窗口、按原样结算。 */
  | { type: 'resolveInterrupt' }
  /** P7-2（X5）：受击方使用「魔术棒」打断，本次攻击伤害按道具效果折算（仅 kind='attack'）。 */
  | { type: 'interruptWithItem'; unitId: string; itemIndex: number }
  /** P7-3：使用反应技能（役鸟守护），免疫本次伤害；unitId 为技能持有者。 */
  | { type: 'interruptWithSkill'; unitId: string; skillIndex: number }
  | { type: 'endTurn'; offered?: string[] };

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

const otherSide = (s: Side): Side => (s === 'first' ? 'second' : 'first');

export function createGame(
  units: (Omit<GameUnit, 'dead' | 'attackedThisBigTurn'> & Partial<GameUnit>)[],
  setup?: { itemBudget?: Partial<Record<Side, number>>; effects?: EffectsIndex },
): GameState {
  // P5：旧调用方不传 statuses/items/skills，这里统一补默认值，避免每个测试手写。
  const full: GameUnit[] = units.map((u) => ({
    ...u,
    tempHp: u.tempHp ?? 0,
    statuses: u.statuses ?? [],
    items: (u.items ?? []) as OwnedItem[],
    skills: (u.skills ?? []) as UnitSkill[],
    isSummon: u.isSummon ?? false,
    dead: false,
    attackedThisBigTurn: false,
    damageTakenThisBigTurn: 0,
    maxHp: u.maxHp ?? u.hp,
    initialMaxHp: u.initialMaxHp ?? u.maxHp ?? u.hp,
  })) as GameUnit[];
  const clock = createClock();
  // P5 收尾：常驻被动里的「静态授予」只在开局结算一次（救援能力、免死标记、反伤修正等）。
  applyAlwaysPassives(full, clock);
  // P7：带 condition 的常驻被动要按条件重算（复仇者、胆怯、格列佛游记）。
  syncAuras(full, clock);
  const events: GameEvent[] = [{ type: 'battleStart' }];
  // 战吼统一在开局结算，先于第一回合（R04）。
  const cry = fire(full, {
    trigger: 'battlecry',
    clock,
    createSummon: (owner, unit, tags) => buildSummon(owner, unit, tags, full, full.length),
  });
  events.push(...(cry.events as GameEvent[]));
  // P5-26：与手动效果同条目的「战吼部分」在开局结算（入殓师开局即持有附容返生）。
  for (const u of full) {
    for (const s of u.skills) {
      const ops = s.effect?.battlecryOps;
      if (!ops?.length) continue;
      runEffect({ units: full, clock, sourceId: u.id, targetId: u.id, events }, { ops });
    }
  }
  return {
    clock,
    units: full,
    victory: createVictoryState(aliveCount(full), computeCanAttack(full, clock)),
    events,
    winner: null,
    dyingQueue: [],
    attackedThisSmallTurn: false,
    itemBudget: {
      first: setup?.itemBudget?.first ?? 0,
      second: setup?.itemBudget?.second ?? 0,
    },
    // P6-Q9（2026-11-15 裁决）：首轮资源 = BP 折算值 + 3k；之后每个大回合开始仍各 +3k。
    k: {
      first: (setup?.itemBudget?.first ?? 0) + 3000,
      second: (setup?.itemBudget?.second ?? 0) + 3000,
    },
    effects: setup?.effects,
  };
}

function aliveCount(units: GameUnit[]): Record<Side, number> {
  const alive = { first: 0, second: 0 };
  for (const u of units) if (!u.dead) alive[u.side] += 1;
  return alive;
}

/**
 * P7-2 X1：召唤物的每回合掉血被动（记者幻影：2 血、每回合 -1，正常情况下会自然死亡）。
 * 用一条普通 ownTurnStart 技能表达，这样掉血走 dealDamage、判死走 resolveDying，
 * 不需要在回合流程里单开一条「衰减」分支。
 */
function makeDecaySkill(
  owner: GameUnit,
  spec: { name: string; decay?: number },
  seq: number,
): UnitSkill {
  return {
    def: {
      name: `${spec.name}消减`,
      type: 'passive',
      text: '每个大回合开始时血量 -1',
      cost: null,
      durability: null,
      cd: null,
      initialCd: null,
    },
    effect: {
      id: `${owner.side}:summon:${seq}/decay`,
      character: spec.name,
      name: `${spec.name}消减`,
      type: 'passive',
      impl: 'full',
      manual: false,
      // 用 ownTurnStart（只在自己一方的小回合开始触发），而不是 turnStart（每个小回合都触发，
      // 会让一个大回合扣两次）。
      trigger: 'ownTurnStart',
      ops: [{ op: 'damage', ref: 'self', amount: spec.decay ?? 1 }],
    },
    cdCounter: 0,
    charge: 0,
    durability: null,
    usedPerGame: 0,
    usedThisBigTurn: 0,
  };
}

/** 生成一个召唤物（Q24：占位不占阵容、可被攻击、不可被救援）。 */
function buildSummon(
  owner: GameUnit,
  spec: { name: string; atk: number; hp: number; durability?: number; decay?: number },
  tags: string[] | undefined,
  units: GameUnit[],
  seq: number,
): GameUnit {
  const slot = Math.max(0, ...units.filter((u) => u.side === owner.side).map((u) => u.slot)) + 1;
  return {
    id: `${owner.side}:summon:${seq}`,
    name: spec.name,
    side: owner.side,
    slot,
    atk: spec.atk,
    hp: spec.hp,
    maxHp: spec.hp,
    initialMaxHp: spec.hp,
    durability: spec.durability ?? null,
    tempHp: 0,
    statuses: [],
    items: [],
    // P7-2 X1：召唤物的持续掉血就是一条普通的 ownTurnStart 被动，交给统一的 fire 调度；
    // 扣到 0 后由 settleDamage → resolveDying 判死，和被打死走同一条通道（含 summonDeath 反应）。
    skills: spec.decay ? [makeDecaySkill(owner, spec, seq)] : [],
    attackedThisBigTurn: false,
    damageTakenThisBigTurn: 0,
    dead: false,
    isSummon: true,
    hasRescue: false,
    hasReflect: false,
    ownerId: owner.id,
    rescueLimit: tags?.includes('rescuable') ? 1 : 0,
  };
}
/** 常驻被动（trigger=always）里可以「一次授予、永久生效」的 op。 */
const STATIC_OPS = new Set(['grantRescue', 'flag', 'reflectMod', 'shield', 'immune', 'untargetable', 'invulnerable', 'selfRescue', 'rescueRule']);
/** 与触发时机无关、开局一次性授予的能力 op（记者「观测视角」的主动销毁、入殓师的标记转移、飞行家的免伤救援）。 */
const CAPABILITY_OPS = new Set(['grantDestroySummon', 'grantTransferMark', 'grantRescueFlyer']);

function applyAlwaysPassives(units: GameUnit[], clock: TurnClock): void {
  for (const u of units) {
    for (const s of u.skills) {
      const e = s.effect;
      if (!e || e.manual) continue;
      if (s.durability !== null && s.durability <= 0) continue;
      if (e.trigger === 'always') {
        // P7：带 condition 的常驻被动交给 syncAuras 动态重算，这里不再一次性授予。
        if (e.condition?.length) continue;
        const ctx: EffectContext = { units, clock, sourceId: u.id, events: [], unsupported: [] };
        for (const op of e.ops) {
          if (op.when) continue;
          if (!STATIC_OPS.has(op.op)) continue;
          applyOp(op, ctx, op.duration ?? e.duration);
        }
      }
      // 能力授予不依赖触发时机（观测视角的 trigger 是 summonDeath）。
      for (const op of e.ops) {
        if (!CAPABILITY_OPS.has(op.op)) continue;
        applyOp(op, { units, clock, sourceId: u.id, events: [], unsupported: [] }, op.duration ?? e.duration);
      }
    }
  }
}

const AURA_SOURCE = 'aura:';

/**
 * P7：动态条件被动。`trigger:"always"` 且带 `condition` 的技能不再只在开局结算一次：
 * 每次状态变化后按当前场上情况重算。授予的状态统一用 `source="aura:<unitId>"` 标记，
 * 重算前先整批清除，保证幂等（复仇者 血<3 攻+2 / 胆怯 每个受伤队友攻-1 / 格列佛游记 有队友才无敌）。
 */
export function syncAuras(units: GameUnit[], clock: TurnClock): void {
  for (const u of units) {
    if (!u.statuses.some((s) => s.source.startsWith(AURA_SOURCE))) continue;
    u.statuses = u.statuses.filter((s) => !s.source.startsWith(AURA_SOURCE));
  }
  for (const u of units) {
    if (u.dead) continue;
    for (const s of u.skills) {
      const e = s.effect;
      if (!e || e.manual || e.trigger !== 'always') continue;
      // 条件型（带 condition）与计数型（modStatPer）才需要每次重算。
      if (!e.condition?.length && !e.ops.some((op) => op.op === 'modStatPer')) continue;
      if (s.durability !== null && s.durability <= 0) continue;
      if ((e.condition ?? []).length && !(e.condition ?? []).every((c) => evalCondition(c, u, undefined, units, clock, s))) continue;
      const ctx: EffectContext = { units, clock, sourceId: u.id, events: [], unsupported: [] };
      const before = u.statuses.length;
      for (const op of e.ops) {
        if (op.when) continue;
        // 只跑纯加成型 op；hp/maxHp 这类实体修改不能反复施加。
        if (!STATIC_OPS.has(op.op) && op.op !== 'modStatPer' && !(op.op === 'modStat' && op.stat === 'atk')) continue;
        applyOp(op, ctx, op.duration ?? 'permanent');
      }
      // 给本次新加的状态打上光环标记，下一次重算时整批清除。
      for (let i = before; i < u.statuses.length; i += 1) u.statuses[i].source = `${AURA_SOURCE}${u.id}`;
    }
  }
}

const findUnit = (units: GameUnit[], id: string) => units.find((u) => u.id === id);
const isActive = (u: GameUnit, phase: Side) => u.side === phase && !u.dead && u.hp > 0;

/**
 * 击球手「爆发」：若该技能处于 CD 状态，自身攻击力 -1（P5-16⑥）。
 * 数据用 `{op:'atkPenaltyOnCd', skill, amount}` 声明，这里按技能自己的 cd 判定。
 * P5-33 裁决：从未使用过的技能不算「处于 CD」（撤销 P5-25），首回合不减攻。
 */
function cdPenaltyOf(unit: GameUnit): number {
  let total = 0;
  for (const s of unit.skills) {
    if (s.usedPerGame <= 0) continue;
    const e = s.effect as { ops?: OpSpec[]; branches?: { ops?: OpSpec[] }[] } | undefined;
    if (!e) continue;
    const ops = [...(e.ops ?? []), ...((e.branches ?? []).flatMap((b) => b.ops ?? []))];
    for (const op of ops) {
      if (op.op !== 'atkPenaltyOnCd') continue;
      const cd = s.def.type === 'cooldown' ? s.def.cd ?? 0 : 0;
      if (s.cdCounter < cd) total += typeof op.amount === 'number' ? op.amount : 1;
    }
  }
  return total;
}

/** 刷新胜负输入（存活数 / 是否还有进攻手段）。 */
function refreshVictory(units: GameUnit[], victory: VictoryState, clock: TurnClock): VictoryState {
  return { ...victory, alive: aliveCount(units), canAttack: computeCanAttack(units, clock) };
}

/**
 * P6 套索（QA-25）：目标身上有 holdDying，且施加者仍存活时，目标保持濒死、不判死、也不进濒死队列。
 */
function heldDyingBy(u: GameUnit, units: GameUnit[]): boolean {
  const flag = u.statuses.find((s) => s.kind === 'flag' && s.key === 'holdDying');
  if (!flag) return false;
  const source = units.find((x) => x.id === flag.source);
  return Boolean(source && !source.dead);
}

/** P6 坚强：带 damageToMark 的单位进入濒死时，清空对应标记。 */
function clearDamageMarks(u: GameUnit): void {
  const keys = u.statuses
    .filter((s) => s.kind === 'flag' && s.key.startsWith('damageToMark:'))
    .map((s) => s.key.slice('damageToMark:'.length));
  if (!keys.length) return;
  u.statuses = u.statuses.filter((s) => !(s.kind === 'mark' && keys.includes(s.key)));
}

/**
 * P7 E：小女孩「记忆同步」的结束条件——被附身角色的临时血量扣完时，
 * 移除附身标记与同一次附身授予的无上限免疫（免疫的 source 固定为 `possession:<自己 id>`）。
 */
function settlePossession(units: GameUnit[], events: GameEvent[]): void {
  for (const u of units) {
    const flags = u.statuses.filter((s) => s.kind === 'flag' && s.key.startsWith('possession:'));
    if (!flags.length) continue;
    const valid: string[] = [];
    for (const f of flags) {
      const targetId = f.key.slice('possession:'.length);
      const target = findUnit(units, targetId);
      if (target && !target.dead && target.tempHp > 0) {
        valid.push(f.key);
        continue;
      }
      events.push({ type: 'possessionEnd', unit: u.id, target: targetId } as unknown as GameEvent);
    }
    if (valid.length === flags.length) continue;
    const validKeys = new Set(valid);
    u.statuses = u.statuses.filter(
      (s) =>
        !(s.kind === 'flag' && s.key.startsWith('possession:') && !validKeys.has(s.key))
        && !(valid.length === 0 && s.source === `possession:${u.id}`),
    );
  }
}

/**
 * P7 E2：野人「野性伙伴」的结束条件——临时血量扣完时，撤掉同组的状态（攻击力 +1 / 不反伤）。
 * 组标记由数据里的 `op.group` 写入，状态统一带 `group` 字段，按组整批移除。
 */
function settleTempHpGroups(units: GameUnit[], events: GameEvent[]): void {
  for (const u of units) {
    if (u.tempHp > 0 || u.dead) continue;
    const groups = new Set(
      u.statuses.map((s) => s.group).filter((g): g is string => Boolean(g && g.startsWith('tempHp:'))),
    );
    if (!groups.size) continue;
    u.statuses = u.statuses.filter((s) => !(s.group && groups.has(s.group)));
    events.push({ type: 'tempHpBuffEnd', unit: u.id } as unknown as GameEvent);
  }
}

/**
 * 结算濒死：D01 立即判定。
 * 单场闭环里默认所有玩家放弃救援（P3 接入界面后再由玩家选择）。
 */
function resolveDying(units: GameUnit[], events: GameEvent[], clock: TurnClock): GameUnit[] {
  let next = units;
  for (const u of next) {
    if (u.dead || u.hp > 0) continue;
    clearDamageMarks(u);
    // P6 套索：被套索压住的濒死单位暂不判死，等牛仔下个己方回合开始自动救援。
    if (heldDyingBy(u, next)) {
      events.push({ type: 'heldDying', unit: u.id } as unknown as GameEvent);
      continue;
    }
    events.push({ type: 'dying', unit: u.id });
    const judgement = judgeDying(withRescueStatuses(u), next.filter((x) => !x.dead).map(withRescueStatuses));
    if (judgement.outcome === 'dead') {
      next = next.map((x) => (x.id === u.id ? { ...x, dead: true } : x));
      events.push({ type: 'death', unit: u.id });
      // 召唤物的死法有很多种（被打死、掉血归零、主动销毁），统一在这里触发归属者的
      // 「观测视角」，避免每处结算各写一遍。
      if (u.isSummon && u.ownerId) {
        const owner = next.find((x) => x.id === u.ownerId);
        if (owner && !owner.dead) {
          const r = fire(next, { trigger: 'summonDeath', clock, sideFilter: owner.side });
          events.push(...(r.events as GameEvent[]));
          next = next.map((x) => {
            const after = (r as unknown as { units?: GameUnit[] }).units?.find((y) => y.id === x.id);
            return after ?? x;
          });
        }
      }
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
    const u = findUnit(units, id);
    if (u && heldDyingBy(u, units)) continue;
    if (!out.includes(id)) out.push(id);
  }
  for (const u of units) {
    if (!u.dead && u.hp <= 0 && !out.includes(u.id) && !heldDyingBy(u, units)) out.push(u.id);
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
  return judgeDying(withRescueStatuses(target), state.units.filter((u) => !u.dead).map(withRescueStatuses)).ops;
}

/** 排程 op 的条件（只实现数据里用到的两种）。 */
function scheduledCondOk(u: GameUnit, op: OpSpec): boolean {
  if (!op.if) return true;
  if (op.if === 'noAttackLastTurn') return !u.attackedLastBigTurn;
  if (op.if === 'gloryLastTurn') return (u.lastUsedSkills ?? []).includes('未照耀的荣光');
  return false;
}

/** P7-4：统一反应窗口挂起点（实现见 applyActionCore 里的 demandReaction）。 */
type ReactionGate = (targetId: string, kind: 'attack' | 'damage') => void;

/** 回合边界的排程 op（ownTurnStart / ownTurnEnd），只对当前行动方生效。 */
function runScheduled(
  units: GameUnit[],
  phase: Side,
  at: 'ownTurnStart' | 'ownTurnEnd',
  clock: TurnClock,
  events: GameEvent[],
  queued: DeferredOp[],
  gate?: ReactionGate,
): void {
  for (const u of units) {
    if (u.dead || u.side !== phase) continue;
    // 计算器解释器是原地改单位的；把数组换成可变副本，改动才能回到返回的 state 里。
    const live = [...units];
    for (const s of u.skills) {
      const e = s.effect;
      if (!e) continue;
      if (s.durability !== null && s.durability <= 0) continue;
      for (const op of e.ops) {
        if (op.when !== at) continue;
        if (!scheduledCondOk(u, op)) continue;
        // 用新对象承接，避免 applyOp 改到被冻结的原始单位上。
        const ctx: EffectContext = { units: live, clock, sourceId: u.id, events, pending: queued, reactionGate: gate };
        applyOp(op, ctx, op.duration ?? e.duration);
      }
    }
    for (let i = 0; i < units.length; i += 1) units[i] = live[i];
  }
}

/** 结算延迟队列里满足条件的一组效果。 */
function flushPending(
  list: DeferredOp[],
  keep: (p: DeferredOp) => boolean,
  units: GameUnit[],
  clock: TurnClock,
  events: GameEvent[],
  queued: DeferredOp[],
  gate?: ReactionGate,
): DeferredOp[] {
  const rest: DeferredOp[] = [];
  for (const p of list) {
    if (!keep(p)) {
      rest.push(p);
      continue;
    }
    const ctx: EffectContext = {
      units,
      clock,
      sourceId: p.sourceId,
      targetId: p.targetId,
      events,
      pending: queued,
      reactionGate: gate,
    };
    for (const op of p.ops) applyOp(op, ctx, op.duration ?? p.duration);
  }
  return rest;
}

/**
 * P6 Q4（QA-15/16）：在「己方回合结束」结算被延迟的致命伤害。
 * 到点后走完整伤害流程（护盾可减、可判濒死），与首次命中时是否消耗护盾无关。
 */
function settleDeferredDamage(units: GameUnit[], side: Side, clock: TurnClock, events: GameEvent[], gate?: ReactionGate): GameUnit[] {
  let out = units;
  const now = { bigTurn: clock.bigTurn, phase: side, at: 'end' as const };
  for (let guard = 0; guard < 10; guard++) {
    const victim = out.find(
      (u) =>
        !u.dead &&
        u.side === side &&
        u.statuses.some((s) => s.kind === 'flag' && s.key === 'deferredDamage' && s.expiresAt !== null && isExpired(s, now)),
    );
    if (!victim) break;
    const marks = victim.statuses.filter(
      (s) => s.kind === 'flag' && s.key === 'deferredDamage' && s.expiresAt !== null && isExpired(s, now),
    );
    let unit = { ...victim, statuses: victim.statuses.filter((s) => !marks.includes(s)) };
    for (const m of marks) {
      // P7-4：延迟到此刻的致命伤害同样先过反应窗口。
      gate?.(unit.id, 'damage');
      const r = applyDamage(unit, m.value, { clock, kind: 'effect', ignoreDefer: true });
      unit = { ...unit, ...r.target } as GameUnit;
      events.push({ type: 'damage', target: unit.id, amount: m.value, applied: r.applied, hpAfter: unit.hp } as unknown as GameEvent);
    }
    out = out.map((u) => (u.id === unit.id ? unit : u));
  }
  return out;
}

/** P6 巧手匠心（QA-12/13）：把「转给施放者的溢出伤害」无来源伤害结清（可被护盾减免）。 */
function settleTransfers(units: GameUnit[], clock: TurnClock, events: GameEvent[], gate?: ReactionGate): GameUnit[] {
  let out = units;
  for (let guard = 0; guard < 20; guard++) {
    const holder = out.find((u) => u.statuses.some((s) => s.kind === 'flag' && s.key.startsWith('transferPending:')));
    if (!holder) break;
    const status = holder.statuses.find((s) => s.kind === 'flag' && s.key.startsWith('transferPending:'))!;
    const toId = status.key.slice('transferPending:'.length);
    out = out.map((u) => (u.id === holder.id ? { ...u, statuses: u.statuses.filter((s) => s.id !== status.id) } : u));
    const to = out.find((u) => u.id === toId);
    if (!to || to.dead) continue;
    // P7-4：无来源的转移伤害也先过反应窗口。
    gate?.(to.id, 'damage');
    const r = applyDamage(to, status.value, { clock, kind: 'effect', ignoreDefer: true });
    const updated = { ...to, ...r.target } as GameUnit;
    out = out.map((u) => (u.id === to.id ? updated : u));
    events.push({ type: 'damage', target: to.id, amount: status.value, applied: r.applied, hpAfter: updated.hp } as unknown as GameEvent);
    if (updated.hp <= 0) events.push({ type: 'dying', unit: updated.id } as GameEvent);
  }
  return out;
}

/** 伤害结算后统一判濒死：先结清转移伤害，再判濒死。 */
function settleDamage(units: GameUnit[], clock: TurnClock, events: GameEvent[], gate?: ReactionGate): GameUnit[] {
  return resolveDying(settleTransfers(units, clock, events, gate), events, clock);
}

/**
 * P5-9 充能速率（R05）：大回合开始时结算一次。
 * 首回合不充能（`x/y` 的 x 即开局层数），之后每 `chargeRate.turns` 个大回合 +`amount` 层，封顶 `chargeMax`。
 * `chargeOn` 事件驱动的技能（猿猴咒像）不在此处充能。
 */
export function chargeOnBigTurnStart(units: GameUnit[], clock: TurnClock): GameUnit[] {
  if (clock.phase !== 'first' || clock.bigTurn < 2) return units;
  return units.map((u) => {
    if (!u.skills.some((s) => s.def.type === 'charge' && !s.def.chargeOn)) return u;
    return {
      ...u,
      skills: u.skills.map((s) => {
        if (s.def.type !== 'charge' || s.def.chargeOn) return s;
        const rate = s.def.chargeRate;
        const turns = rate?.turns ?? 1;
        const amount = rate?.amount ?? 1;
        if (turns <= 0 || (clock.bigTurn - 2) % turns !== 0) return s;
        const max = s.def.chargeMax ?? Infinity;
        const charge = Math.min(max, s.charge + amount);
        return charge === s.charge ? s : { ...s, charge };
      }),
    };
  });
}

/**
 * P5-9 受击充能（猿猴咒像）：自己及相邻的两个角色每受到一次伤害 +1 层，封顶 `chargeMax`。
 * 以 `damageTakenThisBigTurn` 的增量为准（所有伤害都经 applyDamage），一次动作结算一次。
 */
function chargeFromDamage(units: GameUnit[], before: GameUnit[]): GameUnit[] {
  const prev = new Map(before.map((u) => [u.id, u.damageTakenThisBigTurn ?? 0]));
  const hits = units.filter((u) => (u.damageTakenThisBigTurn ?? 0) - (prev.get(u.id) ?? 0) > 0);
  if (!hits.length) return units;
  return units.map((u) => {
    if (u.dead || typeof u.slot !== 'number') return u;
    const taken = hits.filter((h) => h.side === u.side && typeof h.slot === 'number' && Math.abs(h.slot - u.slot) <= 1).length;
    if (!taken) return u;
    let touched = false;
    const skills = u.skills.map((s) => {
      if (s.def.type !== 'charge' || s.def.chargeOn !== 'selfOrAdjacentDamage') return s;
      const max = s.def.chargeMax ?? Infinity;
      const charge = Math.min(max, s.charge + taken);
      if (charge === s.charge) return s;
      touched = true;
      return { ...s, charge };
    });
    return touched ? { ...u, skills } : u;
  });
}

/**
 * P7 C：受击触发（trigger:"damaged"）。
 * 以 `damageTakenThisBigTurn` 的增量为准，覆盖所有走 applyDamage 的伤害（攻击/技能/反伤/无来源）。
 * 近似说明：本函数在濒死判死之后才执行，故「受伤致死」的那一下不会触发；见 temp/decisions.md P7-C1。
 */
function fireDamageReactors(
  units: GameUnit[],
  before: GameUnit[],
  clock: TurnClock,
  events: GameEvent[],
  /** P7-2 X3/X4：`damage` = 走 applyDamage 的受击（原口径），`hpLoss` = 任何通道的本体血量减少。 */
  mode: 'damage' | 'hpLoss' = 'damage',
): void {
  const read = (u: GameUnit) => (mode === 'hpLoss' ? u.hpLostThisBigTurn ?? 0 : u.damageTakenThisBigTurn ?? 0);
  const prev = new Map(before.map((u) => [u.id, read(u)]));
  const hitIds = units.filter((u) => !u.dead && read(u) - (prev.get(u.id) ?? 0) > 0).map((u) => u.id);
  for (const id of hitIds) {
    const r = fire(units, { trigger: 'damaged', clock, onlyUnitId: id });
    events.push(...(r.events as GameEvent[]));
  }
}

/**
 * P7-2 X6：清掉「攻击后 / 被攻击后」失效的状态（八音盒的两种增益）。
 * 例外：状态来源单位带 `bayinheBuffPersist`（舞女「二重奏」）时不删——八音盒用在自己身上时增益不消失。
 */
function clearConsumedStatuses(units: GameUnit[], unitId: string, on: 'attack' | 'attacked'): GameUnit[] {
  const persist = (sourceId: string) => units.some((u) => u.id === sourceId && !u.dead && hasFlag(u.statuses ?? [], 'bayinheBuffPersist'));
  return units.map((u) => {
    if (u.id !== unitId) return u;
    const statuses = u.statuses ?? [];
    if (!statuses.some((s) => s.consumedOn === on && !persist(s.source))) return u;
    return { ...u, statuses: statuses.filter((s) => s.consumedOn !== on || persist(s.source)) } as GameUnit;
  });
}

/**
 * P7-4：伤害前反应窗口的内部控制流哨兵。任一伤害通道发现「受击方还有可用反应」就抛它，
 * 由 applyAction 外层接住转成 pendingInterrupt；抛出的那次结算整体丢弃（units 已深拷贝）。
 */
class ReactionWindowSignal extends Error {
  constructor(
    readonly targetId: string,
    readonly kind: 'attack' | 'damage',
    readonly attackerId?: string,
  ) {
    super('reaction-window');
    this.name = 'ReactionWindowSignal';
  }
}

/** 本动作里已经问过反应的目标（同一动作内同一目标只开一次窗；多处伤害按目标逐个开窗）。 */
function offeredTargets(action: Action): string[] {
  return (action as { offered?: string[] }).offered ?? [];
}

export function applyAction(
  state: GameState,
  action: Action,
  hooks?: HookRegistry,
): ApplyResult {
  try {
    return applyActionCore(state, action, hooks);
  } catch (err) {
    if (!(err instanceof ReactionWindowSignal)) throw err;
    const resume: Action = { ...action, offered: [...offeredTargets(action), err.targetId] } as Action;
    const pendingEvent: GameEvent = {
      type: 'interruptPending',
      kind: err.kind,
      target: err.targetId,
      ...(err.attackerId ? { attacker: err.attackerId } : {}),
    };
    return {
      state: {
        ...state,
        pendingInterrupt: { kind: err.kind, targetId: err.targetId, attackerId: err.attackerId, resume },
        events: [...state.events, pendingEvent],
      },
      events: [pendingEvent],
    };
  }
}

function applyActionCore(
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
  // P7-2（X5）/ P7-3 反应窗口：窗口存在时只接受「反应」或「不打断」，避免绕过窗口。
  if (action.type === 'resolveInterrupt' || action.type === 'interruptWithItem' || action.type === 'interruptWithSkill') {
    const win = state.pendingInterrupt;
    if (!win) throw new Error('当前没有待处理的反应窗口');
    const base: GameState = { ...state, pendingInterrupt: undefined };
    if (action.type === 'resolveInterrupt') return applyAction(base, win.resume, hooks);
    if (action.type === 'interruptWithItem') {
      if (win.kind !== 'attack') throw new Error('只有被攻击时才能使用魔术棒');
      const used = useInterruptItem(base, win, action.unitId, action.itemIndex);
      // P7-4：延续 resume（含 offered 记录），只把折算系数换成道具给出的值。
      const resume: Action =
        win.resume.type === 'attack'
          ? { ...win.resume, damageFactor: used.factor }
          : { type: 'attack', attackerId: win.attackerId!, targetId: win.targetId, damageFactor: used.factor, offered: [win.targetId] };
      return applyAction(used.state, resume, hooks);
    }
    const reacted = useReactionSkill(base, win, action.unitId, action.skillIndex);
    return applyAction(reacted.state, win.resume, hooks);
  }
  if (state.pendingInterrupt) throw new Error('请先处理反应窗口（使用反应技能/道具或选择不打断）');
  let queue = syncQueue(state.units, state.dyingQueue);
  // 濒死必须先处理：队列非空时只允许「处理队首」，避免玩家继续普通操作。
  if (queue.length > 0) {
    const must = findUnit(state.units, queue[0]);
    if (action.type !== 'rescue' || action.targetId !== queue[0]) {
      throw new Error(`必须先处理濒死单位：${must ? must.name : queue[0]}`);
    }
  }
  // P7-4：深拷贝到 statuses/items/skills 一层——反应窗口哨兵抛出时整份结算会被丢弃，
  // 不能让半成品状态（已扣的充能、已花掉的道具）泄漏回 state。
  let units = state.units.map((u) => ({
    ...u,
    statuses: (u.statuses ?? []).map((s) => ({ ...s })),
    items: (u.items ?? []).map((it) => ({ ...it })),
    skills: (u.skills ?? []).map((s) => ({ ...s })),
  }));
  // P7-4：所有伤害通道共用的反应窗口挂起点。已问过的目标跳过；有可用反应就中断本次结算。
  const offered = new Set<string>(offeredTargets(action));
  const demandReaction = (targetId: string, kind: 'attack' | 'damage', attackerId?: string): void => {
    if (offered.has(targetId)) return;
    const victim = findUnit(units, targetId);
    if (!victim || victim.dead) return;
    const open = collectReactions(units, state.effects, victim, kind);
    if (open.items.length > 0 || open.skills.length > 0) {
      offered.add(targetId);
      throw new ReactionWindowSignal(targetId, kind, attackerId);
    }
  };
  let victory = state.victory;
  let clock = state.clock;
  let attackedThisSmallTurn = state.attackedThisSmallTurn;
  let k = state.k;
  let summonSeq = 0;
  const queued: DeferredOp[] = [];
  let pending = state.pending ?? [];
  // P7-4 收尾：回合结束钩子延迟到整个动作结算成功之后才 emit。若中途抛反应窗口哨兵，
  // 这次结算整体丢弃，钩子也不能先响一次（否则重放时同一回合会 emit 两次）。
  let turnEndHook: 'bigTurnEnd' | 'smallTurnEnd' | undefined;

  if (action.type === 'attack') {
    const attacker = findUnit(units, action.attackerId);
    const target = findUnit(units, action.targetId);
    if (!attacker || !target) throw new Error('单位不存在');
    if (!isActive(attacker, clock.phase)) throw new Error('当前不是该角色的行动小回合');
    if (hasFlag(attacker.statuses, 'cannotAttack') || hasFlag(attacker.statuses, 'restrictAttack')) {
      throw new Error('该角色无法攻击');
    }
    if (hasFlag(attacker.statuses, 'unliberated') && !hasFlag(attacker.statuses, 'liberated')) {
      throw new Error('尚未解放，无法攻击');
    }
    if (hasFlag(target.statuses, 'invulnerable') || target.invincible) throw new Error('目标不可被攻击');
    // P5：extraAttack 状态允许突破「每大回合一次」的限制；
    // 第一次攻击只置位，不消耗次数；第二次起每打一次消耗一次。
    const wasAttacked = attacker.attackedThisBigTurn;
    const extraIdx = attacker.statuses.findIndex((s) => s.kind === 'extraAttack' && s.value > 0);
    if (wasAttacked && extraIdx < 0) throw new Error('该角色本大回合已攻击过（D10）');
    const consumeExtra = wasAttacked && extraIdx >= 0;

    // P7-4：统一反应窗口——攻击也走 demandReaction（不再在这里单独预开），
    // 有反应就抛哨兵，由 applyAction 外层挂起窗口；resume 带着 offered 回来时这里直接放行。
    demandReaction(target.id, 'attack', attacker.id);

    // P5-28：受击前结算「首次伤害免疫」类被动（飞行家「悬停」）；免疫状态由 applyDamage 消费。
    const pre = fire(units, { trigger: 'beforeDamage', clock, sideFilter: target.side, onlyUnitId: target.id });
    if (pre.events.length) events.push(...(pre.events as GameEvent[]));

    // 击球手「爆发」的 CD 惩罚（P5-16⑥）在攻击伤害上扣。
    const rawDmg = Math.max(0, attackDamage(attacker, target, clock) - cdPenaltyOf(attacker));
    // P7-2（X5）：魔术棒「伤害减半（向下取整）」在最终伤害上折算。
    const dmg = Math.max(Math.floor(rawDmg * (action.damageFactor ?? 1)), flagValue(attacker.statuses, 'minDamage'));
    const hit = applyDamage(target, dmg, { clock, kind: 'attack' });
    // P6 坚强：伤害转标记时不产生伤害事件。
    events.push({ type: 'attack', attacker: attacker.id, target: target.id, damage: hit.converted || hit.lethalDeferred ? 0 : dmg, hpAfter: hit.target.hp } as unknown as GameEvent);
    if (hit.converted) events.push({ type: 'markGained', unit: target.id, amount: hit.converted } as unknown as GameEvent);
    if (hit.lethalDeferred) events.push({ type: 'damageDeferred', unit: target.id, amount: hit.lethalDeferred } as unknown as GameEvent);

    units = units.map((u) => {
      if (u.id === target.id) return { ...u, ...hit.target } as GameUnit;
      if (u.id === attacker.id) {
        const next = { ...u, attackedThisBigTurn: true };
        if (consumeExtra) {
          const statuses = next.statuses.slice();
          const s = statuses[extraIdx];
          if (s.value <= 1) statuses.splice(extraIdx, 1);
          else statuses[extraIdx] = { ...s, value: s.value - 1 };
          next.statuses = statuses;
        }
        return next;
      }
      return u;
    });

    // 藏锋「扫式」/ 击球手「爆发」：本次攻击命中后，使被攻击者攻击力 -N，持续一回合（P5-16⑥）。
    const atkDown = flagValue(attacker.statuses, 'atkDownOnHit');
    const stillTarget = units.find((u) => u.id === target.id);
    if (atkDown > 0 && stillTarget && !stillTarget.dead) {
      applyOp(
        { op: 'modStat', ref: 'target', stat: 'atk', delta: -atkDown, duration: 'turns:1' },
        { units, clock, sourceId: attacker.id, targetId: target.id, events },
        'turns:1',
      );
    }

    // 玛恩纳「未照耀的荣光」：解放期间攻击时，对被攻击者相邻的两个角色各造成 2 点伤害。
    const splash = flagValue(attacker.statuses, 'splash');
    if (splash > 0) {
      // 逐击衰减与伤害下限同样作用于溅射。
      const splashDmg = Math.max(flagValue(attacker.statuses, 'minDamage'), splash + outgoingAdjust(attacker.statuses));
      for (const u of units.filter((x) => !x.dead && x.side === target.side && Math.abs(x.slot - target.slot) === 1)) {
        // P7-4：溅射伤害也是「将要受到伤害」，同样先过反应窗口。
        demandReaction(u.id, 'damage', attacker.id);
        const sHit = applyDamage(u, splashDmg, { clock, kind: 'skill' });
        units = units.map((x) => (x.id === u.id ? ({ ...x, ...sHit.target } as GameUnit) : x));
        events.push(
          sHit.converted
            ? ({ type: 'markGained', unit: u.id, amount: sHit.converted } as unknown as GameEvent)
            : ({ type: 'damage', target: u.id, amount: sHit.applied, hpAfter: sHit.target.hp } as unknown as GameEvent),
        );
      }
    }

    // 玛恩纳「未照耀的荣光」：每攻击一次，本回合后续造成的所有伤害再 -1（累加）。
    if (hasFlag(attacker.statuses, 'rampDownArm')) {
      applyOp(
        { op: 'flag', ref: 'self', key: 'rampDown', value: 1 },
        { units, clock, sourceId: attacker.id, events },
        'untilOwnTurnEnd',
      );
    }

    // 召唤物被攻击致死后的「观测视角」反应统一走 resolveDying（见该函数），这里不再特判。

    // 反伤：取受击方当前攻击力（它刚刚受到的伤害不影响攻击力）
    if (target.hasReflect && !hasFlag(attacker.statuses, 'noReflect')) {
      const tb = { ...target, ...hit.target } as GameUnit;
      let back = reflectDamage(tb as Combatant, clock);
      // 反伤修正与「旧伤」的不反伤特例（P5 收尾）。
      back = Math.max(0, back + flagValue(tb.statuses, 'reflect'));
      if (hasFlag(tb.statuses, 'noReflectVsHp1') && attacker.hp === 1) back = 0;
      if (back > 0) {
        // P7-4：反伤是「出手方将要受到伤害」——统一挂起点，役鸟在这里获得询问机会。
        demandReaction(attacker.id, 'damage', target.id);
        const counter = applyDamage(findUnit(units, attacker.id)!, back, { clock, kind: 'reflect' });
        units = units.map((u) => (u.id === attacker.id ? { ...u, ...counter.target } as GameUnit : u));
        events.push({ type: 'reflect', attacker: target.id, target: attacker.id, damage: counter.converted ? 0 : back, hpAfter: counter.target.hp });
        if (counter.converted) events.push({ type: 'markGained', unit: attacker.id, amount: counter.converted } as unknown as GameEvent);
      }
    }

    // P5-24：藏锋「扫式」这类 nextAttack 效果，本次攻击结算完即失效（只作用于「下次攻击」）。
    // P7-2 X6：八音盒的「攻击后 +1」「被攻击后 -1」同机位清除（舞女二重奏的保留标记除外）。
    units = clearConsumedStatuses(units, attacker.id, 'attack');
    units = clearConsumedStatuses(units, target.id, 'attacked');

    units = settleDamage(units, clock, events, demandReaction);
    // 攻击后触发（作曲家「组曲」、画家「艺术敏感」）：只让出手者自己触发。
    const attackTriggers = fire(units, {
      trigger: 'afterAttack',
      clock,
      sideFilter: attacker.side,
      onlyUnitId: attacker.id,
      attackerId: attacker.id,
      victimId: target.id,
    });
    events.push(...(attackTriggers.events as GameEvent[]));
    // P7 C：同一技能条目里的「攻击后部分」（冒险家「探险幻想」：攻击后攻击力改为2）。
    // 与 afterAttack 同口径：只属于出手者，封印/耐久耗尽时不结算。
    const attackerNow = units.find((u) => u.id === attacker.id);
    if (attackerNow && !attackerNow.dead && !hasFlag(attackerNow.statuses, 'sealed')) {
      for (const s of attackerNow.skills) {
        const postOps = s.effect?.afterAttackOps;
        if (!postOps?.length) continue;
        if (s.effect?.manual) continue;
        if (s.durability !== null && s.durability <= 0) continue;
        runEffect(
          { units, clock, sourceId: attacker.id, targetId: target.id, attackerId: attacker.id, victimId: target.id, events },
          { ops: postOps, duration: s.effect?.duration },
        );
      }
    }
    // 新规则：同一次攻击下双方都濒死时，被攻击者必须先处理，攻击者的濒死排在后面。
    queue = syncQueue(units, queue, [target.id, attacker.id]);
    attackedThisSmallTurn = true;
    victory = recordAttack(refreshVictory(units, victory, clock), attacker.side);
  }

  // P5：技能/道具的公共收尾（伤害后判濒死、刷新胜负、记录进攻方）。
  const settleEffect = (actor: GameUnit, offensive: boolean) => {
    units = settleDamage(units, clock, events, demandReaction);
    queue = syncQueue(units, queue);
    victory = refreshVictory(units, victory, clock);
    if (offensive) {
      attackedThisSmallTurn = true;
      victory = recordAttack(victory, actor.side);
    }
  };

  const createSummon = (owner: GameUnit, unit: { name: string; atk: number; hp: number; durability?: number }, tags?: string[]): GameUnit =>
    buildSummon(owner, unit, tags, units, summonSeq++);

  // P5-16④：记者主动令幻影死亡（不触发「受攻击致死」的观测视角加成）。
  if (action.type === 'destroySummon') {
    const owner = findUnit(units, action.unitId);
    const summon = findUnit(units, action.summonId);
    if (!owner || !summon) throw new Error('单位不存在');
    if (!isActive(owner, clock.phase)) throw new Error('当前不是该角色的行动小回合');
    if (!owner.canDestroySummon) throw new Error('该角色没有「主动使幻影死亡」的能力');
    if (!summon.isSummon || summon.ownerId !== owner.id) throw new Error('目标不是该角色的召唤物');
    if (summon.dead) throw new Error('该召唤物已死亡');
    units = units.map((u) => (u.id === summon.id ? { ...u, dead: true, hp: 0 } : u));
    events.push({ type: 'death', unit: summon.id });
    // P5-17 裁决（2026-11-07）：主动销毁也触发「观测视角」的临时血量。
    const destroyed = fire(units, { trigger: 'summonDeath', clock, sideFilter: owner.side });
    events.push(...(destroyed.events as GameEvent[]));
    victory = refreshVictory(units, victory, clock);
  }

  // P5-16⑥：入殓师在己方回合无限次转移「附容返生」标记（免费动作，不占技能使用）。
  if (action.type === 'transferMark') {
    const owner = findUnit(units, action.unitId);
    const from = findUnit(units, action.fromId);
    const to = findUnit(units, action.toId);
    if (!owner || !from || !to) throw new Error('单位不存在');
    if (!isActive(owner, clock.phase)) throw new Error('当前不是该角色的行动小回合');
    if (!owner.canTransferMark) throw new Error('该角色没有「转移标记」的能力');
    if (from.dead || to.dead) throw new Error('目标已死亡');
    if (from.side !== owner.side || to.side !== owner.side) throw new Error('只能在己方角色之间转移');
    if (from.id === to.id) throw new Error('标记转移的目标不能是原持有者');
    const MARK = 'furongfansheng';
    const idx = from.statuses.findIndex((s) => s.kind === 'mark' && s.key === MARK);
    if (idx < 0) throw new Error('该角色没有可转移的标记');
    const moved = from.statuses[idx];
    units = units.map((u) => {
      if (u.id === from.id) return { ...u, statuses: u.statuses.filter((_, i) => i !== idx) };
      if (u.id === to.id) {
        return {
          ...u,
          // 「友方场上最多一个」：转移时先清掉别人身上的同名标记。
          statuses: [...u.statuses.filter((s) => !(s.kind === 'mark' && s.key === MARK)), { ...moved, source: owner.id }],
        };
      }
      return u;
    });
    events.push({ type: 'markTransfer', from: from.id, to: to.id, key: MARK } as unknown as GameEvent);
    victory = refreshVictory(units, victory, clock);
  }

  if (action.type === 'useSkill') {
    const unit = findUnit(units, action.unitId);
    if (!unit) throw new Error('单位不存在');
    const skill = unit.skills[action.skillIndex];
    if (!skill) throw new Error('技能不存在');
    // P7 E2-4：安抚物等「任意阶段」技能不受行动小回合限制（含对方回合）。
    if (!skill.effect?.anyPhase && !isActive(unit, clock.phase)) throw new Error('当前不是该角色的行动小回合');
    const reason = canUseSkill(unit, skill, clock);
    if (reason) throw new Error(reason);
    const effect = skill.effect;
    if (!effect) throw new Error('该技能暂无效果数据（见 temp/p5-skill-audit.md）');
    // P7-3：反应技能（役鸟守护）不是主动技能，只能从反应窗口使用。
    if (effect.reaction) throw new Error('该技能只能在反应窗口使用（角色将要受到伤害时）');
    // P5-15：有 branches 的技能必须先选分支；分支可覆盖目标与时长。
    const branch = selectBranch(effect, action.variant, clock);
    // P7 D：分支级次数上限与 k 花费在内核拒绝（不依赖数据自觉）。
    const branchIndex = branch ? (effect.branches ?? []).indexOf(branch) : -1;
    const branchReason = canUseSkill(unit, skill, clock, branch?.cost, branch ?? undefined, branchIndex >= 0 ? branchIndex : undefined);
    if (branchReason) throw new Error(branchReason);
    const kCost = branch?.kCost ?? 0;
    if (kCost > 0 && k[unit.side] < kCost) throw new Error(`资源不足（${k[unit.side]}/${kCost}）`);
    const ops = branch ? branch.ops : effect.ops;
    const targetSpec = branch?.target ?? effect.target;
    const needTarget = targetSpec && targetSpec.mode !== 'self' && targetSpec.mode !== 'none';
    if (needTarget && !action.targetId && !targetSpec!.optional) throw new Error('该技能需要指定目标');
    // P6-Q10：技能「指定一个道具」——道具属于玩家，候选 = 己方所有角色道具栏里的道具 id（去重）。
    const needsItem = ops.some((o) => o.item === '$chosen');
    if (needsItem) {
      const owned = new Set(
        units.filter((u) => u.side === unit.side && !u.dead).flatMap((u) => u.items.map((i) => i.itemId)),
      );
      if (!action.itemId) throw new Error('该技能需要指定一个道具');
      if (!owned.has(action.itemId)) throw new Error('该道具不在己方道具栏中');
    }
    // 目标过滤（P5-23）：已实现 atkNotZero / excludeSelf / wounded；其余键一律报错，不静默放行。
    const picked = action.targetId ? findUnit(units, action.targetId) : undefined;
    const filterSpec = (targetSpec?.filter ?? {}) as Record<string, boolean>;
    const KNOWN_TARGET_FILTERS = ['atkNotZero', 'excludeSelf', 'wounded'];
    for (const key of Object.keys(filterSpec)) {
      if (!KNOWN_TARGET_FILTERS.includes(key)) throw new Error(`未实现的目标过滤条件：${key}`);
    }
    if (picked) {
      if (filterSpec.atkNotZero && picked.atk === 0) throw new Error('目标攻击力为 0，不可被指定');
      if (filterSpec.excludeSelf && picked.id === unit.id) throw new Error('该技能不能以自己为目标');
      if (filterSpec.wounded && picked.hp >= picked.maxHp) throw new Error('目标未受伤，不可被指定');
    }
    // P5-26：入殓 = 转移附容返生（上限 = 战场上己方入殓师数量；同一角色不能持有两个）。
    if (effect.id === 'rulianshi/入殓' && picked) {
      const MARK = 'furongfansheng';
      const hasMark = (x: GameUnit) => x.statuses.some((s) => s.kind === 'mark' && s.key === MARK);
      if (hasMark(picked)) throw new Error('该角色已有附容返生标记');
      const ownSide = units.filter((u) => !u.dead && u.side === unit.side);
      const embalmers = ownSide.filter((u) => u.skills.some((s) => s.def.name === '入殓')).length;
      const holders = ownSide.filter(hasMark);
      if (holders.length >= embalmers) {
        // 先撤后上：优先撤施放者自己身上的（战吼那个），否则撤最早持有者的。
        const donor = holders.find((u) => u.id === unit.id) ?? holders[0];
        units = units.map((u) =>
          u.id === donor.id ? ({ ...u, statuses: u.statuses.filter((s) => !(s.kind === 'mark' && s.key === MARK)) } as GameUnit) : u,
        );
      }
    }
    const ctx: EffectContext = {
      units,
      clock,
      sourceId: unit.id,
      targetId: action.targetId,
      itemId: action.itemId,
      events,
      createSummon,
      pending: queued,
      // P7-4：技能伤害走统一反应窗口（每个受伤目标各问一次）。
      reactionGate: demandReaction,
    };
    // 支付代价（R05/R06）：充能按层扣（分支可覆盖），耐久按次扣。
    // P5-36：技能伤害前也触发一次 `beforeDamage`（悬停等免伤被动）。
    ctx.beforeDamage = (victim: GameUnit) => {
      const r = fire(units, { trigger: 'beforeDamage', clock, sideFilter: victim.side, onlyUnitId: victim.id });
      if (r.events.length) events.push(...(r.events as GameEvent[]));
    };
    if (skill.def.type === 'charge') {
      const need = branch?.cost ?? skill.def.cost ?? 0;
      if (skill.charge < need) throw new Error(`充能不足（${skill.charge}/${need}）`);
      skill.charge = Math.max(0, skill.charge - need);
    }
    // P5-35：耐久按分支/技能声明的消耗扣；分支可覆盖（藏锋转式 1、扫式 3）。
    const durCost = branch?.durability ?? effect.cost?.durability;
    if (durCost !== undefined) {
      if (skill.durability !== null && skill.durability < durCost) throw new Error(`耐久度不足（${skill.durability}/${durCost}）`);
      skill.durability = (skill.durability ?? 0) - durCost;
    } else if (skill.def.type === 'active' && skill.durability !== null) skill.durability -= 1;
    // P7 D：分支级 k 花费（线路控制升级分支 1k = 1000），校验已在前面完成，这里只扣。
    if (kCost > 0) k = { ...k, [unit.side]: k[unit.side] - kCost };
    // P7 E2：时长随使用次数变化（野性伙伴：首次 turns:2，之后 turns:1）。
    const useDuration = effect.durationByUse
      ? (skill.usedPerGame === 0 ? effect.durationByUse.first : effect.durationByUse.later)
      : effect.duration;
    if (branch) runBranch(ctx, { duration: useDuration }, branch);
    else runEffect(ctx, { ops: effect.ops, duration: useDuration });
    if (branch && branchIndex >= 0) {
      if (!skill.branchUses) skill.branchUses = [];
      skill.branchUses[branchIndex] = (skill.branchUses[branchIndex] ?? 0) + 1;
    }
    skill.usedPerGame += 1;
    skill.usedThisBigTurn += 1;
    skill.cdCounter = 0;
    const offensive = ops.some((o) => o.op === 'damage' || (o.op === 'modStat' && (o.delta ?? 0) < 0));
    settleEffect(unit, offensive);
  }

  if (action.type === 'useItem') {
    const unit = findUnit(units, action.unitId);
    if (!unit) throw new Error('单位不存在');
    const owned = unit.items[action.itemIndex];
    if (!owned) throw new Error('道具不存在');
    if (!isActive(unit, clock.phase)) throw new Error('当前不是该角色的行动小回合');
    // P6-Q10：道具级锁定（玩具匣）——锁定的是「该道具」，不是该角色的整个道具栏。
    if (itemLocked(unit.statuses, owned.itemId)) throw new Error('本回合不可使用该道具');
    const catalog = state.effects?.items.get(owned.itemId);
    const effect = catalog?.effect as {
      ops: { op: string }[];
      duration?: string;
      branches?: EffectBranch[];
      reaction?: string;
    } | undefined;
    if (!effect) throw new Error('该道具暂无效果数据');
    // P7-2（X5）：反应式道具只能在攻击宣告后的打断窗口里使用。
    if (effect.reaction === 'beforeAttack') {
      throw new Error('该道具只能在受到攻击时（打断窗口）使用');
    }
    // P6（QA-34）：画作在获取时绑定一个人名，使用时只能选该名下的 1 个角色。
    if (owned.nameKey) {
      const picked = action.targetId ? units.find((u) => u.id === action.targetId) : undefined;
      const label = catalog?.name ?? owned.itemId;
      if (!picked) throw new Error(`「${label}」只能用于「${owned.nameKey}」`);
      if (picked.name !== owned.nameKey) throw new Error(`「${label}」只能用于「${owned.nameKey}」`);
    }
    const price = itemPrice({ item: { id: owned.itemId, name: catalog?.name ?? owned.itemId, cost: catalog?.cost ?? null }, owned, statuses: unit.statuses });
    if (!canPay({ remaining: k }, unit.side, price)) throw new Error('道具资源不足');
    k = pay({ remaining: k }, unit.side, price).remaining;
    // P6（QA-33/36）：买完消费折扣——once 清除，turn 记本小回合已用。
    unit.statuses = consumeItemDiscounts(unit.statuses, owned.itemId, unit.id, clock);
    unit.items = unit.items.filter((_, i) => i !== action.itemIndex);
    const ctx: EffectContext = {
      units,
      clock,
      sourceId: unit.id,
      targetId: action.targetId,
      events,
      createSummon,
      pending: queued,
      // P7-4：道具伤害同样走统一反应窗口。
      reactionGate: demandReaction,
    };
    // P7-2 X6：抉择式道具（八音盒）——必须选分支，按分支 ops 结算。
    const branch = selectBranch(effect, action.variant, clock);
    if (branch) runBranch(ctx, { duration: effect.duration }, branch);
    else runEffect(ctx, effect as never);
    // P7 C：使用道具后的反应（空军「精准打击」：用信号枪后 atk-1/hp+1 并封技能；
    // 舞女「二重奏」：用八音盒后 hp+1）。条件键 itemUsed 由 fire 传给 evalCondition。
    const itemReaction = fire(units, {
      trigger: 'itemUse',
      clock,
      sideFilter: unit.side,
      onlyUnitId: unit.id,
      targetId: action.targetId,
      itemUsed: owned.itemId,
    });
    events.push(...(itemReaction.events as GameEvent[]));
    const offensive = (branch?.ops ?? effect.ops).some((o) => o.op === 'damage' || o.op === 'sealSkills');
    settleEffect(unit, offensive);
  }

  if (action.type === 'rescue') {
    const target = withRescueStatuses(findUnit(units, action.targetId)!);
    if (!target || target.dead) throw new Error('目标不存在或已死亡');
    if (target.hp > 0) throw new Error('该单位不是濒死状态，无需救援');
    let pool = units.filter((u) => !u.dead).map(withRescueStatuses);
    const ops = judgeDying(target, pool);
    // 飞行家「救援」：可选消耗一个飞行器，使本次救援不扣血（P5-16⑥）。
    let flyerOp: RescueOp | null = null;
    if (action.useFlyer) {
      const rescuer = findUnit(units, action.rescuerId ?? '');
      if (!rescuer) throw new Error('未指定救援者');
      if (!rescuer.canRescueByFlyer || !rescuer.hasRescue) throw new Error('该角色没有「消耗飞行器免伤救援」的能力');
      const flyer = rescuer.skills.find((s) => s.def.name === '飞行器' && (s.durability ?? 0) > 0);
      if (!flyer) throw new Error('没有可消耗的飞行器');
      flyer.durability = (flyer.durability ?? 0) - 1;
      flyerOp = { kind: 'ally', rescuerId: rescuer.id, cost: 0, useBodyOnly: false };
    }
    // 没人能救（无可救援者 / 名额用尽 / 扣血不够）时直接判死，不再抛错，
    // 否则界面上的「放弃救援」会被内核挡回。
    if (ops.outcome !== 'choice' && !flyerOp) {
      units = units.map((u) => (u.id === target.id ? { ...u, dead: true } : u));
      events.push({ type: 'death', unit: target.id });
      queue = syncQueue(units, queue.filter((id) => id !== target.id));
      victory = refreshVictory(units, victory, clock);
    } else {
      const chosen: RescueOp | null = flyerOp ?? (action.rescuerId === null
        ? null
        : ops.ops.find((o) => o.kind === 'ally' && o.rescuerId === action.rescuerId)
          ?? ops.ops.find((o) => o.kind === 'self' && action.rescuerId === target.id)
          ?? null);
      if (action.rescuerId !== null && !chosen) throw new Error('该救援者当前不可救援该单位');
      // P7 E：救援扣血前触发一次 beforeDamage（木偶师「路易」：因救援导致时临时血量改为 2）。
      // 只对实际会扣本体/临时血的救援触发；自我救援与飞行器免费救援不触发。
      if (chosen && chosen.kind === 'ally' && chosen.cost > 0) {
        const rescuer = findUnit(units, chosen.rescuerId);
        const r = fire(units, {
          trigger: 'beforeDamage',
          clock,
          sideFilter: rescuer?.side,
          onlyUnitId: chosen.rescuerId,
          viaRescue: true,
        });
        events.push(...(r.events as GameEvent[]));
        // fire 已就地改写救援者，重新取池，让救援扣血按新的临时血量结算。
        pool = units.filter((u) => !u.dead).map(withRescueStatuses);
      }
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
        // P7 E2：救援后的被动（杂技演员「即兴演出」获得粘土弹；飞行家「救援」的能力授予）。
        const rescuerId = chosen?.kind === 'self' ? target.id : action.rescuerId;
        if (rescuerId) {
          const r = fire(units, { trigger: 'rescue', clock, onlyUnitId: rescuerId });
          events.push(...(r.events as GameEvent[]));
        }
      }
      // 救援者可能把自己扣到濒死（规则上已被 canRescue 拦住，这里只做兜底排队）。
      queue = syncQueue(units, queue.filter((id) => id !== target.id));
      victory = refreshVictory(units, victory, clock);
    }
  }

  if (action.type === 'endTurn') {
    if (!attackedThisSmallTurn) {
      victory = endSmallTurnWithoutAttack(refreshVictory(units, victory, clock));
    } else {
      victory = refreshVictory(units, victory, clock);
    }
    const endedPhase = clock.phase;
    // 结束时的技能触发：己方回合结束 / 对方回合结束；大回合结束再加「回合结束时」。
    for (const t of ['ownTurnEnd', 'enemyTurnEnd'] as const) {
      const r = fire(units, {
        trigger: t,
        clock,
        sideFilter: t === 'ownTurnEnd' ? endedPhase : otherSide(endedPhase),
        reactionGate: demandReaction,
      });
      events.push(...(r.events as GameEvent[]));
    }
    if (endedPhase === 'second') {
      const r = fire(units, { trigger: 'turnEnd', clock, reactionGate: demandReaction });
      events.push(...(r.events as GameEvent[]));
    }
    // P5-16②：己方回合结束的排程与延迟结算。
    runScheduled(units, endedPhase, 'ownTurnEnd', clock, events, queued, demandReaction);
    pending = flushPending(
      pending,
      (p) => p.side === endedPhase && p.when === 'ownTurnEnd',
      units, clock, events, queued, demandReaction,
    );
    units = settleDeferredDamage(units, endedPhase, clock, events, demandReaction);
    units = settleDamage(units, clock, events, demandReaction);
    queue = syncQueue(units, queue);
    events.push({ type: 'smallTurnEnd', bigTurn: clock.bigTurn, phase: endedPhase });
    clock = endSmallTurn(clock);
    attackedThisSmallTurn = false;

    // 进入新的小回合：清到期状态 → 大回合开始时充能（R05/P5-9）→ 回合开始类触发。
    const now = { bigTurn: clock.bigTurn, phase: clock.phase, at: 'start' as const };
    units = units.map((u) => {
      // P7-E2-2 裁决：临时血量也受「持续」约束——授予凭据到期时只扣回这一份。
      const grant = u.statuses
        .filter((s) => s.kind === 'flag' && s.key === 'tempHpGrant' && isExpired(s, now))
        .reduce((sum, s) => sum + s.value, 0);
      const tempHp = grant > 0 ? Math.max(0, u.tempHp - grant) : u.tempHp;
      return { ...u, tempHp, statuses: purgeExpired(u.statuses, now) };
    });
    units = chargeOnBigTurnStart(units, clock);
    const startAll = fire(units, { trigger: 'turnStart', clock });
    events.push(...(startAll.events as GameEvent[]));
    const ownStart = fire(units, { trigger: 'ownTurnStart', clock, sideFilter: clock.phase });
    events.push(...(ownStart.events as GameEvent[]));
    // P5-16①③：进入己方回合后的排程（守护重获护盾、未宽解的悲哀解放、下个回合开始的延迟）。
    runScheduled(units, clock.phase, 'ownTurnStart', clock, events, queued, demandReaction);
    pending = flushPending(
      pending,
      (p) => p.side === clock.phase && p.when === 'nextOwnTurnStart',
      units, clock, events, queued, demandReaction,
    );
    units = settleDamage(units, clock, events, demandReaction);
    queue = syncQueue(units, queue);
    const enemyStart = fire(units, { trigger: 'enemyTurnStart', clock, sideFilter: otherSide(clock.phase) });
    events.push(...(enemyStart.events as GameEvent[]));

    if (clock.phase === 'first') {
      events.push({ type: 'bigTurnEnd', bigTurn: clock.bigTurn - 1 });
      // P6（QA-02）：每个大回合开始，双方资源各 +3k（即 3000）；首个大回合为开局初值，不另加。
      k = { first: k.first + 3000, second: k.second + 3000 };
      units = units.map((u) => ({
        ...u,
        attackedLastBigTurn: u.attackedThisBigTurn,
        lastUsedSkills: u.skills.filter((s) => s.usedThisBigTurn > 0).map((s) => s.def.name),
        attackedThisBigTurn: false,
        damageTakenThisBigTurn: 0,
        hpLostThisBigTurn: 0,
      }));
      // CD 计数只在大回合结束时 +1（R16）；「使用当回合不计数」（R16：使用/效果结束后本回合不计数）。
      for (const u of units) {
        for (const s of u.skills) {
          if (s.usedThisBigTurn === 0) s.cdCounter += 1;
          s.usedThisBigTurn = 0;
        }
      }
      if (hooks) turnEndHook = 'bigTurnEnd';
    } else if (hooks) {
      turnEndHook = 'smallTurnEnd';
    }
    victory = refreshVictory(units, victory, clock);
  }

  // P7 E：附身类技能在动作结算末尾按目标临时血量判断是否结束（小女孩「记忆同步」）。
  settlePossession(units, events);
  // P7 E2：临时血量为 0 时整组撤掉「野性伙伴」的攻击力/不反伤加成。
  settleTempHpGroups(units, events);
  // P7 C：受击触发（心理学家「应激」等），在动作伤害结算完之后、动态光环重算之前。
  // P7-2 X3/X4 裁决：「路易」覆盖标记扣血、延迟伤害、道具，但不覆盖直接改 hp——统一以
  // `hpLostThisBigTurn` 的增量为准，即任何落到本体血量的减少都会触发一次。
  fireDamageReactors(units, state.units, clock, events, 'hpLoss');
  // P7：动作结算完，按当前血量/存活情况重算动态条件被动。
  syncAuras(units, clock);
  // P5-9：本动作造成的伤害给「受击充能」类技能（猿猴咒像）充能，再判胜负。
  units = chargeFromDamage(units, state.units);

  const result = checkVictory(victory);
  if (result.winner) {
    events.push({ type: 'victory', winner: result.winner, reason: result.reason ?? '' });
  }
  // 结算全部成功（没有抛反应窗口哨兵）才发回合结束钩子，见上方 turnEndHook 注释。
  if (hooks && turnEndHook) hooks.emit(turnEndHook, makeEvent(turnEndHook), { clock });

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
      k,
      pending: [...pending, ...queued],
      effects: state.effects,
    },
    events,
  };
}

/** P7-2（X5）/P7-3：本次伤害前可用的反应来源。items 为魔术棒道具下标，skills 为反应技能持有者。 */
function collectReactions(
  units: GameUnit[],
  effects: EffectsIndex | undefined,
  target: GameUnit,
  kind: 'attack' | 'damage',
): { items: number[]; skills: { unitId: string; skillIndex: number }[] } {
  const items =
    kind === 'attack'
      ? target.items
          .map((it, i) => ({ it, i }))
          .filter(({ it }) => {
            const eff = effects?.items.get(it.itemId)?.effect as { reaction?: string } | undefined;
            return eff?.reaction === 'beforeAttack';
          })
          .map(({ i }) => i)
      : [];
  const skills: { unitId: string; skillIndex: number }[] = [];
  for (const u of units) {
    if (u.dead || u.side !== target.side) continue;
    u.skills.forEach((s, skillIndex) => {
      if (s.effect?.reaction !== 'beforeDamage') return;
      if (skillReactionReady(s)) skills.push({ unitId: u.id, skillIndex });
    });
  }
  return { items, skills };
}

/** 反应技能此刻是否可用：充能足够、未超过每局限次。 */
function skillReactionReady(skill: UnitSkill): boolean {
  const eff = skill.effect;
  if (!eff) return false;
  const limit = eff.usageLimit?.perGame;
  if (limit !== undefined && skill.usedPerGame >= limit) return false;
  if (skill.def.type === 'charge') {
    const need = eff.cost?.charge ?? skill.def.cost ?? 0;
    if (skill.charge < need) return false;
  }
  return true;
}

/**
 * P7-3：在反应窗口里使用反应技能（役鸟守护）。
 * 支付充能后按原 ops 结算（免疫状态挂到受击者身上），再重放被挂起的动作——
 * 免疫状态由 applyDamage 消费，整次伤害归零；先知攻击力 -1 在 ops 里落地。
 */
function useReactionSkill(
  state: GameState,
  win: { kind: 'attack' | 'damage'; targetId: string },
  unitId: string,
  skillIndex: number,
): { state: GameState } {
  // P7-4：skills 也要深拷贝——充能/限次是就地改的，重放时不能把已扣的充能带回来。
  const units = state.units.map((u) => ({
    ...u,
    statuses: u.statuses.map((s) => ({ ...s })),
    skills: u.skills.map((s) => ({ ...s })),
  }));
  const unit = findUnit(units, unitId);
  if (!unit) throw new Error('单位不存在');
  const victim = findUnit(units, win.targetId);
  if (!victim) throw new Error('受击单位不存在');
  if (unit.side !== victim.side) throw new Error('只能保护己方角色');
  const skill = unit.skills[skillIndex];
  if (!skill || skill.effect?.reaction !== 'beforeDamage') throw new Error('该技能不能在反应窗口使用');
  if (!skillReactionReady(skill)) throw new Error('该反应技能当前不可用（充能不足或用尽）');
  const events: GameEvent[] = [];
  const cost = skill.effect.cost?.charge ?? skill.def.cost ?? 0;
  if (skill.def.type === 'charge') skill.charge = Math.max(0, skill.charge - cost);
  const queued: DeferredOp[] = [];
  runEffect(
    { units, clock: state.clock, sourceId: unit.id, targetId: victim.id, victimId: victim.id, events, pending: queued },
    skill.effect as never,
  );
  skill.usedPerGame += 1;
  skill.usedThisBigTurn += 1;
  skill.cdCounter = 0;
  events.push({ type: 'interruptSkill', unit: unit.id, skill: skill.def.name, target: victim.id });
  return {
    state: {
      ...state,
      units,
      pending: [...(state.pending ?? []), ...queued],
      events: [...state.events, ...events],
    },
  };
}

/**
 * P7-2（X5）：在打断窗口里使用道具（魔术棒）。
 * 与 useItem 走同一套计价/折扣/消耗，区别是不要求「当前是该角色的行动小回合」，
 * 且必须是被攻击方；效果里的 interruptDamage 决定本次伤害的折算系数。
 */
function useInterruptItem(
  state: GameState,
  win: { kind: 'attack' | 'damage'; targetId: string },
  unitId: string,
  itemIndex: number,
): { state: GameState; factor: number } {
  if (unitId !== win.targetId) throw new Error('只有被攻击的一方可以使用打断道具');
  const units = state.units.map((u) => ({ ...u }));
  const unit = findUnit(units, unitId)!;
  const owned = unit.items[itemIndex];
  if (!owned) throw new Error('道具不存在');
  if (itemLocked(unit.statuses, owned.itemId)) throw new Error('本回合不可使用该道具');
  const catalog = state.effects?.items.get(owned.itemId);
  const effect = catalog?.effect as { ops: OpSpec[]; reaction?: string } | undefined;
  if (!effect || effect.reaction !== 'beforeAttack') throw new Error('该道具不能在打断窗口使用');
  const events: GameEvent[] = [];
  const price = itemPrice({
    item: { id: owned.itemId, name: catalog?.name ?? owned.itemId, cost: catalog?.cost ?? null },
    owned,
    statuses: unit.statuses,
  });
  if (!canPay({ remaining: state.k }, unit.side, price)) throw new Error('道具资源不足');
  const k = pay({ remaining: state.k }, unit.side, price).remaining;
  unit.statuses = consumeItemDiscounts(unit.statuses, owned.itemId, unit.id, state.clock);
  unit.items = unit.items.filter((_, i) => i !== itemIndex);
  const interrupt = { factor: 0.5 };
  const queued: DeferredOp[] = [];
  runEffect(
    {
      units,
      clock: state.clock,
      sourceId: unit.id,
      targetId: unit.id,
      victimId: unit.id,
      events,
      pending: queued,
      interrupt,
    },
    effect as never,
  );
  // 使用道具后的反应与 useItem 同口径（魔术师「魔术演绎」的 wandCap1）。
  const itemReaction = fire(units, {
    trigger: 'itemUse',
    clock: state.clock,
    sideFilter: unit.side,
    onlyUnitId: unit.id,
    itemUsed: owned.itemId,
  });
  events.push(...(itemReaction.events as GameEvent[]));
  events.push({ type: 'attackInterrupted', unit: unit.id, item: owned.itemId, factor: interrupt.factor });
  return {
    state: {
      ...state,
      units,
      k,
      pending: [...(state.pending ?? []), ...queued],
      events: [...state.events, ...events],
    },
    factor: interrupt.factor,
  };
}

/** 合法的攻击目标：对方存活、未被无敌保护、未被「不可被攻击」类效果锁定。 */
export function legalAttackTargets(state: GameState, attackerId: string): GameUnit[] {
  const attacker = findUnit(state.units, attackerId);
  if (!attacker) return [];
  // 机械盲这类「无法主动攻击」的单位直接没有可攻击目标（界面也不会高亮）。
  if (hasFlag(attacker.statuses, 'cannotAttack') || hasFlag(attacker.statuses, 'restrictAttack')) return [];
  return state.units.filter(
    (u) =>
      u.side !== attacker.side &&
      !u.dead &&
      !u.invincible &&
      !u.statuses.some((s) => s.kind === 'flag' && (s.key === 'invulnerable' || s.key === 'untargetable:attack' || s.key === 'untargetable:all')),
  );
}

export { otherSide };
