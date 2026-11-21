// P5 效果层测试：技能/道具真正参与战斗、itemBudget 真正扣费、canAttack 不再恒真。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, chargeOnBigTurnStart, legalAttackTargets } from '../temp/build/core/game.js';
import { canUseSkill } from '../temp/build/core/trigger.js';
import { effectiveAtk, attackDamage } from '../temp/build/core/combat.js';
import { isRescuableAtAll, availableRescues, withRescueStatuses } from '../temp/build/core/rescue.js';
import { resolveDuration, statOf } from '../temp/build/core/status.js';
import { selectBranch } from '../temp/build/core/effects.js';
import { buildUnitSkills, indexEffects } from '../temp/build/core/units.js';
import { HookRegistry } from '../temp/build/core/hooks.js';

const def = (over = {}) => ({
  name: 'T',
  type: 'active',
  text: '',
  cost: null,
  durability: null,
  cd: null,
  initialCd: null,
  ...over,
});

const eff = (over = {}) => ({
  id: 'x/T',
  character: 'X',
  name: 'T',
  type: 'active',
  impl: 'full',
  manual: true,
  trigger: 'manual',
  ops: [],
  ...over,
});

const skill = (definition, effect) => ({
  def: definition,
  effect,
  cdCounter: 0,
  charge: 0,
  durability: definition.durability ?? null,
  usedPerGame: 0,
  usedThisBigTurn: 0,
});

const mkUnit = (over = {}) => ({
  id: 'A',
  name: '测试员',
  side: 'first',
  slot: 1,
  atk: 3,
  hp: 6,
  maxHp: 6,
  initialMaxHp: 6,
  tempHp: 0,
  statuses: [],
  items: [],
  skills: [],
  ...over,
});

