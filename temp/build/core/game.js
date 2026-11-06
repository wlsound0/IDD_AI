"use strict";
// 一局对战的状态机（P2 单场闭环）。
//
// 设计约束：
//   - 纯函数：applyAction(state, action) 返回新状态 + 事件日志，不改入参。
//   - 所有随机、时间、IO 都不在这里出现，保证同一脚本重跑结果一致。
//   - 伤害/救援/胜负各自已有独立模块，这里只做编排，不复制规则。
Object.defineProperty(exports, "__esModule", { value: true });
exports.otherSide = void 0;
exports.createGame = createGame;
exports.pendingDying = pendingDying;
exports.legalRescueOps = legalRescueOps;
exports.applyAction = applyAction;
exports.legalAttackTargets = legalAttackTargets;
const combat_1 = require("./combat");
const turn_1 = require("./turn");
const hooks_1 = require("./hooks");
const rescue_1 = require("./rescue");
const victory_1 = require("./victory");
const otherSide = (s) => (s === 'first' ? 'second' : 'first');
exports.otherSide = otherSide;
function createGame(units, setup) {
    const full = units.map((u) => ({
        ...u,
        dead: false,
        attackedThisBigTurn: false,
        damageTakenThisBigTurn: 0,
    }));
    const alive = { first: 0, second: 0 };
    const canAttack = { first: false, second: false };
    for (const u of full) {
        alive[u.side] += 1;
        canAttack[u.side] = true;
    }
    return {
        clock: (0, turn_1.createClock)(),
        units: full,
        victory: (0, victory_1.createVictoryState)(alive, canAttack),
        events: [{ type: 'battleStart' }],
        winner: null,
        dyingQueue: [],
        attackedThisSmallTurn: false,
        itemBudget: {
            first: setup?.itemBudget?.first ?? 0,
            second: setup?.itemBudget?.second ?? 0,
        },
    };
}
const findUnit = (units, id) => units.find((u) => u.id === id);
// 濒死（hp ≤ 0）的单位不能再行动；它要么被救活，要么下一步死亡。
const isActive = (u, phase) => u.side === phase && !u.dead && u.hp > 0;
/** 刷新胜负输入（存活数 / 是否还有进攻手段）。 */
function refreshVictory(units, victory) {
    const alive = { first: 0, second: 0 };
    const canAttack = { first: false, second: false };
    for (const u of units) {
        if (u.dead)
            continue;
        alive[u.side] += 1;
        canAttack[u.side] = true;
    }
    return { ...victory, alive, canAttack };
}
/**
 * 结算濒死：D01 立即判定。
 * 单场闭环里默认所有玩家放弃救援（P3 接入界面后再由玩家选择）。
 */
