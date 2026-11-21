// 效果解释器（P5）：把 data/effects.json 里的结构化 op 落到 GameUnit 上。
//
// 三层分工：
//   data/effects.json —— 数据层，只描述「做什么」；
//   本文件           —— 把 op 翻译成状态/伤害/道具变化；
//   game.ts          —— 时机（谁在什么时候被触发），不复制 op 语义。
//
// 所有函数都就地修改传入的 units 数组里的对象（game.ts 已在动作入口做过一层浅拷贝）。

import { applyDamage, healByAdding, healByRestoring, type Combatant } from './combat';
import { applyRescue, withRescueStatuses } from './rescue';
import type { TurnClock } from './turn';
import type { Side, SkillDef } from './types';
import {
  resolveDuration,
  type Status,
  type StatKey,
  hasFlag,
  markValue,
  removeMark,
  totalShield,
  consumeShield,
  tryConsumeImmune,
  damageMultiplier,
  damageTakenAdjust,
  outgoingAdjust,
  statOf,
  flagValue,
} from './status';

export type Trigger =
  | 'manual'
  | 'battlecry'
  | 'turnStart'
  | 'turnEnd'
  | 'ownTurnStart'
  | 'ownTurnEnd'
  | 'enemyTurnStart'
  | 'enemyTurnEnd'
  | 'beforeDamage'
  | 'afterDamage'
  | 'afterAttack'
  /** P7 C：使用道具后（空军「精准打击」、舞女「二重奏」）。 */
  | 'itemUse'
  | 'attacked'
  | 'damaged'
  | 'lethalDamage'
  | 'selfDeath'
  | 'allyDeath'
  | 'enemyDeath'
  | 'enteringDying'
  | 'rescue'
  | 'rescued'
  | 'summonDeath'
  | 'always';

export type ImplLevel = 'full' | 'partial' | 'none';

export interface OpSpec {
  op: string;
  ref?: string;
  refA?: string;
  refB?: string;
  from?: string;
  to?: string;
  stat?: string;
  statA?: string;
  statB?: string;
  hpCost?: number;
  delta?: number;
  value?: number;
  amount?: number | 'full';
  /** 计算式血量：base 减去场上人数（希望信件 5-X）。 */
  amountExpr?: { base: number; minus: 'alliesAlive' | 'enemiesAlive' };
  /** heal 的语义：add=加血（可破上限），restore=回血（默认）。 */
  healMode?: 'add' | 'restore';
  factor?: number;
  vs?: string;
  scope?: string;
  uses?: number;
  by?: string;
  key?: string;
  note?: string;
  item?: string;
  count?: number;
  /** grantItem 的绑定名来源（P6 QA-34：画家获得被攻击者的画作）。 */
  nameFrom?: 'self' | 'target' | 'victim';
  unit?: { name: string; atk: number; hp: number; durability?: number; decay?: number };
  tags?: string[];
  kind?: string;
  minDamage?: number;
  autoReduce?: { max: number };
  filter?: Record<string, unknown>;
  ignoreInvulnerable?: boolean;
  /** 逐条覆盖技能级 duration（P5 收尾新增）。 */
  duration?: string;
  /** 排程时机：不在使用时立即结算，由 game.ts 在回合边界执行。 */
  when?: 'ownTurnStart' | 'ownTurnEnd' | 'nextOwnTurnStart';
  /** defer 专用：延迟到哪个时机结算（与 when 分开，避免 defer 自身被当作排程 op）。 */
  delay?: 'ownTurnEnd' | 'nextOwnTurnStart';
  /** 排程条件：noAttackLastTurn / gloryLastTurn。 */
  if?: string;
  /** defer 携带的实际效果。 */
  ops?: OpSpec[];
  /** shield 的分档：points=抵挡 n 点（默认），once=抵挡一次伤害。 */
  mode?: string;
  /** modStatPer：按场上计数重复（woundedAllies = 己方受伤角色数，P7）。 */
  per?: 'woundedAllies';
  /** rescueRule 扩展：可被救援次数、救援扣血增减、免减上限、必扣本体、封技能后扣血。 */
  limit?: number;
  costDelta?: number;
  noHalve?: boolean;
  fromBaseHp?: boolean;
  sealedCost?: number;
  /** rescueRule 扩展：只能救援该角色名（心理学家「牵绊」→ 病患）。 */
  targetName?: string;
  /** 该 op 在 ref 带某 flag 时整条跳过（调律压制组曲加攻）。 */
  unless?: string;
  /** P7 E：cdDelta 在「目标就是施放者」时改为把技能 CD 直接拉满（振奋「若为自己则立即可用」）。 */
  selfReady?: boolean;
  /** P7 E：tempHp 在救援流程触发时改用这个数值（木偶师「路易」救援变体 2 点）。 */
  rescueAmount?: number;
  /** P7 E2：本次 op 产生的状态归入同一组（野性伙伴的 atk+1/noReflect 随临时血归零一起撤掉）。 */
  group?: string;
  /** P7-2 X6：状态在「自己攻击后」或「自己被攻击后」清除（八音盒的两种增益）。 */
  consumedOn?: 'attack' | 'attacked';
}

export interface TargetSpec {
  mode: 'self' | 'none' | 'anyUnit' | 'allyUnit' | 'enemyUnit' | 'otherAlly' | 'anyCharacter';
  optional?: boolean;
  filter?: Record<string, unknown>;
}

/** P5-15：同一技能「使用前二选一」的分支（藏锋转/扫、邮差信件等）。 */
export interface EffectBranch {
  label: string;
  ops: OpSpec[];
  /** 分支级目标覆盖（省略则沿用技能级 target）。 */
  target?: TargetSpec;
  /** 分支级持续时长（省略则沿用技能级 duration）。 */
  duration?: string;
  /** 分支级充能消耗（激励：雀跃 1 / 亢奋 3）。 */
  cost?: number;
  /** 分支级耐久消耗（藏锋：转式 1 / 扫式 3，P5-35）。 */
  durability?: number;
  /** 分支级 k 资源花费（囚徒「线路控制」升级分支：1k = 1000，P7 D）。 */
  kCost?: number;
  /** 分支级每局使用次数上限（记者「独家新闻」：3/1；囚徒升级分支：1，P7 D）。 */
  uses?: number;
  /** 分支可用条件（冷静信件：首回合不可用）。 */
  if?: 'notFirstBigTurn';
  notes?: string;
}