describe('P5 技能/道具接入', () => {
  it('战吼在开局结算并入道具栏', () => {
    const s = createGame([
      mkUnit({
        skills: [skill(def({ type: 'battlecry' }), eff({ trigger: 'battlecry', manual: false, ops: [{ op: 'grantItem', ref: 'self', item: 'wangyouzhixiang', count: 2 }] }))],
      }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    const a = s.units.find((u) => u.id === 'A');
    assert.equal(a.items.length, 2);
    assert.equal(a.items[0].itemId, 'wangyouzhixiang');
  });

  it('主动技能加攻，持续到本小回合结束', () => {
    const s0 = createGame([
      mkUnit({
        skills: [skill(def(), eff({ ops: [{ op: 'modStat', ref: 'self', stat: 'atk', delta: 2 }], duration: 'untilOwnTurnEnd' }))],
      }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    const { state } = applyAction(s0, { type: 'useSkill', unitId: 'A', skillIndex: 0 });
    const a = state.units.find((u) => u.id === 'A');
    // 首回合 -1（R15）：3 + 2 - 1 = 4
    assert.equal(effectiveAtk(a, state.clock), 4);
    const after = applyAction(state, { type: 'endTurn' }).state;
    const a2 = after.units.find((u) => u.id === 'A');
    // 状态已到期：3 - 1（首回合）= 2
  });

  it('技能伤害进入濒死队列', () => {
    const s0 = createGame([
      mkUnit({
        skills: [skill(def(), eff({ ops: [{ op: 'damage', ref: 'target', amount: 9, kind: 'skill' }] }))],
      }),
      mkUnit({ id: 'B', side: 'second', slot: 1, hp: 5, maxHp: 5, initialMaxHp: 5 }),
    ]);
    const { state } = applyAction(s0, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'B' });
    const b = state.units.find((u) => u.id === 'B');
    assert.ok(b.hp <= 0);
    // 无人可救 → 立即判死（D01）
    assert.equal(b.dead, true);
  });

  it('道具按花费扣每回合资源 k，付不起就拒绝', () => {
    const s0 = createGame(
      [
        mkUnit({ items: [{ itemId: 'xinhaoqiang', cost: 1000 }] }),
        mkUnit({ id: 'B', side: 'second', slot: 1 }),
      ],
      { effects: { skills: new Map(), items: new Map([['xinhaoqiang', { id: 'xinhaoqiang', name: '信号枪', cost: 1000, effect: { ops: [{ op: 'damage', ref: 'target', amount: 2 }] } }]]) } },
    );
    s0.k.first = 1000;
    const { state } = applyAction(s0, { type: 'useItem', unitId: 'A', itemIndex: 0, targetId: 'B' });
    assert.equal(state.k.first, 0);
    assert.equal(state.units.find((u) => u.id === 'A').items.length, 0);
  });

  it('免疫吃掉一次伤害', () => {
    const s0 = createGame([
      mkUnit(),
      mkUnit({
        id: 'B',
        side: 'second',
        slot: 1,
        statuses: [{ id: 'i1', kind: 'immune', key: 'damage', value: 1, mode: 'add', expiresAt: null, source: 'B' }],
      }),
    ]);
    const { state } = applyAction(s0, { type: 'attack', attackerId: 'A', targetId: 'B' });
    const b = state.units.find((u) => u.id === 'B');
    assert.equal(b.hp, 6);
    assert.equal(b.statuses.filter((s) => s.kind === 'immune').length, 0);
  });

  it('封印技能后不能发动', () => {
    const u = mkUnit({ skills: [skill(def(), eff({ ops: [] }))] });
    u.statuses = [{ id: 's1', kind: 'flag', key: 'sealed', value: 1, mode: 'add', expiresAt: null, source: 'B' }];
    const reason = canUseSkill(u, u.skills[0], { bigTurn: 1, phase: 'first', smallTurnsDone: 0 });
    assert.match(String(reason), /封印/);
  });

  it('extraAttack 允许同一大回合攻击两次', () => {
    const s0 = createGame([
      mkUnit({ skills: [skill(def(), eff({ ops: [{ op: 'extraAttack', ref: 'self', count: 1 }], duration: 'instant' }))] }),
      mkUnit({ id: 'B', side: 'second', slot: 1, hp: 20, maxHp: 20, initialMaxHp: 20 }),
    ]);
    const s1 = applyAction(s0, { type: 'useSkill', unitId: 'A', skillIndex: 0 }).state;
    const s2 = applyAction(s1, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    assert.equal(s2.units.find((u) => u.id === 'B').hp, 18);
    const s3 = applyAction(s2, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    assert.equal(s3.units.find((u) => u.id === 'B').hp, 16);
  });

  it('召唤物落地，占独立站位', () => {
    const s = createGame([
      mkUnit({
        skills: [skill(def({ type: 'battlecry' }), eff({ trigger: 'battlecry', manual: false, ops: [{ op: 'summon', ref: 'owner', unit: { name: '机械玩偶', atk: 1, hp: 1 } }] }))],
      }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    const summons = s.units.filter((u) => u.isSummon);
    assert.equal(summons.length, 1);
    assert.equal(summons[0].name, '机械玩偶');
    assert.equal(summons[0].slot, 2);
  });

  it('一方无法进攻：两大回合后该方获胜（R25 第 5 条）', () => {
    let s = createGame([
      mkUnit({ atk: 0, hp: 5, statuses: [{ id: 'c1', kind: 'flag', key: 'cannotAttack', value: 1, mode: 'add', expiresAt: null, source: 'A' }] }),
      mkUnit({ id: 'B', side: 'second', slot: 1, atk: 3, hp: 5 }),
    ]);
    for (let i = 0; i < 4; i++) s = applyAction(s, { type: 'endTurn' }).state;
    assert.equal(s.winner, 'first');
  });

  it('双方从未进攻：四小回合后判后手胜（新裁决）', () => {
    let s = createGame([
      mkUnit({ atk: 3, hp: 5 }),
      mkUnit({ id: 'B', side: 'second', slot: 1, atk: 3, hp: 5 }),
    ]);
    for (let i = 0; i < 4; i++) s = applyAction(s, { type: 'endTurn' }).state;
    assert.equal(s.winner, 'second');
  });
});

// ---------- 数据全量回归（P5 验收：111 技能 + 15 道具一个都不能缺） ----------
import { readFileSync } from 'node:fs';

const FX = JSON.parse(readFileSync('data/effects.json', 'utf8'));
const CHARS = JSON.parse(readFileSync('data/characters.json', 'utf8')).characters;
const ITEM_DEFS = JSON.parse(readFileSync('data/items.json', 'utf8')).items;
const KNOWN_OPS = new Set([
  'modStat', 'modStatPer', 'setStat', 'heal', 'damage', 'tempHp', 'shield', 'damageReduce', 'damageMultiplier',
  'immune', 'invulnerable', 'untargetable', 'sealSkills', 'extraAttack', 'grantItem', 'itemDiscount', 'itemLock',
  'summon', 'cdDelta', 'chargeDelta', 'swapStat', 'swapPosition', 'transferDamage', 'deferDamage',
  'revive', 'mark', 'flag', 'restrictAttack', 'selfRescue', 'rescueRule', 'copyAtk', 'custom',
  'grantRescue', 'reflectMod', 'defer', 'liberate',
  'grantDestroySummon',
  'grantTransferMark', 'grantRescueFlyer', 'atkPenaltyOnCd', 'triggerFlyer',
  'damageToMark', 'drainMarks', 'holdDying', 'deferredRescue', 'rescueHeld',
  // P7 D：换回
  'swapBack',
  // P7 E：扣本体血 / 附身
  'loseHp', 'possession',
  // P7-2 X5：魔术棒打断窗口的伤害折算
  'interruptDamage',
]);

describe('P5 数据全量', () => {
  it('111 个技能全部有规格，且没有 unknown 类型', () => {
    const ids = new Set(FX.skills.map((s) => s.id));
    const missing = [];
    let total = 0;
    for (const c of CHARS) {
      for (const s of c.skills) {
        total += 1;
        if (!ids.has(c.id + '/' + s.name)) missing.push(c.name + '/' + s.name);
        assert.notEqual(s.type, 'unknown', c.name + ' 仍有 unknown 技能（Q40 应改为 passive）');
      }
    }
    assert.equal(total, 111);
    assert.deepEqual(missing, []);
  });

  it('15 件道具全部有规格', () => {
    const ids = new Set(FX.items.map((i) => i.id));
    assert.equal(ITEM_DEFS.length, 15);
    for (const it of ITEM_DEFS) assert.ok(ids.has(it.id), '缺道具规格：' + it.name);
  });

  it('只用白名单 op，且 full 里不出现 custom', () => {
    for (const e of [...FX.skills, ...FX.items]) {
      const allOps = [...e.ops, ...(e.battlecryOps || []), ...(e.afterAttackOps || []), ...((e.parts || []).flatMap((p) => p.ops || [])), ...((e.branches || []).flatMap((b) => b.ops || []))];
      for (const op of allOps) {
        assert.ok(KNOWN_OPS.has(op.op), e.id + ' 用了未知 op：' + op.op);
        if (op.op === 'custom') assert.notEqual(e.impl, 'full', e.id + ' 有 custom 却标 full');
      }
    }
  });

  it('覆盖率不低于当前记录值（full 107 / partial 0 / none 4）', () => {
    const impl = { full: 0, partial: 0, none: 0 };
    for (const s of FX.skills) impl[s.impl] += 1;
    assert.equal(impl.full, 107);
    assert.equal(impl.partial, 0);
    assert.equal(impl.none, 4);
  });
});

// ---------- P7-2 X6：八音盒（抉择式道具） ----------
describe('P7-2 X6：八音盒的两种抉择增益', () => {
  const BAYINHE = FX.items.find((i) => i.id === 'bayinhe');
  const fx = () => indexEffects({ skills: [], items: [BAYINHE] });
  const withItem = (over = {}) => mkUnit({ items: [{ itemId: 'bayinhe', cost: 1000 }], ...over });
  const atkOf = (st, id) => statOf(0, st.units.find((u) => u.id === id).statuses, 'atk');
  const variant = (i) => BAYINHE.branches[i].label;

  it('分支一：目标攻击力+1，被攻击后清除', () => {
    const g0 = createGame([withItem(), mkUnit({ id: 'B', side: 'second', slot: 1 })], { effects: fx() });
    let s = applyAction(g0, { type: 'useItem', unitId: 'A', itemIndex: 0, targetId: 'B', variant: variant(0) }).state;
    assert.equal(atkOf(s, 'B'), 1, '目标攻击力+1');
    s = applyAction(s, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    assert.equal(atkOf(s, 'B'), 0, '被攻击后增益消失');
  });

  it('分支二：目标攻击力-1，其攻击后清除', () => {
    const g0 = createGame([withItem(), mkUnit({ id: 'B', side: 'second', slot: 1 })], { effects: fx() });
    let s = applyAction(g0, { type: 'useItem', unitId: 'A', itemIndex: 0, targetId: 'B', variant: variant(1) }).state;
    assert.equal(atkOf(s, 'B'), -1, '目标攻击力-1');
    s = applyAction(s, { type: 'endTurn' }).state; // 轮到 B
    assert.equal(atkOf(s, 'B'), -1, '自己还没攻击，状态仍在');
    s = applyAction(s, { type: 'attack', attackerId: 'B', targetId: 'A' }).state;
    assert.equal(atkOf(s, 'B'), 0, 'B 攻击后减益消失');
  });

  it('舞女「二重奏」的 bayinheBuffPersist 让八音盒增益在自己身上不消失', () => {
    const persist = { id: 'p1', kind: 'flag', key: 'bayinheBuffPersist', value: 1, mode: 'add', expiresAt: null, source: 'A' };
    const g0 = createGame([withItem({ statuses: [persist] }), mkUnit({ id: 'B', side: 'second', slot: 1, atk: 1 })], { effects: fx() });
    let s = applyAction(g0, { type: 'useItem', unitId: 'A', itemIndex: 0, targetId: 'A', variant: variant(0) }).state;
    assert.equal(atkOf(s, 'A'), 1);
    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'attack', attackerId: 'B', targetId: 'A' }).state;
    assert.equal(atkOf(s, 'A'), 1, '被攻击后仍然保留');
  });

  it('抉择式道具缺少 variant 时拒绝使用', () => {
    const g0 = createGame([withItem(), mkUnit({ id: 'B', side: 'second', slot: 1 })], { effects: fx() });
    assert.throws(
      () => applyAction(g0, { type: 'useItem', unitId: 'A', itemIndex: 0, targetId: 'B' }),
      /需要选择分支/,
    );
  });
});

// ---------- P5 收尾：新 op 与新 duration 的行为 ----------
describe('P5 收尾：护盾分档 / 反伤通道 / 救援规则', () => {
  const st = (over = {}) => ({ id: 's' + Math.random(), kind: 'flag', key: 'x', value: 1, mode: 'add', expiresAt: null, source: 'A', ...over });

  it('shield mode=once 吞掉整次伤害并消失', () => {
    const s = createGame([
      mkUnit({ id: 'A', atk: 3, hp: 6 }),
      mkUnit({ id: 'B', side: 'second', slot: 1, atk: 2, hp: 5, statuses: [st({ kind: 'shield', key: 'shield', value: -1 })] }),
    ]);
    const hit = applyAction(s, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    assert.equal(hit.units.find((u) => u.id === 'B').hp, 5, '整次伤害被吞掉');
    assert.equal(hit.units.find((u) => u.id === 'B').statuses.filter((x) => x.kind === 'shield').length, 0);
  });

  it('reflectMod -1：反伤在有效攻击力上再减 1', () => {
    const s = createGame([
      mkUnit({ id: 'A', atk: 3, hp: 6 }),
      mkUnit({
        id: 'B',
        side: 'second',
        slot: 1,
        atk: 4,
        hp: 6,
        hasReflect: true,
        statuses: [st({ kind: 'flag', key: 'reflect', value: -1 })],
      }),
    ]);
    const hit = applyAction(s, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    // B 有效攻击力 4-1（首回合全体 -1）=3，再 -1（reflectMod）=2。
    assert.equal(hit.units.find((u) => u.id === 'A').hp, 4, '反伤 3-1=2');
  });

  it('noReflectVsHp1：攻击者血量 1 时不反伤', () => {
    const s = createGame([
      mkUnit({ id: 'A', atk: 2, hp: 1 }),
      mkUnit({
        id: 'B',
        side: 'second',
        slot: 1,
        atk: 2,
        hp: 6,
        hasReflect: true,
        statuses: [st({ kind: 'flag', key: 'noReflectVsHp1' })],
      }),
    ]);
    const hit = applyAction(s, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    assert.equal(hit.units.find((u) => u.id === 'B').hp, 5, '攻击者造成 1 点');
    assert.equal(hit.units.find((u) => u.id === 'A').hp, 1, '未受反伤');
  });

  it('grantRescue 常驻被动在开局授予救援能力', () => {
    const s = createGame([
      mkUnit({
        skills: [skill(def({ type: 'passive' }), eff({ trigger: 'always', manual: false, ops: [{ op: 'grantRescue', ref: 'self' }] }))],
      }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    assert.equal(s.units.find((u) => u.id === 'A').hasRescue, true);
  });

  it('cannotBeRescued 立刻判不可救；rescueLimit=2 的画家可被救两次', () => {
    const base = { id: 'A', atk: 1, hp: 0, maxHp: 6, initialMaxHp: 6, tempHp: 0, statuses: [] };
    assert.equal(isRescuableAtAll({ ...base }), true);
    assert.equal(isRescuableAtAll({ ...base, statuses: [st({ kind: 'flag', key: 'cannotBeRescued' })] }), false);
    const painter = withRescueStatuses({
      ...base,
      rescueCount: 1,
      statuses: [st({ kind: 'flag', key: 'rescueLimit', value: 2 })],
    });
    assert.equal(painter.rescueLimit, 2);
    assert.equal(isRescuableAtAll(painter), true, '第二次仍可被救');
  });

  it('untilNextOwnTurnEnd：下个己方回合结束时到期', () => {
    const p = resolveDuration('untilNextOwnTurnEnd', { bigTurn: 1, phase: 'first' }, 'first');
    assert.deepEqual(p, { bigTurn: 2, phase: 'first', at: 'end' });
  });
});

describe('P5-15 技能分支（variant）', () => {
  const branchSkill = () => ({
    def: def(),
    effect: eff({
      ops: [],
      branches: [
        { label: '扫', ops: [{ op: 'damage', ref: 'target', amount: 2, kind: 'skill' }] },
        { label: '转', ops: [{ op: 'modStat', ref: 'self', stat: 'atk', delta: 1 }] },
      ],
      target: { mode: 'anyUnit' },
    }),
    cdCounter: 0,
    charge: 0,
    durability: null,
    usedPerGame: 0,
    usedThisBigTurn: 0,
  });

  it('按 label 选分支并只结算该分支', () => {
    const s0 = createGame([mkUnit({ skills: [branchSkill()] }), mkUnit({ id: 'B', side: 'second', slot: 1 })]);
    const s1 = applyAction(s0, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'B', variant: '扫' }).state;
    assert.equal(s1.units.find((u) => u.id === 'B').hp, 4);
    assert.equal(s1.units.find((u) => u.id === 'A').statuses.filter((x) => x.kind === 'stat').length, 0);
  });

  it('也接受分支下标；缺省或非法 variant 直接报错', () => {
    const s0 = createGame([mkUnit({ skills: [branchSkill()] }), mkUnit({ id: 'B', side: 'second', slot: 1 })]);
    const s1 = applyAction(s0, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'B', variant: '1' }).state;
    assert.equal(s1.units.find((u) => u.id === 'B').hp, 6);
    assert.throws(() => applyAction(s0, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'B' }), /需要选择分支/);
    assert.throws(() => applyAction(s0, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'B', variant: '不存在' }), /没有该分支/);
  });
});

describe('P5-16 排程 / 解放 / 幻影', () => {
  const noAtkShield = eff({
    trigger: 'battlecry',
    manual: false,
    ops: [
      { op: 'shield', ref: 'self', mode: 'once', duration: 'untilTurnEnd' },
      { op: 'shield', ref: 'self', mode: 'once', duration: 'untilTurnEnd', when: 'ownTurnStart', if: 'noAttackLastTurn' },
    ],
  });

  it('守护：上回合未攻击时，回合开始重获护盾', () => {
    const s0 = createGame([
      mkUnit({ skills: [skill(def({ type: 'battlecry' }), noAtkShield)] }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    // 先手回合结束 → 后手回合结束 → 新大回合先手回合开始
    const s2 = applyAction(applyAction(s0, { type: 'endTurn' }).state, { type: 'endTurn' }).state;
    const a = s2.units.find((u) => u.id === 'A');
    assert.ok(a.statuses.some((x) => x.kind === 'shield'), '未攻击应重获护盾');
  });

  it('defer：己方回合结束才结算延迟效果', () => {
    const s0 = createGame([
      mkUnit({
        skills: [skill(def(), eff({
          ops: [{
            op: 'defer', ref: 'self', delay: 'ownTurnEnd',
            ops: [{ op: 'modStat', ref: 'target', stat: 'atk', delta: -1, duration: 'untilNextOwnTurnEnd' }],
          }],
        }))],
      }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    const s1 = applyAction(s0, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'B' }).state;
    assert.equal(s1.units.find((u) => u.id === 'B').statuses.filter((x) => x.kind === 'stat').length, 0);
    const s2 = applyAction(s1, { type: 'endTurn' }).state;
    assert.equal(s2.units.find((u) => u.id === 'B').statuses.filter((x) => x.kind === 'stat').length, 1);
  });

  it('解放：未解放不能攻击，解放后每回合可攻击两次', () => {
    const s0 = createGame([
      mkUnit({
        skills: [skill(def(), eff({
          ops: [{ op: 'liberate', ref: 'self', amount: 0, delta: 0 }],
          duration: 'untilOwnTurnEnd',
        }))],
        statuses: [{ id: 'u1', kind: 'flag', key: 'unliberated', value: 1, mode: 'add', expiresAt: null, source: 'A' }],
      }),
      mkUnit({ id: 'B', side: 'second', slot: 1, hp: 20, maxHp: 20, initialMaxHp: 20 }),
    ]);
    assert.throws(() => applyAction(s0, { type: 'attack', attackerId: 'A', targetId: 'B' }), /解放/);
    const s1 = applyAction(s0, { type: 'useSkill', unitId: 'A', skillIndex: 0 }).state;
    const s2 = applyAction(s1, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    assert.equal(s2.units.find((u) => u.id === 'B').hp, 18);
    const s3 = applyAction(s2, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    assert.equal(s3.units.find((u) => u.id === 'B').hp, 16);
  });

  it('幻影被攻击致死后，归属者获得临时血量', () => {
    const s0 = createGame([
      mkUnit({
        skills: [
          skill(def(), eff({ ops: [{ op: 'summon', ref: 'self', unit: { name: '牵制幻影', atk: 0, hp: 1 } }] })),
          skill(def({ type: 'passive' }), eff({ trigger: 'summonDeath', manual: false, ops: [{ op: 'tempHp', ref: 'self', amount: 1, duration: 'untilNextOwnTurnEnd' }] })),
        ],
      }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    const s1 = applyAction(s0, { type: 'useSkill', unitId: 'A', skillIndex: 0 }).state;
    const summon = s1.units.find((u) => u.isSummon);
    assert.ok(summon, '应召唤出幻影');
    const s2 = applyAction(s1, { type: 'endTurn' }).state;
    const s3 = applyAction(s2, { type: 'attack', attackerId: 'B', targetId: summon.id }).state;
    assert.equal(s3.units.find((u) => u.id === summon.id).dead, true);
    assert.equal(s3.units.find((u) => u.id === 'A').tempHp, 1);
  });
});

// ---------- P5 第一轮收尾：销毁幻影 / 荣光衰减 / 激励充能 / 调律 ----------
describe('P5 第一轮收尾', () => {
  it('攻击后触发：组曲给攻击 +1 与临时血量', () => {
    const suite = eff({
      trigger: 'afterAttack',
      manual: false,
      ops: [
        { op: 'modStat', ref: 'self', stat: 'atk', delta: 1, duration: 'permanent' },
        { op: 'tempHp', ref: 'self', amount: 1, duration: 'untilNextOwnTurnStart' },
      ],
    });
    const s0 = createGame([
      mkUnit({ atk: 3, hp: 6, skills: [skill(def({ type: 'passive' }), suite)] }),
      mkUnit({ id: 'B', side: 'second', slot: 1, hp: 6 }),
    ]);
    const s1 = applyAction(s0, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    const a = s1.units.find((u) => u.id === 'A');
    assert.equal(effectiveAtk(a, s1.clock), 3, '3+1-1（首回合）');
    assert.equal(a.tempHp, 1, '攻击后组曲给 1 临时血量');
  });

  it('调律：本回合可再次攻击，但组曲不再加攻', () => {
    const suite = eff({
      trigger: 'afterAttack',
      manual: false,
      ops: [
        { op: 'modStat', ref: 'self', stat: 'atk', delta: 1, duration: 'permanent', unless: 'suppressSuiteAtk' },
        { op: 'tempHp', ref: 'self', amount: 1, duration: 'untilNextOwnTurnStart' },
      ],
    });
    // 直接用数据表里的真实条目（P5-22：extraAttack 必须自带 untilOwnTurnEnd，不得由测试补 duration）。
    const tune = FX.skills.find((s) => s.id === 'zuoqujia/调律');
    assert.equal(tune.ops.find((o) => o.op === 'extraAttack').duration, 'untilOwnTurnEnd');
    const s0 = createGame([
      mkUnit({ atk: 3, hp: 6, skills: [skill(def({ type: 'passive' }), suite), skill(def(), tune)] }),
      mkUnit({ id: 'B', side: 'second', slot: 1, hp: 20 }),
    ]);
    const s1 = applyAction(s0, { type: 'useSkill', unitId: 'A', skillIndex: 1 }).state;
    const s2 = applyAction(s1, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    const s3 = applyAction(s2, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    const a = s3.units.find((u) => u.id === 'A');
    assert.equal(effectiveAtk(a, s3.clock), 2, '调律期间组曲不加攻（3-1 首回合）');
    assert.equal(a.tempHp, 4, '调律 2 + 两次攻击各 1');
  });

  it('荣光：每攻击一次，后续伤害 -1（可叠加）', () => {
    const glory = eff({
      ops: [
        { op: 'liberate', ref: 'self', amount: 2, delta: 1 },
        { op: 'modStat', ref: 'self', stat: 'atk', delta: 3 },
        { op: 'flag', ref: 'self', key: 'rampDownArm' },
      ],
      duration: 'untilOwnTurnEnd',
    });
    const s0 = createGame([
      mkUnit({
        atk: 3,
        hp: 6,
        skills: [skill(def(), glory)],
        statuses: [{ id: 'u1', kind: 'flag', key: 'unliberated', value: 1, mode: 'add', expiresAt: null, source: 'A' }],
      }),
      mkUnit({ id: 'B', side: 'second', slot: 1, hp: 20, maxHp: 20, initialMaxHp: 20 }),
    ]);
    const s1 = applyAction(s0, { type: 'useSkill', unitId: 'A', skillIndex: 0 }).state;
    const s2 = applyAction(s1, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    // 有效攻击力 3+3-1（首回合）=5
    assert.equal(s2.units.find((u) => u.id === 'B').hp, 15);
    const s3 = applyAction(s2, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    assert.equal(s3.units.find((u) => u.id === 'B').hp, 11, '第二击 5-1=4');
  });

  it('激励：雀跃扣 1 充能、亢奋扣 3 充能，不足则拒绝', () => {
    const inspire = eff({
      branches: [
        { label: '雀跃', cost: 1, ops: [{ op: 'modStat', ref: 'target', stat: 'atk', delta: 1 }] },
        { label: '亢奋', cost: 3, ops: [{ op: 'heal', ref: 'target', amount: 2 }] },
      ],
    });
    const s0 = createGame([
      mkUnit({ skills: [skill(def({ type: 'charge', cost: null }), inspire)] }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    s0.units.find((u) => u.id === 'A').skills[0].charge = 4;
    const s1 = applyAction(s0, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'B', variant: '雀跃' }).state;
    assert.equal(s1.units.find((u) => u.id === 'A').skills[0].charge, 3);
    const s2 = applyAction(s1, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'B', variant: '亢奋' }).state;
    assert.equal(s2.units.find((u) => u.id === 'A').skills[0].charge, 0);
    const poor = {
      ...s2,
      units: s2.units.map((u) => (u.id === 'A' ? { ...u, skills: u.skills.map((x) => ({ ...x, charge: 2 })) } : u)),
    };
    assert.throws(
      () => applyAction(poor, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'B', variant: '亢奋' }),
      /充能不足/,
    );
  });

  it('销毁幻影：记者可主动令自己的幻影死亡，并触发观测视角的临时血量（P5-17 裁决）', () => {
    const summon = eff({ ops: [{ op: 'summon', ref: 'self', unit: { name: '牵制幻影', atk: 0, hp: 2 } }] });
    const vision = eff({
      trigger: 'summonDeath',
      manual: false,
      ops: [
        { op: 'tempHp', ref: 'self', amount: 1, duration: 'untilNextOwnTurnEnd' },
        { op: 'grantDestroySummon', ref: 'self' },
      ],
    });
    const s0 = createGame([
      mkUnit({ skills: [skill(def(), summon), skill(def({ type: 'passive' }), vision)] }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    const s1 = applyAction(s0, { type: 'useSkill', unitId: 'A', skillIndex: 0 }).state;
    const phantom = s1.units.find((u) => u.isSummon);
    assert.ok(phantom);
    assert.equal(s1.units.find((u) => u.id === 'A').canDestroySummon, true, '开局授予主动销毁能力');
    const s2 = applyAction(s1, { type: 'destroySummon', unitId: 'A', summonId: phantom.id }).state;
    assert.equal(s2.units.find((u) => u.id === phantom.id).dead, true);
    assert.equal(s2.units.find((u) => u.id === 'A').tempHp, 1, 'P5-17：主动销毁同样触发观测视角');
  });

  it('目标过滤：excludeSelf / wounded 生效，未知 filter 键报错（P5-23）', () => {
    const inspire = FX.skills.find((s) => s.id === 'laladuiyuan/激励');
    const s0 = createGame([
      mkUnit({ skills: [skill(def({ type: 'charge', cost: null }), inspire)] }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    s0.units.find((u) => u.id === 'A').skills[0].charge = 5;
    assert.throws(
      () => applyAction(s0, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'A', variant: '雀跃' }),
      /不能以自己为目标/,
    );
    const drink = FX.skills.find((s) => s.id === 'tiaojiushi/烈性多夫林');
    const s1 = createGame([
      mkUnit({ skills: [skill(def({ type: 'active', durability: null }), drink)] }),
      mkUnit({ id: 'B', side: 'second', slot: 1, hp: 5, maxHp: 5, initialMaxHp: 5 }),
    ]);
    assert.throws(
      () => applyAction(s1, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'B' }),
      /未受伤/,
    );
    const bad = eff({ target: { mode: 'anyCharacter', filter: { neverImplemented: true } }, ops: [] });
    const s2 = createGame([
      mkUnit({ skills: [skill(def(), bad)] }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    assert.throws(
      () => applyAction(s2, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'B' }),
      /未实现的目标过滤条件/,
    );
  });
});

// ---------- P5 邮差六信件 ----------
describe('P5 邮差六信件', () => {
  const mail = FX.skills.find((s) => s.id === 'youcha/邮件');
  const labels = mail.branches.map((b) => b.label);
  const cast = (label, opts = {}) => {
    const s0 = createGame([
      mkUnit({ skills: [skill(def({ type: 'active' }), mail)] }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    const action = { type: 'useSkill', unitId: 'A', skillIndex: 0, variant: label };
    if (!opts.noTarget) action.targetId = 'B';
    return applyAction(s0, action).state;
  };

  it('六种信件齐全，且邮件目标可空（Q40）', () => {
    assert.deepEqual(labels, ['急切', '诀别', '冷静', '勇敢', '激励', '希望']);
    assert.equal(mail.target.optional, true);
    assert.equal(cast('急切', { noTarget: true }).units.find((u) => u.id === 'A').tempHp, 1, '空目标只给邮差自己');
  });

  it('急切：双方各 +1 临时血量；诀别：受击后回 1 血', () => {
    const s1 = cast('急切');
    assert.equal(s1.units.find((u) => u.id === 'A').tempHp, 1);
    assert.equal(s1.units.find((u) => u.id === 'B').tempHp, 1);
    const s2 = cast('诀别');
    const s3 = applyAction(s2, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    // 首回合攻击力 3-1=2：6-2=4，受击后回 1 → 5
    assert.equal(s3.units.find((u) => u.id === 'B').hp, 5);
  });

  it('冷静：首回合不可用；勇敢：救援扣血 1；激励：可再次攻击', () => {
    assert.throws(() => cast('冷静'), /第 1 回合不可使用/);
    assert.equal(selectBranch(mail, '冷静', { bigTurn: 2 }).label, '冷静');
    const brave = cast('勇敢');
    const rules = (id) => brave.units.find((u) => u.id === id).statuses.filter((s) => s.kind === 'rescueRule');
    assert.equal(rules('A')[0].value, 1);
    assert.equal(rules('B')[0].value, 1);
    const inspire = cast('激励');
    const extra = (id) => inspire.units.find((u) => u.id === id).statuses.filter((s) => s.kind === 'extraAttack');
    assert.equal(extra('A').length, 1);
    assert.equal(extra('B').length, 1);
    // Q41：本回合有效攻击力上限 1（A 原 3，首回合 -1 后仍取 min(2,1)=1）。
    assert.equal(effectiveAtk(inspire.units.find((u) => u.id === 'A'), inspire.clock), 1);
    assert.equal(effectiveAtk(inspire.units.find((u) => u.id === 'B'), inspire.clock), 1);
  });

  it('希望：加 5-X 血（X 为己方场上存活角色数，可破上限）', () => {
    const s = cast('希望');
    const a = s.units.find((u) => u.id === 'A');
    const b = s.units.find((u) => u.id === 'B');
    assert.equal(a.hp, 10, '6 + (5-1) = 10');
    assert.equal(a.maxHp, 10, '加血抬升上限');
    assert.equal(b.hp, 10);
  });
});

// P5-16⑥ 零碎：藏锋相邻伤害 / 击球手 CD 惩罚 / 入殓师标记转移 / 飞行家免伤救援。
// 全部直接吃 data/effects.json 的真实条目，避免测试自补字段掩盖数据缺口。
describe('P5-16⑥ 零碎', () => {
  const fx = (id) => FX.skills.find((s) => s.id === id);
  const hasMark = (u) => u.statuses.some((s) => s.kind === 'mark' && s.key === 'furongfansheng');

  it('藏锋扫式：攻击 +1、不反伤、相邻各 1 点、被击者攻击 -1', () => {
    const g = createGame([
      mkUnit({ id: 'A', atk: 3, hp: 8, maxHp: 8, initialMaxHp: 8, skills: [skill(def({ durability: 5 }), fx('gudongshang/藏锋'))] }),
      mkUnit({ id: 'B', side: 'second', slot: 1, atk: 3, hp: 6, maxHp: 6, initialMaxHp: 6, hasReflect: true }),
      mkUnit({ id: 'C', side: 'second', slot: 2, atk: 0, hp: 3, maxHp: 3, initialMaxHp: 3 }),
    ]);
    const s1 = applyAction(g, { type: 'useSkill', unitId: 'A', skillIndex: 0, variant: '扫式' }).state;
    assert.equal(s1.units.find((u) => u.id === 'A').skills[0].durability, 2, '扫式耗耐久 3（P5-35）');
    const { state: s2, events } = applyAction(s1, { type: 'attack', attackerId: 'A', targetId: 'B' });
    const atk = events.find((e) => e.type === 'attack');
    // 首回合 -1（3→2），扫式「造成伤害 +1」→ 3（P5-21：dmgDealt 已被读取）
    assert.equal(atk.damage, 3);
    assert.equal(s2.units.find((u) => u.id === 'B').hp, 3);
    assert.equal(s2.units.find((u) => u.id === 'C').hp, 2, '相邻角色各受 1 点');
    assert.equal(s2.units.find((u) => u.id === 'A').hp, 8, '扫式不受到反伤');
    // 3 - 首回合 1 - 扫式 1 = 1
    assert.equal(effectiveAtk(s2.units.find((u) => u.id === 'B'), s2.clock), 1);
    // P5-24：edge 角色（B 在 slot 1）只溅射到唯一相邻的 C；且一次性效果用完即失效。
    const left = s2.units.find((u) => u.id === 'A').statuses;
    for (const key of ['splash', 'noReflect', 'atkDownOnHit']) {
      assert.equal(left.some((s) => s.kind === 'flag' && s.key === key), false, `${key} 用完即失效`);
    }
    assert.equal(left.some((s) => s.kind === 'stat' && s.key === 'dmgDealt'), false, '伤害 +1 用完即失效');
    // 转式：耐久只扣 1；耐久不足 3 时不能再扫式。
    const g2 = createGame([
      mkUnit({ id: 'A', atk: 3, hp: 8, maxHp: 8, initialMaxHp: 8, skills: [skill(def({ durability: 5 }), fx('gudongshang/藏锋'))] }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    const t1 = applyAction(g2, { type: 'useSkill', unitId: 'A', skillIndex: 0, variant: '转式' }).state;
    assert.equal(t1.units.find((u) => u.id === 'A').skills[0].durability, 4, '转式耗耐久 1（P5-35）');
    const t2 = applyAction(t1, { type: 'useSkill', unitId: 'A', skillIndex: 0, variant: '扫式' }).state;
    assert.equal(t2.units.find((u) => u.id === 'A').skills[0].durability, 1);
    assert.throws(() => applyAction(t2, { type: 'useSkill', unitId: 'A', skillIndex: 0, variant: '扫式' }), /耐久度不足/);
  });

  it('击球手爆发：从未用过不算 CD（P5-33），用过且在 CD 时攻击 -1', () => {
    const mk = (used) =>
      mkUnit({ id: 'A', atk: 3, hp: 8, maxHp: 8, initialMaxHp: 8, skills: [{ ...skill(def({ type: 'cooldown', cd: 1 }), fx('jiqiushou/爆发')), usedPerGame: used }] });
    const g0 = createGame([mk(0), mkUnit({ id: 'B', side: 'second', slot: 1, atk: 3, hp: 9, maxHp: 9, initialMaxHp: 9 })]);
    // 首回合 -1（3→2），从未使用过不算处于 CD（P5-33 撤销 P5-25）
    assert.equal(applyAction(g0, { type: 'attack', attackerId: 'A', targetId: 'B' }).events.find((e) => e.type === 'attack').damage, 2);
    const g1 = createGame([mk(1), mkUnit({ id: 'B', side: 'second', slot: 1, atk: 3, hp: 9, maxHp: 9, initialMaxHp: 9 })]);
    // 用过且 cdCounter(0) < cd(1) → 再 -1
    assert.equal(applyAction(g1, { type: 'attack', attackerId: 'A', targetId: 'B' }).events.find((e) => e.type === 'attack').damage, 1);
  });

  it('入殓师：战吼开局自带标记，施放即转移（先撤后上）', () => {
    const rl = fx('rulianshi/入殓');
    const mk = (id, slot, charge = 1) =>
      mkUnit({ id, slot, skills: [{ ...skill(def({ type: 'charge', cost: 1, name: '入殓' }), rl), charge }] });
    const g = createGame([mk('A', 1, 2), mk('B', 2), mkUnit({ id: 'C', slot: 3 }), mkUnit({ id: 'E', side: 'second', slot: 1 })]);
    assert.ok(hasMark(g.units.find((u) => u.id === 'A')), '战吼：开局自身持有');
    const s1 = applyAction(g, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'C' }).state;
    assert.equal(hasMark(s1.units.find((u) => u.id === 'A')), false, '施放时先撤下自身的');
    assert.ok(hasMark(s1.units.find((u) => u.id === 'C')));
    // 同一角色不能持有两个
    assert.throws(() => applyAction(s1, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'C' }), /已有附容返生/);
    // 「无限次」转移
    const s2 = applyAction(s1, { type: 'transferMark', unitId: 'A', fromId: 'C', toId: 'B' }).state;
    assert.equal(hasMark(s2.units.find((u) => u.id === 'C')), false);
    assert.ok(hasMark(s2.units.find((u) => u.id === 'B')));
  });

  it('入殓师：上限 = 己方入殓师数量（双入殓师可有两个标记）', () => {
    const rl = fx('rulianshi/入殓');
    const mk = (id, slot) =>
      mkUnit({ id, slot, skills: [{ ...skill(def({ type: 'charge', cost: 1, name: '入殓' }), rl), charge: 1 }] });
    const g = createGame([mk('A', 1), mk('D', 2), mkUnit({ id: 'C', slot: 3 }), mkUnit({ id: 'E', side: 'second', slot: 1 })]);
    assert.equal(g.units.filter((u) => hasMark(u)).length, 2, '开局两名入殓师各持一个');
    const s1 = applyAction(g, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'C' }).state;
    assert.equal(s1.units.filter((u) => hasMark(u)).length, 2, '转移不增加总数');
    assert.ok(hasMark(s1.units.find((u) => u.id === 'C')));
    assert.ok(hasMark(s1.units.find((u) => u.id === 'D')));
  });

  it('飞行家：消耗一个飞行器使本次救援无伤', () => {
    const g = createGame([
      mkUnit({
        id: 'F',
        atk: 0,
        hp: 2,
        maxHp: 2,
        initialMaxHp: 2,
        hasRescue: true,
        skills: [
          skill(def({ type: 'passive' }), fx('feixingjia/救援')),
          skill(def({ name: '飞行器', type: 'active', durability: 3 }), fx('feixingjia/飞行器')),
        ],
      }),
      mkUnit({ id: 'D', hp: 0, maxHp: 4, initialMaxHp: 4 }),
      mkUnit({ id: 'E', side: 'second', slot: 1 }),
    ]);
    const plain = applyAction(g, { type: 'rescue', targetId: 'D', rescuerId: 'F' }).state;
    assert.equal(plain.units.find((u) => u.id === 'D').dead, true, '不消耗飞行器时血量不足，救不了');
    const s1 = applyAction(g, { type: 'rescue', targetId: 'D', rescuerId: 'F', useFlyer: true }).state;
    const f = s1.units.find((u) => u.id === 'F');
    assert.equal(s1.units.find((u) => u.id === 'D').dead, false);
    assert.equal(f.hp, 2, '消耗飞行器后不扣血');
    assert.equal(f.skills[1].durability, 2, '飞行器耐久 -1');
  });

  it('悬停：首次伤害免疫并触发飞行器；耐久 0 时只免伤（P5-28）', () => {
    const mkF = (dur) =>
      mkUnit({
        id: 'F',
        side: 'second',
        slot: 1,
        hp: 3,
        maxHp: 3,
        initialMaxHp: 3,
        skills: [
          skill(def({ type: 'passive' }), fx('feixingjia/悬停')),
          skill(def({ name: '飞行器', type: 'active', durability: dur }), fx('feixingjia/飞行器')),
        ],
      });
    const hit = (dur) => {
      const g = createGame([mkUnit({ id: 'A', atk: 2 }), mkF(dur)]);
      return applyAction(g, { type: 'attack', attackerId: 'A', targetId: 'F' }).state.units.find((u) => u.id === 'F');
    };
    const a = hit(3);
    assert.equal(a.hp, 4, '免伤 + 触发飞行器回 1 血');
    assert.equal(a.maxHp, 4, '上限 +1');
    assert.equal(a.skills[1].durability, 2, '触发消耗 1 耐久');
    const b = hit(0);
    assert.equal(b.hp, 3, '免伤');
    assert.equal(b.maxHp, 3, '耐久 0 不触发飞行器');
    assert.equal(b.skills[1].durability, 0);
    // P5-36：技能伤害同样吃「悬停」免伤（scope=all），并且同样触发飞行器。
    const g = createGame([
      mkUnit({
        id: 'A',
        atk: 2,
        skills: [skill(def(), eff({ id: 'x/dmg', target: { mode: 'enemyUnit' }, ops: [{ op: 'damage', ref: 'target', amount: 2 }] }))],
      }),
      mkF(3),
    ]);
    const afterSkill = applyAction(g, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'F' }).state.units.find((u) => u.id === 'F');
    assert.equal(afterSkill.hp, 4, '技能伤害被免伤，飞行器回 1 血');
    assert.equal(afterSkill.skills[1].durability, 2, '技能伤害也触发飞行器');
  });
});

// ---------- P5-9 充能速率（data 字段 + 结算口径） ----------
describe('P5-9 充能速率', () => {
  const at = (bigTurn, phase = 'first') => ({ bigTurn, phase, at: 'start' });

  it('大回合开始按 chargeRate 充能：首回合不充能、隔回合生效、封顶', () => {
    const mk = (charge = 1) =>
      mkUnit({
        skills: [
          { ...skill(def({ type: 'charge', cost: 1, chargeInitial: charge, chargeMax: 5, chargeRate: { turns: 2, amount: 1 } })), charge },
        ],
      });
    const chargeAt = (bigTurn, phase = 'first') => chargeOnBigTurnStart([mk(1)], at(bigTurn, phase))[0].skills[0].charge;
    assert.equal(chargeAt(1), 1, '首回合不充能（x/y 的 x 即开局层数）');
    assert.equal(chargeAt(2), 2, '第二回合首次充能');
    assert.equal(chargeAt(3), 1, '「每两回合一次」：第三回合不充能');
    assert.equal(chargeAt(4), 2, '第四回合 +1');
    assert.equal(chargeAt(3, 'second'), 1, '后手小回合开始不充能');
    const capped = chargeOnBigTurnStart(
      [
        mkUnit({
          skills: [
            { ...skill(def({ type: 'charge', chargeInitial: 4, chargeMax: 5, chargeRate: { turns: 1, amount: 2 } })), charge: 4 },
          ],
        }),
      ],
      at(2),
    );
    assert.equal(capped[0].skills[0].charge, 5, '封顶 chargeMax');
    const eventDriven = chargeOnBigTurnStart(
      [mkUnit({ skills: [{ ...skill(def({ type: 'charge', chargeRate: null, chargeOn: 'selfOrAdjacentDamage' })), charge: 0 }] })],
      at(2),
    );
    assert.equal(eventDriven[0].skills[0].charge, 0, '事件驱动充能不走回合结算');
  });

  it('数据：7 个充能技能的初始/上限/速率与原文 x/y 一致', () => {
    const want = {
      '先知/役鸟守护': { initial: 1, max: 5, turns: 2 },
      '拉拉队员/激励': { initial: 0, max: null, turns: 1 },
      '入殓师/入殓': { initial: 1, max: 1, turns: 1 },
      '祭司/门之钥': { initial: 2, max: 3, turns: 1 },
      '咒术师/猿猴咒像': { initial: 0, max: 5, turns: null },
      '勘探员/陨石磁铁': { initial: 1, max: 3, turns: 1 },
      '小女孩/回忆碎片': { initial: 1, max: 3, turns: 1 },
    };
    const seen = [];
    for (const c of CHARS) {
      for (const s of c.skills) {
        if (s.type !== 'charge') continue;
        const key = c.name + '/' + s.name;
        seen.push(key);
        const w = want[key];
        assert.ok(w, '未登记的充能技能：' + key);
        assert.equal(s.chargeInitial, w.initial, key + ' 初始层数');
        assert.equal(s.chargeMax, w.max, key + ' 上限');
        if (w.turns === null) {
          assert.equal(s.chargeOn, 'selfOrAdjacentDamage', key + ' 应为受击充能');
          assert.equal(s.chargeRate, null, key + ' 不应按回合充能');
        } else {
          assert.deepEqual(s.chargeRate, { turns: w.turns, amount: 1 }, key + ' 充能速率');
        }
      }
    }
    assert.equal(seen.length, 7);
  });

  it('受击充能：猿猴咒像自己及相邻角色受伤各 +1，间隔位不充能，封顶 5', () => {
    const owner = (id, slot, initial = 0) =>
      mkUnit({
        id,
        slot,
        side: 'second',
        skills: [
          {
            ...skill(def({ type: 'charge', chargeInitial: initial, chargeMax: 5, chargeRate: null, chargeOn: 'selfOrAdjacentDamage' }), null),
            charge: initial,
          },
        ],
      });
    const setup = (initial) =>
      createGame([mkUnit({ id: 'A', atk: 2, slot: 1 }), owner('B', 1, initial), owner('C', 2, initial), owner('D', 3, initial)]);
    const s1 = applyAction(setup(0), { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    const ch = (s, id) => s.units.find((u) => u.id === id).skills[0].charge;
    assert.equal(ch(s1, 'B'), 1, '自己受伤 +1');
    assert.equal(ch(s1, 'C'), 1, '相邻角色受伤 +1');
    assert.equal(ch(s1, 'D'), 0, '不相关角色不充能');
    const s2 = applyAction(setup(5), { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    assert.equal(ch(s2, 'B'), 5, '封顶 chargeMax');
  });
});

describe('P5-32 CD 字段', () => {
  it('数据：14 个 CD 技能都有数字 cd，玛恩纳为初始 1 / 之后 2', () => {
    assert.equal(CHARS.some((c) => (c.skills || []).some((s) => 'cooldown' in s)), false, '不应再有 cooldown 字段');
    const cds = CHARS.flatMap((c) => (c.skills || []).filter((s) => s.type === 'cooldown').map((s) => ({ c, s })));
    assert.equal(cds.length, 14);
    for (const { c, s } of cds) {
      assert.equal(typeof s.cd, 'number', `${c.name}/${s.name} 的 cd 必须是数字`);
      if (s.initialCd != null) assert.equal(typeof s.initialCd, 'number');
    }
    const rong = cds.find(({ s }) => s.name === '未照耀的荣光');
    assert.equal(rong.s.cd, 2, '之后 CD 2');
    assert.equal(rong.s.initialCd, 1, '初始 CD 1');
    const noInit = cds.filter(({ s }) => s.initialCd == null).map(({ s }) => s.name);
    assert.equal(noInit.length, 13, '其余 CD 技能初始为 0（缺省）');
  });

  it('接线：initialCd 进 cdCounter，CD 未就绪时 canUseSkill 拒绝', () => {
    const idx = indexEffects(FX);
    const maenna = CHARS.find((c) => c.id === 'maenna');
    const us = buildUnitSkills('maenna', maenna.skills, idx);
    const rong = us.find((s) => s.def.name === '未照耀的荣光');
    assert.equal(rong.cdCounter, 1);
    const u = mkUnit({ id: 'M', skills: us });
    // D08：初始 CD 1 → 第 2 回合起可用
    assert.match(String(canUseSkill(u, rong, { bigTurn: 1, phase: 'first', smallTurnsDone: 0 })), /初始 CD/);
    assert.equal(canUseSkill(u, rong, { bigTurn: 2, phase: 'first', smallTurnsDone: 0 }), null);
    // R22：无初始 CD 的技能开局即可用，用掉之后才按 R16 计数
    const lala = CHARS.find((c) => c.id === 'laladuiyuan');
    const ls = buildUnitSkills('laladuiyuan', lala.skills, idx);
    const guwu = ls.find((s) => s.def.name === '鼓舞');
    assert.equal(guwu.cdCounter, 0);
    assert.equal(canUseSkill(mkUnit({ id: 'L', skills: ls }), guwu, { bigTurn: 1, phase: 'first', smallTurnsDone: 0 }), null);
    const used = { ...guwu, usedPerGame: 1, cdCounter: 0 };
    assert.match(String(canUseSkill(mkUnit({ id: 'L', skills: [used] }), used, { bigTurn: 1, phase: 'first', smallTurnsDone: 0 })), /CD 未就绪/);
    const ready = { ...guwu, usedPerGame: 1, cdCounter: 1 };
    assert.equal(canUseSkill(mkUnit({ id: 'L', skills: [ready] }), ready, { bigTurn: 2, phase: 'first', smallTurnsDone: 0 }), null);
  });

  it('R16：使用当回合不计 CD 计数', () => {
    const g = createGame([
      mkUnit({ id: 'A', skills: [skill(def({ type: 'cooldown', cd: 1 }), eff({}))] }),
      mkUnit({ id: 'B', side: 'second', slot: 1, atk: 1, hp: 9, maxHp: 9, initialMaxHp: 9 }),
    ]);
    const s1 = applyAction(g, { type: 'useSkill', unitId: 'A', skillIndex: 0 }).state;
    assert.equal(s1.units.find((u) => u.id === 'A').skills[0].cdCounter, 0);
    const s2 = applyAction(s1, { type: 'endTurn' }).state;
    const s3 = applyAction(s2, { type: 'endTurn' }).state;
    assert.equal(s3.clock.bigTurn, 2);
    assert.equal(s3.units.find((u) => u.id === 'A').skills[0].cdCounter, 0, '使用当回合的大回合结束不计数');
  });
});

// P7 A 批：动态条件被动（trigger=always + condition，由 core/game.ts 的 syncAuras 重算）。
describe('P7 条件被动', () => {
  const passive = (ops, condition) => skill(def({ type: 'passive' }), eff({ trigger: 'always', manual: false, ops, condition }));

  it('复仇者：血量掉到 3 以下后攻击力 +2，回到 3 以上恢复', () => {
    const g = createGame([
      mkUnit({ skills: [passive([{ op: 'modStat', ref: 'self', stat: 'atk', delta: 2 }], [{ hpLt: 3 }])] }),
      mkUnit({
        id: 'B',
        side: 'second',
        slot: 1,
        skills: [skill(def(), eff({ ops: [{ op: 'damage', ref: 'target', amount: 4 }] }))],
      }),
      mkUnit({ id: 'C', side: 'first', slot: 2 }),
    ]);
    assert.equal(effectiveAtk(g.units.find((u) => u.id === 'A'), g.clock), 2, '首回合 -1');
    const t = applyAction(g, { type: 'endTurn' }).state;
    const s1 = applyAction(t, { type: 'useSkill', unitId: 'B', skillIndex: 0, targetId: 'A' }).state;
    const a = s1.units.find((u) => u.id === 'A');
    assert.ok(a.hp < 3);
    assert.equal(effectiveAtk(a, s1.clock), 3 + 2 - 1);
  });

  it('胆怯：每个受伤的己方角色使攻击力 -1', () => {
    const g = createGame([
      mkUnit({ skills: [passive([{ op: 'modStatPer', ref: 'self', stat: 'atk', delta: -1, per: 'woundedAllies' }], [])] }),
      mkUnit({ id: 'C', side: 'first', slot: 2, hp: 3, maxHp: 6, initialMaxHp: 6 }),
      mkUnit({ id: 'D', side: 'first', slot: 3 }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    // 受伤的己方只有 C → 3 - 1（胆怯）- 1（首回合）= 1
    assert.equal(effectiveAtk(g.units.find((u) => u.id === 'A'), g.clock), 1);
  });

  it('格列佛游记：有队友时不可被攻击，队友全灭后失效', () => {
    const g = createGame([
      mkUnit({ skills: [passive([{ op: 'invulnerable', ref: 'self' }], [{ allyAlive: 2 }])] }),
      mkUnit({ id: 'C', side: 'first', slot: 2, hp: 1, maxHp: 1, initialMaxHp: 1 }),
      mkUnit({
        id: 'B',
        side: 'second',
        slot: 1,
        atk: 5,
        skills: [skill(def(), eff({ ops: [{ op: 'damage', ref: 'target', amount: 3 }] }))],
      }),
    ]);
    assert.equal(legalAttackTargets(g, 'B').some((u) => u.id === 'A'), false, '开局不可被攻击');
    const t = applyAction(g, { type: 'endTurn' }).state;
    const s1 = applyAction(t, { type: 'useSkill', unitId: 'B', skillIndex: 0, targetId: 'C' }).state;
    assert.equal(s1.units.find((u) => u.id === 'C').dead, true);
    assert.equal(legalAttackTargets(s1, 'B').some((u) => u.id === 'A'), true, '队友全灭后恢复可被攻击');
  });

  it('牵绊（病患）：战吼条件——有「心理学家」在场才 +1 血', () => {
    const ops = [{ op: 'modStat', ref: 'self', stat: 'hp', delta: 1 }];
    const cond = [{ allyName: '心理学家' }];
    const withAlly = createGame([
      mkUnit({ skills: [skill(def({ type: 'battlecry' }), eff({ trigger: 'battlecry', manual: false, duration: 'permanent', ops, condition: cond }))] }),
      mkUnit({ id: 'C', side: 'first', slot: 2, name: '心理学家' }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    assert.equal(withAlly.units.find((u) => u.id === 'A').hp, 7);
    const alone = createGame([
      mkUnit({ skills: [skill(def({ type: 'battlecry' }), eff({ trigger: 'battlecry', manual: false, ops, condition: cond }))] }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    assert.equal(alone.units.find((u) => u.id === 'A').hp, 6);
  });
});

// P7 B 批：条件被动、全局关键词、受限救援目标。
describe('P7 B 批', () => {
  const passive = (ops, condition) => skill(def({ type: 'passive' }), eff({ trigger: 'always', manual: false, ops, condition }));

  it('特发性震颤：只有自己是唯一救援者时攻击力 -1 且可自我救援，否则撤销', () => {
    const makeGame = (extra = []) =>
      createGame([
        mkUnit({
          id: 'A',
          skills: [
            skill(def({ type: 'passive' }), eff({ trigger: 'always', manual: false, ops: [{ op: 'grantRescue', ref: 'self' }] })),
            passive(
              [
                { op: 'modStat', ref: 'self', stat: 'atk', delta: -1 },
                { op: 'selfRescue', ref: 'self' },
              ],
              [{ selfUniqueRescuer: true }],
            ),
          ],
        }),
        mkUnit({ id: 'B', side: 'second', slot: 1 }),
        ...extra,
      ]);

    const solo = makeGame();
    const a = withRescueStatuses(solo.units.find((u) => u.id === 'A'));
    assert.equal(a.hasRescue, true);
    assert.equal(effectiveAtk(a, solo.clock), 1, '3 - 1（首回合）- 1（条件被动）');
    assert.equal(a.canSelfRescue, true);

    const withAlly = makeGame([mkUnit({ id: 'C', side: 'first', slot: 2, hasRescue: true })]);
    const a2 = withRescueStatuses(withAlly.units.find((u) => u.id === 'A'));
    assert.equal(effectiveAtk(a2, withAlly.clock), 2, '出现第二个救援者后攻击力恢复');
    assert.ok(!a2.canSelfRescue, '不再具备自我救援');
  });

  it('庄园老友：本大回合已受伤后，后续攻击伤害 -1', () => {
    const g = createGame([
      mkUnit({
        hp: 10,
        maxHp: 10,
        initialMaxHp: 10,
        skills: [passive([{ op: 'flag', ref: 'self', key: 'veteranOfManor' }])],
      }),
      mkUnit({ id: 'B', side: 'second', slot: 1, atk: 3 }),
    ]);
    const a = g.units.find((u) => u.id === 'A');
    const b = g.units.find((u) => u.id === 'B');
    assert.ok(a.statuses.some((s) => s.kind === 'flag' && s.key === 'veteranOfManor'), '关键词已落成 flag');
    // 首回合 -1：3 → 2；本大回合已受伤后再 -1：→ 1。
    assert.equal(attackDamage(b, { ...a, damageTakenThisBigTurn: 0 }, g.clock), 2);
    assert.equal(attackDamage(b, { ...a, damageTakenThisBigTurn: 1 }, g.clock), 1);
  });

  it('牵绊：心理学家只能救援角色名「病患」的目标', () => {
    const g = createGame([
      mkUnit({
        id: 'A',
        skills: [
          skill(
            def({ type: 'passive' }),
            eff({
              trigger: 'always',
              manual: false,
              ops: [
                { op: 'grantRescue', ref: 'self' },
                { op: 'rescueRule', ref: 'self', targetName: '病患' },
              ],
            }),
          ),
        ],
      }),
      mkUnit({ id: 'P', name: '病患', side: 'first', slot: 2, hp: 0, maxHp: 6, initialMaxHp: 6 }),
      mkUnit({ id: 'O', name: '路人', side: 'first', slot: 3, hp: 0, maxHp: 6, initialMaxHp: 6 }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    const rescuer = withRescueStatuses(g.units.find((u) => u.id === 'A'));
    const patient = withRescueStatuses(g.units.find((u) => u.id === 'P'));
    const other = withRescueStatuses(g.units.find((u) => u.id === 'O'));
    assert.equal(availableRescues(patient, [rescuer]).length, 1, '可以救病患');
    assert.equal(availableRescues(other, [rescuer]).length, 0, '不能救病患以外的角色');
  });
});

// P7 C 批：道具使用后的反应、攻击后重置、受击回血。
describe('P7 C 批', () => {
  const itemIndex = (items) => ({ skills: new Map(), items: new Map(items) });

  it('探险幻想：攻击后攻击力改为 2，之后的回合结束 +2 仍在 2 的基础上叠加', () => {
    const g = createGame([
      mkUnit({
        atk: 5,
        skills: [
          skill(
            def({ type: 'passive' }),
            eff({
              trigger: 'turnEnd',
              manual: false,
              duration: 'permanent',
              ops: [{ op: 'modStat', ref: 'self', stat: 'atk', delta: 2 }],
              afterAttackOps: [{ op: 'setStat', ref: 'self', stat: 'atk', value: 2 }],
            }),
          ),
        ],
      }),
      mkUnit({ id: 'B', side: 'second', slot: 1, hp: 20, maxHp: 20, initialMaxHp: 20 }),
    ]);
    // 走过第 1 个大回合的回合结束 +2，进入第 2 大回合。
    let s = applyAction(g, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'endTurn' }).state;
    assert.equal(effectiveAtk(s.units.find((u) => u.id === 'A'), s.clock), 7);
    // 攻击后「改为2」：setStat 覆盖此前的 +2。
    const after = applyAction(s, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    assert.equal(effectiveAtk(after.units.find((u) => u.id === 'A'), after.clock), 2, '攻击后有效攻击力回到 2');
    // 下个回合结束的 +2 施加在 set 之后，仍应累加（不是被永久吞掉）。
    let t = applyAction(after, { type: 'endTurn' }).state;
    t = applyAction(t, { type: 'endTurn' }).state;
    assert.equal(t.clock.bigTurn, 3);
    assert.equal(effectiveAtk(t.units.find((u) => u.id === 'A'), t.clock), 4, '2 + 回合结束 +2');
  });

  it('应激：血量 <4 受击后回 2 血，限两次；攻击力上限 1 常驻', () => {
    const g = createGame([
      mkUnit({
        atk: 3,
        skills: [
          skill(
            def({ type: 'passive' }),
            eff({
              trigger: 'damaged',
              manual: false,
              condition: [{ hpLt: 4 }],
              usageLimit: { perGame: 2 },
              battlecryOps: [{ op: 'flag', ref: 'self', key: 'atkCap', value: 1, duration: 'permanent' }],
              ops: [{ op: 'heal', ref: 'self', amount: 2 }],
            }),
          ),
        ],
      }),
      mkUnit({
        id: 'B',
        side: 'second',
        slot: 1,
        skills: [skill(def(), eff({ ops: [{ op: 'damage', ref: 'target', amount: 3, kind: 'skill' }] }))],
      }),
    ]);
    assert.ok(
      g.units.find((u) => u.id === 'A').statuses.some((s) => s.kind === 'flag' && s.key === 'atkCap'),
      '开局即受「攻击力不可高于 1」约束',
    );
    assert.equal(effectiveAtk(g.units.find((u) => u.id === 'A'), g.clock), 1);

    let s = applyAction(g, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'useSkill', unitId: 'B', skillIndex: 0, targetId: 'A' }).state;
    assert.equal(s.units.find((u) => u.id === 'A').hp, 5, '6-3=3 后回 2');

    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'useSkill', unitId: 'B', skillIndex: 0, targetId: 'A' }).state;
    assert.equal(s.units.find((u) => u.id === 'A').hp, 4, '5-3=2 后再回 2');

    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'useSkill', unitId: 'B', skillIndex: 0, targetId: 'A' }).state;
    assert.equal(s.units.find((u) => u.id === 'A').hp, 1, '两次额度用尽后不再回血');
    assert.equal(effectiveAtk(s.units.find((u) => u.id === 'A'), s.clock), 1);
  });

  it('精准打击：使用信号枪后空军攻击 -1、血量 +1，并额外封禁目标技能', () => {
    const g = createGame(
      [
        mkUnit({
          skills: [
            skill(
              def({ type: 'battlecry' }),
              eff({
                trigger: 'itemUse',
                manual: false,
                condition: [{ itemUsed: 'xinhaoqiang' }],
                battlecryOps: [{ op: 'grantItem', ref: 'self', item: 'xinhaoqiang', count: 1 }],
                ops: [
                  { op: 'modStat', ref: 'self', stat: 'atk', delta: -1, duration: 'permanent' },
                  { op: 'modStat', ref: 'self', stat: 'hp', delta: 1, duration: 'permanent' },
                  { op: 'sealSkills', ref: 'target', duration: 'turns:1' },
                ],
              }),
            ),
          ],
        }),
        mkUnit({ id: 'B', side: 'second', slot: 1 }),
      ],
      {
        effects: itemIndex([
          [
            'xinhaoqiang',
            {
              id: 'xinhaoqiang',
              name: '信号枪',
              cost: 1000,
              effect: { ops: [{ op: 'damage', ref: 'target', amount: 2, kind: 'skill' }] },
            },
          ],
        ]),
      },
    );
    assert.equal(g.units.find((u) => u.id === 'A').items.length, 1, '战吼已给信号枪');

    const s = applyAction(g, { type: 'useItem', unitId: 'A', itemIndex: 0, targetId: 'B' }).state;
    const a = s.units.find((u) => u.id === 'A');
    const b = s.units.find((u) => u.id === 'B');
    assert.equal(effectiveAtk(a, s.clock), 1, '3 - 1（永久）- 1（首回合）');
    assert.equal(a.hp, 7);
    assert.equal(a.maxHp, 7);
    assert.equal(b.hp, 4, '信号枪 2 点伤害');
    assert.ok(b.statuses.some((x) => x.kind === 'flag' && x.key === 'sealed'), '本次信号枪额外封禁目标技能');
  });

  it('二重奏：使用八音盒后舞女血量 +1，并挂上「增益不消失」flag', () => {
    const g = createGame(
      [
        mkUnit({
          skills: [
            skill(
              def({ type: 'battlecry' }),
              eff({
                trigger: 'itemUse',
                manual: false,
                condition: [{ itemUsed: 'bayinhe' }],
                battlecryOps: [{ op: 'grantItem', ref: 'self', item: 'bayinhe', count: 3 }],
                ops: [
                  { op: 'modStat', ref: 'self', stat: 'hp', delta: 1, duration: 'permanent' },
                  { op: 'flag', ref: 'self', key: 'bayinheBuffPersist', duration: 'permanent' },
                ],
              }),
            ),
          ],
        }),
        mkUnit({ id: 'B', side: 'second', slot: 1 }),
      ],
      {
        effects: itemIndex([['bayinhe', { id: 'bayinhe', name: '八音盒', cost: 1000, effect: { ops: [] } }]]),
      },
    );
    assert.equal(g.units.find((u) => u.id === 'A').items.length, 3, '战吼给三个八音盒');

    const s = applyAction(g, { type: 'useItem', unitId: 'A', itemIndex: 0, targetId: 'A' }).state;
    const a = s.units.find((u) => u.id === 'A');
    assert.equal(a.items.length, 2);
    assert.equal(a.hp, 7);
    assert.equal(a.maxHp, 7);
    assert.ok(a.statuses.some((x) => x.kind === 'flag' && x.key === 'bayinheBuffPersist'));
  });
});

// P7 D 批：分支次数上限 / 分支 k 花费 / 换位换回规则。
describe('P7 D 批', () => {
  const summonBranch = (label, uses, name, decay) => ({
    label,
    uses,
    ops: [{ op: 'summon', ref: 'self', unit: { name, atk: 0, hp: 2 } }],
  });

  it('独家新闻：幻影每个大回合开始-1 血，第二回合自然消失并触发观测视角（P7-2-X1）', () => {
    const real = FX.skills.find((s) => s.id === 'jizhe/独家新闻');
    assert.equal(real.impl, 'full');
    const observe = FX.skills.find((s) => s.id === 'jizhe/观测视角');
    let s = createGame([
      mkUnit({
        id: 'A',
        hp: 6,
        maxHp: 6,
        initialMaxHp: 6,
        skills: [
          skill(def({ type: 'cooldown', cd: 0 }), real),
          skill(def({ type: 'passive' }), observe),
        ],
      }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    s = applyAction(s, { type: 'useSkill', unitId: 'A', skillIndex: 0, variant: '牵制幻影' }).state;
    const ghostId = s.units.find((u) => u.isSummon).id;
    const ghost = () => s.units.find((u) => u.id === ghostId);
    assert.equal(ghost().hp, 2, '幻影初始 2 血');
    // 掉血走的是召唤物自带的 turnStart 被动，不额外开字段/分支。
    assert.ok(
      ghost().skills.some((s) => s.effect?.trigger === 'ownTurnStart'
        && s.effect.ops.some((o) => o.op === 'damage' && o.ref === 'self' && o.amount === 1)),
      '幻影自带每回合-1 血的 turnStart 被动',
    );

    // 第一个大回合结束（进入 bigTurn 2 先手）：-1 血，还剩 1。
    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'endTurn' }).state;
    assert.equal(s.clock.bigTurn, 2);
    assert.equal(ghost().hp, 1, '每个大回合开始-1 血');
    assert.equal(ghost().dead, false);

    // 第二个大回合结束：归零 → 自然死亡，记者获得观测视角的 1 点临时血。
    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'endTurn' }).state;
    assert.equal(s.clock.bigTurn, 3);
    assert.equal(ghost().dead, true, '血量归零即消失');
    assert.equal(s.units.find((u) => u.id === 'A').tempHp, 1, '消失同样触发观测视角');
  });

  it('独家新闻：牵制幻影每局限 3 次、救援幻影限 1 次，且两者计数互不影响', () => {
    const g = createGame([
      mkUnit({
        skills: [
          skill(
            def({ type: 'cooldown', cd: 0 }),
            eff({ branches: [summonBranch('牵制幻影', 3, '牵制幻影'), summonBranch('救援幻影', 1, '救援幻影')] }),
          ),
        ],
      }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    let s = g;
    for (let i = 0; i < 3; i += 1) {
      s = applyAction(s, { type: 'useSkill', unitId: 'A', skillIndex: 0, variant: '牵制幻影' }).state;
    }
    assert.equal(s.units.filter((u) => u.isSummon && u.name === '牵制幻影').length, 3, '已召唤三个牵制幻影');
    assert.throws(
      () => applyAction(s, { type: 'useSkill', unitId: 'A', skillIndex: 0, variant: '牵制幻影' }),
      /已用尽/,
      '第 4 次牵制幻影被拒',
    );
    // 牵制用尽不影响救援分支。
    s = applyAction(s, { type: 'useSkill', unitId: 'A', skillIndex: 0, variant: '救援幻影' }).state;
    assert.equal(s.units.filter((u) => u.isSummon && u.name === '救援幻影').length, 1, '救援幻影仍可召唤');
    assert.throws(
      () => applyAction(s, { type: 'useSkill', unitId: 'A', skillIndex: 0, variant: '救援幻影' }),
      /已用尽/,
      '第 2 次救援幻影被拒',
    );
    assert.throws(
      () => applyAction(s, { type: 'useSkill', unitId: 'A', skillIndex: 0, variant: '牵制幻影' }),
      /已用尽/,
      '牵制计数不被救援分支重置',
    );
  });

  it('线路控制：基础分支每回合限一次；升级分支扣 1k、每局限一次；k 不足被拒', () => {
    const lineEffect = (branches) =>
      eff({
        target: { mode: 'allyUnit' },
        usageLimit: { perTurn: 1 },
        branches,
      });
    const branches = [
      {
        label: '基础',
        ops: [
          { op: 'modStat', ref: 'self', stat: 'atk', delta: -1 },
          { op: 'modStat', ref: 'target', stat: 'atk', delta: 1 },
        ],
      },
      {
        label: '升级',
        kCost: 1000,
        uses: 1,
        ops: [
          { op: 'modStat', ref: 'self', stat: 'atk', delta: -3 },
          { op: 'modStat', ref: 'target', stat: 'atk', delta: 2 },
        ],
      },
    ];
    const make = () =>
      createGame([
        mkUnit({ id: 'A', atk: 5, skills: [skill(def({ type: 'active' }), lineEffect(branches))] }),
        mkUnit({ id: 'C', side: 'first', slot: 2, atk: 3 }),
        mkUnit({ id: 'B', side: 'second', slot: 1 }),
      ]);

    // 基础分支：每回合一次。
    let s = make();
    s = applyAction(s, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'C', variant: '基础' }).state;
    assert.equal(statOf(s.units.find((u) => u.id === 'A').atk, s.units.find((u) => u.id === 'A').statuses, 'atk'), 4, '自身攻击 -1');
    assert.equal(statOf(s.units.find((u) => u.id === 'C').atk, s.units.find((u) => u.id === 'C').statuses, 'atk'), 4, '友方攻击 +1');
    // P7-D3 裁决：攻击力变化为永久（没有到期时间点）。
    const modA = s.units.find((u) => u.id === 'A').statuses.find((x) => x.kind === 'stat' && x.key === 'atk');
    assert.equal(modA.expiresAt, null, '攻击力修正永久保留');
    assert.throws(
      () => applyAction(s, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'C', variant: '基础' }),
      /本回合使用次数已用尽/,
      '基础分支同一回合第二次被拒',
    );
    // P7-D2 裁决：同一回合只能选一个分支（每回合次数由技能级共享）。
    assert.throws(
      () => applyAction(s, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'C', variant: '升级' }),
      /本回合使用次数已用尽/,
      '同一回合只能选一个分支',
    );
    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'C', variant: '基础' }).state;
    assert.equal(statOf(s.units.find((u) => u.id === 'A').atk, s.units.find((u) => u.id === 'A').statuses, 'atk'), 3, '下回合基础分支可再使用');

    // 升级分支：扣 1000k、每局限一次。
    s = make();
    assert.equal(s.k.first, 3000);
    s = applyAction(s, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'C', variant: '升级' }).state;
    assert.equal(s.k.first, 2000, '升级分支扣 1k');
    assert.equal(statOf(s.units.find((u) => u.id === 'A').atk, s.units.find((u) => u.id === 'A').statuses, 'atk'), 2, '自身攻击 -3');
    assert.equal(statOf(s.units.find((u) => u.id === 'C').atk, s.units.find((u) => u.id === 'C').statuses, 'atk'), 5, '友方攻击 +2');
    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'endTurn' }).state;
    assert.throws(
      () => applyAction(s, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'C', variant: '升级' }),
      /已用尽/,
      '升级分支每局只能选一次',
    );

    // k 不足：内核拒绝且不消耗次数。
    const poor = make();
    poor.k = { ...poor.k, first: 999 };
    assert.throws(
      () => applyAction(poor, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'C', variant: '升级' }),
      /资源不足/,
    );
    assert.equal(poor.units.find((u) => u.id === 'A').skills[0].branchUses?.[1] ?? 0, 0, '失败不消耗分支次数');
  });

  it('隐喻：己方回合结束自动换回；一方死亡时另一方回原位；对方血<3 换回后 +1', () => {
    const metaphor = () =>
      eff({
        target: { mode: 'anyCharacter' },
        duration: 'untilOwnTurnEnd',
        ops: [
          { op: 'swapPosition', refA: 'self', refB: 'target' },
          { op: 'defer', ref: 'self', delay: 'ownTurnEnd', ops: [{ op: 'swapBack', refA: 'self', refB: 'target' }] },
        ],
      });
    // 正常换回 + 低血加一。
    let g = createGame([
      mkUnit({ id: 'A', slot: 2, skills: [skill(def({ type: 'cooldown', cd: 1 }), metaphor())] }),
      mkUnit({ id: 'B', side: 'second', slot: 1, hp: 2, maxHp: 6, initialMaxHp: 6 }),
    ]);
    let s = applyAction(g, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'B' }).state;
    assert.equal(s.units.find((u) => u.id === 'A').slot, 1, '换位后到对方原位');
    assert.equal(s.units.find((u) => u.id === 'B').slot, 2);
    s = applyAction(s, { type: 'endTurn' }).state;
    assert.equal(s.units.find((u) => u.id === 'A').slot, 2, '己方回合结束自动换回');
    assert.equal(s.units.find((u) => u.id === 'B').slot, 1);
    assert.equal(s.units.find((u) => u.id === 'B').hp, 3, '被互换的对方血<3，换回时 +1');

    // 一方死亡：活着的另一方单方面回原位。
    g = createGame([
      mkUnit({ id: 'A', slot: 2, skills: [skill(def({ type: 'cooldown', cd: 1 }), metaphor())] }),
      mkUnit({ id: 'B', side: 'second', slot: 1, hp: 1, maxHp: 6, initialMaxHp: 6 }),
      mkUnit({ id: 'B2', side: 'second', slot: 2 }),
    ]);
    s = applyAction(g, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'B' }).state;
    assert.equal(s.units.find((u) => u.id === 'A').slot, 1);
    s = applyAction(s, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    assert.equal(s.units.find((u) => u.id === 'B').dead, true, 'B 在换位期间死亡');
    const deadHp = s.units.find((u) => u.id === 'B').hp;
    s = applyAction(s, { type: 'endTurn' }).state;
    assert.equal(s.units.find((u) => u.id === 'A').slot, 2, '活着的 A 回原位');
    assert.equal(s.units.find((u) => u.id === 'B').hp, deadHp, '死者不回血');
  });
});

// P7 E 批：CD 立即就绪 / 救援变体 / 魔术棒伤害上限 / 附身结束条件。
describe('P7 E 批', () => {
  it('振奋：对他人使用使目标技能 CD-1；对自己使用使自身 CD 技能立即就绪', () => {
    const make = () => {
      const rally = skill(
        def({ type: 'cooldown', cd: 2 }),
        eff({
          target: { mode: 'anyCharacter' },
          ops: [{ op: 'cdDelta', ref: 'target', delta: -1, selfReady: true }],
        }),
      );
      const own = skill(def({ type: 'cooldown', cd: 3 }), eff({ ops: [{ op: 'flag', ref: 'self', key: 'used' }] }));
      own.usedPerGame = 1;
      own.cdCounter = 1;
      const enemySkill = skill(def({ type: 'cooldown', cd: 3 }), eff({ ops: [] }));
      enemySkill.usedPerGame = 1;
      enemySkill.cdCounter = 2;
      return createGame([
        mkUnit({ id: 'A', skills: [rally, own] }),
        mkUnit({ id: 'B', side: 'second', slot: 1, skills: [enemySkill] }),
      ]);
    };

    let s = applyAction(make(), { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'B' }).state;
    assert.equal(s.units.find((u) => u.id === 'B').skills[0].cdCounter, 1, '目标技能 CD 2 → 1');

    // 对自己：自身 CD 技能直接拉到可用。
    s = applyAction(make(), { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'A' }).state;
    const a = s.units.find((u) => u.id === 'A');
    assert.equal(a.skills[1].cdCounter, 3, '自己技能 CD 直接拉满');
    assert.equal(canUseSkill(a, a.skills[1], s.clock), null, '对自己使用后技能立即可用');
    // P7-E1 裁决：对自己使用后，振奋自身也必须进 CD（不能连着刷自己）。
    assert.equal(a.skills[0].cdCounter, 0, '振奋自身开始冷却');
    assert.equal(canUseSkill(a, a.skills[1], s.clock), null, '对自己使用后技能立即可用');
  });

  it('“路易”：普通触发临时血 3；救援导致触发时只有 2', () => {
    const louis = () =>
      skill(
        def({ type: 'passive' }),
        eff({
          trigger: 'beforeDamage',
          manual: false,
          duration: 'untilTurnEnd',
          ops: [
            { op: 'loseHp', ref: 'self', amount: 1 },
            { op: 'tempHp', ref: 'self', amount: 3, rescueAmount: 2 },
          ],
        }),
      );
    // 普通触发：被技能打 2 点 → 先扣 1 本体血 + 3 临时血，再承伤。
    let g = createGame([
      mkUnit({ id: 'A', name: '木偶师', skills: [louis()] }),
      mkUnit({
        id: 'B',
        side: 'second',
        slot: 1,
        skills: [skill(def(), eff({ ops: [{ op: 'damage', ref: 'target', amount: 2, kind: 'skill' }] }))],
      }),
    ]);
    let s = applyAction(g, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'useSkill', unitId: 'B', skillIndex: 0, targetId: 'A' }).state;
    let a = s.units.find((u) => u.id === 'A');
    assert.equal(a.hp, 5, '本体血 6 - 1');
    assert.equal(a.tempHp, 1, '获得 3 点临时血，被 2 点伤害打掉 2');

    // 救援触发：木偶师救人扣 2 血 → 先触发 +2 临时血，救援扣血由临时血承担。
    g = createGame([
      mkUnit({ id: 'A', name: '木偶师', skills: [louis()], hasRescue: true }),
      mkUnit({ id: 'C', side: 'first', slot: 2, hp: 0, maxHp: 6, initialMaxHp: 6 }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    s = applyAction(g, { type: 'rescue', targetId: 'C', rescuerId: 'A' }).state;
    a = s.units.find((u) => u.id === 'A');
    assert.equal(a.hp, 5, '救援导致：本体血 6 - 1');
    assert.equal(a.tempHp, 0, '只获得 2 点临时血，正好支付救援的 2 点扣血');
  });

  it('魔术棒：攻击宣告后打开打断窗口，使用后本次伤害减半（向下取整）并给下次 +1k', () => {
    const wand = {
      ops: [
        { op: 'interruptDamage', ref: 'victim', factor: 0.5 },
        { op: 'itemDiscount', ref: 'self', item: 'moshubang', amount: 1000, scope: 'once' },
      ],
      reaction: 'beforeAttack',
    };
    const effects = {
      skills: new Map(),
      items: new Map([['moshubang', { id: 'moshubang', name: '魔术棒', cost: 1000, effect: wand }]]),
    };
    let s = createGame(
      [mkUnit({ id: 'C', name: '路人', items: [{ itemId: 'moshubang', cost: null }] }), mkUnit({ id: 'B', side: 'second', slot: 1, atk: 4 })],
      { effects },
    );
    // 反应式道具不能在自己的行动小回合直接使用。
    assert.throws(
      () => applyAction(s, { type: 'useItem', unitId: 'C', itemIndex: 0, targetId: 'C' }),
      /打断窗口/,
      '魔术棒只能用于打断窗口',
    );
    s = applyAction(s, { type: 'endTurn' }).state;
    const kBefore = s.k.first;
    const opened = applyAction(s, { type: 'attack', attackerId: 'B', targetId: 'C' });
    s = opened.state;
    assert.ok(s.pendingInterrupt, '攻击先挂起，等受击方决定是否打断');
    assert.equal(s.units.find((u) => u.id === 'C').hp, 6, '窗口期间还没有造成伤害');
    assert.equal(opened.events[0].type, 'interruptPending', '产生 interruptPending 事件给界面遮罩');
    assert.throws(() => applyAction(s, { type: 'endTurn' }), /反应窗口/);
    assert.throws(() => applyAction(s, { type: 'attack', attackerId: 'B', targetId: 'C' }), /反应窗口/);
    s = applyAction(s, { type: 'interruptWithItem', unitId: 'C', itemIndex: 0 }).state;
    assert.ok(!s.pendingInterrupt, '打断后窗口关闭');
    assert.equal(s.units.find((u) => u.id === 'C').hp, 5, '4-1=3 点伤害减半向下取整为 1');
    assert.equal(s.units.find((u) => u.id === 'C').items.length, 0, '魔术棒被消耗');
    assert.equal(s.k.first, kBefore - 1000, '使用打断道具照常支付 1k');
    assert.ok(
      s.units.find((u) => u.id === 'C').statuses.some((x) => x.kind === 'flag' && x.key === 'itemDiscount:once:moshubang'),
      '下次魔术棒 +1k',
    );
  });

  it('魔术棒：选择不打断时按原伤害结算；没有反应式道具就不开窗', () => {
    const effects = {
      skills: new Map(),
      items: new Map([['moshubang', {
        id: 'moshubang',
        name: '魔术棒',
        cost: 1000,
        effect: { ops: [{ op: 'interruptDamage', ref: 'victim', factor: 0.5 }], reaction: 'beforeAttack' },
      }]]),
    };
    let s = createGame(
      [mkUnit({ id: 'C', items: [{ itemId: 'moshubang', cost: null }] }), mkUnit({ id: 'B', side: 'second', slot: 1, atk: 4 })],
      { effects },
    );
    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'attack', attackerId: 'B', targetId: 'C' }).state;
    assert.ok(s.pendingInterrupt, '持有魔术棒时开窗');
    s = applyAction(s, { type: 'resolveInterrupt' }).state;
    assert.equal(s.units.find((u) => u.id === 'C').hp, 3, '不打断则吃满 3 点（4-1）');
    s = createGame([mkUnit({ id: 'D' }), mkUnit({ id: 'E', side: 'second', slot: 1, atk: 4 })]);
    s = applyAction(s, { type: 'endTurn' }).state;
    const direct = applyAction(s, { type: 'attack', attackerId: 'E', targetId: 'D' }).state;
    assert.ok(!direct.pendingInterrupt, '没有反应式道具时攻击直接结算');
    assert.equal(direct.units.find((u) => u.id === 'D').hp, 3);
  });

  it('役鸟守护：技能伤害前开反应窗口，先知支付充能免疫整次伤害并攻击力-1', () => {
    const yiniao = (charge = 1) => {
      const sk = skill(
        def({ name: '役鸟守护', type: 'charge', cost: 1 }),
        eff({
          id: 'xianzhi/役鸟守护',
          name: '役鸟守护',
          type: 'charge',
          reaction: 'beforeDamage',
          target: { mode: 'anyUnit' },
          cost: { charge: 1 },
          ops: [
            { op: 'immune', ref: 'target', scope: 'all', uses: 1, duration: 'instant' },
            { op: 'modStat', ref: 'self', stat: 'atk', delta: -1, duration: 'permanent' },
          ],
        }),
      );
      sk.charge = charge;
      return sk;
    };
    const hit = () =>
      skill(def({ name: '打击', type: 'active' }), eff({ target: { mode: 'enemyUnit' }, ops: [{ op: 'damage', ref: 'target', amount: 3 }] }));
    const build = (charge = 1) =>
      createGame([
        mkUnit({ id: 'A', name: '先知', skills: [yiniao(charge)] }),
        mkUnit({ id: 'B', side: 'second', slot: 1, skills: [hit()] }),
      ]);
    let s = build();
    s = applyAction(s, { type: 'endTurn' }).state;
    const opened = applyAction(s, { type: 'useSkill', unitId: 'B', skillIndex: 0, targetId: 'A' });
    assert.equal(opened.state.pendingInterrupt.kind, 'damage');
    assert.equal(opened.events[opened.events.length - 1].type, 'interruptPending', '产生 interruptPending 事件');
    s = applyAction(opened.state, { type: 'interruptWithSkill', unitId: 'A', skillIndex: 0 }).state;
    const a = s.units.find((u) => u.id === 'A');
    assert.equal(a.hp, 6, '免伤');
    assert.equal(a.skills[0].charge, 0, '充能支付 1 点');
    assert.ok(
      a.statuses.some((x) => x.kind === 'stat' && x.key === 'atk' && x.value === -1 && x.expiresAt === null),
      '先知攻击力永久-1',
    );
    assert.ok(!s.pendingInterrupt, '打断后窗口关闭');
    // 没有充能就不开窗，伤害直接落地。
    let t = build(0);
    t = applyAction(t, { type: 'endTurn' }).state;
    const direct = applyAction(t, { type: 'useSkill', unitId: 'B', skillIndex: 0, targetId: 'A' }).state;
    assert.ok(!direct.pendingInterrupt, '充能不足时不弹反应窗口');
    assert.equal(direct.units.find((u) => u.id === 'A').hp, 3, '充能不足时伤害落地');
  });

  it('役鸟守护：攻击伤害也能反应；魔术棒不能用于技能伤害窗口', () => {
    const yiniao = () => {
      const sk = skill(
        def({ name: '役鸟守护', type: 'charge', cost: 1 }),
        eff({
          id: 'xianzhi/役鸟守护',
          name: '役鸟守护',
          type: 'charge',
          reaction: 'beforeDamage',
          target: { mode: 'anyUnit' },
          cost: { charge: 1 },
          ops: [
            { op: 'immune', ref: 'target', scope: 'all', uses: 1, duration: 'instant' },
            { op: 'modStat', ref: 'self', stat: 'atk', delta: -1, duration: 'permanent' },
          ],
        }),
      );
      sk.charge = 1;
      return sk;
    };
    const effects = {
      skills: new Map(),
      items: new Map([
        ['moshubang', {
          id: 'moshubang',
        name: '魔术棒',
          cost: 1000,
          effect: { ops: [{ op: 'interruptDamage', ref: 'victim', factor: 0.5 }], reaction: 'beforeAttack' },
        }],
      ]),
    };
    let s = createGame(
      [
        mkUnit({ id: 'A', name: '先知', skills: [yiniao()], items: [{ itemId: 'moshubang', cost: null }] }),
        mkUnit({ id: 'B', side: 'second', slot: 1, atk: 4 }),
      ],
      { effects },
    );
    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'attack', attackerId: 'B', targetId: 'A' }).state;
    assert.equal(s.pendingInterrupt.kind, 'attack', '攻击窗口同时挂着役鸟与魔术棒两个反应');
    s = applyAction(s, { type: 'interruptWithSkill', unitId: 'A', skillIndex: 0 }).state;
    assert.equal(s.units.find((u) => u.id === 'A').hp, 6, '攻击伤害也被役鸟免疫');
    assert.equal(s.units.find((u) => u.id === 'A').items.length, 1, '魔术棒未被消耗');
  });

  it('魔术棒：不能用于技能伤害窗口（只在被攻击时可用）', () => {
    const yiniao = skill(
      def({ name: '役鸟守护', type: 'charge', cost: 1 }),
      eff({
        id: 'xianzhi/役鸟守护',
        name: '役鸟守护',
        type: 'charge',
        reaction: 'beforeDamage',
        target: { mode: 'anyUnit' },
        cost: { charge: 1 },
        ops: [{ op: 'immune', ref: 'target', scope: 'all', uses: 1, duration: 'instant' }],
      }),
    );
    yiniao.charge = 1;
    const hit = skill(
      def({ name: '打击', type: 'active' }),
      eff({ target: { mode: 'enemyUnit' }, ops: [{ op: 'damage', ref: 'target', amount: 2 }] }),
    );
    let s = createGame([
      mkUnit({ id: 'A', name: '先知', skills: [yiniao], items: [{ itemId: 'moshubang', cost: null }] }),
      mkUnit({ id: 'B', side: 'second', slot: 1, skills: [hit] }),
    ]);
    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'useSkill', unitId: 'B', skillIndex: 0, targetId: 'A' }).state;
    assert.equal(s.pendingInterrupt.kind, 'damage');
    assert.throws(
      () => applyAction(s, { type: 'interruptWithItem', unitId: 'A', itemIndex: 0 }),
      /只有被攻击时/,
      '技能伤害窗口里魔术棒不可用',
    );
  });

  describe('P7-4 反应窗口统一挂起点：反伤', () => {
  it('反伤也先开反应窗口——先知可用役鸟免疫反伤', () => {
    const yiniao = (charge = 1) => {
      const sk = skill(
        def({ name: '役鸟守护', type: 'charge', cost: 1 }),
        eff({
          id: 'xianzhi/役鸟守护',
          name: '役鸟守护',
          type: 'charge',
          reaction: 'beforeDamage',
          target: { mode: 'anyUnit' },
          cost: { charge: 1 },
          ops: [
            { op: 'immune', ref: 'target', scope: 'all', uses: 1, duration: 'instant' },
            { op: 'modStat', ref: 'self', stat: 'atk', delta: -1, duration: 'permanent' },
          ],
        }),
      );
      sk.charge = charge;
      return sk;
    };
    const build = (charge = 1) =>
      createGame([
        mkUnit({ id: 'A', name: '先知', atk: 4, hp: 6, skills: [yiniao(charge)] }),
        mkUnit({ id: 'B', side: 'second', slot: 1, atk: 3, hp: 6, hasReflect: true }),
      ]);
    // 攻击落地后反伤结算前挂起：受击的是出手方 A，来源是带反伤的 B。
    const opened = applyAction(build(), { type: 'attack', attackerId: 'A', targetId: 'B' });
    assert.equal(opened.state.pendingInterrupt.kind, 'damage', '反伤走「伤害」窗口');
    assert.equal(opened.state.pendingInterrupt.targetId, 'A', '窗口的受击者是出手方');
    assert.equal(opened.state.pendingInterrupt.attackerId, 'B', '反伤来源是被攻击者');
    assert.equal(opened.events[opened.events.length - 1].type, 'interruptPending', '产生 interruptPending 事件');
    let s = applyAction(opened.state, { type: 'interruptWithSkill', unitId: 'A', skillIndex: 0 }).state;
    const a = s.units.find((u) => u.id === 'A');
    assert.equal(a.hp, 6, '反伤被免疫');
    assert.equal(s.units.find((u) => u.id === 'B').hp, 4, '攻击伤害照常落地（重放后只算一次；役鸟降攻后 A 有效攻击 2）');
    assert.equal(a.skills[0].charge, 0, '充能支付 1 点');
    assert.ok(
      a.statuses.some((x) => x.kind === 'stat' && x.key === 'atk' && x.value === -1 && x.expiresAt === null),
      '先知攻击力永久-1',
    );
    assert.ok(!s.pendingInterrupt, '反伤免疫后窗口关闭');
    // 没有充能就不开窗，反伤直接落地（B 有效攻击 3-1=2）。
    const direct = applyAction(build(0), { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    assert.ok(!direct.pendingInterrupt, '充能不足时不弹反应窗口');
    assert.equal(direct.units.find((u) => u.id === 'A').hp, 4, '反伤 2 点落地');
  });
  });

  describe('P7-4 反应窗口统一挂起点：标记扣血', () => {
  it('坚强 回合末的标记扣血也先开反应窗口', () => {
    const yiniao = (charge = 1) => {
      const sk = skill(
        def({ name: '役鸟守护', type: 'charge', cost: 1 }),
        eff({
          id: 'xianzhi/役鸟守护',
          name: '役鸟守护',
          type: 'charge',
          reaction: 'beforeDamage',
          target: { mode: 'anyUnit' },
          cost: { charge: 1 },
          ops: [
            { op: 'immune', ref: 'target', scope: 'all', uses: 1, duration: 'instant' },
            { op: 'modStat', ref: 'self', stat: 'atk', delta: -1, duration: 'permanent' },
          ],
        }),
      );
      sk.charge = charge;
      return sk;
    };
    const jianqiang = skill(
      def({ name: '坚强', type: 'passive' }),
      eff({
        trigger: 'beforeDamage',
        ops: [{ op: 'drainMarks', ref: 'self', key: 'yongbingMark', amount: 3, when: 'ownTurnEnd' }],
      }),
    );
    const marks = (u) =>
      u.statuses.filter((x) => x.kind === 'mark' && x.key === 'yongbingMark').reduce((n, x) => n + x.value, 0);
    const build = (charge = 1) =>
      createGame([
        mkUnit({ id: 'A', name: '先知', hp: 6, skills: [yiniao(charge)] }),
        mkUnit({
          id: 'B',
          name: '佣兵',
          slot: 1,
          hp: 6,
          skills: [jianqiang],
          statuses: [{ id: 'm1', kind: 'mark', key: 'yongbingMark', value: 2, mode: 'add', expiresAt: null, source: 'B' }],
        }),
      ]);
    const opened = applyAction(build(), { type: 'endTurn' });
    assert.equal(opened.state.pendingInterrupt.kind, 'damage', '标记扣血走「伤害」窗口');
    assert.equal(opened.state.pendingInterrupt.targetId, 'B', '受击者是带标记的佣兵');
    let s = applyAction(opened.state, { type: 'interruptWithSkill', unitId: 'A', skillIndex: 0 }).state;
    const b = s.units.find((u) => u.id === 'B');
    assert.equal(b.hp, 6, '标记扣血被免疫');
    assert.equal(marks(b), 2, '免疫时也不减标记');
    assert.ok(!s.pendingInterrupt, '窗口关闭');
    // 没有充能时不弹窗，标记照常扣血。
    const direct = applyAction(build(0), { type: 'endTurn' }).state;
    assert.ok(!direct.pendingInterrupt, '充能不足时不弹反应窗口');
    assert.equal(direct.units.find((u) => u.id === 'B').hp, 4, '2 点标记扣血落地');
  });

  it('回合结束钩子在反应窗口挂起时不提前 emit，且只 emit 一次', () => {
    const yiniao = skill(
      def({ name: '役鸟守护', type: 'charge', cost: 1 }),
      eff({
        id: 'xianzhi/役鸟守护',
        name: '役鸟守护',
        type: 'charge',
        reaction: 'beforeDamage',
        target: { mode: 'anyUnit' },
        cost: { charge: 1 },
        ops: [{ op: 'immune', ref: 'target', scope: 'all', uses: 1, duration: 'instant' }],
      }),
    );
    yiniao.charge = 1;
    const jianqiang = skill(
      def({ name: '坚强', type: 'passive' }),
      eff({
        trigger: 'beforeDamage',
        ops: [{ op: 'drainMarks', ref: 'self', key: 'yongbingMark', amount: 3, when: 'ownTurnEnd' }],
      }),
    );
    const reg = new HookRegistry();
    let emits = 0;
    reg.register({
      id: 'h1',
      point: 'smallTurnEnd',
      ownerSide: 'first',
      ownerSlot: 1,
      relation: 'self',
      timeUnit: 'small',
      handler: () => { emits += 1; },
    });
    const state = createGame([
      mkUnit({ id: 'A', name: '先知', hp: 6, skills: [yiniao] }),
      mkUnit({
        id: 'B',
        name: '佣兵',
        slot: 1,
        hp: 6,
        skills: [jianqiang],
        statuses: [{ id: 'm1', kind: 'mark', key: 'yongbingMark', value: 2, mode: 'add', expiresAt: null, source: 'B' }],
      }),
    ]);
    const opened = applyAction(state, { type: 'endTurn' }, reg);
    assert.ok(opened.state.pendingInterrupt, '回合末伤害先挂起');
    assert.equal(emits, 0, '被丢弃的那次结算不应 emit 回合结束钩子');
    const s = applyAction(opened.state, { type: 'interruptWithSkill', unitId: 'A', skillIndex: 0 }, reg).state;
    assert.equal(emits, 1, '正式结算完成后只 emit 一次');
    assert.ok(!s.pendingInterrupt, '窗口关闭');
  });
  });

  it('魔术演绎：魔术师在打断窗口用魔术棒后本次伤害至多 1', () => {
    const magic = () =>
      skill(
        def({ type: 'battlecry' }),
        eff({
          trigger: 'itemUse',
          manual: false,
          condition: [{ itemUsed: 'moshubang' }],
          battlecryOps: [{ op: 'grantItem', ref: 'self', item: 'moshubang', count: 3 }],
          ops: [{ op: 'flag', ref: 'self', key: 'wandCap1', value: 1 }],
        }),
      );
    const effects = {
      skills: new Map(),
      items: new Map([['moshubang', {
        id: 'moshubang',
        name: '魔术棒',
        cost: 1000,
        effect: { ops: [{ op: 'interruptDamage', ref: 'victim', factor: 1 }], reaction: 'beforeAttack' },
      }]]),
    };
    let s = createGame(
      [mkUnit({ id: 'A', name: '魔术师', skills: [magic()] }), mkUnit({ id: 'B', side: 'second', slot: 1, atk: 3 })],
      { effects },
    );
    assert.equal(s.units.find((u) => u.id === 'A').items.length, 3, '战吼给三个魔术棒');
    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'attack', attackerId: 'B', targetId: 'A' }).state;
    assert.ok(s.pendingInterrupt, '持有魔术棒时先开打断窗口');
    s = applyAction(s, { type: 'interruptWithItem', unitId: 'A', itemIndex: 0 }).state;
    assert.equal(s.units.find((u) => u.id === 'A').hp, 5, 'B 伤害 2（首回合 -1）被 wandCap1 压到 1');
    assert.ok(
      !s.units.find((u) => u.id === 'A').statuses.some((x) => x.kind === 'flag' && x.key === 'wandCap1'),
      '上限只作用于本次伤害，结算后移除',
    );
  });

  it('记忆同步：使用后自身免疫、目标 +1 临时血；目标临时血扣完后免疫消失', () => {
    const memory = skill(
      def({ type: 'cooldown', cd: 1 }),
      eff({
        target: { mode: 'anyCharacter' },
        ops: [
          { op: 'possession', ref: 'target', scope: 'all' },
          { op: 'tempHp', ref: 'target', amount: 1 },
        ],
      }),
    );
    let s = createGame([
      mkUnit({ id: 'A', name: '小女孩', skills: [memory] }),
      mkUnit({ id: 'C', side: 'first', slot: 2, hp: 5, maxHp: 5, initialMaxHp: 5 }),
      mkUnit({ id: 'B', side: 'second', slot: 1, atk: 3 }),
    ]);
    s = applyAction(s, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'C' }).state;
    let a = s.units.find((u) => u.id === 'A');
    assert.ok(a.statuses.some((x) => x.kind === 'immune' && x.key === 'all'), '附身期间自身免疫');
    assert.ok(a.statuses.some((x) => x.kind === 'flag' && x.key === 'possession:C'), '记下被附身目标');
    assert.equal(s.units.find((u) => u.id === 'C').tempHp, 1, '目标获得 1 点临时血');
    assert.ok(a.statuses.some((x) => x.kind === 'flag' && x.key === 'restrictAttack'), '附身期间不可攻击');
    assert.throws(
      () => applyAction(s, { type: 'attack', attackerId: 'A', targetId: 'B' }),
      /该角色无法攻击/,
      '附身期间攻击被拒',
    );

    // 敌方攻击把目标临时血打光 → 技能自动结束，免疫移除。
    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'attack', attackerId: 'B', targetId: 'C' }).state;
    a = s.units.find((u) => u.id === 'A');
    assert.equal(s.units.find((u) => u.id === 'C').tempHp, 0);
    assert.ok(!a.statuses.some((x) => x.kind === 'immune' && x.key === 'all'), '目标临时血扣完后自身免疫消失');
    assert.ok(!a.statuses.some((x) => x.kind === 'flag' && x.key === 'possession:C'), '附身标记一并结束');
    assert.ok(!a.statuses.some((x) => x.kind === 'flag' && x.key === 'restrictAttack'), '附身结束后恢复攻击');

    // 进入下一个大回合，A 的己方回合可以正常攻击。
    s = applyAction(s, { type: 'endTurn' }).state;
    assert.equal(s.clock.phase, 'first');
    s = applyAction(s, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    assert.equal(s.units.find((u) => u.id === 'B').hp, 3);
  });
});

// P7-2 X4：应激的「受击」按本体血量减少判定。
describe('P7-2 X4：受击按血量减少判定', () => {
  const fx = (id) => FX.skills.find((s) => s.id === id);

  it('猿猴咒像：充能不足两式都不可用；引爆以 3 充能造成 2 伤害并禁止目标下回合攻击', () => {
    const charm = fx('zhoushushi/猿猴咒像');
    const mkCharm = (charge) => {
      const s = skill(def({ type: 'charge' }), charm);
      s.charge = charge;
      return s;
    };
    const empty = createGame([
      mkUnit({ id: 'A', skills: [mkCharm(0)] }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    for (const variant of ['咒像守护', '咒像引爆']) {
      assert.throws(
        () => applyAction(empty, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'B', variant }),
        /充能不足/,
        `充能 0 时「${variant}」不可用`,
      );
    }

    const one = createGame([
      mkUnit({ id: 'A', skills: [mkCharm(1)] }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    const guard = applyAction(one, {
      type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'B', variant: '咒像守护',
    }).state;
    assert.equal(guard.units.find((u) => u.id === 'B').hp, 5, '咒像守护 1 点伤害');
    assert.equal(guard.units.find((u) => u.id === 'A').skills[0].charge, 0, '扣 1 充能');

    let s = applyAction(createGame([
      mkUnit({ id: 'A', skills: [mkCharm(3)] }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]), { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'B', variant: '咒像引爆' }).state;
    const b = s.units.find((u) => u.id === 'B');
    assert.equal(b.hp, 4, '咒像引爆 2 点伤害');
    assert.equal(s.units.find((u) => u.id === 'A').skills[0].charge, 0, '扣 3 充能后归零');
    assert.ok(b.statuses.some((x) => x.kind === 'flag' && x.key === 'restrictAttack'), '目标带「下回合不可攻击」');
    s = applyAction(s, { type: 'endTurn' }).state;
    assert.throws(
      () => applyAction(s, { type: 'attack', attackerId: 'B', targetId: 'A' }),
      /无法攻击/,
      '目标在自己的下个回合不能攻击',
    );
    // P7-E2-1 裁决：到期时点为目标的这个小回合结束时（下一个敌方小回合结束）。
    assert.deepEqual(
      s.units.find((u) => u.id === 'B').statuses.find((x) => x.key === 'restrictAttack').expiresAt,
      { bigTurn: 1, phase: 'second', at: 'end' },
    );
    s = applyAction(s, { type: 'endTurn' }).state;
    assert.ok(
      !s.units.find((u) => u.id === 'B').statuses.some((x) => x.key === 'restrictAttack'),
      '下一个敌方小回合结束时到期',
    );
  });

  it('安抚物：任意阶段可用（含对方回合），每局限一次', () => {
    const comfort = fx('wanjushang/安抚物');
    let s = createGame([
      mkUnit({ id: 'A', name: '玩具商', skills: [skill(def({ type: 'active' }), comfort)] }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    const itemsOf = (state) => state.units.find((u) => u.id === 'A').items.map((i) => i.itemId);

    // 进入对方（B）小回合后仍可使用。
    s = applyAction(s, { type: 'endTurn' }).state;
    assert.equal(s.clock.phase, 'second');
    s = applyAction(s, { type: 'useSkill', unitId: 'A', skillIndex: 0, variant: '镇静剂' }).state;
    assert.equal(itemsOf(s).filter((id) => id === 'zhenjingji').length, 1, '对方回合拿到镇静剂');
    assert.throws(
      () => applyAction(s, { type: 'useSkill', unitId: 'A', skillIndex: 0, variant: '魔术棒' }),
      /本局使用次数已用尽/,
      '安抚物每局限一次',
    );
  });

  it('野性伙伴：首次使用持续两回合、攻 +1 且免反伤；临时血扣完立即整组结束', () => {
    const wild = fx('yeren/野性伙伴');
    const mkWild = (over = {}) => Object.assign(skill(def({ type: 'cooldown', cd: 1 }), wild), over);
    let s = createGame([
      mkUnit({ id: 'A', atk: 3, hp: 6, skills: [mkWild()] }),
      mkUnit({ id: 'B', side: 'second', slot: 1, atk: 3, hp: 6, hasReflect: true }),
    ]);
    s = applyAction(s, { type: 'useSkill', unitId: 'A', skillIndex: 0 }).state;
    let a = s.units.find((u) => u.id === 'A');
    assert.equal(a.tempHp, 2, '获得 2 点临时血');
    assert.equal(effectiveAtk(a, s.clock), 3, '3 + 1（技能）- 1（首回合）');
    const first = a.statuses.find((x) => x.group === 'tempHp:wildPartner');
    assert.deepEqual(first.expiresAt, { bigTurn: 2, phase: 'second', at: 'end' }, '首次使用持续两回合');
    assert.ok(a.statuses.some((x) => x.kind === 'flag' && x.key === 'noReflect'));

    s = applyAction(s, { type: 'attack', attackerId: 'A', targetId: 'B' }).state;
    a = s.units.find((u) => u.id === 'A');
    assert.equal(a.hp, 6, '攻击时不受到反伤');
    assert.equal(a.tempHp, 2, '反伤未打到临时血');
    assert.equal(s.units.find((u) => u.id === 'B').hp, 3);

    // B 的回合打掉 2 点临时血：技能立即结束，攻击力加成撤掉。
    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'attack', attackerId: 'B', targetId: 'A' }).state;
    a = s.units.find((u) => u.id === 'A');
    assert.equal(a.tempHp, 0);
    assert.ok(!a.statuses.some((x) => x.group === 'tempHp:wildPartner'), '临时血扣完整组结束');
    assert.equal(effectiveAtk(a, s.clock), 2, '攻击力回到 3 - 1（首回合）');

    // 之后使用：持续一回合（turns:1）。
    const later = createGame([
      mkUnit({ id: 'A', skills: [mkWild({ usedPerGame: 1, cdCounter: 1 })] }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    const s2 = applyAction(later, { type: 'useSkill', unitId: 'A', skillIndex: 0 }).state;
    const second = s2.units.find((u) => u.id === 'A').statuses.find((x) => x.group === 'tempHp:wildPartner');
    assert.deepEqual(second.expiresAt, { bigTurn: 1, phase: 'second', at: 'end' }, '之后使用持续一回合');
  });

  it('野性伙伴：持续到期时临时血一并清零（P7-E2-2）', () => {
    const wild = fx('yeren/野性伙伴');
    let s = createGame([
      mkUnit({ id: 'A', atk: 3, hp: 6, skills: [skill(def({ type: 'cooldown', cd: 1 }), wild)] }),
      mkUnit({ id: 'B', side: 'second', slot: 1, atk: 3, hp: 6 }),
    ]);
    s = applyAction(s, { type: 'useSkill', unitId: 'A', skillIndex: 0 }).state;
    let a = s.units.find((u) => u.id === 'A');
    assert.equal(a.tempHp, 2);
    assert.ok(
      a.statuses.some((x) => x.kind === 'flag' && x.key === 'tempHpGrant' && x.value === 2),
      '记下这次授予的临时血',
    );

    // 持续两回合：走到 bigTurn 2 后手结束，临时血仍在。
    for (let i = 0; i < 3; i += 1) s = applyAction(s, { type: 'endTurn' }).state;
    a = s.units.find((u) => u.id === 'A');
    assert.equal(s.clock.bigTurn, 2);
    assert.equal(a.tempHp, 2, '未到期时临时血不变');

    // 进入下一个小回合（bigTurn 3 先手开始）：状态到期，临时血清零。
    s = applyAction(s, { type: 'endTurn' }).state;
    a = s.units.find((u) => u.id === 'A');
    assert.equal(s.clock.bigTurn, 3);
    assert.equal(a.tempHp, 0, '到期后临时血清零');
    assert.ok(!a.statuses.some((x) => x.key === 'tempHpGrant'), '授予凭据随状态清除');
  });

  it('路易：本体血量将减少时自动 +1 血换 3 点临时血，救援时只换 2 点（P7-2-X3）', () => {
    const louis = fx('muoushi/“路易”');
    const ev = () => ({
      id: 'x/dmg', character: 'X', name: '打手', type: 'active', impl: 'full',
      manual: true, trigger: 'manual', target: { mode: 'enemyUnit' },
      ops: [{ op: 'damage', ref: 'target', amount: 5, kind: 'skill' }],
    });
    let s = createGame([
      mkUnit({ id: 'A', atk: 3, hp: 6, maxHp: 6, initialMaxHp: 6, skills: [skill(def({ type: 'passive' }), louis)] }),
      mkUnit({ id: 'B', side: 'second', slot: 1, skills: [skill(def({ type: 'active' }), ev())] }),
    ]);
    s = applyAction(s, { type: 'endTurn' }).state; // 进入 B 的回合
    s = applyAction(s, { type: 'useSkill', unitId: 'B', skillIndex: 0, targetId: 'A' }).state;
    const a = s.units.find((u) => u.id === 'A');
    // 5 点伤害先由 3 点临时血吸收，剩下 2 点才落到本体；换血触发的自动 +1 点也计入血量减少。
    assert.equal(a.tempHp, 0, '3 点临时血被这一击打空');
    assert.equal(a.hp, 3, '6 - 1（换血） - 2（溢出）= 3');
    // 已知口径：换血的 +1 点走 loseHp 通道，不进受击判定（P7-2 X3/X4：「不覆盖直接扣 hp」）。
    assert.equal(a.hpLostThisBigTurn, 2, '只把伤害通道的溢出 2 点计入受击增量');
  });

  it('即兴演出：救援后得粘土弹、第二个己方回合结束得冷却弹、受伤后得燃烧弹', () => {
    const improv = fx('zajiyanyuan/即兴演出');
    let s = createGame([
      mkUnit({ id: 'A', name: '杂技演员', atk: 1, hp: 8, hasRescue: true, skills: [skill(def({ type: 'passive' }), improv)] }),
      mkUnit({ id: 'C', side: 'first', slot: 2, hp: 0, maxHp: 6, initialMaxHp: 6 }),
      mkUnit({ id: 'B', side: 'second', slot: 1, atk: 3 }),
    ]);
    const itemsOf = (state) => state.units.find((u) => u.id === 'A').items.map((i) => i.itemId);
    s = applyAction(s, { type: 'rescue', targetId: 'C', rescuerId: 'A' }).state;
    assert.equal(itemsOf(s).filter((id) => id === 'niantudan').length, 1, '救援后获得粘土弹');

    for (let i = 0; i < 3; i += 1) s = applyAction(s, { type: 'endTurn' }).state;
    assert.equal(itemsOf(s).filter((id) => id === 'lengquedan').length, 1, '第二个己方回合结束获得冷却弹');

    s = applyAction(s, { type: 'attack', attackerId: 'B', targetId: 'A' }).state;
    assert.equal(itemsOf(s).filter((id) => id === 'ranshaodan').length, 1, '受到伤害后获得燃烧弹');
  });

  it('安抚物：钢铁护肘映射到「护腕」道具，四选一都能获得并减价；全技能无 custom', () => {
    const soothing = fx('wanjushang/安抚物');
    const labels = soothing.branches.map((b) => b.label);
    assert.deepEqual(labels, ['镇静剂', '魔术棒', '忘忧之香', '钢铁护肘']);
    assert.equal(
      soothing.branches.flatMap((b) => b.ops).some((o) => o.op === 'custom'),
      false,
      '四选一分支不再含 custom',
    );

    let s = createGame([
      mkUnit({ id: 'A', skills: [skill(def({ type: 'active' }), soothing)] }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    s = applyAction(s, { type: 'useSkill', unitId: 'A', skillIndex: 0, variant: '钢铁护肘' }).state;
    const a = s.units.find((u) => u.id === 'A');
    assert.equal(a.items.filter((i) => i.itemId === 'huwan').length, 1, '获得护腕道具');
    assert.ok(
      a.statuses.some((x) => x.kind === 'flag' && x.key === 'itemDiscount:huwan' && x.value === -1),
      '该道具花费-1',
    );
  });

  it('陨石磁铁：降低攻击分支在己方回合结束结算，且攻击力-1 永久保留（P7-2-X2）', () => {
    const magnet = fx('kantanyuan/陨石磁铁');
    assert.equal(magnet.impl, 'full');
    let s = createGame([
      mkUnit({ id: 'A', atk: 3, skills: [skill(def({ type: 'charge' }), magnet)] }),
      mkUnit({ id: 'B', side: 'second', slot: 1 }),
    ]);
    s = applyAction(s, { type: 'useSkill', unitId: 'A', skillIndex: 0, targetId: 'B', variant: '降低攻击' }).state;
    const mods = (st) => st.units.find((u) => u.id === 'B').statuses.filter((x) => x.kind === 'stat' && x.key === 'atk');
    assert.equal(mods(s).length, 0, '己方回合结束前尚未结算');
    s = applyAction(s, { type: 'endTurn' }).state;
    assert.equal(mods(s).length, 1, '己方回合结束落地攻击 -1');
    assert.equal(mods(s)[0].expiresAt, null, '持续时长永久');
    for (let i = 0; i < 3; i += 1) s = applyAction(s, { type: 'endTurn' }).state;
    assert.equal(mods(s).length, 1, '多个小回合后仍然存在');
  });


  it('应激：标记扣血、延迟伤害、道具扣血都会触发（P7-2-X4）', () => {
    const zhang = fx('xinlixuejia/应激');
    const damager = () => skill(def({ type: 'active' }), eff({ target: { mode: 'enemyUnit' }, ops: [{ op: 'damage', ref: 'target', amount: 1, kind: 'skill' }] }));
    const make = (xSkills) => createGame([
      mkUnit({ id: 'A', hp: 6, maxHp: 6, initialMaxHp: 6, skills: [skill(def({ type: 'passive' }), zhang), ...xSkills] }),
      mkUnit({ id: 'B', side: 'second', slot: 1, skills: [damager()] }),
    ]);
    const hpA = (st) => st.units.find((u) => u.id === 'A').hp;
    const stressOf = (st) => st.units.find((u) => u.id === 'A').skills.find((k) => k.effect?.condition?.[0]?.hpLt === 4);

    // ① 标记扣血（drainMarks）：B 的回合结束时 A 因标记流失扣血，也应触发应激。
    let s = make([skill(def({ type: 'passive' }), eff({
      trigger: 'turnEnd',
      manual: false,
      ops: [{ op: 'drainMarks', ref: 'self', key: 'chinengMark', amount: 'full' }],
    }))]);
    s = { ...s, units: s.units.map((u) => (u.id === 'A' ? { ...u, hp: 3, statuses: [...u.statuses, { kind: 'mark', key: 'chinengMark', value: 2, mode: 'add', id: 'm1', expiresAt: null, source: 'B' }] } : u)) };
    s = applyAction(s, { type: 'endTurn' }).state; // A 回合结束：无人扣血
    assert.equal(hpA(s), 3, 'A 自己的回合结束不触发');
    s = applyAction(s, { type: 'endTurn' }).state; // B 回合结束：turnEnd 触发 A 标记流失 2 血 → 应激回 2
    assert.equal(hpA(s), 1, 'mark 2 → hp 1（应激的条件在小回合结束后才求值，本次不触发回血）');
    assert.equal(stressOf(s).usedPerGame, 0, '本次未消耗应激次数');

    // ② 延迟伤害（deferLethal：只有「这一击会致死」时才延迟）。A 先手，延迟到 A 的回合结束。
    s = make([]);
    s = { ...s, units: s.units.map((u) => (u.id === 'A' ? { ...u, hp: 1, statuses: [...u.statuses, { kind: 'flag', key: 'deferLethal', value: 1, mode: 'add', id: 'd1', expiresAt: { bigTurn: 1, phase: 'first', at: 'end' }, source: 'A' }] } : u)) };
    s = applyAction(s, { type: 'endTurn' }).state; // 进入 B 的回合
    s = applyAction(s, { type: 'useSkill', unitId: 'B', skillIndex: 0, targetId: 'A' }).state;
    assert.equal(hpA(s), 0, 'A 处于濒死（下个己方回合结束前可救）');
    assert.equal(stressOf(s).usedPerGame, 0, '血量没减少，不触发应激');
    s = applyAction(s, { type: 'endTurn' }).state;
    assert.equal(hpA(s), 0, '延迟伤害在己方回合结束到点结算后判死（无人可救）');
    assert.equal(stressOf(s).usedPerGame, 0, '濒死时被动不再触发（与 P7-C1 的「受击近似」一致）');
  });
});

