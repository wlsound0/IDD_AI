"use strict";
// 回合时钟（机制 R08 / R26 / R34）。
//
// R08：除非特殊声明，否则「一回合」= 先手回合 + 后手回合。
// R26/R34：「回合结束时」默认指大回合结束；「己方/敌方/先手/后手结束时」指小回合结束。
// 因此所有触发器都必须声明自己属于哪个时间单位，不能混用。
Object.defineProperty(exports, "__esModule", { value: true });
exports.createClock = createClock;
exports.endSmallTurn = endSmallTurn;
exports.endsBigTurn = endsBigTurn;
exports.turnEndUnits = turnEndUnits;
exports.isFirstTurnPenaltyActive = isFirstTurnPenaltyActive;
function createClock() {
    return { bigTurn: 1, phase: 'first', smallTurnsDone: 0 };
}
/**
 * 结束当前小回合，返回新时钟。
 * 先手小回合结束 -> 进入后手小回合；后手小回合结束 -> 大回合 +1，回到先手小回合。
 */
function endSmallTurn(clock) {
    if (clock.phase === 'first') {
        return { bigTurn: clock.bigTurn, phase: 'second', smallTurnsDone: 1 };
    }
    return { bigTurn: clock.bigTurn + 1, phase: 'first', smallTurnsDone: 0 };
}
/** 该小回合的结束是否同时构成大回合结束。 */
function endsBigTurn(clock) {
    return clock.phase === 'second';
}
/**
 * 判断一个「回合结束」事件当前应当触发哪一类效果（R26）。
 * 大小回合是两套语义，实现里必须分开挂载。
 */
function turnEndUnits(clock) {
    return endsBigTurn(clock) ? ['small', 'big'] : ['small'];
}
/** 第一回合所有角色攻击 -1（机制 R15）：只在大回合 1 期间生效。 */
function isFirstTurnPenaltyActive(clock) {
    return clock.bigTurn === 1;
}
//# sourceMappingURL=turn.js.map