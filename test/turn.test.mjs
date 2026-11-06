import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createClock,
  endSmallTurn,
  endsBigTurn,
  turnEndUnits,
  isFirstTurnPenaltyActive,
} from '../temp/build/core/turn.js';

describe('R08/R26 回合时钟', () => {
  it('开局为先手小回合，大回合 1', () => {
    assert.deepEqual(createClock(), { bigTurn: 1, phase: 'first', smallTurnsDone: 0 });
  });

  it('先手小回合结束后进入后手小回合，大回合不变', () => {
    const c = endSmallTurn(createClock());
    assert.equal(c.bigTurn, 1);
    assert.equal(c.phase, 'second');
  });

  it('后手小回合结束后大回合 +1 并回到先手', () => {
    assert.deepEqual(endSmallTurn(endSmallTurn(createClock())), {
      bigTurn: 2,
      phase: 'first',
      smallTurnsDone: 0,
    });
  });

  it('只有后手小回合结束才构成大回合结束', () => {
    const c = createClock();
    assert.equal(endsBigTurn(c), false);
    assert.equal(endsBigTurn(endSmallTurn(c)), true);
  });

  it('回合结束事件按时间单位分流', () => {
    const c = createClock();
    assert.deepEqual(turnEndUnits(c), ['small']);
    assert.deepEqual(turnEndUnits(endSmallTurn(c)), ['small', 'big']);
  });

  it('R15 首回合攻击 -1 只在大回合 1 生效', () => {
    let c = createClock();
    assert.equal(isFirstTurnPenaltyActive(c), true);
    c = endSmallTurn(c);
    assert.equal(isFirstTurnPenaltyActive(c), true);
    c = endSmallTurn(c);
    assert.equal(isFirstTurnPenaltyActive(c), false);
  });
});