/**
 * P7 E2：一个技能条目下的额外触发时机（杂技演员「即兴演出」：救援后 / 第二己方回合结束 / 受伤后）。
 * 主 effect 仍走 trigger + ops，parts 各自带 trigger/条件/次数，互不覆盖。
 */
export interface SkillPart {
  trigger: Trigger;
  ops: OpSpec[];
  condition?: Record<string, unknown>[];
  usageLimit?: Record<string, number>;
  duration?: string;
  target?: TargetSpec;
}

export interface SkillEffect {
  id: string;
  character: string;
  name: string;
  type: string;
  impl: ImplLevel;
  manual: boolean;
  trigger: Trigger;
  target?: TargetSpec;
  /** P7 E2：额外触发时机。 */
  parts?: SkillPart[];
  /** 有分支的技能：ops 可为空，实际结算走被选中的 branch。 */
  branches?: EffectBranch[];
  /** 同一技能条目里的「战吼部分」（P5-26：入殓的被动战吼给自己上标记），开局结算一次。 */
  battlecryOps?: OpSpec[];
  /** P7 C：同一技能条目里的「攻击后部分」（冒险家「探险幻想」：攻击后攻击力改为2）。 */
  afterAttackOps?: OpSpec[];
  condition?: Record<string, unknown>[];
  cost?: Record<string, number>;
  usageLimit?: Record<string, number>;
  duration?: string;
  /** P7 E2-4：任意阶段可用（安抚物），不受「只能在自己行动小回合使用」限制。 */
  anyPhase?: boolean;
  /** P7 E2：时长随使用次数变化（野性伙伴：首次 turns:2，之后 turns:1）。 */
  durationByUse?: { first: string; later: string };
  /** P7-3：beforeDamage = 反应技能，只能在「角色将要受到伤害」的反应窗口里使用（役鸟守护）。 */
  reaction?: 'beforeDamage';
  ops: OpSpec[];
  notes?: string;
  rulings?: string[];
}

export interface ItemEffect {
  id: string;
  name: string;
  cost?: number | null;
  impl: ImplLevel;
  trigger: Trigger;
  target?: TargetSpec;
  condition?: Record<string, unknown>[];
  duration?: string;
  ops: OpSpec[];
  /** P7-2 X6：抉择式道具（八音盒）：使用前二选一，选中分支后按分支 ops 结算。 */
  branches?: EffectBranch[];
  notes?: string;
  rulings?: string[];
  /** P7-2（X5）：beforeAttack = 只在「将要受到攻击」的打断窗口里可用。 */
  reaction?: 'beforeAttack';
}

export interface OwnedItem {
  itemId: string;
  /** 实际支付花费，已含折扣/涨价。 */
  cost: number | null;
  /** 本回合是否已被「玩具匣」类效果锁住。 */
  lockedThisTurn?: boolean;
  /** P6（QA-34）：绑定的角色名（画作在获取时确定），使用时只能选该名角色。 */
  nameKey?: string;
}

/** 每个角色身上某个技能的运行时计数。 */
export interface UnitSkill {
  def: SkillDef;
  effect: SkillEffect | null;
  /** CD 计数（R16）：回合结束 +1，>= cd 才可用。 */
  cdCounter: number;
  /** 充能层数（R05）。 */
  charge: number;
  /** 耐久度（R06），null 表示无限。 */
  durability: number | null;
  usedPerGame: number;
  usedThisBigTurn: number;
  /** P7 D：每个分支的每局已用次数（下标与 SkillEffect.branches 对齐）。 */
  branchUses?: number[];
  /** P7 E2：每个额外触发时机的已用次数（下标与 SkillEffect.parts 对齐）。 */
  partUses?: { perGame: number; perTurn: number }[];
}

/** 解释器需要的最小单位形状（GameUnit 满足它）。 */
export interface EffectUnit extends Combatant {
  id: string;
  name: string;
  side: Side;
  slot: number;
  dead: boolean;
  statuses: Status[];
  items: OwnedItem[];
  skills: UnitSkill[];
  attackedThisBigTurn: boolean;
  /** 是否拥有救援能力（rescue.ts 的 Rescuer）。 */
  hasRescue?: boolean;
  /** 受击时是否反伤。 */
  hasReflect?: boolean;
  /** 召唤物标记。 */
  isSummon?: boolean;
  /** 记者「观测视角」：可主动令自己的召唤物死亡。 */
  canDestroySummon?: boolean;
  /** 入殓师「入殓」：可随时在己方回合无限次转移附容返生标记。 */
  canTransferMark?: boolean;
  /** 飞行家「救援」：救援时可选消耗一个飞行器使本次救援无伤。 */
  canRescueByFlyer?: boolean;
}

export interface EffectEventLike {
  type: string;
  [k: string]: unknown;
}

export interface EffectContext {
  units: EffectUnit[];
  clock: TurnClock;
  sourceId: string;
  targetId?: string;
  attackerId?: string;
  victimId?: string;
  /** 结果落到哪个阵营（用于日志）。 */
  events: EffectEventLike[];
  /** 召唤物落地：由 game.ts 注入，负责分配 id/slot。 */
  createSummon?: (owner: EffectUnit, unit: { name: string; atk: number; hp: number; durability?: number; decay?: number }, tags?: string[]) => EffectUnit;
  /** defer 排程队列（P5-16②）：由 game.ts 注入，回合边界统一结算。 */
  pending?: DeferredOp[];
  /** 引擎未支持的 op 会记录在这里，供覆盖率统计。 */
  unsupported?: string[];
  /** P7-2（X5）：打断窗口上下文，`interruptDamage` 把折算系数写回 factor。 */
  interrupt?: { factor: number };
  /** 技能伤害前的受击钩子（P5-28/P5-36：接线 `beforeDamage` 被动），由 game.ts 注入。 */
  beforeDamage?: (unit: EffectUnit) => void;
  /**
   * P7-4：伤害前的统一反应窗口挂起点（役鸟等反应技能）。由 game.ts 注入，
   * 有可用反应时直接抛哨兵中止本次结算，由 applyAction 外层转成 pendingInterrupt。
   * 技能/道具伤害与标记扣血都从这里过，不再各通道单独开窗。
   */
  reactionGate?: (targetId: string, kind: 'attack' | 'damage') => void;
  /** P6-Q10：技能「指定一个道具」时用户选中的道具 id，op.item === '$chosen' 从这里取。 */
  itemId?: string;
  /** P7 E：本次触发来自救援流程（木偶师「路易」的救援变体）。 */
  viaRescue?: boolean;
  /** P7 E2：当前 op 的 group，addStatus 用它给状态打组标记。 */
  currentGroup?: string;
}

