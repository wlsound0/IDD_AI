"use strict";
// 胜负判定。依据：机制 R25 + 裁决落地 D11（Q08）/ D12（Q07）。
//
// D11：
//   反伤同死、双方卡死、双方都不进攻 → 最后一次发起进攻的一方获胜。
//   一方无法进攻、另一方有但不进攻 → 无法进攻的一方获胜。
// D12：僵持计数从「没有发起进攻」的第一个小回合/大回合开始累加。
Object.defineProperty(exports, "__esModule", { value: true });
exports.STALEMATE_BIG_TURNS = exports.STALEMATE_SMALL_TURNS = void 0;
exports.createVictoryState = createVictoryState;
exports.recordAttack = recordAttack;
exports.endSmallTurnWithoutAttack = endSmallTurnWithoutAttack;
exports.bigTurnsWithoutAttack = bigTurnsWithoutAttack;
exports.checkVictory = checkVictory;
exports.winnerAgainst = winnerAgainst;
exports.STALEMATE_SMALL_TURNS = 4;
exports.STALEMATE_BIG_TURNS = 2;
const other = (s) => (s === 'first' ? 'second' : 'first');
function createVictoryState(alive, canAttack) {
    return { alive, canAttack, lastAggressor: null, smallTurnsWithoutAttack: 0 };
}
/** 记录一次进攻：清空僵持计数。 */
function recordAttack(state, side) {
    return { ...state, lastAggressor: side, smallTurnsWithoutAttack: 0 };
}
/** 一个小回合结束时调用：若该回合无人进攻，计数 +1。 */
function endSmallTurnWithoutAttack(state) {
    return { ...state, smallTurnsWithoutAttack: state.smallTurnsWithoutAttack + 1 };
}
/** 由小回合数推出大回合数（一个大回合 = 两个小回合）。 */
function bigTurnsWithoutAttack(state) {
    return Math.floor(state.smallTurnsWithoutAttack / exports.STALEMATE_BIG_TURNS);
}
function checkVictory(state) {
    const { alive, canAttack, lastAggressor } = state;
    // 1. 双方同死：最后一次发起进攻的一方获胜。
    if (alive.first <= 0 && alive.second <= 0) {
        return { winner: lastAggressor, reason: 'mutual-destruction' };
    }
    // 2. 单方全灭。
    if (alive.first <= 0)
        return { winner: 'second', reason: 'annihilation' };
    if (alive.second <= 0)
        return { winner: 'first', reason: 'annihilation' };
    // 3. 一方无法进攻：两大回合后，无法进攻的一方获胜。
    const firstCannot = !canAttack.first;
    const secondCannot = !canAttack.second;
    if (firstCannot !== secondCannot && bigTurnsWithoutAttack(state) >= exports.STALEMATE_BIG_TURNS) {
        return { winner: firstCannot ? 'first' : 'second', reason: 'stalemate-one-cannot-attack' };
    }
    // 4. 双方都能进攻但都不动手：四小回合后，最后进攻方获胜。
    if (!firstCannot && !secondCannot && state.smallTurnsWithoutAttack >= exports.STALEMATE_SMALL_TURNS) {
        return { winner: lastAggressor, reason: 'stalemate-both-can-attack' };
    }
    return { winner: null, reason: null };
}
/** 在一方全灭时取另一方，便于外部直接用。 */
function winnerAgainst(side) {
    return other(side);
}
//# sourceMappingURL=victory.js.map