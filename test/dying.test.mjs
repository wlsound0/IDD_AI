// 濒死的「必须处理顺序」与救援者血量限制。
// 依据：D01（濒死立即判定）+ 本轮新增规则（同步濒死时被攻击者优先、血量不足以支付救援扣血者不可救援）。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, pendingDying, legalRescueOps } from '../temp/build/core/game.js';
import { canRescue } from '../temp/build/core/rescue.js';

const u = (over) => ({
  id: 'a',
  name: 'A',
  side: 'first',
  slot: 1,
  atk: 1,
  hp: 5,
  maxHp: 5,
  initialMaxHp: 5,
  tempHp: 0,
  ...over,
});

const rescuer = (id, side, slot) => u({ id, name: id, side, slot, atk: 0, hp: 5, maxHp: 5, initialMaxHp: 5, hasRescue: true });

describe('濒死处理顺序', () => {
  it('有人濒死时，普通操作被拒绝（必须先处理）', () => {
    // A 打 B：B 血 1 且有自己的救援者，停在「等待选择」。
    const s0 = createGame([
      u({ id: 'A', side: 'first', slot: 1, atk: 5, hp: 5, maxHp: 5, initialMaxHp: 5 }),
      u({ id: 'B', side: 'second', slot: 1, atk: 1, hp: 1, maxHp: 1, initialMaxHp: 1 }),
      rescuer('R2', 'second', 2),
      rescuer('R1', 'first', 2),
    ]);
    const s1 = applyAction(s0, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    assert.deepEqual(s1.dyingQueue, ['B']);
    assert.throws(() => applyAction(s1, { type: 'endTurn' }), /必须先处理濒死/);
    assert.throws(() => applyAction(s1, { type: 'attack', attackerId: 'R1', targetId: 'B' }), /必须先处理濒死/);
  });

  it('放弃救援立即判死，不再抛「不可被救援」', () => {
    const s0 = createGame([
      u({ id: 'A', side: 'first', slot: 1, atk: 5 }),
      u({ id: 'B', side: 'second', slot: 1, atk: 1, hp: 1, maxHp: 1, initialMaxHp: 1 }),
      rescuer('R2', 'second', 2),
      rescuer('R1', 'first', 2),
    ]);
    const s1 = applyAction(s0, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    const s2 = applyAction(s1, { type: 'rescue', targetId: 'B', rescuerId: null }).state;
    assert.equal(s2.units.find((x) => x.id === 'B').dead, true);
    assert.deepEqual(s2.dyingQueue, []);
  });

  it('无人可救的濒死，放弃救援也直接判死（不报错）', () => {
    const s0 = createGame([u({ id: 'A', side: 'first', slot: 1 }), u({ id: 'B', side: 'second', slot: 1 })]);
    // 人为构造「停在濒死且队列已登记」的状态，模拟救援者中途离场。
    const dying = { ...s0, units: s0.units.map((x) => (x.id === 'B' ? { ...x, hp: 0 } : x)), dyingQueue: ['B'] };
    assert.deepEqual(legalRescueOps(dying, 'B'), []);
    const s1 = applyAction(dying, { type: 'rescue', targetId: 'B', rescuerId: null }).state;
    assert.equal(s1.units.find((x) => x.id === 'B').dead, true);
  });

  it('同一次攻击双方都濒死：被攻击者排在前面，处理完才能碰攻击者', () => {
    const s0 = createGame([
      u({ id: 'A', side: 'first', slot: 1, atk: 5, hp: 1, maxHp: 1, initialMaxHp: 1 }), // 攻击者，血 1
      u({ id: 'B', side: 'second', slot: 1, atk: 5, hp: 1, maxHp: 1, initialMaxHp: 1, hasReflect: true }), // 被攻击者，血 1，反伤 5
      rescuer('R1', 'first', 2),
      rescuer('R2', 'second', 2),
    ]);
    const s1 = applyAction(s0, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    assert.deepEqual(s1.dyingQueue, ['B', 'A'], '被攻击者 B 必须排在攻击者 A 之前');

    // 想先处理攻击者 A → 被拒。
    assert.throws(() => applyAction(s1, { type: 'rescue', targetId: 'A', rescuerId: 'R1' }), /必须先处理濒死/);
    // 先处理 B（放弃）→ 队列只剩 A。
    const s2 = applyAction(s1, { type: 'rescue', targetId: 'B', rescuerId: null }).state;
    assert.deepEqual(s2.dyingQueue, ['A']);
  });

  it('血量不足以支付救援扣血的角色不可救援他人', () => {
    const target = u({ id: 'B', side: 'second', slot: 1, hp: 0, maxHp: 3, initialMaxHp: 3 });
    const weak = u({ id: 'W', side: 'first', slot: 2, hp: 2, maxHp: 2, initialMaxHp: 2, hasRescue: true });
    const ok = u({ id: 'O', side: 'first', slot: 3, hp: 3, maxHp: 3, initialMaxHp: 3, hasRescue: true });
    assert.equal(canRescue(target, weak), false, '血 2 救 2 会把自己救成濒死，应禁止');
    assert.equal(canRescue(target, ok), true);
    assert.deepEqual(pendingDying(createGame([u({ id: 'A', side: 'first', slot: 1 }), u({ id: 'B', side: 'second', slot: 1 })])), []);
  });
});