/** 排程中的一组效果：when=ownTurnEnd / nextOwnTurnStart，side=发起方。 */
export interface DeferredOp {
  side: Side;
  when: 'ownTurnEnd' | 'nextOwnTurnStart';
  ops: OpSpec[];
  sourceId: string;
  targetId?: string;
  duration?: string;
}

const numOf = (v: number | 'full' | undefined): number | undefined => (typeof v === 'number' ? v : undefined);

let seq = 0;
const nextId = (prefix: string) => `${prefix}#${++seq}`;

export function resetSeqForTest(): void {
  seq = 0;
}

export const findUnitById = (units: EffectUnit[], id: string | undefined): EffectUnit | undefined =>
  id === undefined ? undefined : units.find((u) => u.id === id);

/** 把 ref 解析成一组单位。 */
export function resolveRef(ctx: EffectContext, ref: string | undefined): EffectUnit[] {
  const source = findUnitById(ctx.units, ctx.sourceId);
  if (!source) return [];
  const target = findUnitById(ctx.units, ctx.targetId);
  const attacker = findUnitById(ctx.units, ctx.attackerId);
  const victim = findUnitById(ctx.units, ctx.victimId);
  switch (ref) {
    case 'self':
    case 'owner':
      return [source];
    case 'target':
      return target ? [target] : [];
    case 'selfAndTarget':
      // P5：邮差信件同时对「邮差本人」与「收信者」生效（同一人时只算一次）。
      return target && target.id !== source.id ? [source, target] : [source];
    case 'attacker':
      return attacker ? [attacker] : [];
    case 'victim':
      return victim ? [victim] : [];
    case 'allAllies':
      return ctx.units.filter((u) => u.side === source.side && !u.dead);
    case 'allEnemies':
      return ctx.units.filter((u) => u.side !== source.side && !u.dead);
    default:
      return [];
  }
}

/** P6-Q10：op.item 的取值——`$chosen` 取 ctx.itemId（技能指定的那个道具），其余原样。 */
function resolveItem(item: string | undefined, ctx: EffectContext): string {
  if (item === undefined) return '*';
  if (item === '$chosen') return ctx.itemId ?? '*';
  return item;
}

function addStatus(
  unit: EffectUnit,
  status: Omit<Status, 'id' | 'expiresAt' | 'source'>,
  ctx: EffectContext,
  duration: string | undefined,
): void {
  if (unit.dead) return;
  if (duration === 'instant' && status.kind === 'stat') return;
  const expiresAt = resolveDuration(duration, ctx.clock, unit.side);
  const full: Status = {
    ...status,
    id: nextId('st'),
    expiresAt,
    source: ctx.sourceId,
    requiresSourceAlive: duration === 'whileSourceAlive',
    consumedOn: status.consumedOn ?? (duration === 'nextAttack' ? 'attack' : undefined),
    ...(ctx.currentGroup ? { group: ctx.currentGroup } : {}),
  };
  unit.statuses = [...unit.statuses, full];
}

function dealDamage(unit: EffectUnit, amount: number, ctx: EffectContext, kind: string): number {
  if (unit.dead) return 0;
  // P7-4：技能/道具伤害统一先过反应窗口（役鸟守护），窗口未处理完不落伤害。
  ctx.reactionGate?.(unit.id, kind === 'attack' ? 'attack' : 'damage');
  // P5-36：技能伤害也走一次 `beforeDamage`（悬停等免伤被动需要在这里挂免疫状态）。
  if (ctx.beforeDamage) ctx.beforeDamage(unit);
  // P5-16②：伤害来源的逐击衰减 / 伤害下限。
  const floor = flagValue(unit.statuses, 'minDamage');
  let total = Math.max(0, Math.round(amount + outgoingAdjust(unit.statuses)));
  if (floor > 0) total = Math.max(floor, total);
  const result = applyDamage(unit as Combatant, total, { clock: ctx.clock, kind: kind as never });
  // P6 坚强：伤害被转成标记时不算受伤，也不产生伤害事件（标记写在 result.target.statuses 上）。
  if (result.converted) {
    Object.assign(unit, result.target);
    ctx.events.push({ type: 'markGained', target: unit.id, amount: result.converted });
    return result.converted;
  }
  // P6 Q4（QA-15/16）：致命伤害被延迟，本次不产生伤害事件，状态标记随结果一起落地。
  if (result.lethalDeferred) {
    Object.assign(unit, result.target);
    ctx.events.push({ type: 'damageDeferred', unit: unit.id, amount: result.lethalDeferred });
    return 0;
  }
  Object.assign(unit, result.target);
  ctx.events.push({ type: 'damage', target: unit.id, amount: total, applied: result.applied, hpAfter: unit.hp });
  if (unit.hp <= 0) ctx.events.push({ type: 'dying', unit: unit.id });
  return total;
}

