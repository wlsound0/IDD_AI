// 结算顺序（机制 R21）。这条规则在文档里是完整的，不依赖任何待裁决项。
//
// 原文：回合结束/回合开始等效果的结算顺序为
//   先手一号位 -> 后手一号位 -> 先手二号位 -> 后手二号位 -> ……
//   按照受效果影响的角色排序。
//   同一角色效果按：本角色特性/技能 > 己方道具、技能 > 敌方效果；
//   同等级内按附带效果的先后顺序、技能顺序排序。

import type { PendingEffect, Side, SourceKind } from './types';

const SIDE_RANK: Record<Side, number> = { first: 0, second: 1 };
const SOURCE_RANK: Record<SourceKind, number> = { self: 0, ally: 1, enemy: 2 };

/** 排序键：站位交错 -> 来源等级 -> 入队顺序。入队顺序保证稳定。 */
export function compareEffects(a: PendingEffect, b: PendingEffect): number {
  if (a.targetSlot !== b.targetSlot) return a.targetSlot - b.targetSlot;
  if (a.targetSide !== b.targetSide) return SIDE_RANK[a.targetSide] - SIDE_RANK[b.targetSide];
  if (a.source !== b.source) return SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
  return a.seq - b.seq;
}

/** 返回新数组，不修改入参。 */
export function sortEffects(effects: readonly PendingEffect[]): PendingEffect[] {
  return [...effects].sort(compareEffects);
}

/**
 * 按顺序消费效果队列。handler 返回 false 表示该效果被取消（免疫、目标已死亡等），
 * 能力节点可选择据此重新排序剩余队列。
 */
export function resolveEffects(
  effects: readonly PendingEffect[],
  handler: (effect: PendingEffect) => boolean | void,
  onResort?: (remaining: PendingEffect[]) => PendingEffect[],
): PendingEffect[] {
  const queue = sortEffects(effects);
  const done: PendingEffect[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (handler(current) === false) continue;
    done.push(current);
    if (onResort && queue.length > 0) {
      queue.splice(0, queue.length, ...onResort(queue));
    }
  }
  return done;
}
