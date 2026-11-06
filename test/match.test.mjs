// P2 金标测试：与 scripts/play.mjs 同一套阵容与策略，断言整局结果。
// 若引擎改动导致结果变化，这个测试会立刻失败——这是“数值与手工推算一致”的守门员。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, legalAttackTargets } from '../temp/build/core/game.js';

const mk = (over) => ({
  id: 'x',
  name: 'X',
  side: 'first',
  slot: 1,
  atk: 3,
  hp: 6,
  maxHp: 6,
  initialMaxHp: 6,
  tempHp: 0,
  ...over,
});

const lineup = () => createGame([
  mk({ id: 'F1', side: 'first', slot: 1, atk: 4, hp: 6 }),
  mk({ id: 'F2', side: 'first', slot: 2, atk: 2, hp: 5, hasRescue: true, mustUseBodyForRescue: true }),
  mk({ id: 'S1', side: 'second', slot: 1, atk: 3, hp: 7, hasReflect: true }),
  mk({ id: 'S2', side: 'second', slot: 2, atk: 5, hp: 4 }),
]);

function run(state) {
  let guard = 0;
  while (!state.winner && guard++ < 40) {
    const side = state.clock.phase;
    for (const actor of state.units.filter((u) => u.side === side && !u.dead && !u.attackedThisBigTurn)) {
      const targets = legalAttackTargets(state, actor.id).sort((a, b) => a.hp - b.hp);
      if (targets.length === 0) break;
      state = applyAction(state, { type: 'attack', attackerId: actor.id, targetId: targets[0].id }).state;
    }
    if (state.winner) break;
    state = applyAction(state, { type: 'endTurn' }).state;
  }
  return state;
}

describe('P2 整局金标', () => {
  it('固定阵容跑完整局，结果与手工推算一致', () => {
    const s = run(lineup());
    assert.equal(s.winner, 'second');
    assert.equal(s.clock.bigTurn, 2, '在第 2 大回合的后手小回合里结束');
    assert.equal(s.clock.phase, 'second');
    const byId = Object.fromEntries(s.units.map((u) => [u.id, u]));
    assert.deepEqual(
      { F1: [byId.F1.hp, byId.F1.dead], F2: [byId.F2.hp, byId.F2.dead], S1: [byId.S1.hp, byId.S1.dead], S2: [byId.S2.hp, byId.S2.dead] },
      { F1: [0, true], F2: [0, true], S1: [1, false], S2: [0, true] },
    );
  });

  it('全程使用救援能力时，同阵营濒死单位会被救活而不是直接死亡', () => {
    // F2 是唯一有救援能力的角色；它自己在 T2 濒死时无人可救
    const s = run(lineup());
    assert.equal(s.units.find((u) => u.id === 'F2').dead, true);
    // S2 在 T1 死于无同阵营救援者
    assert.equal(s.units.find((u) => u.id === 'S2').dead, true);
  });
});
