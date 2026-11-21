// 道具层（P5）：道具栏、价格（含折扣/涨价）、使用校验、预算扣费。
//
// 规则依据：R24（道具无商店，唯一来源是技能；每次使用消耗花费；不足则不可用），
// P4 已定的 14k 剩余按 1:2 折算 → GameState.itemBudget 是本小局的道具预算。

import type { OwnedItem } from './effects';
import { hasFlag } from './status';
import type { Status } from './status';
import type { Side } from './types';

export interface ItemRef {
  id: string;
  name: string;
  /** 数据表里的原始花费（1k = 1000）。 */
  cost: number | null;
}

export interface PriceInput {
  item: ItemRef;
  /** 道具栏实例上记录的实际花费，null 表示按数据表。 */
  owned?: OwnedItem;
  statuses: Status[];
}

/** 折扣状态 key：`itemDiscount:<itemId>` / `itemDiscount:*`
 *  P6（QA-33/36）扩展两种作用域：
 *  - `itemDiscount:once:<itemId>`：只对下一次购买生效，买完即清（不累积）。
 *  - `itemDiscount:turn:<itemId>`：每小回合第一次购买生效，用过本回合不再生效。
 *  数值口径：正数 = 加价，负数 = 减价，单位与价格一致（1k = 1000）。
 */
type DiscountScope = 'persistent' | 'once' | 'turn';

interface ParsedDiscount {
  scope: DiscountScope;
  item: string;
  value: number;
}

function parseDiscount(s: Status): ParsedDiscount | null {
  if (s.kind !== 'flag' || !s.key.startsWith('itemDiscount:')) return null;
  const rest = s.key.slice('itemDiscount:'.length);
  const scoped = /^(once|turn):(.+)$/.exec(rest);
  if (scoped) return { scope: scoped[1] as 'once' | 'turn', item: scoped[2], value: s.value };
  return { scope: 'persistent', item: rest, value: s.value };
}

const usedKey = (itemId: string) => `itemUsedThisTurn:${itemId}`;

/** 本小回合是否已用过该道具（用于 turn 作用域）。 */
function usedThisTurn(statuses: Status[], itemId: string): boolean {
  return hasFlag(statuses, usedKey(itemId));
}

/** 当前生效的折扣（turn 作用域在用过之后不再计入）。 */
function discountsFor(statuses: Status[], itemId: string): ParsedDiscount[] {
  const out: ParsedDiscount[] = [];
  for (const s of statuses) {
    const d = parseDiscount(s);
    if (!d) continue;
    if (d.item !== '*' && d.item !== itemId) continue;
    if (d.scope === 'turn' && usedThisTurn(statuses, itemId)) continue;
    out.push(d);
  }
  return out;
}

function discountFor(statuses: Status[], itemId: string): number {
  return discountsFor(statuses, itemId).reduce((n, d) => n + d.value, 0);
}

export function itemPrice({ item, owned, statuses }: PriceInput): number {
  const base = owned?.cost ?? item.cost ?? 0;
  return Math.max(0, base + discountFor(statuses, item.id));
}

let discountSeq = 0;

/** 购买后消费折扣（P6）：once 立即清除；turn 记下「本小回合已用」，到下个小回合开始自动过期。 */
export function consumeItemDiscounts(
  statuses: Status[],
  itemId: string,
  unitId: string,
  clock: { bigTurn: number; phase: Side },
): Status[] {
  const applied = discountsFor(statuses, itemId);
  if (!applied.length) return statuses;
  let next = statuses;
  if (applied.some((d) => d.scope === 'once')) {
    next = next.filter((s) => {
      const d = parseDiscount(s);
      return !(d && d.scope === 'once' && (d.item === itemId || d.item === '*'));
    });
  }
  if (applied.some((d) => d.scope === 'turn') && !usedThisTurn(next, itemId)) {
    next = [
      ...next,
      {
        id: `itemUsed-${++discountSeq}`,
        kind: 'flag',
        key: usedKey(itemId),
        value: 1,
        mode: 'add',
        expiresAt: { bigTurn: clock.bigTurn, phase: clock.phase, at: 'end' },
        source: unitId,
        note: '本小回合已用过该道具（每回合首个折扣已消耗）',
      },
    ];
  }
  return next;
}

export interface BudgetState {
  /** 本小局剩余道具预算，单位与 itemPrice 一致。 */
  remaining: Record<Side, number>;
}

export function canPay(budget: BudgetState, side: Side, price: number): boolean {
  return budget.remaining[side] >= price;
}

export function pay(budget: BudgetState, side: Side, price: number): BudgetState {
  return {
    remaining: { ...budget.remaining, [side]: budget.remaining[side] - price },
  };
}

/** 道具是否可用：未被封印、未被本回合锁住。
 *  P6-Q10：锁定分两种——旧的整名角色锁定 `itemLockedThisTurn`，与道具级 `itemLock:<itemId>`。 */
export function itemLocked(statuses: Status[], itemId: string): boolean {
  return hasFlag(statuses, 'itemLockedThisTurn') || hasFlag(statuses, `itemLock:${itemId}`);
}

export function itemUsable(owned: OwnedItem, statuses: Status[]): boolean {
  if (owned.lockedThisTurn) return false;
  if (itemLocked(statuses, owned.itemId)) return false;
  if (hasFlag(statuses, 'sealed')) return false;
  return true;
}

export function itemIndexByCost(items: OwnedItem[], candidate: ItemRef[]): number {
  // 道具栏里同一道具可能有多个实例，按出现顺序使用第一个可用（含花费差异）。
  const wanted = new Set(candidate.map((c) => c.id));
  return items.findIndex((i) => wanted.has(i.itemId));
}
