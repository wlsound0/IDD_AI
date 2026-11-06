// 用 node:test 而不是 vitest：本机沙箱禁止子进程管道，vite/vitest 在启动时会 exec 外部命令而被拦截。
// 运行方式见 package.json 的 test 脚本（先 tsc 编译 core 到 temp/build，再用 node --test）。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sortEffects, resolveEffects } from '../temp/build/core/settlement.js';

const e = (id, targetSide, targetSlot, source, seq) => ({ id, targetSide, targetSlot, source, seq });
const ids = (list) => list.map((x) => x.id);

describe('R21 结算顺序', () => {
  it('按站位交错：先手1 -> 后手1 -> 先手2 -> 后手2', () => {
    const input = [
      e('first2', 'first', 2, 'self', 0),
      e('second1', 'second', 1, 'self', 1),
      e('first1', 'first', 1, 'self', 2),
      e('second2', 'second', 2, 'self', 3),
    ];
    assert.deepEqual(ids(sortEffects(input)), ['first1', 'second1', 'first2', 'second2']);
  });

  it('同一角色：本角色特性 > 己方道具/技能 > 敌方效果', () => {
    const input = [
      e('enemy', 'first', 1, 'enemy', 0),
      e('ally', 'first', 1, 'ally', 1),
      e('self', 'first', 1, 'self', 2),
    ];
    assert.deepEqual(ids(sortEffects(input)), ['self', 'ally', 'enemy']);
  });

  it('同级按入队顺序，保证稳定', () => {
    const input = [e('b', 'first', 1, 'ally', 1), e('a', 'first', 1, 'ally', 0)];
    assert.deepEqual(ids(sortEffects(input)), ['a', 'b']);
  });

  it('不修改入参数组', () => {
    const input = [e('b', 'second', 1, 'self', 1), e('a', 'first', 1, 'self', 0)];
    const snapshot = ids(input);
    sortEffects(input);
    assert.deepEqual(ids(input), snapshot);
  });

  it('resolveEffects 跳过被取消的效果，并按序返回已结算者', () => {
    const input = [e('a', 'first', 1, 'self', 0), e('b', 'first', 1, 'ally', 1)];
    const seen = [];
    const done = resolveEffects(input, (x) => {
      seen.push(x.id);
      return x.id !== 'a';
    });
    assert.deepEqual(seen, ['a', 'b']);
    assert.deepEqual(ids(done), ['b']);
  });
});
