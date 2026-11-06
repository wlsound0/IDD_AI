"use strict";
// 事件钩子系统：63 个被动、15 个战吼、以及各类「回合结束时」效果都挂在这里。
//
// 两条硬约束：
//   1. 执行顺序必须复用 R21（core/settlement.ts 的 sortEffects），不要再写第二套排序。
//   2. 回合结束类钩子必须声明 timeUnit（small / big），见机制 R26/R34。
Object.defineProperty(exports, "__esModule", { value: true });
exports.HookRegistry = void 0;
exports.createRegistry = createRegistry;
exports.makeEvent = makeEvent;
const settlement_1 = require("./settlement");
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
//# sourceMappingURL=hooks.js.map