import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createVictoryState,
  checkVictory,
  recordAttack,
  endSmallTurnWithoutAttack,
  bigTurnsWithoutAttack,
} from '../temp/build/core/victory.js';

describe('D11 胜负判定', () => {
  it('一方全员死亡，另一方获胜', () => {
    const s = createVictoryState({ first: 0, second: 2 }, { first: false, second: true });
    assert.deepEqual(checkVictory(s), { winner: 'second', reason: 'annihilation' });
  });

  it('双方同死时，最后发起进攻的一方获胜', () => {
    let s = createVictoryState({ first: 0, second: 0 }, { first: false, second: false });
    s = recordAttack(s, 'first');
    assert.deepEqual(checkVictory(s), { winner: 'first', reason: 'mutual-destruction' });
  });

  it('双方同死且从未进攻过时没有胜者', () => {
    const s = createVictoryState({ first: 0, second: 0 }, { first: false, second: false });
    // 没有「最后进攻方」可判，只能记为同归于尽但无胜者
    assert.deepEqual(checkVictory(s), { winner: null, reason: 'mutual-destruction' });
  });

  it('双方都能进攻但四小回合不动手：最后进攻方获胜', () => {
    let s = createVictoryState({ first: 2, second: 2 }, { first: true, second: true });
    s = recordAttack(s, 'second');
    for (let i = 0; i < 4; i++) s = endSmallTurnWithoutAttack(s);
    assert.deepEqual(checkVictory(s), { winner: 'second', reason: 'stalemate-both-can-attack' });
  });

  it('不足四小回合时不判负', () => {
    let s = createVictoryState({ first: 2, second: 2 }, { first: true, second: true });
    for (let i = 0; i < 3; i++) s = endSmallTurnWithoutAttack(s);
    assert.equal(checkVictory(s).winner, null);
  });

  it('一方无法进攻，两大回合后由无法进攻方获胜', () => {
    let s = createVictoryState({ first: 2, second: 2 }, { first: true, second: false });
    for (let i = 0; i < 4; i++) s = endSmallTurnWithoutAttack(s);
    assert.equal(bigTurnsWithoutAttack(s), 2);
    assert.deepEqual(checkVictory(s), { winner: 'second', reason: 'stalemate-one-cannot-attack' });
  });

  it('无法进攻方在一大回合时还不够', () => {
    let s = createVictoryState({ first: 2, second: 2 }, { first: true, second: false });
    for (let i = 0; i < 2; i++) s = endSmallTurnWithoutAttack(s);
    assert.equal(checkVictory(s).winner, null);
  });

  it('进攻会清空僵持计数（D12 从零开始计）', () => {
    let s = createVictoryState({ first: 2, second: 2 }, { first: true, second: true });
    for (let i = 0; i < 3; i++) s = endSmallTurnWithoutAttack(s);
    s = recordAttack(s, 'first');
    assert.equal(s.smallTurnsWithoutAttack, 0);
    assert.equal(s.lastAggressor, 'first');
    assert.equal(checkVictory(s).winner, null);
  });
});
