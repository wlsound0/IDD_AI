// 规则内核的共同类型。数据来自 data/*.json，字段含义见 temp/extract/机制.md。
// 凡是文档未定义、已列入 temp/decisions.md 的字段，这里一律可空，禁止私自补默认值。
define("types", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
});
// BP（选人）规则内核：状态机 + 校验，纯函数，不 import 数据文件。
//
// 规则来源：temp/extract/BP.md（8 步骨架 × 7 变体）+ temp/decisions.md 的 Q34/Q35(Q19)/Q36/Q37/Q38(Q17)/Q39。
// 这里只做「能选谁 / 选完进哪步」，界面负责把结果摆出来。
define("bp", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.otherPlayer = exports.BP_VARIANTS = exports.BP_MAX_LIMITED = exports.BP_MAX_PICKS = exports.BP_BUDGET = void 0;
    exports.variantsForMode = variantsForMode;
    exports.seriesWinsNeeded = seriesWinsNeeded;
    exports.roundSteps = roundSteps;
    exports.createBp = createBp;
    exports.currentStep = currentStep;
    exports.stepActor = stepActor;
    exports.sidePlayers = sidePlayers;
    exports.bannedNamesThisRound = bannedNamesThisRound;
    exports.blockReason = blockReason;
    exports.legalBpChoices = legalBpChoices;
    exports.applyBp = applyBp;
    exports.toItemBudget = toItemBudget;
    exports.forfeitBp = forfeitBp;
    exports.createSeries = createSeries;
    exports.recordRoundWinner = recordRoundWinner;
    exports.advanceSeries = advanceSeries;
    /** BP 每小局总预算（14k）。见 decisions.md Q12 / QA-01：每小局重置。 */
    exports.BP_BUDGET = 14000;
    /** 单方总人数上限：首轮 2 + 次轮至多 3。 */
    exports.BP_MAX_PICKS = 5;
    /** 单方限定角色上限（Q20：一局内某一方合计最多 2 个，且必不同名）。 */
    exports.BP_MAX_LIMITED = 2;
    const V = (key, label, banFirstRound, banSecondRound, distinctFirstPicks, entersGlobalBan) => ({ key, label, banFirstRound, banSecondRound, distinctFirstPicks, entersGlobalBan });
    exports.BP_VARIANTS = {
        single: [V('single', '一局一胜', 2, 2, false, false)],
        bo3: [
            V('bo3-1', '三局两胜 BO1', 2, 2, true, true),
            V('bo3-2', '三局两胜 BO2', 2, 1, true, true),
            V('bo3-3', '三局两胜 BO3', 1, 1, false, false),
        ],
        bo5: [
            V('bo5-1', '五局三胜 BO1', 2, 2, true, true),
            V('bo5-2', '五局三胜 BO2', 2, 1, true, true),
            V('bo5-3', '五局三胜 BO3', 1, 1, true, true),
            V('bo5-4', '五局三胜 BO4、5', 1, 1, false, false),
            V('bo5-5', '五局三胜 BO4、5', 1, 1, false, false),
        ],
    };
    function variantsForMode(mode) {
        return exports.BP_VARIANTS[mode];
    }
    /** 系列赛需要赢几局（一局一胜 1、三局两胜 2、五局三胜 3）。 */
    function seriesWinsNeeded(mode) {
        return mode === 'single' ? 1 : mode === 'bo3' ? 2 : 3;
    }
    /** 8 步骨架：ban → pick → ban → pick。 */
    function roundSteps(variant) {
        const mk = (index, actor, action, count, atMost = false, distinct = false, entersGlobalBan = false) => ({ index, actor, action, count, atMost, distinct, entersGlobalBan });
        return [
            mk(0, 'first', 'ban', variant.banFirstRound),
            mk(1, 'second', 'ban', variant.banFirstRound),
            mk(2, 'first', 'pick', 2, false, variant.distinctFirstPicks, variant.entersGlobalBan),
            mk(3, 'second', 'pick', 2, false, variant.distinctFirstPicks, variant.entersGlobalBan),
            mk(4, 'first', 'ban', variant.banSecondRound),
            mk(5, 'second', 'ban', variant.banSecondRound),
            mk(6, 'first', 'pick', 3, true),
            mk(7, 'second', 'pick', 3, true),
        ];
    }
    const emptyPlayer = (key, globalBans = []) => ({
        key,
        picks: [],
        bans: [],
        globalBans: globalBans.slice(),
        spent: 0,
    });
    function createBp(opts) {
        const roundIndex = opts.roundIndex ?? 0;
        const variants = variantsForMode(opts.mode);
        const variant = variants[roundIndex];
        if (!variant)
            throw new Error(`赛制 ${opts.mode} 没有第 ${roundIndex + 1} 小局`);
        const firstPlayer = opts.firstPlayer ?? (roundIndex % 2 === 0 ? 'p1' : 'p2');
        const carry = opts.globalBans ?? {};
        return {
            mode: opts.mode,
            roundIndex,
            variant,
            firstPlayer,
            stepIndex: 0,
            stepChars: [],
            players: {
                p1: emptyPlayer('p1', carry.p1),
                p2: emptyPlayer('p2', carry.p2),
            },
            finished: false,
            log: [],
        };
    }
    function currentStep(state) {
        if (state.finished)
            return null;
        return roundSteps(state.variant)[state.stepIndex] ?? null;
    }
    const otherPlayer = (key) => (key === 'p1' ? 'p2' : 'p1');
    exports.otherPlayer = otherPlayer;
    /** 当前步由哪个玩家行动。 */
    function stepActor(state) {
        const step = currentStep(state);
        if (!step)
            throw new Error('BP 已结束，没有行动方');
        return step.actor === 'first' ? state.firstPlayer : (0, exports.otherPlayer)(state.firstPlayer);
    }
    /** 本小局的「先手方/后手方」分别是谁。 */
    function sidePlayers(state) {
        return { first: state.firstPlayer, second: (0, exports.otherPlayer)(state.firstPlayer) };
    }
    const isLimited = (r) => r === 'limited' || r === 'legend';
    const sameNameLimit = (r) => (r === 'normal' ? 2 : 1);
    function findChar(catalog, name) {
        for (const c of catalog)
            if (c.name === name)
                return c;
        return null;
    }
    function countName(names, name) {
        let n = 0;
        for (const x of names)
            if (x === name)
                n += 1;
        return n;
    }
    /** 本小局已被任意一方直接 BAN 的名字。 */
    function bannedNamesThisRound(state) {
        return [...state.players.p1.bans, ...state.players.p2.bans];
    }
    /** 某个玩家不能选某个名字的原因；可选时返回 null。界面用它做置灰提示。 */
    function blockReason(state, player, action, ch, catalog) {
        const step = currentStep(state);
        if (!step)
            return 'BP 已结束';
        if (action === 'ban') {
            // 只禁止自己重复 BAN 同一个名字；对方已 BAN 的名字仍然可以 BAN（用户 2026-11-06 明确）。
            if (state.players[player].bans.includes(ch.name))
                return '自己本局已 BAN 过该角色';
            return null;
        }
        const me = state.players[player];
        const foe = state.players[(0, exports.otherPlayer)(player)];
        if (foe.bans.includes(ch.name))
            return '被对方 BAN';
        if (me.globalBans.includes(ch.name))
            return '自己全局 BAN 中';
        if (step.distinct && state.stepChars.includes(ch.name))
            return '本步要求两个不同角色';
        const same = countName(me.picks, ch.name);
        if (same >= sameNameLimit(ch.rarity))
            return '同名角色上限';
        if (isLimited(ch.rarity)) {
            const limited = me.picks.filter((n) => {
                const c = findChar(catalog, n);
                return c ? isLimited(c.rarity) : false;
            }).length;
            if (limited >= exports.BP_MAX_LIMITED)
                return '限定角色已达 2 个';
        }
        if (me.picks.length >= exports.BP_MAX_PICKS)
            return '人数已满 5 人';
        if (me.spent + (ch.cost ?? 0) > exports.BP_BUDGET)
            return '预算不足 14k';
        return null;
    }
    function legalBpChoices(state, catalog) {
        const step = currentStep(state);
        if (!step)
            return null;
        const player = stepActor(state);
        const chars = catalog.filter((ch) => blockReason(state, player, step.action, ch, catalog) === null);
        return {
            player,
            action: step.action,
            remaining: step.count - state.stepChars.length,
            chars,
            canEndStep: step.atMost && !state.finished,
        };
    }
    function finalizeStep(state, player, step) {
        const players = { ...state.players };
        if (step.action === 'pick' && step.entersGlobalBan && state.stepChars.length > 0) {
            const p = players[player];
            const merged = p.globalBans.slice();
            for (const name of state.stepChars)
                if (!merged.includes(name))
                    merged.push(name);
            players[player] = { ...p, globalBans: merged };
        }
        const next = state.stepIndex + 1;
        return {
            ...state,
            players,
            stepIndex: next,
            stepChars: [],
            finished: next >= roundSteps(state.variant).length,
        };
    }
    function applyBp(state, action, catalog) {
        if (state.finished)
            throw new Error('BP 已结束');
        const step = currentStep(state);
        if (!step)
            throw new Error('BP 已结束');
        const player = stepActor(state);
        if (action.type === 'endStep') {
            if (!step.atMost)
                throw new Error(`本步必须选满 ${step.count} 个`);
            return finalizeStep(state, player, step);
        }
        if (step.action !== action.type) {
            throw new Error(step.action === 'ban' ? '当前是 BAN 阶段' : '当前是选人阶段');
        }
        if (step.atMost && state.stepChars.length >= step.count) {
            throw new Error('本步已选满');
        }
        const ch = catalog.find((c) => c.id === action.charId);
        if (!ch)
            throw new Error('角色不存在：' + action.charId);
        const reason = blockReason(state, player, step.action, ch, catalog);
        if (reason)
            throw new Error(reason);
        const players = { ...state.players };
        const me = players[player];
        let nextStepChars;
        if (step.action === 'ban') {
            players[player] = { ...me, bans: [...me.bans, ch.name] };
            nextStepChars = [...state.stepChars, ch.name];
        }
        else {
            players[player] = { ...me, picks: [...me.picks, ch.name], spent: me.spent + (ch.cost ?? 0) };
            nextStepChars = [...state.stepChars, ch.name];
        }
        const log = [
            ...state.log,
            { round: state.roundIndex + 1, step: step.index + 1, player, action: step.action, name: ch.name },
        ];
        const next = { ...state, players, stepChars: nextStepChars, log };
        if (nextStepChars.length >= step.count)
            return finalizeStep(next, player, step);
        return next;
    }
    /** 剩余预算按 1:2 折算成道具花费（decisions.md Q12 / Q21）。 */
    function toItemBudget(leftover) {
        return Math.max(0, leftover) * 2;
    }
    /**
     * 认负：任意时刻结束本小局 BP（未选满也算结束），由调用方再把对手记为小局胜者。
     * 已经选出的角色照常保留（含已计入的全局 BAN）。
     */
    function forfeitBp(state) {
        if (state.finished)
            return state;
        return { ...state, finished: true };
    }
    function createSeries(mode) {
        return {
            mode,
            roundIndex: 0,
            wins: { p1: 0, p2: 0 },
            globalBans: { p1: [], p2: [] },
            current: createBp({ mode, roundIndex: 0 }),
            champion: null,
        };
    }
    /** 记录一小局胜者；达到胜局数即产生冠军。必须在 BP 结束后调用。 */
    function recordRoundWinner(series, winner) {
        if (series.champion)
            throw new Error('系列赛已结束');
        if (!series.current.finished)
            throw new Error('BP 尚未结束，不能记录小局结果');
        const wins = { ...series.wins, [winner]: series.wins[winner] + 1 };
        const globalBans = {
            p1: mergeBans(series.globalBans.p1, series.current.players.p1.globalBans),
            p2: mergeBans(series.globalBans.p2, series.current.players.p2.globalBans),
        };
        const champion = wins[winner] >= seriesWinsNeeded(series.mode) ? winner : null;
        return { ...series, wins, globalBans, champion };
    }
    /** 进入下一小局：先手逐局轮换、携带全局 BAN、预算重置。 */
    function advanceSeries(series) {
        if (series.champion)
            throw new Error('系列赛已结束');
        if (!series.current.finished)
            throw new Error('BP 尚未结束，不能进入下一小局');
        const roundIndex = series.roundIndex + 1;
        return {
            ...series,
            roundIndex,
            current: createBp({
                mode: series.mode,
                roundIndex,
                firstPlayer: roundIndex % 2 === 0 ? 'p1' : 'p2',
                globalBans: series.globalBans,
            }),
        };
    }
    function mergeBans(a, b) {
        const out = a.slice();
        for (const x of b)
            if (!out.includes(x))
                out.push(x);
        return out;
    }
});
// 回合时钟（机制 R08 / R26 / R34）。
//
// R08：除非特殊声明，否则「一回合」= 先手回合 + 后手回合。
// R26/R34：「回合结束时」默认指大回合结束；「己方/敌方/先手/后手结束时」指小回合结束。
// 因此所有触发器都必须声明自己属于哪个时间单位，不能混用。
define("turn", ["require", "exports"], function (require, exports) {
    "use strict";
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
});
// 伤害结算。依据：机制 R11/R15/R18/R19、裁决落地 D05/D10、Q&A 反伤与庄园老友条。
//
// 关键区分（文档反复强调）：
//   攻击力 ≠ 造成伤害。攻击力只是攻击伤害的计算来源，技能伤害与攻击力无关。
//   临时血量只承伤，不加上限；加血则可能反过来抬高上限（D05）。
define("combat", ["require", "exports", "turn"], function (require, exports, turn_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.effectiveAtk = effectiveAtk;
    exports.attackDamage = attackDamage;
    exports.reflectDamage = reflectDamage;
    exports.applyDamage = applyDamage;
    exports.healByAdding = healByAdding;
    exports.healByRestoring = healByRestoring;
    exports.rescuedMaxHp = rescuedMaxHp;
    /** 有效攻击力：R15 首回合全体 -1，下限 0（R11）。 */
    function effectiveAtk(c, clock) {
        const penalty = (0, turn_1.isFirstTurnPenaltyActive)(clock) ? 1 : 0;
        return Math.max(0, c.atk - penalty);
    }
    /**
     * 攻击伤害（R07 庄园老友 / R15 首回合）。
     * 庄园老友只减「攻击」伤害：首次不减，之后每次 -1，不叠加；技能/道具/无来源伤害不减。
     */
    function attackDamage(attacker, defender, clock) {
        const base = effectiveAtk(attacker, clock);
        if (!defender.veteranOfManor)
            return base;
        const taken = defender.damageTakenThisBigTurn ?? 0;
        return taken > 0 ? Math.max(0, base - 1) : base;
    }
    /** 反伤：取受击方「当前」攻击力，被降攻同样生效，攻击力 0 仍触发（Q&A）。 */
    function reflectDamage(defender, clock) {
        return effectiveAtk(defender, clock);
    }
    /**
     * 施加伤害，返回新的目标快照（不修改入参，方便做快照回归）。
     * 免疫直接吞掉本次伤害（R18）。
     */
    function applyDamage(target, amount, ctx) {
        if (target.immune) {
            return { applied: 0, absorbedByTemp: 0, target: { ...target }, dying: target.hp <= 0 };
        }
        const dmg = Math.max(0, amount);
        const absorbed = Math.min(target.tempHp, dmg);
        const rest = dmg - absorbed;
        const next = {
            ...target,
            tempHp: target.tempHp - absorbed,
            hp: target.hp - rest,
        };
        if (dmg > 0) {
            next.damageTakenThisBigTurn = (target.damageTakenThisBigTurn ?? 0) + 1;
        }
        return { applied: rest, absorbedByTemp: absorbed, target: next, dying: next.hp <= 0 };
    }
    /**
     * 加血（D05）：先加当前血量；若加后超过上限，则把上限抬到当前血量。
     * 注意：抬高的只是 maxHp，initialMaxHp 不变（D04），救援减半仍按初始值算。
     */
    function healByAdding(c, amount) {
        const next = { ...c, hp: c.hp + Math.max(0, amount) };
        if (next.hp > next.maxHp)
            next.maxHp = next.hp;
        return next;
    }
    /** 回血（D05）：不能突破当前上限。 */
    function healByRestoring(c, amount) {
        return { ...c, hp: Math.min(c.maxHp, c.hp + Math.max(0, amount)) };
    }
    /** 救援后的血量上限：初始上限减半向上取整（D02/D04）。 */
    function rescuedMaxHp(c) {
        return Math.ceil(c.initialMaxHp / 2);
    }
});
// 结算顺序（机制 R21）。这条规则在文档里是完整的，不依赖任何待裁决项。
//
// 原文：回合结束/回合开始等效果的结算顺序为
//   先手一号位 -> 后手一号位 -> 先手二号位 -> 后手二号位 -> ……
//   按照受效果影响的角色排序。
//   同一角色效果按：本角色特性/技能 > 己方道具、技能 > 敌方效果；
//   同等级内按附带效果的先后顺序、技能顺序排序。
define("settlement", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.compareEffects = compareEffects;
    exports.sortEffects = sortEffects;
    exports.resolveEffects = resolveEffects;
    const SIDE_RANK = { first: 0, second: 1 };
    const SOURCE_RANK = { self: 0, ally: 1, enemy: 2 };
    /** 排序键：站位交错 -> 来源等级 -> 入队顺序。入队顺序保证稳定。 */
    function compareEffects(a, b) {
        if (a.targetSlot !== b.targetSlot)
            return a.targetSlot - b.targetSlot;
        if (a.targetSide !== b.targetSide)
            return SIDE_RANK[a.targetSide] - SIDE_RANK[b.targetSide];
        if (a.source !== b.source)
            return SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
        return a.seq - b.seq;
    }
    /** 返回新数组，不修改入参。 */
    function sortEffects(effects) {
        return [...effects].sort(compareEffects);
    }
    /**
     * 按顺序消费效果队列。handler 返回 false 表示该效果被取消（免疫、目标已死亡等），
     * 能力节点可选择据此重新排序剩余队列。
     */
    function resolveEffects(effects, handler, onResort) {
        const queue = sortEffects(effects);
        const done = [];
        while (queue.length > 0) {
            const current = queue.shift();
            if (handler(current) === false)
                continue;
            done.push(current);
            if (onResort && queue.length > 0) {
                queue.splice(0, queue.length, ...onResort(queue));
            }
        }
        return done;
    }
});
// 事件钩子系统：63 个被动、15 个战吼、以及各类「回合结束时」效果都挂在这里。
//
// 两条硬约束：
//   1. 执行顺序必须复用 R21（core/settlement.ts 的 sortEffects），不要再写第二套排序。
//   2. 回合结束类钩子必须声明 timeUnit（small / big），见机制 R26/R34。
define("hooks", ["require", "exports", "settlement"], function (require, exports, settlement_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.HookRegistry = void 0;
    exports.createRegistry = createRegistry;
    exports.makeEvent = makeEvent;
    class HookRegistry {
        constructor() {
            this.hooks = [];
            this.seq = 0;
        }
        register(def) {
            this.hooks.push({ ...def, seq: this.seq++ });
        }
        unregister(id) {
            this.hooks = this.hooks.filter((h) => h.id !== id);
        }
        /** 移除某个角色（阵亡/离场）的全部钩子。 */
        unregisterOwner(side, slot) {
            this.hooks = this.hooks.filter((h) => !(h.ownerSide === side && h.ownerSlot === slot));
        }
        list() {
            return this.hooks;
        }
        /**
         * 触发某一点的钩子，按 R21 顺序执行。
         * timeUnit 只对 smallTurnEnd / bigTurnEnd 生效：声明了小回合的钩子不会在大回合结束时被触发。
         */
        emit(point, event, ctx = {}) {
            const timeUnit = point === 'smallTurnEnd' ? 'small'
                : point === 'bigTurnEnd' ? 'big'
                    : undefined;
            const matched = this.hooks.filter((h) => {
                if (h.point !== point)
                    return false;
                if (timeUnit === undefined)
                    return true;
                const declared = h.timeUnit ?? 'big';
                if (timeUnit === 'small')
                    return declared === 'small';
                // 大回合结束时，两类钩子都要结算，但小回合的钩子属于「先手/后手结束」语义，
                // 由调用方在 smallTurnEnd 里单独触发过，这里只跑 big。
                return declared === 'big';
            });
            const pending = matched.map((h) => ({
                id: h.id,
                targetSide: h.ownerSide,
                targetSlot: h.ownerSlot,
                source: h.relation,
                seq: h.seq,
            }));
            const ordered = (0, settlement_1.sortEffects)(pending);
            const byId = new Map(matched.map((h) => [h.id, h]));
            for (const effect of ordered) {
                const hook = byId.get(effect.id);
                if (!hook)
                    continue;
                if (event.stopped)
                    break;
                const result = hook.handler(event, ctx);
                if (result === true) {
                    event.stopped = true;
                    break;
                }
            }
            return event;
        }
    }
    exports.HookRegistry = HookRegistry;
    function createRegistry() {
        return new HookRegistry();
    }
    /** 创建一个未触发的事件对象。 */
    function makeEvent(point, payload = {}) {
        return { point, payload, stopped: false };
    }
});
// 濒死与救援。依据：裁决落地 D01/D02/D03/D06/D17/D18、Q31/Q32（已裁决为默认）。
//
// D01：血量 ≤0 立即判定，不拖到回合结束。
//   有可救援者 → 弹选项；玩家放弃 → 立即死亡。
//   没有可救援者 → 立即死亡。
// D02：救援者扣 2 血；目标满血复活，上限 = ceil(战斗开始上限 / 2)；每人每小局限 1 次。
// D06：召唤物不可被救援、没有濒死状态。
// D17：野人救援只扣 1 血且必扣本体；被封技能后扣 2 血，优先扣临时血量。
// D18：画家可被救 2 次，被救不减上限，救援者扣血 -1。
define("rescue", ["require", "exports", "combat"], function (require, exports, combat_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.rescueCost = rescueCost;
    exports.isRescuableAtAll = isRescuableAtAll;
    exports.canRescue = canRescue;
    exports.availableRescues = availableRescues;
    exports.judgeDying = judgeDying;
    exports.applyRescue = applyRescue;
    /** 救援者救这个目标需要扣多少血。 */
    function rescueCost(rescuer, target) {
        const base = rescuer.sealed
            ? (rescuer.rescueCostWhenSealed ?? rescuer.rescueCostBase ?? 2)
            : (rescuer.rescueCostBase ?? 2);
        const delta = target.rescueCostDelta ?? 0;
        return Math.max(0, base + delta);
    }
    /** 目标是否还可能被救（不考虑救援者）。 */
    function isRescuableAtAll(target) {
        if (target.isSummon)
            return false;
        if (target.hp > 0)
            return false;
        return (target.rescueCount ?? 0) < (target.rescueLimit ?? 1);
    }
    /** 某个具体救援者能否救这个目标。 */
    function canRescue(target, rescuer) {
        if (!isRescuableAtAll(target))
            return false;
        if (!rescuer.hasRescue)
            return false;
        if (rescuer.hp <= 0)
            return false;
        if (rescuer.sealed && !rescuer.canRescueWhenSealed)
            return false;
        const cost = rescueCost(rescuer, target);
        const payable = rescuer.mustUseBodyForRescue && !rescuer.sealed
            ? rescuer.hp
            : rescuer.hp + rescuer.tempHp;
        if (payable < cost)
            return false;
        // 机制：「血量小于本次救援应扣血量的角色不可救援其他角色」。
        // 实现取「救完本体血量仍 ≥1」的严格解释：血量正好等于扣血量时也不可救（否则救完自己立刻濒死）。
        const bodyLoss = rescuer.mustUseBodyForRescue && !rescuer.sealed
            ? cost
            : Math.max(0, cost - rescuer.tempHp);
        return rescuer.hp > bodyLoss;
    }
    /**
     * 列出当前可用的救援操作。
     * 自我救援（D03）不额外扣血，且只有目标自己具备该能力时才出现（Q31：同样可选、可放弃）。
     */
    function availableRescues(target, units) {
        const ops = [];
        if (!isRescuableAtAll(target))
            return ops;
        for (const u of units) {
            if (u.id === target.id)
                continue;
            // 机制 R02：「若有其他己方角色进入濒死状态」——只有同阵营能救。
            if (u.side && target.side && u.side !== target.side)
                continue;
            if (!canRescue(target, u))
                continue;
            ops.push({
                kind: 'ally',
                rescuerId: u.id,
                cost: rescueCost(u, target),
                useBodyOnly: Boolean(u.mustUseBodyForRescue) && !u.sealed,
            });
        }
        const self = units.find((u) => u.id === target.id);
        if (self?.canSelfRescue)
            ops.push({ kind: 'self', cost: 0 });
        return ops;
    }
    /** D01 的第一步：扣血后立即判定。不传入选择时只做“是否有得选”。 */
    function judgeDying(target, units) {
        const ops = availableRescues(target, units);
        if (ops.length === 0)
            return { target: { ...target }, outcome: 'dead', ops };
        return { target: { ...target }, outcome: 'choice', ops };
    }
    /**
     * D01 的第二步：玩家做出选择。
     * choice 为 null 表示放弃救援 → 立即死亡。
     */
    function applyRescue(target, units, choice) {
        if (!choice)
            return { target: { ...target }, rescuer: undefined, dead: true };
        // 救援名额已用尽（或目标根本不是可救援单位）时，任何选择都不成立。
        if (!isRescuableAtAll(target))
            return { target: { ...target }, rescuer: undefined, dead: true };
        if (choice.kind === 'self') {
            const next = { ...target, rescueCount: (target.rescueCount ?? 0) + 1 };
            if (!next.noMaxHpHalvingOnRescue)
                next.maxHp = (0, combat_1.rescuedMaxHp)(next);
            next.hp = next.maxHp;
            next.tempHp = 0;
            return { target: next, dead: false };
        }
        const rescuer = units.find((u) => u.id === choice.rescuerId);
        if (!rescuer)
            return { target: { ...target }, dead: true };
        // 扣血：野人未封技能时必须扣本体，其余情况优先扣临时血量。
        const cost = choice.cost;
        const fromTemp = choice.useBodyOnly ? 0 : Math.min(rescuer.tempHp, cost);
        const fromBody = cost - fromTemp;
        const nextRescuer = { ...rescuer, tempHp: rescuer.tempHp - fromTemp, hp: rescuer.hp - fromBody };
        const next = { ...target, rescueCount: (target.rescueCount ?? 0) + 1 };
        if (!next.noMaxHpHalvingOnRescue)
            next.maxHp = (0, combat_1.rescuedMaxHp)(next);
        next.hp = next.maxHp;
        next.tempHp = 0;
        return { target: next, rescuer: nextRescuer, dead: false };
    }
});
// 胜负判定。依据：机制 R25 + 裁决落地 D11（Q08）/ D12（Q07）。
//
// D11：
//   反伤同死、双方卡死、双方都不进攻 → 最后一次发起进攻的一方获胜。
//   一方无法进攻、另一方有但不进攻 → 无法进攻的一方获胜。
// D12：僵持计数从「没有发起进攻」的第一个小回合/大回合开始累加。
define("victory", ["require", "exports"], function (require, exports) {
    "use strict";
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
});
// 一局对战的状态机（P2 单场闭环）。
//
// 设计约束：
//   - 纯函数：applyAction(state, action) 返回新状态 + 事件日志，不改入参。
//   - 所有随机、时间、IO 都不在这里出现，保证同一脚本重跑结果一致。
//   - 伤害/救援/胜负各自已有独立模块，这里只做编排，不复制规则。
define("game", ["require", "exports", "combat", "turn", "hooks", "rescue", "victory"], function (require, exports, combat_2, turn_2, hooks_1, rescue_1, victory_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.otherSide = void 0;
    exports.createGame = createGame;
    exports.pendingDying = pendingDying;
    exports.legalRescueOps = legalRescueOps;
    exports.applyAction = applyAction;
    exports.legalAttackTargets = legalAttackTargets;
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
            clock: (0, turn_2.createClock)(),
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
            const dmg = (0, combat_2.attackDamage)(attacker, target, clock);
            const hit = (0, combat_2.applyDamage)(target, dmg, { clock, kind: 'attack' });
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
                const back = (0, combat_2.reflectDamage)({ ...target, ...hit.target }, clock);
                if (back > 0) {
                    const counter = (0, combat_2.applyDamage)(findUnit(units, attacker.id), back, { clock, kind: 'reflect' });
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
            clock = (0, turn_2.endSmallTurn)(clock);
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
});
