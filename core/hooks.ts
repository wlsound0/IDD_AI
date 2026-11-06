// 事件钩子系统：63 个被动、15 个战吼、以及各类「回合结束时」效果都挂在这里。
//
// 两条硬约束：
//   1. 执行顺序必须复用 R21（core/settlement.ts 的 sortEffects），不要再写第二套排序。
//   2. 回合结束类钩子必须声明 timeUnit（small / big），见机制 R26/R34。

import { sortEffects } from './settlement';
import type { PendingEffect, Side, SourceKind } from './types';

export type HookPoint =
  | 'battleStart' // 战吼
  | 'turnStart' // 回合（大回合）开始，充能在此 +1
  | 'smallTurnEnd' // 先手/后手小回合结束
  | 'bigTurnEnd' // 大回合结束（CD 计数在此 +1）
  | 'afterAttack'
  | 'afterDamaged'
  | 'afterSkillUsed'
  | 'onDeath';

export type TimeUnit = 'small' | 'big';

export interface HookEvent {
  point: HookPoint;
  /** 事件负载，交给各技能自行解读。 */
  payload: Record<string, unknown>;
  /** 置为 true 后，后续同点的钩子不再执行。 */
  stopped: boolean;
}

export interface HookContext {
  /** 当前回合时钟，便于钩子内取大/小回合。 */
  clock?: { bigTurn: number; phase: Side };
}

export interface HookDef {
  id: string;
  point: HookPoint;
  /** 钩子归属角色所在阵营与站位。 */
  ownerSide: Side;
  ownerSlot: number;
  /** 该效果相对归属角色的来源等级：本角色特性/技能、己方道具/技能、敌方效果。 */
  relation: SourceKind;
  /** 仅回合结束类钩子有意义；缺省视为 big。 */
  timeUnit?: TimeUnit;
  /** 返回值 true 表示拦截，后续钩子不再执行。 */
  handler: (event: HookEvent, ctx: HookContext) => boolean | void;
}

interface RegisteredHook extends HookDef {
  seq: number;
}

export class HookRegistry {
  private hooks: RegisteredHook[] = [];
  private seq = 0;

  register(def: HookDef): void {
    this.hooks.push({ ...def, seq: this.seq++ });
  }

  unregister(id: string): void {
    this.hooks = this.hooks.filter((h) => h.id !== id);
  }

  /** 移除某个角色（阵亡/离场）的全部钩子。 */
  unregisterOwner(side: Side, slot: number): void {
    this.hooks = this.hooks.filter((h) => !(h.ownerSide === side && h.ownerSlot === slot));
  }

  list(): ReadonlyArray<HookDef> {
    return this.hooks;
  }

  /**
   * 触发某一点的钩子，按 R21 顺序执行。
   * timeUnit 只对 smallTurnEnd / bigTurnEnd 生效：声明了小回合的钩子不会在大回合结束时被触发。
   */
  emit(point: HookPoint, event: HookEvent, ctx: HookContext = {}): HookEvent {
    const timeUnit: TimeUnit | undefined = point === 'smallTurnEnd' ? 'small'
      : point === 'bigTurnEnd' ? 'big'
      : undefined;

    const matched = this.hooks.filter((h) => {
      if (h.point !== point) return false;
      if (timeUnit === undefined) return true;
      const declared = h.timeUnit ?? 'big';
      if (timeUnit === 'small') return declared === 'small';
      // 大回合结束时，两类钩子都要结算，但小回合的钩子属于「先手/后手结束」语义，
      // 由调用方在 smallTurnEnd 里单独触发过，这里只跑 big。
      return declared === 'big';
    });

    const pending: PendingEffect[] = matched.map((h) => ({
      id: h.id,
      targetSide: h.ownerSide,
      targetSlot: h.ownerSlot,
      source: h.relation,
      seq: h.seq,
    }));

    const ordered = sortEffects(pending);
    const byId = new Map(matched.map((h) => [h.id, h]));

    for (const effect of ordered) {
      const hook = byId.get(effect.id);
      if (!hook) continue;
      if (event.stopped) break;
      const result = hook.handler(event, ctx);
      if (result === true) {
        event.stopped = true;
        break;
      }
    }
    return event;
  }
}

export function createRegistry(): HookRegistry {
  return new HookRegistry();
}

/** 创建一个未触发的事件对象。 */
export function makeEvent(point: HookPoint, payload: Record<string, unknown> = {}): HookEvent {
  return { point, payload, stopped: false };
}
