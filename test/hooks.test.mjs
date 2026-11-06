import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry, makeEvent } from '../temp/build/core/hooks.js';

const hook = (id, over) => ({
  id,
  point: 'afterDamaged',
  ownerSide: 'first',
  ownerSlot: 1,
  relation: 'self',
  handler: () => {},
  ...over,
});

describe('钩子系统', () => {
  it('按 R21 的站位交错顺序执行', () => {
    const reg = createRegistry();
    const order = [];
    reg.register(hook('s1', { ownerSide: 'first', ownerSlot: 1, handler: () => order.push('s1') }));
    reg.register(hook('t1', { ownerSide: 'second', ownerSlot: 1, handler: () => order.push('t1') }));
    reg.register(hook('s2', { ownerSide: 'first', ownerSlot: 2, handler: () => order.push('s2') }));
    reg.emit('afterDamaged', makeEvent('afterDamaged'));
    assert.deepEqual(order, ['s1', 't1', 's2']);
  });

  it('同一角色内按 本角色 > 己方 > 敌方 排序', () => {
    const reg = createRegistry();
    const order = [];
    for (const rel of ['enemy', 'ally', 'self']) {
      reg.register(hook(rel, { relation: rel, handler: () => order.push(rel) }));
    }
    reg.emit('afterDamaged', makeEvent('afterDamaged'));
    assert.deepEqual(order, ['self', 'ally', 'enemy']);
  });

  it('钩子返回 true 即拦截，后续不再执行', () => {
    const reg = createRegistry();
    const order = [];
    reg.register(hook('a', { handler: () => { order.push('a'); return true; } }));
    reg.register(hook('b', { handler: () => order.push('b') }));
    const ev = reg.emit('afterDamaged', makeEvent('afterDamaged'));
    assert.deepEqual(order, ['a']);
    assert.equal(ev.stopped, true);
  });

  it('只触发同一类事件点的钩子', () => {
    const reg = createRegistry();
    const order = [];
    reg.register(hook('damaged', { point: 'afterDamaged', handler: () => order.push('d') }));
    reg.register(hook('attack', { point: 'afterAttack', handler: () => order.push('a') }));
    reg.emit('afterAttack', makeEvent('afterAttack'));
    assert.deepEqual(order, ['a']);
  });

  it('小回合结束不会触发只声明大回合的钩子（R26）', () => {
    const reg = createRegistry();
    const order = [];
    reg.register(hook('small', { point: 'smallTurnEnd', timeUnit: 'small', handler: () => order.push('s') }));
    reg.register(hook('big', { point: 'bigTurnEnd', timeUnit: 'big', handler: () => order.push('b') }));
    reg.emit('smallTurnEnd', makeEvent('smallTurnEnd'));
    assert.deepEqual(order, ['s']);
  });

  it('注销后不再执行，含按角色批量注销', () => {
    const reg = createRegistry();
    const order = [];
    reg.register(hook('a', { handler: () => order.push('a') }));
    reg.register(hook('b', { ownerSlot: 2, handler: () => order.push('b') }));
    reg.unregister('a');
    reg.emit('afterDamaged', makeEvent('afterDamaged'));
    assert.deepEqual(order, ['b']);

    reg.unregisterOwner('first', 2);
    reg.emit('afterDamaged', makeEvent('afterDamaged'));
    assert.deepEqual(order, ['b']);
  });
});