/** 执行一条 op。返回 true 表示已被引擎完整处理。 */
export function applyOp(op: OpSpec, ctx: EffectContext, duration: string | undefined): boolean {
  // P5-16④：op 级跳过（调律期间组曲不加攻）。
  if (op.unless) {
    const refs = resolveRef(ctx, op.ref);
    if (refs.length && refs.every((u) => hasFlag(u.statuses, op.unless!))) return true;
  }
  switch (op.op) {
    case 'modStat': {
      const stat = op.stat as StatKey;
      const delta = op.delta ?? op.value ?? 0;
      for (const u of resolveRef(ctx, op.ref)) {
        // P6 D 块（QA-18/21）：hp/maxHp 是实体数值，永久修改时直接落到血量与上限，并同步初始上限。
        if (stat === 'hp' || stat === 'maxHp') {
          if (duration !== 'permanent') {
            addStatus(u, { kind: 'stat', key: stat, value: delta, mode: 'add' }, ctx, duration);
            continue;
          }
          if (stat === 'hp') {
            u.hp += delta;
            u.maxHp += delta;
            u.initialMaxHp += delta;
            if (u.hp > u.maxHp) u.maxHp = u.hp;
            if (u.hp < 0) u.hp = 0;
          } else {
            u.maxHp += delta;
            u.initialMaxHp += delta;
            if (u.hp > u.maxHp) u.hp = u.maxHp;
          }
          continue;
        }
        addStatus(u, { kind: 'stat', key: stat, value: delta, mode: 'add', ...(op.consumedOn ? { consumedOn: op.consumedOn } : {}) }, ctx, duration);
      }
      return true;
    }
    case 'modStatPer': {
      // P7：按数量动态增减（机械师「胆怯」：每个受伤的己方角色攻击力 -1）。
      for (const u of resolveRef(ctx, op.ref)) {
        const n = ctx.units.filter((x) => !x.dead && x.side === u.side && x.hp < x.maxHp).length;
        if (n <= 0) continue;
        addStatus(u, { kind: 'stat', key: op.stat as StatKey, value: (op.delta ?? 0) * n, mode: 'add' }, ctx, duration);
      }
      return true;
    }
    case 'setStat': {
      const stat = op.stat as StatKey;
      for (const u of resolveRef(ctx, op.ref)) {
        addStatus(u, { kind: 'stat', key: stat, value: op.value ?? 0, mode: 'set' }, ctx, duration);
      }
      return true;
    }
    case 'heal': {
      const full = op.amount === 'full';
      for (const u of resolveRef(ctx, op.ref)) {
        if (u.dead || hasFlag(u.statuses, 'noHeal')) continue;
        // P5：希望信件「加 5-X 血」，X 为受者一方场上存活角色数。
        const exprCount = op.amountExpr
          ? ctx.units.filter((x) => !x.dead && (op.amountExpr!.minus === 'enemiesAlive' ? x.side !== u.side : x.side === u.side)).length
          : 0;
        const amount = typeof op.amount === 'number'
          ? op.amount
          : op.amountExpr ? Math.max(0, op.amountExpr.base - exprCount) : 0;
        if (full) Object.assign(u, { hp: u.maxHp, statuses: u.statuses });
        else if (op.healMode === 'add') healAdding(u, amount);
        else Object.assign(u, healByRestoring(u as Combatant, amount), { statuses: u.statuses });
        ctx.events.push({ type: 'heal', target: u.id, hpAfter: u.hp });
      }
      return true;
    }
    case 'damage': {
      const amount = op.amount === 'full' ? 0 : op.amount ?? 0;
      for (const u of resolveRef(ctx, op.ref)) dealDamage(u, amount, ctx, op.kind ?? 'skill');
      return true;
    }
    case 'tempHp': {
      for (const u of resolveRef(ctx, op.ref)) {
        // P7 E：救援流程里触发的变体（木偶师「路易」：救援导致时只获得 2 点）。
        const amount = ctx.viaRescue && op.rescueAmount !== undefined
          ? op.rescueAmount
          : op.amount === 'full' ? 0 : op.amount ?? 0;
        u.tempHp += amount;
        // P7-E2-2 裁决：「持续」也约束临时血量——记一份带时长的授予凭据，
        // 到期由 game.ts 清理状态时把这一份扣回（只影响本技能给的部分）。
        if (op.group && amount !== 0) {
          addStatus(u, { kind: 'flag', key: 'tempHpGrant', value: amount, mode: 'add' }, ctx, duration);
        }
        ctx.events.push({ type: 'tempHp', target: u.id, total: u.tempHp });
      }
      return true;
    }
    case 'loseHp': {
      // P7 E：直接扣本体血量（不经过护盾/临时血/免疫），用于「本体血量将要减少时」。
      for (const u of resolveRef(ctx, op.ref)) {
        if (u.dead) continue;
        const amount = op.amount === 'full' ? u.hp : op.amount ?? 0;
        u.hp = Math.max(0, u.hp - amount);
        ctx.events.push({ type: 'hpLoss', unit: u.id, amount, hpAfter: u.hp });
      }
      return true;
    }
    case 'possession': {
      // P7 E：小女孩「记忆同步」——给目标挂附身标记，同时给自己一个无次数上限的免疫。
      // 标记 key 里带目标 id，动作结算末尾由 game.ts 的 settlePossession 检查目标临时血量。
      const owner = findUnitById(ctx.units, ctx.sourceId);
      if (!owner) return true;
      const expiresAt = null;
      for (const u of resolveRef(ctx, op.ref)) {
        // 重复附身时先清掉旧标记与旧免疫，避免免疫叠加。
        owner.statuses = owner.statuses.filter(
          (s) => !(s.kind === 'flag' && s.key.startsWith('possession:')) && s.source !== `possession:${owner.id}`,
        );
        owner.statuses = [
          ...owner.statuses,
          {
            id: nextId('st'),
            kind: 'flag',
            key: `possession:${u.id}`,
            value: 1,
            mode: 'add',
            expiresAt,
            source: ctx.sourceId,
          },
          {
            id: nextId('st'),
            kind: 'immune',
            key: op.scope ?? 'all',
            value: -1,
            mode: 'add',
            expiresAt,
            source: `possession:${owner.id}`,
          },
          {
            // P7-E4 裁决：小女孩附身期间不可攻击；与免疫同源，settlePossession 一并撤除。
            id: nextId('st'),
            kind: 'flag',
            key: 'restrictAttack',
            value: 1,
            mode: 'add',
            expiresAt,
            source: `possession:${owner.id}`,
          },
        ];
        ctx.events.push({ type: 'possession', owner: owner.id, target: u.id });
      }
      return true;
    }
    case 'shield': {
      // mode=once：「抵挡一次伤害」用 -1 作哨兵，由 consumeShield 整次吞掉。
      const value = op.mode === 'once' ? -1 : op.amount === 'full' ? 0 : op.amount ?? 0;
      for (const u of resolveRef(ctx, op.ref)) {
        addStatus(u, { kind: 'shield', key: 'shield', value, mode: 'add' }, ctx, duration);
      }
      return true;
    }
    case 'reflectMod': {
      // 只改「反伤造成的伤害」，不影响普通受伤（-1 即反伤减一）。
      for (const u of resolveRef(ctx, op.ref)) {
        addStatus(u, { kind: 'flag', key: 'reflect', value: op.delta ?? 0, mode: 'add' }, ctx, duration);
      }
      return true;
    }
    case 'grantRescue': {
      for (const u of resolveRef(ctx, op.ref)) u.hasRescue = true;
      return true;
    }
    case 'grantDestroySummon': {
      // 记者「观测视角」：仅授予能力，真正的销毁走 destroySummon 动作。
      for (const u of resolveRef(ctx, op.ref)) u.canDestroySummon = true;
      return true;
    }
    case 'grantTransferMark': {
      // 入殓师「入殓」：授予转移标记的能力，真正转移走 transferMark 动作。
      for (const u of resolveRef(ctx, op.ref)) u.canTransferMark = true;
      return true;
    }
    case 'grantRescueFlyer': {
      // 飞行家「救援」：授予「消耗飞行器免伤」的选项，真正消耗在 rescue 动作里。
      for (const u of resolveRef(ctx, op.ref)) u.canRescueByFlyer = true;
      return true;
    }
    case 'damageReduce': {
      for (const u of resolveRef(ctx, op.ref)) {
        addStatus(u, { kind: 'stat', key: 'dmgTaken', value: -(op.amount === 'full' ? 0 : op.amount ?? 0), mode: 'add' }, ctx, duration);
      }
      return true;
    }
    case 'damageMultiplier': {
      for (const u of resolveRef(ctx, op.ref)) {
        addStatus(u, { kind: 'dmgMultiplier', key: 'damage', value: op.factor ?? 1, mode: 'set' }, ctx, duration);
      }
      return true;
    }
    case 'interruptDamage': {
      // P7-2（X5）：魔术棒「本次受到的伤害减半（向下取整）」。
      // 不挂状态：折算系数由 game.ts 在正式结算攻击时用 Math.floor 一次算清。
      if (ctx.interrupt) ctx.interrupt.factor = op.factor ?? 0.5;
      return true;
    }
    case 'immune': {
      for (const u of resolveRef(ctx, op.ref)) {
        addStatus(u, { kind: 'immune', key: op.scope ?? 'damage', value: op.uses ?? 1, mode: 'add' }, ctx, duration);
      }
      return true;
    }
    case 'invulnerable': {
      for (const u of resolveRef(ctx, op.ref)) {
        // 身轻如燕 / 未声张的怒火：不会获得「不可攻击」类效果。
        if (hasFlag(u.statuses, 'noInvulnerable')) continue;
        addStatus(u, { kind: 'flag', key: 'invulnerable', value: 1, mode: 'add' }, ctx, duration);
      }
      return true;
    }
    case 'untargetable': {
      for (const u of resolveRef(ctx, op.ref)) {
        addStatus(u, { kind: 'flag', key: `untargetable:${op.by ?? 'all'}`, value: 1, mode: 'add' }, ctx, duration);
      }
      return true;
    }
    case 'sealSkills': {
      for (const u of resolveRef(ctx, op.ref)) {
        if (hasFlag(u.statuses, 'noSeal') || hasFlag(u.statuses, 'noSkillSeal')) continue;
        addStatus(u, { kind: 'flag', key: 'sealed', value: 1, mode: 'add' }, ctx, duration);
      }
      return true;
    }
    case 'extraAttack': {
      for (const u of resolveRef(ctx, op.ref)) {
        addStatus(u, { kind: 'extraAttack', key: 'extraAttack', value: op.count ?? 1, mode: 'add' }, ctx, duration);
      }
      return true;
    }
    case 'grantItem': {
      const nameOf = (id: string | undefined) => (id ? ctx.units.find((u) => u.id === id)?.name : undefined);
      const boundId = op.nameFrom === 'victim' ? ctx.victimId : op.nameFrom === 'target' ? ctx.targetId : op.nameFrom === 'self' ? ctx.sourceId : undefined;
      const nameKey = nameOf(boundId);
      for (const u of resolveRef(ctx, op.ref)) {
        for (let i = 0; i < (op.count ?? 1); i++) u.items.push({ itemId: op.item!, cost: null, ...(nameKey ? { nameKey } : {}) });
      }
      return true;
    }
    case 'itemDiscount': {
      // P6（QA-33/36）：scope=once 只对下一次购买生效；scope=turn 每小回合首次；其余常驻。
      // P6-Q10：item === '$chosen' 表示「技能指定的那一个道具」，由 ctx.itemId 提供。
      const scopeTag = op.scope === 'once' || op.scope === 'turn' ? `${op.scope}:` : '';
      for (const u of resolveRef(ctx, op.ref)) {
        addStatus(u, { kind: 'flag', key: `itemDiscount:${scopeTag}${resolveItem(op.item, ctx)}`, value: numOf(op.amount) ?? 0, mode: 'add' }, ctx, duration);
      }
      return true;
    }
    case 'itemLock': {
      // P6-Q10：道具级「本回合不可使用」——按道具 id 锁定（不锁整名角色的道具栏）。
      const key = `itemLock:${resolveItem(op.item, ctx)}`;
      for (const u of resolveRef(ctx, op.ref)) {
        addStatus(u, { kind: 'flag', key, value: 1, mode: 'add' }, ctx, duration);
      }
      return true;
    }
    case 'cdDelta': {
      for (const u of resolveRef(ctx, op.ref)) {
        // P7 E：振奋「若为自己，则改为可立即使用技能」——目标是施放者时把 CD 拉满；
        // 否则按 delta 调整目标所有 CD 技能（原文未写「一个技能」怎么选，见 decisions P7-E1）。
        if (op.selfReady && u.id === ctx.sourceId) {
          for (const s of u.skills) {
            if (s.def.type !== 'cooldown') continue;
            s.cdCounter = Math.max(s.cdCounter, s.def.cd ?? 0);
          }
          ctx.events.push({ type: 'cdReady', unit: u.id });
          continue;
        }
        for (const s of u.skills) s.cdCounter = Math.max(0, s.cdCounter + (op.delta ?? 0));
      }
      return true;
    }
    case 'chargeDelta': {
      for (const u of resolveRef(ctx, op.ref)) {
        for (const s of u.skills) s.charge = Math.max(0, s.charge + (op.delta ?? 0));
      }
      return true;
    }
    case 'swapStat': {
      const a = resolveRef(ctx, op.refA)[0];
      const b = resolveRef(ctx, op.refB)[0];
      if (a && b) {
        const statA = (op.statA ?? 'atk') as StatKey;
        const statB = (op.statB ?? 'atk') as StatKey;
        const readOf = (u: EffectUnit, s: StatKey) =>
          statOf(s === 'hp' || s === 'maxHp' ? u.maxHp : u.atk, u.statuses, s);
        const writeOf = (u: EffectUnit, s: StatKey, v: number) => {
          if (s === 'hp' || s === 'maxHp') u.maxHp = v;
          else u.atk = v;
        };
        const av = readOf(a, statA);
        const bv = readOf(b, statB);
        writeOf(a, statA, bv);
        writeOf(b, statB, av);
        ctx.events.push({ type: 'swapStat', a: a.id, b: b.id, av, bv });
      }
      return true;
    }
    case 'swapPosition': {
      const a = resolveRef(ctx, op.refA)[0];
      const b = resolveRef(ctx, op.refB)[0];
      if (a && b) {
        const slotA = a.slot;
        const slotB = b.slot;
        a.slot = slotB;
        b.slot = slotA;
        addStatus(a, { kind: 'flag', key: 'swapped', value: slotB, mode: 'add' }, ctx, duration);
        // P7 D：记下双方原位，供 swapBack（隐喻「换回」）还原；旧标记先清掉，避免重复记录。
        const strip = (u: EffectUnit) => u.statuses.filter((s) => !(s.kind === 'flag' && s.key === 'swapOrigin'));
        a.statuses = strip(a);
        b.statuses = strip(b);
        addStatus(a, { kind: 'flag', key: 'swapOrigin', value: slotA, mode: 'add' }, ctx, 'permanent');
        addStatus(b, { kind: 'flag', key: 'swapOrigin', value: slotB, mode: 'add' }, ctx, 'permanent');
        ctx.events.push({ type: 'swapPosition', a: a.id, b: b.id });
      }
      return true;
    }
    case 'swapBack': {
      // P7 D：隐喻的「己方回合结束时换回」。一方已死时活着的那个仍回原位（死者不再占位）；
      // 换回时被互换的「另一个角色」若血 <3 则 +1（原文未写的语义见 temp/decisions.md P7-D3）。
      const a = resolveRef(ctx, op.refA)[0];
      const b = resolveRef(ctx, op.refB)[0];
      if (!a || !b) return true;
      const originOf = (u: EffectUnit): number | undefined =>
        u.statuses.find((s) => s.kind === 'flag' && s.key === 'swapOrigin')?.value;
      const originA = originOf(a);
      const originB = originOf(b);
      if (originA !== undefined) a.slot = originA;
      if (originB !== undefined) b.slot = originB;
      const strip = (u: EffectUnit) =>
        u.statuses.filter((s) => !(s.kind === 'flag' && (s.key === 'swapOrigin' || s.key === 'swapped')));
      a.statuses = strip(a);
      b.statuses = strip(b);
      if (!b.dead && b.hp < 3 && !hasFlag(b.statuses, 'noHeal')) {
        Object.assign(b, healByAdding(b as Combatant, 1), { statuses: b.statuses });
        ctx.events.push({ type: 'heal', target: b.id, hpAfter: b.hp });
      }
      ctx.events.push({ type: 'swapBack', a: a.id, b: b.id });
      return true;
    }
    case 'summon': {
      if (!ctx.createSummon || !op.unit) {
        ctx.unsupported?.push(`${op.op}:${ctx.sourceId}`);
        return false;
      }
      for (const owner of resolveRef(ctx, op.ref)) {
        ctx.units.push(ctx.createSummon(owner, op.unit, op.tags));
      }
      return true;
    }
    case 'revive': {
      for (const u of resolveRef(ctx, op.ref)) {
        addStatus(u, { kind: 'flag', key: `revive:${op.value ?? op.amount ?? 1}`, value: 1, mode: 'add' }, ctx, duration);
      }
      return true;
    }
    case 'defer': {
      // P5-16②：把一组效果排到己方回合结束 / 下个己方回合开始。
      if (!ctx.pending) {
        ctx.unsupported?.push('defer:no-queue');
        return false;
      }
      const when: DeferredOp['when'] = op.delay === 'nextOwnTurnStart' ? 'nextOwnTurnStart' : 'ownTurnEnd';
      for (const u of resolveRef(ctx, op.ref)) {
        ctx.pending.push({
          side: u.side,
          when,
          ops: op.ops ?? [],
          sourceId: u.id,
          targetId: ctx.targetId,
          duration: op.duration ?? duration,
        });
      }
      return true;
    }
    case 'liberate': {
      // P5-16③：解放状态 + 解放者关键词（每回合两次攻击、溅射、伤害下限 1）。
      for (const u of resolveRef(ctx, op.ref)) {
        addStatus(u, { kind: 'flag', key: 'liberated', value: 1, mode: 'add' }, ctx, duration);
        addStatus(u, { kind: 'flag', key: 'splash', value: numOf(op.amount) ?? 2, mode: 'add' }, ctx, duration);
        addStatus(u, { kind: 'flag', key: 'minDamage', value: op.delta ?? 1, mode: 'add' }, ctx, duration);
        addStatus(u, { kind: 'extraAttack', key: 'extraAttack', value: 1, mode: 'add' }, ctx, duration);
      }
      return true;
    }
    case 'deferDamage': {
      for (const u of resolveRef(ctx, op.ref)) {
        addStatus(u, { kind: 'flag', key: 'deferLethal', value: 1, mode: 'add' }, ctx, duration);
      }
      return true;
    }
    case 'transferDamage': {
      // P6 巧手匠心（QA-12/13）：给 from（目标）挂保底 1 血的 flag，ratio 决定转移倍数，来源 = ctx.sourceId。
      const ratio = typeof (op as { ratio?: number }).ratio === 'number' ? (op as { ratio?: number }).ratio! : 2;
      for (const u of resolveRef(ctx, op.from ?? op.ref ?? 'self')) {
        addStatus(u, { kind: 'flag', key: 'keepHpMin1', value: ratio, mode: 'add' }, ctx, duration);
      }
      return true;
    }
    case 'mark': {
      for (const u of resolveRef(ctx, op.ref)) {
        addStatus(u, { kind: 'mark', key: op.key ?? 'mark', value: op.delta ?? numOf(op.amount) ?? 1, mode: 'add' }, ctx, duration);
      }
      return true;
    }
    case 'flag': {
      for (const u of resolveRef(ctx, op.ref)) {
        addStatus(u, { kind: 'flag', key: op.key ?? 'flag', value: op.value ?? 1, mode: 'add' }, ctx, duration);
      }
      return true;
    }
    case 'restrictAttack': {
      // P7 E2：不带 filter 时表示「完全不可攻击」（猿猴咒像·咒像引爆）；
      // 旧数据里带 filter 的（旧伤/三心二意）仍写成独立 key，避免误伤其自身行动。
      for (const u of resolveRef(ctx, op.ref)) {
        const key = op.filter ? `restrictAttackFiltered:${String(op.filter.hpEq ?? 'custom')}` : 'restrictAttack';
        addStatus(u, { kind: 'flag', key, value: 1, mode: 'add' }, ctx, duration);
      }
      return true;
    }
    case 'selfRescue': {
      for (const u of resolveRef(ctx, op.ref)) {
        addStatus(u, { kind: 'flag', key: 'selfRescue', value: 1, mode: 'add' }, ctx, duration);
      }
      return true;
    }
    case 'rescueRule': {
      const hpCost = op.value ?? (op as unknown as { hpCost?: number }).hpCost ?? 2;
      for (const u of resolveRef(ctx, op.ref)) {
        addStatus(u, { kind: 'rescueRule', key: 'rescueHpCost', value: hpCost, mode: 'set' }, ctx, duration);
        // 扩展项一律落成 flag，由 rescue.ts 的 overlay 读取（见 §6 说明）。
        if (op.limit !== undefined) addStatus(u, { kind: 'flag', key: 'rescueLimit', value: op.limit, mode: 'add' }, ctx, 'permanent');
        if (op.costDelta !== undefined) addStatus(u, { kind: 'flag', key: 'rescueCostDelta', value: op.costDelta, mode: 'add' }, ctx, 'permanent');
        if (op.noHalve !== undefined && op.noHalve) addStatus(u, { kind: 'flag', key: 'noMaxHpHalve', value: 1, mode: 'add' }, ctx, 'permanent');
        if (op.fromBaseHp !== undefined && op.fromBaseHp) addStatus(u, { kind: 'flag', key: 'mustUseBodyForRescue', value: 1, mode: 'add' }, ctx, 'permanent');
        if (op.sealedCost !== undefined) addStatus(u, { kind: 'flag', key: 'sealedRescueCost', value: op.sealedCost, mode: 'add' }, ctx, 'permanent');
        // 目标名过滤也走 flag：key 带角色名，status.value 只用于布尔判定（见 rescue.ts）。
        if (op.targetName !== undefined) {
          addStatus(u, { kind: 'flag', key: `rescueTargetName:${op.targetName}`, value: 1, mode: 'add' }, ctx, 'permanent');
        }
      }
      return true;
    }
    case 'copyAtk': {
      const from = resolveRef(ctx, op.from ?? 'self')[0];
      for (const u of resolveRef(ctx, op.to ?? 'target')) {
        if (!from) continue;
        addStatus(u, { kind: 'stat', key: 'atk', value: statOf(from.atk, from.statuses, 'atk'), mode: 'set' }, ctx, duration);
      }
      return true;
    }
    case 'triggerFlyer': {
      // P5-28：飞行器耐久为 0 时不触发；触发时消耗 1 点耐久并回 1 血（上限同步 +1）。
      for (const u of resolveRef(ctx, op.ref)) {
        const flyer = u.skills.find((s) => s.def.name === '飞行器');
        if (!flyer || flyer.durability === null || flyer.durability <= 0) continue;
        flyer.durability -= 1;
        u.hp += 1;
        u.maxHp += 1;
        // P6 D 块（QA-21）：上限增加计入初始上限，救援减半后才不会丢失。
        u.initialMaxHp += 1;
        ctx.events.push({ type: 'flyerTriggered', unit: u.id } as never);
      }
      return true;
    }
    case 'damageToMark': {
      // P6 坚强（QA-19/20）：受伤时改为获得等量标记；标记无上限。
      const key = op.key ?? 'mark';
      for (const u of resolveRef(ctx, op.ref)) {
        const flagKey = `damageToMark:${key}`;
        if (hasFlag(u.statuses, flagKey)) continue;
        addStatus(u, { kind: 'flag', key: flagKey, value: 1, mode: 'add' }, ctx, op.duration ?? 'permanent');
      }
      return true;
    }
    case 'drainMarks': {
      // P6 坚强：己方回合结束尽可能多减（≤amount）标记，并扣等量血（直接扣血，不走伤害通道）。
      // P7-2：amount:'full' 表示减光全部标记（此前写成 0，导致「尽可能多减」实际一点都减不掉）。
      const key = op.key ?? 'mark';
      const max = op.amount === 'full' ? Number.POSITIVE_INFINITY : op.amount ?? 3;
      for (const u of resolveRef(ctx, op.ref)) {
        if (u.dead) continue;
        const spent = Math.min(markValue(u.statuses, key), Math.max(0, max));
        if (spent <= 0) continue;
        // P7-4：标记扣血也算受伤，先过统一反应窗口；反应技能给了免疫就整份不进血。
        ctx.reactionGate?.(u.id, 'damage');
        const immune = tryConsumeImmune(u.statuses, 'skill');
        if (immune.blocked) {
          u.statuses = immune.statuses;
          ctx.events.push({ type: 'immune', unit: u.id, source: 'markDrain' } as never);
          continue;
        }
        const cut = removeMark(u.statuses, key, spent);
        u.statuses = cut.statuses;
        u.hp -= cut.removed;
        // P7-2 X3/X4：标记流失也是「血量减少」，计入受击触发的增量。
        u.hpLostThisBigTurn = (u.hpLostThisBigTurn ?? 0) + cut.removed;
        ctx.events.push({ type: 'markDrain', unit: u.id, amount: cut.removed, hpAfter: u.hp } as never);
      }
      return true;
    }
    case 'holdDying': {
      // P6 套索（QA-25）：保持濒死，且除牛仔本人外不可被救援。
      for (const u of resolveRef(ctx, op.ref)) {
        addStatus(u, { kind: 'flag', key: 'holdDying', value: 1, mode: 'add' }, ctx, op.duration ?? duration);
        if (!hasFlag(u.statuses, 'cannotBeRescued')) {
          addStatus(u, { kind: 'flag', key: 'cannotBeRescued', value: 1, mode: 'add' }, ctx, op.duration ?? duration);
        }
      }
      return true;
    }
    case 'deferredRescue': {
      // P6 套索：把「牛仔存活则不扣血救援」排到牛仔的下个己方回合开始。
      if (!ctx.pending) {
        ctx.unsupported?.push('deferredRescue:no-queue');
        return false;
      }
      const source = findUnitById(ctx.units, ctx.sourceId);
      if (!source) return true;
      for (const u of resolveRef(ctx, op.ref)) {
        ctx.pending.push({
          side: source.side,
          when: 'nextOwnTurnStart',
          ops: [{ op: 'rescueHeld', ref: 'target' }],
          sourceId: source.id,
          targetId: u.id,
        });
      }
      return true;
    }
    case 'rescueHeld': {
      // P6 套索到期结算：清掉本条技能挂的状态；目标仍濒死且牛仔存活时不扣血救援。
      const source = findUnitById(ctx.units, ctx.sourceId);
      const ref = op.ref ? resolveRef(ctx, op.ref) : [findUnitById(ctx.units, ctx.targetId)].filter((u): u is EffectUnit => Boolean(u));
      for (const u of ref) {
        if (u.dead || !hasFlag(u.statuses, 'holdDying')) continue;
        u.statuses = u.statuses.filter(
          (s) =>
            !(s.kind === 'flag' && (s.key === 'holdDying' || s.key === 'cannotBeRescued'))
            && !((s.key === 'sealed' || s.key.startsWith('untargetable:') || s.kind === 'immune') && s.source === ctx.sourceId),
        );
        if (u.hp > 0) {
          ctx.events.push({ type: 'holdDyingEnd', unit: u.id } as never);
          continue;
        }
        if (!source || source.dead) continue;
        const result = applyRescue(
          withRescueStatuses(u as never),
          [withRescueStatuses(source as never)],
          { kind: 'ally', rescuerId: source.id, cost: 0, useBodyOnly: false },
        );
        Object.assign(u, result.target);
        ctx.events.push(
          result.dead
            ? ({ type: 'death', unit: u.id } as never)
            : ({ type: 'rescue', rescuer: source.id, target: u.id, cost: 0 } as never),
        );
      }
      return true;
    }
    case 'custom': {
      ctx.unsupported?.push(`custom:${op.key ?? ''}`);
      ctx.events.push({ type: 'unsupportedEffect', key: op.key ?? '', note: op.note ?? '' });
      return false;
    }
    default: {
      ctx.unsupported?.push(`op:${op.op}`);
      return false;
    }
  }
}