function resolveDying(units, events) {
    let next = units;
    for (const u of next) {
        if (u.dead || u.hp > 0)
            continue;
        events.push({ type: 'dying', unit: u.id });
        const judgement = (0, rescue_1.judgeDying)(u, next.filter((x) => !x.dead));
        if (judgement.outcome === 'dead') {
            next = next.map((x) => (x.id === u.id ? { ...x, dead: true } : x));
            events.push({ type: 'death', unit: u.id });
        }
        // outcome === 'choice' 时保持濒死，等待外部传入 rescue 动作
    }
    return next;
}
/** 当前仍处于濒死（hp ≤ 0 且未死）的单位 id。 */
const isDying = (units, id) => {
    const u = findUnit(units, id);
    return Boolean(u && !u.dead && u.hp <= 0);
};
/** 让队列与场上实际情况对齐：去掉已处理/已死的，按既有顺序保留，新出现的按指定顺序追加。 */
function syncQueue(units, queue, prependOrder = []) {
    const out = [];
    for (const id of [...prependOrder, ...queue]) {
        if (!isDying(units, id))
            continue;
        if (!out.includes(id))
            out.push(id);
    }
    for (const u of units) {
        if (!u.dead && u.hp <= 0 && !out.includes(u.id))
            out.push(u.id);
    }
    return out;
}
/** 还没处理的濒死单位（队首 = 必须优先处理的那个）。界面用。 */
function pendingDying(state) {
    return state.dyingQueue
        .map((id) => findUnit(state.units, id))
        .filter((u) => Boolean(u));
}
/** 某个濒死目标当前有哪些合法救援操作（不含「放弃救援」）。界面用。 */
function legalRescueOps(state, targetId) {
    const target = findUnit(state.units, targetId);
    if (!target || target.dead || target.hp > 0)
        return [];
    return (0, rescue_1.judgeDying)(target, state.units.filter((u) => !u.dead)).ops;
}
function applyAction(state, action, hooks) {
    if (state.winner)
        return { state, events: [] };
    // 投降：任意一方、任意时刻（含濒死队列未处理时）都可以直接认负。
    if (action.type === 'resign') {
        const winner = otherSide(action.side);
        const events = [
            { type: 'resign', side: action.side },
            { type: 'victory', winner, reason: '对方投降' },
        ];
        return {
            state: { ...state, winner, events: [...state.events, ...events] },
            events,
        };
    }
    const events = [];
    let queue = syncQueue(state.units, state.dyingQueue);
    // 濒死必须先处理：队列非空时只允许「处理队首」，避免玩家继续普通操作。
    if (queue.length > 0) {
        const must = findUnit(state.units, queue[0]);
        if (action.type !== 'rescue' || action.targetId !== queue[0]) {
            throw new Error(`必须先处理濒死单位：${must ? must.name : queue[0]}`);
        }
    }
    let units = state.units.map((u) => ({ ...u }));
    let victory = state.victory;
    let clock = state.clock;
    let attackedThisSmallTurn = state.attackedThisSmallTurn;
    if (action.type === 'attack') {
        const attacker = findUnit(units, action.attackerId);
        const target = findUnit(units, action.targetId);
        if (!attacker || !target)
            throw new Error('单位不存在');
        if (!isActive(attacker, clock.phase))
            throw new Error('当前不是该角色的行动小回合');
        if (attacker.attackedThisBigTurn)
            throw new Error('该角色本大回合已攻击过（D10）');
        if (target.dead || target.invincible)
            throw new Error('目标不可被攻击');
        const dmg = (0, combat_1.attackDamage)(attacker, target, clock);
        const hit = (0, combat_1.applyDamage)(target, dmg, { clock, kind: 'attack' });
        events.push({ type: 'attack', attacker: attacker.id, target: target.id, damage: dmg, hpAfter: hit.target.hp });
        units = units.map((u) => {
            if (u.id === target.id)
                return { ...u, ...hit.target };
            if (u.id === attacker.id)
                return { ...u, attackedThisBigTurn: true };
            return u;
        });
        // 反伤：取受击方当前攻击力（它刚刚受到的伤害不影响攻击力）
        if (target.hasReflect) {
            const back = (0, combat_1.reflectDamage)({ ...target, ...hit.target }, clock);
            if (back > 0) {
                const counter = (0, combat_1.applyDamage)(findUnit(units, attacker.id), back, { clock, kind: 'reflect' });
                units = units.map((u) => (u.id === attacker.id ? { ...u, ...counter.target } : u));
                events.push({ type: 'reflect', attacker: target.id, target: attacker.id, damage: back, hpAfter: counter.target.hp });
            }
        }
        units = resolveDying(units, events);
        // 新规则：同一次攻击下双方都濒死时，被攻击者必须先处理，攻击者的濒死排在后面。
        queue = syncQueue(units, queue, [target.id, attacker.id]);
        attackedThisSmallTurn = true;
        victory = (0, victory_1.recordAttack)(refreshVictory(units, victory), attacker.side);
    }
    if (action.type === 'rescue') {
        const target = findUnit(units, action.targetId);
        if (!target || target.dead)
            throw new Error('目标不存在或已死亡');
        if (target.hp > 0)
            throw new Error('该单位不是濒死状态，无需救援');
        const pool = units.filter((u) => !u.dead);
        const ops = (0, rescue_1.judgeDying)(target, pool);
        // 没人能救（无可救援者 / 名额用尽 / 扣血不够）时直接判死，不再抛错，
        // 否则界面上的「放弃救援」会被内核挡回。
        if (ops.outcome !== 'choice') {
            units = units.map((u) => (u.id === target.id ? { ...u, dead: true } : u));
            events.push({ type: 'death', unit: target.id });
            queue = syncQueue(units, queue.filter((id) => id !== target.id));
            victory = refreshVictory(units, victory);
        }
        else {
            const chosen = action.rescuerId === null
                ? null
                : ops.ops.find((o) => o.kind === 'ally' && o.rescuerId === action.rescuerId)
                    ?? ops.ops.find((o) => o.kind === 'self' && action.rescuerId === target.id)
                    ?? null;
            if (action.rescuerId !== null && !chosen)
                throw new Error('该救援者当前不可救援该单位');
            const result = (0, rescue_1.applyRescue)(target, pool, chosen);
            if (result.dead) {
                units = units.map((u) => (u.id === target.id ? { ...u, dead: true } : u));
                events.push({ type: 'death', unit: target.id });
            }
            else {
                units = units.map((u) => {
                    if (u.id === target.id)
                        return { ...u, ...result.target };
                    if (result.rescuer && u.id === result.rescuer.id)
                        return { ...u, ...result.rescuer };
                    return u;
                });
                events.push({
                    type: 'rescue',
                    rescuer: chosen?.kind === 'self' ? target.id : action.rescuerId ?? '',
                    target: target.id,
                    cost: chosen?.kind === 'ally' ? chosen.cost : 0,
                });
            }
            // 救援者可能把自己扣到濒死（规则上已被 canRescue 拦住，这里只做兜底排队）。
            queue = syncQueue(units, queue.filter((id) => id !== target.id));
            victory = refreshVictory(units, victory);
        }
    }
    if (action.type === 'endTurn') {
        if (!attackedThisSmallTurn) {
            victory = (0, victory_1.endSmallTurnWithoutAttack)(refreshVictory(units, victory));
        }
        else {
            victory = refreshVictory(units, victory);
        }
        const endedPhase = clock.phase;
        events.push({ type: 'smallTurnEnd', bigTurn: clock.bigTurn, phase: endedPhase });
        clock = (0, turn_1.endSmallTurn)(clock);
        attackedThisSmallTurn = false;
        if (clock.phase === 'first') {
            events.push({ type: 'bigTurnEnd', bigTurn: clock.bigTurn - 1 });
            units = units.map((u) => ({ ...u, attackedThisBigTurn: false, damageTakenThisBigTurn: 0 }));
            if (hooks)
                hooks.emit('bigTurnEnd', (0, hooks_1.makeEvent)('bigTurnEnd'), { clock });
        }
        else if (hooks) {
            hooks.emit('smallTurnEnd', (0, hooks_1.makeEvent)('smallTurnEnd'), { clock });
        }
    }
    const result = (0, victory_1.checkVictory)(victory);
    if (result.winner) {
        events.push({ type: 'victory', winner: result.winner, reason: result.reason ?? '' });
    }
    return {
        state: {
            clock,
            units,
            victory,
            events: [...state.events, ...events],
            winner: result.winner,
            dyingQueue: syncQueue(units, queue),
            attackedThisSmallTurn,
            itemBudget: state.itemBudget,
        },
        events,
    };
}
/** 合法的攻击目标：对方存活且未被无敌保护。 */
function legalAttackTargets(state, attackerId) {
    const attacker = findUnit(state.units, attackerId);
    if (!attacker)
        return [];
    return state.units.filter((u) => u.side !== attacker.side && !u.dead && !u.invincible);
}
//# sourceMappingURL=game.js.map