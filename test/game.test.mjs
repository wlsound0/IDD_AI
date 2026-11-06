import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, legalAttackTargets } from '../temp/build/core/game.js';

const u = (over) => ({
  id: 'a',
  name: 'A',
  side: 'first',
  slot: 1,
  atk: 3,
  hp: 5,
  maxHp: 5,
  initialMaxHp: 5,
  tempHp: 0,
  ...over,
});

const twoSides = (firstOver = {}, secondOver = {}) =>
  createGame([
    u({ id: 'A', side: 'first', slot: 1, ...firstOver }),
    u({ id: 'B', side: 'second', slot: 1, ...secondOver }),
  ]);

describe('单场闭环', () => {
  it('开局先手行动，攻击造成伤害（首回合 -1）', () => {
    const s0 = twoSides();
    const { state, events } = applyAction(s0, { type: 'attack', attackerId: 'A', targetId: 'B' });
    assert.equal(state.units.find((x) => x.id === 'B').hp, 3);
    assert.equal(events[0].type, 'attack');
    assert.equal(events[0].damage, 2);
  });

  it('D10 同一角色每大回合只能攻击一次', () => {
    const s0 = twoSides();
    const { state } = applyAction(s0, { type: 'attack', attackerId: 'A', targetId: 'B' });
    assert.throws(() => applyAction(state, { type: 'attack', attackerId: 'A', targetId: 'B' }), /已攻击过/);
  });

  it('不能攻击非当前行动方的角色', () => {
    const s0 = twoSides();
    assert.throws(() => applyAction(s0, { type: 'attack', attackerId: 'B', targetId: 'A' }), /不是该角色的行动小回合/);
  });

  it('结束小回合后交换行动方，大回合 2 解除首回合 -1 与攻击限制', () => {
    let s = twoSides();
    s = applyAction(s, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    s = applyAction(s, { type: 'endTurn' }).state;
    assert.equal(s.clock.phase, 'second');
    s = applyAction(s, { type: 'endTurn' }).state;
    assert.equal(s.clock.bigTurn, 2);
    assert.equal(s.clock.phase, 'first');
    const { events } = applyAction(s, { type: 'attack', attackerId: 'A', targetId: 'B' });
    assert.equal(events[0].damage, 3);
  });

  it('击杀后目标死亡，对方全灭即判胜', () => {
    const s0 = twoSides({ atk: 5 }, { hp: 2 });
    const { state, events } = applyAction(s0, { type: 'attack', attackerId: 'A', targetId: 'B' });
    assert.equal(state.units.find((x) => x.id === 'B').dead, true);
    assert.equal(state.winner, 'first');
    assert.ok(events.some((e) => e.type === 'death'));
    assert.ok(events.some((e) => e.type === 'victory'));
  });

  it('反伤取受击方当前攻击力', () => {
    const s0 = createGame([
      u({ id: 'A', atk: 4, hp: 5 }),
      u({ id: 'B', atk: 2, hp: 10, side: 'second', hasReflect: true }),
    ]);
    let s = applyAction(s0, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'endTurn' }).state;
    const { state, events } = applyAction(s, { type: 'attack', attackerId: 'A', targetId: 'B' });
    const reflect = events.find((e) => e.type === 'reflect');
    assert.ok(reflect);
    assert.equal(reflect.damage, 2);
    assert.equal(state.units.find((x) => x.id === 'A').hp, 3);
  });

  it('双方都不进攻，四小回合后由最后进攻方获胜', () => {
    let s = twoSides({ hp: 10 }, { hp: 10 });
    s = applyAction(s, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    for (let i = 0; i < 5; i++) s = applyAction(s, { type: 'endTurn' }).state;
    assert.equal(s.winner, 'first');
    assert.equal(s.victory.smallTurnsWithoutAttack, 4);
  });

  it('可为濒死单位指定救援者，目标按初始上限减半复活', () => {
    const s0 = createGame([
      u({ id: 'A', atk: 5, hp: 5 }),
      u({ id: 'B', atk: 1, hp: 2, maxHp: 5, initialMaxHp: 2, side: 'second' }),
      u({ id: 'C', atk: 1, hp: 5, side: 'second', slot: 2, hasRescue: true, mustUseBodyForRescue: true }),
    ]);
    const hit = applyAction(s0, { type: 'attack', attackerId: 'A', targetId: 'B' });
    assert.equal(hit.state.units.find((x) => x.id === 'B').dead, false, '有救援者时应停在濒死而不是直接死');
    const saved = applyAction(hit.state, { type: 'rescue', targetId: 'B', rescuerId: 'C' });
    const b = saved.state.units.find((x) => x.id === 'B');
    assert.equal(b.hp, 1); // ceil(2/2)
    assert.equal(b.maxHp, 1);
    assert.equal(saved.state.units.find((x) => x.id === 'C').hp, 3);
  });

  it('拒绝救援则立即死亡', () => {
    const s0 = createGame([
      u({ id: 'A', atk: 5, hp: 5 }),
      u({ id: 'B', atk: 1, hp: 2, maxHp: 5, initialMaxHp: 2, side: 'second' }),
      u({ id: 'C', atk: 1, hp: 5, side: 'second', slot: 2, hasRescue: true, mustUseBodyForRescue: true }),
    ]);
    const hit = applyAction(s0, { type: 'attack', attackerId: 'A', targetId: 'B' });
    const dead = applyAction(hit.state, { type: 'rescue', targetId: 'B', rescuerId: null });
    assert.equal(dead.state.units.find((x) => x.id === 'B').dead, true);
  });

  it('legalAttackTargets 排除己方与阵亡单位', () => {
    const s0 = twoSides();
    assert.deepEqual(legalAttackTargets(s0, 'A').map((x) => x.id), ['B']);
  });

  it('applyAction 不修改入参状态', () => {
    const s0 = twoSides();
    const before = JSON.stringify(s0.units);
    applyAction(s0, { type: 'attack', attackerId: 'A', targetId: 'B' });
    assert.equal(JSON.stringify(s0.units), before);
  });
});

describe('投降', () => {
  it('任意一方投降，对方立即获胜并留日志', () => {
    const s0 = twoSides();
    const { state, events } = applyAction(s0, { type: 'resign', side: 'first' });
    assert.equal(state.winner, 'second');
    assert.equal(events[0].type, 'resign');
    assert.equal(events[1].type, 'victory');
    assert.equal(events[1].reason, '对方投降');
    assert.equal(state.units.find((x) => x.id === 'A').dead, false);
  });

  it('濒死队列未处理时也能投降', () => {
    const s0 = createGame([
      u({ id: 'A', side: 'first', slot: 1 }),
      u({ id: 'B', side: 'second', slot: 1, hp: 1, maxHp: 1, initialMaxHp: 1 }),
      u({ id: 'C', side: 'second', slot: 2, hasRescue: true }),
    ]);
    const hit = applyAction(s0, { type: 'attack', attackerId: 'A', targetId: 'B' });
    assert.ok(hit.state.dyingQueue.length > 0);
    const resigned = applyAction(hit.state, { type: 'resign', side: 'second' });
    assert.equal(resigned.state.winner, 'first');
  });

  it('已分胜负后投降不再改变结果', () => {
    const s0 = twoSides();
    const won = applyAction(s0, { type: 'resign', side: 'second' }).state;
    const again = applyAction(won, { type: 'resign', side: 'first' });
    assert.equal(again.state.winner, 'first');
    assert.deepEqual(again.events, []);
  });
});