/** 依次执行整组 op；op 自带的 duration 覆盖技能级 duration。排程 op（when）跳过。 */
export function runEffect(ctx: EffectContext, effect: { ops: OpSpec[]; duration?: string }): void {
  const prevGroup = ctx.currentGroup;
  for (const op of effect.ops) {
    if (op.when) continue;
    // P7 E2：op.group 透传给 addStatus，便于按组整批撤销（野性伙伴）。
    ctx.currentGroup = op.group ?? prevGroup;
    applyOp(op, ctx, op.duration ?? effect.duration);
  }
  ctx.currentGroup = prevGroup;
}

/**
 * P5-15：取出技能分支。技能没有 branches 时返回 null（走技能级 ops）。
 * 有 branches 但 variant 缺省/非法时抛错，错误信息里带上可选分支名。
 */
export function selectBranch(
  effect: { branches?: EffectBranch[] },
  variant?: string | number,
  clock?: { bigTurn: number },
): EffectBranch | null {
  const branches = effect.branches;
  if (!branches || branches.length === 0) return null;
  const labels = branches.map((b) => b.label).join(' / ');
  const key = variant === undefined || variant === null ? '' : String(variant);
  if (key === '') throw new Error(`该技能需要选择分支：${labels}`);
  const hit = branches.find((b) => b.label === key)
    ?? (/^\d+$/.test(key) ? branches[Number(key)] : undefined);
  if (!hit) throw new Error(`没有该分支：${key}（可选：${labels}）`);
  // P5：冷静信件「首回合不可用」。
  if (hit.if === 'notFirstBigTurn' && clock && clock.bigTurn === 1) throw new Error(`第 1 回合不可使用「${hit.label}」`);
  return hit;
}

/** 执行选中的分支（branch.duration 优先于技能级 duration）。 */
export function runBranch(
  ctx: EffectContext,
  effect: { duration?: string },
  branch: EffectBranch,
): void {
  runEffect(ctx, { ops: branch.ops, duration: branch.duration ?? effect.duration });
}

/** 伤害前的免疫/减伤/倍率（game.ts 的攻击结算复用）。 */
export function finalizeDamage(unit: EffectUnit, raw: number, scope: 'damage' | 'skill' | 'all' = 'damage'): number {
  let value = raw;
  const immune = tryConsumeImmune(unit.statuses, scope);
  if (immune.blocked) {
    unit.statuses = immune.statuses;
    return 0;
  }
  value = value * damageMultiplier(unit.statuses) + damageTakenAdjust(unit.statuses);
  const shield = consumeShield(unit.statuses, Math.max(0, value));
  unit.statuses = shield.statuses;
  return Math.max(0, Math.round(value - shield.absorbed));
}

/** 界面用：某单位当前护盾合计。 */
export function shieldOf(unit: EffectUnit): number {
  return totalShield(unit.statuses);
}

/** 界面用：某单位某项属性的当前值。 */
export function currentAtk(unit: EffectUnit, clock: TurnClock): number {
  const penalty = clock.bigTurn === 1 ? 1 : 0;
  return Math.max(0, statOf(unit.atk, unit.statuses, 'atk') - penalty);
}

/** 一次「加血」：可突破上限（D05）。 */
export function healAdding(unit: EffectUnit, amount: number): void {
  if (hasFlag(unit.statuses, 'noHeal')) return;
  Object.assign(unit, healByAdding(unit as Combatant, amount), { statuses: unit.statuses });
}

export const kindOf = (e: SkillEffect | null): ImplLevel => (e ? e.impl : 'none');
