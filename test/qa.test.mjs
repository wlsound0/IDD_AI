// P6 C 块：Q&A 细节对齐（QA-19/20 坚强、QA-25 套索、QA-26 虫群）。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyAction, createGame, legalAttackTargets } from '../temp/build/core/game.js';
import { buildUnitSkills, indexEffects } from '../temp/build/core/units.js';
import { markValue, purgeExpired, resolveDuration } from '../temp/build/core/status.js';
import { consumeItemDiscounts, itemPrice } from '../temp/build/core/items.js';
import { effectiveAtk, rescuedMaxHp } from '../temp/build/core/combat.js';
import { canUseSkill } from '../temp/build/core/trigger.js';
import { availableRescues, applyRescue } from '../temp/build/core/rescue.js';

const FX = JSON.parse(readFileSync('data/effects.json', 'utf8'));
const CHARS = JSON.parse(readFileSync('data/characters.json', 'utf8')).characters;
const INDEX = indexEffects(FX);

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

/** 从真实数据造角色。 */
const char = (id, over = {}) => {
  const c = CHARS.find((x) => x.id === id);
  if (!c) throw new Error('未知角色：' + id);
  return {
    id: over.id ?? id,
    name: c.name,
    side: 'first',
    slot: 1,
    atk: c.atk,
    hp: c.hp,
    maxHp: c.hp,
    initialMaxHp: c.hp,
    tempHp: 0,
    statuses: [],
    items: [],
    skills: buildUnitSkills(c.id, c.skills, INDEX),
    ...over,
  };
};

/** 只会「造成 n 点技能伤害」的打手。 */
const striker = (amount, over = {}) => ({
  id: 'S',
  name: '打手',
  side: 'first',
  slot: 2,
  atk: 1,
  hp: 9,
  maxHp: 9,
  initialMaxHp: 9,
  tempHp: 0,
  statuses: [],
  items: [],
  skills: [skill(def(), eff({ target: { mode: 'enemyUnit' }, ops: [{ op: 'damage', ref: 'target', amount }] }))],
  ...over,
});

const plain = (over = {}) => ({
  id: 'E',
  name: '目标',
  side: 'second',
  slot: 1,
  atk: 1,
  hp: 3,
  maxHp: 3,
  initialMaxHp: 3,
  tempHp: 0,
  statuses: [],
  items: [],
  skills: [],
  ...over,
});

describe('P6 C 块：坚强（QA-19/20）', () => {
  it('QA-19：伤害转为等量标记，不扣血、不产生伤害事件、不计受伤次数', () => {
    const s = createGame([striker(2), char('yongbing', { side: 'second', slot: 1 })]);
    const r = applyAction(s, { type: 'useSkill', unitId: 'S', skillIndex: 0, targetId: 'yongbing' });
    const y = r.state.units.find((u) => u.id === 'yongbing');
    assert.equal(y.hp, 6, '血量不应变化');
    assert.equal(markValue(y.statuses, 'yongbingMark'), 2);
    assert.equal(y.damageTakenThisBigTurn, 0, '不计入受伤次数');
    assert.ok(!r.events.some((e) => e.type === 'damage'), '不应产生伤害事件');
    assert.ok(r.events.some((e) => e.type === 'markGained' && e.amount === 2));
  });

  it('QA-20：标记无上限，公开可见', () => {
    const s = createGame([striker(12), char('yongbing', { side: 'second', slot: 1 })]);
    const r = applyAction(s, { type: 'useSkill', unitId: 'S', skillIndex: 0, targetId: 'yongbing' });
    const y = r.state.units.find((u) => u.id === 'yongbing');
    assert.equal(y.hp, 6);
    assert.equal(markValue(y.statuses, 'yongbingMark'), 12);
    assert.ok(y.statuses.some((x) => x.kind === 'mark' && x.key === 'yongbingMark'));
  });

  it('己方回合结束最多减 3 点标记并扣等量血', () => {
    let s = createGame([striker(5), char('yongbing', { side: 'second', slot: 1 })]);
    s = applyAction(s, { type: 'useSkill', unitId: 'S', skillIndex: 0, targetId: 'yongbing' }).state;
    s = applyAction(s, { type: 'endTurn' }).state; // 先手结束
    s = applyAction(s, { type: 'endTurn' }).state; // 后手（佣兵）结束，触发 drainMarks
    const y = s.units.find((u) => u.id === 'yongbing');
    assert.equal(y.hp, 3, '5 点标记只减 3 点');
    assert.equal(markValue(y.statuses, 'yongbingMark'), 2);
  });
});

describe('P6 C 块：虫群（QA-26）', () => {
  const summonOf = (s) => s.units.find((u) => u.isSummon);

  it('虫群面板 0/2、耐久 5；受 1 点伤害同时扣血与耐久', () => {
    let s = createGame([striker(1), char('kunchongxuezhe', { id: 'K', slot: 1 }), plain()]);
    s = applyAction(s, { type: 'useSkill', unitId: 'K', skillIndex: 0 }).state;
    let bug = summonOf(s);
    assert.equal(bug.hp, 2);
    assert.equal(bug.durability, 5);
    s = applyAction(s, { type: 'useSkill', unitId: 'S', skillIndex: 0, targetId: bug.id }).state;
    bug = summonOf(s);
    assert.equal(bug.hp, 1);
    assert.equal(bug.durability, 4);
  });

  it('血量归零即死（2 点伤害打 2 血虫群）', () => {
    let s = createGame([striker(2), char('kunchongxuezhe', { id: 'K', slot: 1 }), plain()]);
    s = applyAction(s, { type: 'useSkill', unitId: 'K', skillIndex: 0 }).state;
    const id = summonOf(s).id;
    s = applyAction(s, { type: 'useSkill', unitId: 'S', skillIndex: 0, targetId: id }).state;
    assert.equal(summonOf(s).dead, true);
  });

  it('耐久归零也即死（血未归零）', () => {
    let s = createGame([striker(1), char('kunchongxuezhe', { id: 'K', slot: 1 }), plain()]);
    s = applyAction(s, { type: 'useSkill', unitId: 'K', skillIndex: 0 }).state;
    let bug = summonOf(s);
    // 直接把耐久压到 1，验证「任一归零即死」。
    s.units.find((u) => u.id === bug.id).durability = 1;
    s = applyAction(s, { type: 'useSkill', unitId: 'S', skillIndex: 0, targetId: bug.id }).state;
    bug = summonOf(s);
    assert.equal(bug.durability, 0);
    assert.equal(bug.dead, true);
  });
});

describe('P6 C 块：套索技艺（QA-25）', () => {  it('保持濒死、封技能、不可为目标，其他来源不可救；牛仔下个己方回合不扣血救援', () => {
    let s = createGame([
      char('niuzai', { id: 'C', slot: 1 }),
      striker(3),
      plain({ hp: 3, maxHp: 3, initialMaxHp: 3 }),
    ]);
    // 牛仔对目标使用套索技艺。
    s = applyAction(s, { type: 'useSkill', unitId: 'C', skillIndex: 0, targetId: 'E' }).state;
    let e = s.units.find((u) => u.id === 'E');
    assert.ok(e.statuses.some((x) => x.key === 'sealed'), '技能应被封');
    assert.ok(e.statuses.some((x) => x.key === 'cannotBeRescued'), '其他救援来源应被挡');
    assert.ok(!legalAttackTargets(s, 'S').some((u) => u.id === 'E'), '不可被攻击选中');

    // 打成濒死：不判死、不进濒死队列。
    s = applyAction(s, { type: 'useSkill', unitId: 'S', skillIndex: 0, targetId: 'E' }).state;
    e = s.units.find((u) => u.id === 'E');
    assert.equal(e.hp <= 0, true);
    assert.equal(e.dead, false);
    assert.deepEqual(s.dyingQueue, []);

    // 走到牛仔的下个己方回合开始。
    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'endTurn' }).state;
    e = s.units.find((u) => u.id === 'E');
    const c = s.units.find((u) => u.id === 'C');
    assert.equal(e.dead, false);
    assert.equal(e.hp, 2, '救援后上限 = ceil(3/2)');
    assert.equal(e.rescueCount, 1);
    assert.ok(!e.statuses.some((x) => x.key === 'holdDying'), '套索状态应清除');
    assert.equal(c.hp, 3, '牛仔救援不扣血');
  });

  it('牛仔已死则套索目标判死（无人可救）', () => {
    const units = [char('niuzai', { id: 'C', slot: 1 }), plain({ hp: 3, maxHp: 3, initialMaxHp: 3 })];
    let s = createGame(units);
    s = applyAction(s, { type: 'useSkill', unitId: 'C', skillIndex: 0, targetId: 'E' }).state;
    // 牛仔先死，目标随后被打到 0 血：套索失去施加者，进入普通濒死流程。
    s = { ...s, units: s.units.map((u) => (u.id === 'C' ? { ...u, dead: true, hp: 0 } : u)) };
    s = { ...s, units: s.units.map((u) => (u.id === 'E' ? { ...u, hp: 0 } : u)) };
    // 无任何合法救援者 → 放弃救援即判死。
    s = applyAction(s, { type: 'rescue', targetId: 'E', rescuerId: null }).state;
    assert.equal(s.units.find((u) => u.id === 'E').dead, true, '牛仔已死则目标判死');
  });
});

// ---- P6 Q4 块：延缓致死 / 转移伤害（QA-12/13/15/16） ----
let stSeq = 0;
const makeStatus = (kind, key, value, over = {}) => ({
  id: `st-q4-${++stSeq}`,
  kind,
  key,
  value,
  mode: 'add',
  expiresAt: null,
  source: 'X',
  ...over,
});

describe('P6 Q4 块：延缓致死（QA-15/16）', () => {
  const deferAt = (unitId) => makeStatus('flag', 'deferLethal', 1, { source: unitId, expiresAt: { bigTurn: 1, phase: 'second', at: 'end' } });

  it('QA-15：致命伤害不当场结算，延到下一个己方回合结束再判濒死', () => {
    let s = createGame([striker(5), plain({ statuses: [deferAt('E')] })]);
    const r = applyAction(s, { type: 'useSkill', unitId: 'S', skillIndex: 0, targetId: 'E' });
    let e = r.state.units.find((u) => u.id === 'E');
    assert.equal(e.hp, 3, '命中时不掉血');
    assert.equal(e.dead, false);
    assert.deepEqual(r.state.dyingQueue, [], '不当场进濒死队列');
    assert.ok(r.events.some((x) => x.type === 'damageDeferred' && x.amount === 5));

    s = applyAction(r.state, { type: 'endTurn' }).state; // 先手结束，进入后手回合
    assert.equal(s.units.find((u) => u.id === 'E').hp, 3, '后手回合开始时仍未结算');
    s = applyAction(s, { type: 'endTurn' }).state; // 后手（目标）回合结束 → 到点
    e = s.units.find((u) => u.id === 'E');
    assert.equal(e.hp, -2, '到点结算 5 点伤害');
    assert.equal(e.dead, true, '到点后才进入濒死流程（无人可救 → 判死）');
  });

  it('QA-16：有护盾时先延迟、不当场消耗护盾；到点再按护盾减免', () => {
    let s = createGame([
      striker(5),
      plain({ statuses: [deferAt('E'), makeStatus('shield', 'shield', 5, { source: 'E' })] }),
    ]);
    const r = applyAction(s, { type: 'useSkill', unitId: 'S', skillIndex: 0, targetId: 'E' });
    let e = r.state.units.find((u) => u.id === 'E');
    assert.equal(e.hp, 3);
    assert.equal(e.statuses.find((x) => x.kind === 'shield').value, 5, '护盾不被首次命中消耗');

    s = applyAction(r.state, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'endTurn' }).state;
    e = s.units.find((u) => u.id === 'E');
    assert.equal(e.hp, 3, '到点后 5 点伤害被 5 点护盾全额吸收');
    assert.ok(!e.statuses.some((x) => x.kind === 'shield' && x.value > 0), '护盾在到点结算时消耗');
  });
});

describe('P6 Q4 块：巧手匠心转移（QA-12/13）', () => {
  const gardener = () => char('yuanding', { id: 'G', slot: 1, hp: 6, maxHp: 6, initialMaxHp: 6 });
  const skillIndexOf = (u, name) => u.skills.findIndex((sk) => sk.def.name === name);

  const setup = (extra = {}) => {
    let s = createGame([
      gardener(),
      plain({ id: 'A', side: 'first', slot: 2, hp: 3, maxHp: 3, initialMaxHp: 3, ...extra.ally }),
      striker(4, { id: 'S', side: 'second', slot: 2, ...extra.striker }),
    ]);
    // 园丁自带「守护」护盾，先清掉，避免干扰转移伤害的断言。
    s = { ...s, units: s.units.map((u) => (u.id === 'G' ? { ...u, statuses: u.statuses.filter((x) => x.kind !== 'shield') } : u)) };
    const gi = skillIndexOf(s.units.find((u) => u.id === 'G'), '巧手匠心');
    assert.ok(gi >= 0, '园丁应有巧手匠心');
    s = applyAction(s, { type: 'useSkill', unitId: 'G', skillIndex: gi, targetId: 'A' }).state;
    s = applyAction(s, { type: 'endTurn' }).state; // 到后手，打手行动
    return applyAction(s, { type: 'useSkill', unitId: 'S', skillIndex: 0, targetId: 'A' }).state;
  };

  it('QA-12：溢出伤害 ×2 转给园丁，且不产生攻击伤害', () => {
    const s = setup();
    assert.equal(s.units.find((u) => u.id === 'A').hp, 1, '受保护目标保底 1 血');
    assert.equal(s.units.find((u) => u.id === 'G').hp, 2, '溢出 2 点 ×2 = 4，园丁 6→2');
  });

  it('QA-13：转移伤害可被护盾减免，且不被庄园老友 -1', () => {
    let t = createGame([
      char('yuanding', {
        id: 'G', slot: 1, hp: 6, maxHp: 6, initialMaxHp: 6,
        statuses: [makeStatus('shield', 'shield', 3, { source: 'G' })],
        veteranOfManor: true,
        damageTakenThisBigTurn: 1,
      }),
      plain({ id: 'A', side: 'first', slot: 2, hp: 3, maxHp: 3, initialMaxHp: 3 }),
      striker(4, { id: 'S', side: 'second', slot: 2 }),
    ]);
    // 清掉「守护」自带护盾，再放 3 点护盾做断言。
    t = { ...t, units: t.units.map((u) => (u.id === 'G' ? { ...u, statuses: [...u.statuses.filter((x) => x.kind !== 'shield'), makeStatus('shield', 'shield', 3, { source: 'G' })] } : u)) };
    // 园丁的 damageTakenThisBigTurn 断言需要保留（攻击伤害才吃庄园老友）。
    t = { ...t, units: t.units.map((u) => (u.id === 'G' ? { ...u, veteranOfManor: true, damageTakenThisBigTurn: 1 } : u)) };
    const gi = skillIndexOf(t.units.find((u) => u.id === 'G'), '巧手匠心');
    t = applyAction(t, { type: 'useSkill', unitId: 'G', skillIndex: gi, targetId: 'A' }).state;
    t = applyAction(t, { type: 'endTurn' }).state;
    t = applyAction(t, { type: 'useSkill', unitId: 'S', skillIndex: 0, targetId: 'A' }).state;
    const g = t.units.find((u) => u.id === 'G');
    // 4 点溢出 → 2 倍 = 8？按 A 血 3：4 点伤害 → 溢出 2，×2=4；护盾 3 吸收后掉 1 血。
    assert.equal(g.hp, 5, '护盾 3 减免转移伤害，且庄园老友不参与');
  });
});

// ---- P6 E 块：道具折扣语义（QA-33/36） ----
describe('P6 E 块：道具折扣（QA-33/36）', () => {
  const clock = { bigTurn: 1, phase: 'first' };

  it('QA-33：魔术棒只让下一次 +1k，用后即清、不累积', () => {
    const item = { id: 'moshubang', name: '魔术棒', cost: 1000 };
    let st = [makeStatus('flag', 'itemDiscount:once:moshubang', 1000, { source: 'A' })];
    assert.equal(itemPrice({ item, statuses: st }), 2000, '下一次魔术棒 1k → 2k');
    st = consumeItemDiscounts(st, 'moshubang', 'A', clock);
    assert.equal(itemPrice({ item, statuses: st }), 1000, '买完立即回到 1k');
    st = consumeItemDiscounts(st, 'moshubang', 'A', clock);
    assert.equal(itemPrice({ item, statuses: st }), 1000, '不累积、不再涨价');

    // 数据方向：+1k（正数=加价）且 scope=once。
    const fx = FX.items.find((x) => x.id === 'moshubang');
    const op = fx.ops.find((o) => o.op === 'itemDiscount');
    assert.equal(op.amount, 1000);
    assert.equal(op.scope, 'once');
  });

  it('QA-36：每小回合第一个护腕 0 花费，第二个照价扣；数量照常消耗', () => {
    const buyer = plain({
      id: 'Y',
      side: 'first',
      slot: 1,
      statuses: [makeStatus('flag', 'itemDiscount:turn:huwan', -1000, { source: 'Y' })],
      items: [{ itemId: 'huwan', cost: null }, { itemId: 'huwan', cost: null }],
    });
    let s = createGame([buyer, plain({ id: 'E' })]);
    s = {
      ...s,
      itemBudget: { ...s.itemBudget, first: 5000 },
      k: { ...s.k, first: 5000 },
      effects: {
        skills: new Map(),
        items: new Map([['huwan', { id: 'huwan', name: '护腕', cost: 1000, effect: { ops: [{ op: 'heal', ref: 'self', amount: 1 }] } }]]),
      },
    };
    s = applyAction(s, { type: 'useItem', unitId: 'Y', itemIndex: 0 }).state;
    let y = s.units.find((u) => u.id === 'Y');
    assert.equal(s.k.first, 5000, '首个护腕免花费');
    assert.equal(y.items.length, 1, '护腕数量照常 -1');
    assert.ok(y.statuses.some((x) => x.key === 'itemUsedThisTurn:huwan'), '记下本回合已用');

    s = applyAction(s, { type: 'useItem', unitId: 'Y', itemIndex: 0 }).state;
    y = s.units.find((u) => u.id === 'Y');
    assert.equal(s.k.first, 4000, '第二个护腕正常扣 1k');
    assert.equal(y.items.length, 0);

    // 下个小回合开始：本回合已用标记自动过期，下回合首个护腕再次免费。
    const next = purgeExpired(y.statuses, { bigTurn: 1, phase: 'second', at: 'start' });
    assert.ok(!next.some((x) => x.key === 'itemUsedThisTurn:huwan'));
    assert.equal(itemPrice({ item: { id: 'huwan', name: '护腕', cost: 1000 }, statuses: next }), 0);
  });
});

// ---- P6 D 块：飞行家/飞行器（QA-18/21/22） ----
describe('P6 D 块：飞行器（QA-18/21/22）', () => {
  const flyerSkill = (u) => u.skills.find((s) => s.def.name === '飞行器');

  it('QA-18/21：己方回合结束自动 +1 血、上限 +1，并计入初始上限（救援减半不丢）', () => {
    let g = createGame([char('feixingjia'), plain({ side: 'second', slot: 1 })]);
    const before = g.units.find((u) => u.id === 'feixingjia');
    assert.equal(before.hp, 2);
    assert.equal(flyerSkill(before).durability, 3);

    g = applyAction(g, { type: 'endTurn' }).state;
    const f = g.units.find((u) => u.id === 'feixingjia');
    assert.equal(f.hp, 3, '回合结束 +1 血');
    assert.equal(f.maxHp, 3, '上限 +1');
    assert.equal(f.initialMaxHp, 3, '计入初始上限');
    assert.equal(flyerSkill(f).durability, 2, '消耗 1 耐久');
    assert.equal(rescuedMaxHp(f), 2, '救援减半按抬高后的初始上限算（3/2 向上取整）');

    // 耐久 0 时回合结束不再触发。
    f.skills.find((s) => s.def.name === '飞行器').durability = 0;
    const g2 = applyAction({ ...g, units: g.units.map((u) => (u.id === 'feixingjia' ? f : u)) }, { type: 'endTurn' }).state;
    const f2 = g2.units.find((u) => u.id === 'feixingjia');
    assert.equal(f2.maxHp, 3, '耐久 0 不触发');
  });

  it('QA-22：首次受伤立即触发一次飞行器（与回合结束互不重复）', () => {
    let g = createGame([plain({ id: 'A', side: 'first', slot: 1, atk: 2 }), char('feixingjia', { id: 'F', side: 'second', slot: 1 })]);
    g = applyAction(g, { type: 'attack', attackerId: 'A', targetId: 'F' }).state;
    const f = g.units.find((u) => u.id === 'F');
    assert.equal(f.hp, 3, '免疫首次伤害并触发 +1 血');
    assert.equal(f.maxHp, 3, '触发同时上限 +1');
    assert.equal(f.initialMaxHp, 3, '同步初始上限');
    assert.equal(flyerSkill(f).durability, 2, '只触发一次，消耗 1 耐久');

    // 己方（第二方）回合结束再触发一次：两个触发点各算一次，不会因首伤已触发而跳过。
    let s = applyAction(g, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'endTurn' }).state;
    const f2 = s.units.find((u) => u.id === 'F');
    assert.equal(f2.hp, 4, '己方回合结束再 +1');
    assert.equal(flyerSkill(f2).durability, 1);
  });
});

// ---- P6 F 块：时点 / 画作 / 站位（QA-07/34/42） ----
describe('P6 F 块：QA-07 下个己方回合时点', () => {
  it('后手在先手回合时，到期为本大回合后手回合末', () => {
    assert.deepEqual(
      resolveDuration('untilNextOwnTurnEnd', { bigTurn: 1, phase: 'first' }, 'second'),
      { bigTurn: 1, phase: 'second', at: 'end' },
      '后手当前处在先手回合：本大回合的后手回合末',
    );
    assert.deepEqual(
      resolveDuration('untilNextOwnTurnEnd', { bigTurn: 1, phase: 'second' }, 'second'),
      { bigTurn: 2, phase: 'second', at: 'end' },
      '后手已在自己回合：顺延到下个大回合后手回合末',
    );
  });
});

describe('P6 F 块：画作绑名（QA-34）', () => {
  it('画家攻击后获得的画作绑定被攻击者的角色名', () => {
    let g = createGame([char('huajia', { slot: 1 }), plain({ id: 'E', side: 'second', name: '甲', slot: 2 })]);
    g = applyAction(g, { type: 'attack', attackerId: 'huajia', targetId: 'E' }).state;
    const p = g.units.find((u) => u.id === 'huajia');
    const painting = p.items.find((x) => x.itemId === 'huazuo');
    assert.ok(painting, '攻击后应获得画作');
    assert.equal(painting.nameKey, '甲');
  });

  it('只能选绑名下的 1 个角色，选错或空目标都拒绝', () => {
    const s0 = createGame(
      [
        plain({ id: 'A', side: 'first', slot: 1, items: [{ itemId: 'huazuo', cost: null, nameKey: '甲' }] }),
        plain({ id: 'B', side: 'second', name: '甲', slot: 1 }),
        plain({ id: 'C', side: 'second', name: '乙', slot: 2 }),
      ],
      { effects: INDEX },
    );
    s0.k.first = 10000;
    assert.throws(() => applyAction(s0, { type: 'useItem', unitId: 'A', itemIndex: 0, targetId: 'C' }), /只能用于/);
    assert.throws(() => applyAction(s0, { type: 'useItem', unitId: 'A', itemIndex: 0 }), /只能用于/);
    const { state } = applyAction(s0, { type: 'useItem', unitId: 'A', itemIndex: 0, targetId: 'B' });
    assert.equal(state.k.first, 8000, '失败不扣费，成功扣 2k');
    assert.ok(state.units.find((u) => u.id === 'B').statuses.some((x) => x.key === 'cannotAttack'));
    assert.ok(!state.units.find((u) => u.id === 'C').statuses.some((x) => x.key === 'cannotAttack'), '同名以外不受影响');
    assert.equal(state.units.find((u) => u.id === 'A').items.length, 0);
  });
});

describe('P6 A 块：每回合 k 资源（QA-01/02）', () => {
  it('开局 k = BP 剩余 1:2 折算；每大回合 +3k、可累积；道具从 k 扣', () => {
    const effects = {
      skills: new Map(),
      items: new Map([['huwan', { id: 'huwan', name: '护腕', cost: 1000, effect: { ops: [{ op: 'heal', ref: 'self', amount: 1 }] } }]]),
    };
    let g = createGame(
      [
        plain({ id: 'A', side: 'first', slot: 1, hp: 5, maxHp: 5, initialMaxHp: 5, items: [{ itemId: 'huwan', cost: null }] }),
        plain({ id: 'B', side: 'second', slot: 1 }),
      ],
      { itemBudget: { first: 5600, second: 2000 }, effects },
    );
    assert.deepEqual(g.k, { first: 8600, second: 5000 }, '开局 = 1:2 折算值 + 3k（P6-Q9）');
    assert.deepEqual(g.itemBudget, { first: 5600, second: 2000 }, 'itemBudget 只作初值保留');

    let s = applyAction(g, { type: 'useItem', unitId: 'A', itemIndex: 0 }).state;
    assert.equal(s.k.first, 7600, '花费从 k 扣');

    s = applyAction(s, { type: 'endTurn' }).state;
    assert.equal(s.k.first, 7600, '大回合内不增加');
    s = applyAction(s, { type: 'endTurn' }).state;
    assert.deepEqual(s.k, { first: 10600, second: 8000 }, '新大回合双方各 +3k');
    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'endTurn' }).state;
    assert.deepEqual(s.k, { first: 13600, second: 11000 }, '可累积，下个大回合再 +3k');
  });

  it('k 不足时拒绝使用道具且不扣费', () => {
    const effects = {
      skills: new Map(),
      items: new Map([['huwan', { id: 'huwan', name: '护腕', cost: 5000, effect: { ops: [{ op: 'heal', ref: 'self', amount: 1 }] } }]]),
    };
    const g = createGame(
      [
        plain({ id: 'A', side: 'first', slot: 1, items: [{ itemId: 'huwan', cost: null }] }),
        plain({ id: 'B', side: 'second', slot: 1 }),
      ],
      { itemBudget: { first: 1000 }, effects },
    );
    assert.throws(() => applyAction(g, { type: 'useItem', unitId: 'A', itemIndex: 0 }), /道具资源不足/);
  });
});

describe('P6 A 块：玩具匣（QA-32；P6-Q10 道具级）', () => {
  it('指定一个道具：该道具本大回合不可用（临时），且花费永久 -1k；其他道具与角色不受影响', () => {
    let g = createGame(
      [
        char('wanjushang', { id: 'W', slot: 1 }),
        plain({
          id: 'A2',
          side: 'first',
          slot: 2,
          hp: 5,
          maxHp: 5,
          initialMaxHp: 5,
          items: [{ itemId: 'huwan', cost: null }, { itemId: 'zhenjingji', cost: null }],
        }),
        plain({ id: 'E', side: 'second', slot: 1 }),
      ],
      { effects: INDEX },
    );
    g = { ...g, k: { first: 5000, second: 0 } };
    const i = g.units.find((u) => u.id === 'W').skills.findIndex((s) => s.def.name === '玩具匣');
    assert.ok(i >= 0, '应有玩具匣技能');

    // 必须指定道具，且只能是「己方道具栏里有的道具」。
    assert.throws(() => applyAction(g, { type: 'useSkill', unitId: 'W', skillIndex: i }), /需要指定一个道具/);
    assert.throws(
      () => applyAction(g, { type: 'useSkill', unitId: 'W', skillIndex: i, itemId: 'moshubang' }),
      /不在己方道具栏/,
    );

    g = applyAction(g, { type: 'useSkill', unitId: 'W', skillIndex: i, itemId: 'huwan' }).state;
    const a = g.units.find((u) => u.id === 'A2');
    const w = g.units.find((u) => u.id === 'W');
    assert.ok(a.statuses.some((x) => x.key === 'itemLock:huwan'), '按道具锁定（不是整名角色）');
    assert.ok(w.statuses.some((x) => x.key === 'itemDiscount:huwan'), '道具属于玩家：队友也吃到减价');
    assert.equal(itemPrice({ item: { id: 'huwan', name: '护腕', cost: 1000 }, statuses: a.statuses }), 0, '永久 -1k');
    assert.equal(
      itemPrice({ item: { id: 'zhenjingji', name: '镇静剂', cost: 1000 }, statuses: a.statuses }),
      1000,
      '其他道具价格不变',
    );
    assert.throws(() => applyAction(g, { type: 'useItem', unitId: 'A2', itemIndex: 0 }), /本回合不可使用该道具/);
    // 同角色另一件道具照常可用。
    g = applyAction(g, { type: 'useItem', unitId: 'A2', itemIndex: 1 }).state;
    assert.equal(g.units.find((u) => u.id === 'A2').items.length, 1, '只有被指定的道具被锁');

    // 下一个大回合：锁定过期，减费仍在（永久）。
    const next = purgeExpired(a.statuses, { bigTurn: 2, phase: 'second', at: 'end' });
    assert.ok(!next.some((x) => x.key === 'itemLock:huwan'), '锁定到期');
    assert.equal(itemPrice({ item: { id: 'huwan', name: '护腕', cost: 1000 }, statuses: next }), 0, '减费永久保留');
  });
});

describe('P6 F 块：站位（QA-42）', () => {
  it('常规回合推进不改站位；隐喻可与敌方交换', () => {
    const stable = createGame([char('xiaoshuojia', { id: 'X', slot: 1 }), plain({ id: 'B', side: 'second', name: '甲', slot: 2 })]);
    const afterEnd = applyAction(stable, { type: 'endTurn' }).state;
    assert.equal(afterEnd.units.find((u) => u.id === 'X').slot, 1, '常规不可变');
    assert.equal(afterEnd.units.find((u) => u.id === 'B').slot, 2);

    let g = createGame([char('xiaoshuojia', { id: 'X', slot: 1 }), plain({ id: 'B', side: 'second', name: '甲', slot: 2 })]);
    const i = g.units.find((u) => u.id === 'X').skills.findIndex((s) => s.def.name === '隐喻');
    const { state, events } = applyAction(g, { type: 'useSkill', unitId: 'X', skillIndex: i, targetId: 'B' });
    assert.equal(state.units.find((u) => u.id === 'X').slot, 2);
    assert.equal(state.units.find((u) => u.id === 'B').slot, 1);
    assert.ok(events.some((e) => e.type === 'swapPosition'));
  });
});

// ---- P6 收尾：8 条 impl-only 的补断言（只加测试，不改业务逻辑）----

const skillIndex = (g, id, name) => {
  const u = g.units.find((x) => x.id === id);
  const i = u.skills.findIndex((s) => s.def.name === name);
  assert.ok(i >= 0, `应找到技能：${name}`);
  return i;
};

describe('P6 收尾：QA-14 扫式相邻伤害不反伤', () => {
  it('相邻角色即使带反伤，也不因扫式的 1 点技能伤害反伤', () => {
    const g = createGame([
      char('gudongshang', { id: 'A', slot: 1 }),
      plain({ id: 'B', side: 'second', slot: 1, atk: 3, hp: 6, maxHp: 6, initialMaxHp: 6, hasReflect: true }),
      plain({ id: 'C', side: 'second', slot: 2, atk: 5, hp: 5, maxHp: 5, initialMaxHp: 5, hasReflect: true }),
    ]);
    const i = skillIndex(g, 'A', '藏锋');
    const s = applyAction(g, { type: 'useSkill', unitId: 'A', skillIndex: i, variant: '扫式' }).state;
    const before = s.units.find((u) => u.id === 'A').hp;
    const r = applyAction(s, { type: 'attack', attackerId: 'A', targetId: 'B' });
    assert.equal(r.state.units.find((u) => u.id === 'C').hp, 4, '相邻 C 受 1 点技能伤害');
    assert.equal(r.state.units.find((u) => u.id === 'A').hp, before, 'A 不因相邻伤害反伤');
    assert.ok(!r.events.some((e) => e.type === 'reflect'), '不产生反伤事件');
  });
});

describe('P6 收尾：QA-23 救援扣血规则', () => {
  const dying = () => ({ id: 't', hp: 0, maxHp: 4, initialMaxHp: 4, statuses: [] });

  it('前锋式：只扣 1 血，且可先扣临时血量（不锁本体）', () => {
    const target = dying();
    const rescuer = { id: 'r', hp: 4, maxHp: 4, initialMaxHp: 4, tempHp: 1, hasRescue: true, rescueCostBase: 1, statuses: [] };
    const op = availableRescues(target, [target, rescuer])[0];
    assert.equal(op.cost, 1);
    assert.equal(op.useBodyOnly, false, '前锋没有必扣本体');
    const r = applyRescue(target, [target, rescuer], op);
    assert.equal(r.rescuer.tempHp, 0, '先扣临时血量');
    assert.equal(r.rescuer.hp, 4, '本体不减');
  });

  it('野人式：同样只扣 1 血，但必扣本体（临时血量不抵扣）', () => {
    const target = dying();
    const rescuer = {
      id: 'r',
      hp: 5,
      maxHp: 5,
      initialMaxHp: 5,
      tempHp: 3,
      hasRescue: true,
      rescueCostBase: 1,
      mustUseBodyForRescue: true,
      statuses: [],
    };
    const op = availableRescues(target, [target, rescuer])[0];
    assert.equal(op.cost, 1);
    assert.equal(op.useBodyOnly, true);
    const r = applyRescue(target, [target, rescuer], op);
    assert.equal(r.rescuer.hp, 4);
    assert.equal(r.rescuer.tempHp, 3);
  });

  it('前锋开局即具备救援能力（rescueRule + grantRescue）', () => {
    const g = createGame([
      char('qianfeng', { id: 'Q', slot: 1 }),
      plain({ id: 'V', side: 'first', slot: 2, hp: 1, maxHp: 4, initialMaxHp: 4 }),
      plain({ id: 'E', side: 'second', slot: 1, atk: 3 }),
    ]);
    assert.equal(g.units.find((u) => u.id === 'Q').hasRescue, true);
  });
});

describe('P6 收尾：QA-29 CD=N 需等 N 回合', () => {
  it('用后当回合与下一大回合均不可用，第 N+1 个大回合恢复', () => {
    const g = createGame([char('laladuiyuan', { id: 'L', slot: 1 }), plain({ id: 'B', side: 'second', slot: 1, hp: 9, maxHp: 9, initialMaxHp: 9 })]);
    const i = skillIndex(g, 'L', '鼓舞');
    const sk = g.units.find((u) => u.id === 'L').skills[i];
    assert.equal(canUseSkill(g.units.find((u) => u.id === 'L'), sk, g.clock), null, '开局可用');
    let s = applyAction(g, { type: 'useSkill', unitId: 'L', skillIndex: i }).state;
    const used = s.units.find((u) => u.id === 'L').skills[i];
    assert.ok(used.usedPerGame > 0);
    assert.match(String(canUseSkill(s.units.find((u) => u.id === 'L'), used, s.clock)), /CD 未就绪/);

    for (let k = 0; k < 2; k++) s = applyAction(s, { type: 'endTurn' }).state;
    assert.equal(s.clock.bigTurn, 2);
    const at2 = s.units.find((u) => u.id === 'L').skills[i];
    assert.match(String(canUseSkill(s.units.find((u) => u.id === 'L'), at2, s.clock)), /CD 未就绪/, 'CD=1 第 2 大回合仍不可用');

    for (let k = 0; k < 2; k++) s = applyAction(s, { type: 'endTurn' }).state;
    assert.equal(s.clock.bigTurn, 3);
    const at3 = s.units.find((u) => u.id === 'L').skills[i];
    assert.equal(canUseSkill(s.units.find((u) => u.id === 'L'), at3, s.clock), null, '第 3 大回合恢复');
  });
});

describe('P6 收尾：QA-31 道具通用性', () => {
  it('任意角色可用道具，且可对敌方使用', () => {
    const g = createGame(
      [
        plain({ id: 'A', side: 'first', slot: 1, items: [{ itemId: 'niantudan', cost: null }] }),
        plain({ id: 'B', side: 'second', slot: 1, atk: 1, hp: 5, maxHp: 5, initialMaxHp: 5 }),
      ],
      { effects: INDEX },
    );
    const s = applyAction({ ...g, k: { first: 5000, second: 5000 } }, { type: 'useItem', unitId: 'A', itemIndex: 0, targetId: 'B' }).state;
    assert.equal(effectiveAtk(s.units.find((u) => u.id === 'B'), s.clock), 0, '粘土弹对敌方生效（atk 1→0）');
  });
});

describe('P6 收尾：QA-35 役鸟守护攻击力永久 -1', () => {
  it('减攻永久保留，且可被其他加攻效果加回', () => {
    const x = char('xianzhi', { id: 'X', slot: 1 });
    const buff = skill(def(), eff({ target: { mode: 'self' }, ops: [{ op: 'modStat', ref: 'self', stat: 'atk', delta: 1, duration: 'permanent' }] }));
    x.skills = [...x.skills, buff];
    let g = createGame([x, plain({ id: 'B', side: 'second', slot: 1, atk: 4, hp: 9, maxHp: 9, initialMaxHp: 9 })]);
    // 进入对方（后手）回合，由 B 攻击 X 触发役鸟守护的反应窗口。
    g = applyAction(g, { type: 'endTurn' }).state;
    const before = effectiveAtk(g.units.find((u) => u.id === 'X'), g.clock);
    const hpBefore = g.units.find((u) => u.id === 'X').hp;
    let s = applyAction(g, { type: 'attack', attackerId: 'B', targetId: 'X' }).state;
    assert.ok(s.pendingInterrupt, 'B 攻击 X 时触发反应窗口');
    const i = skillIndex(s, 'X', '役鸟守护');
    s = applyAction(s, { type: 'interruptWithSkill', unitId: 'X', skillIndex: i }).state;
    assert.equal(effectiveAtk(s.units.find((u) => u.id === 'X'), s.clock), before - 1, '攻击力永久 -1');
    assert.equal(s.units.find((u) => u.id === 'X').hp, hpBefore, '役鸟免疫了这次攻击伤害');

    // 跨回合不恢复。
    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'endTurn' }).state;
    const xs = s.units.find((u) => u.id === 'X');
    const noMinus = { ...xs, statuses: xs.statuses.filter((x) => !(x.kind === 'stat' && x.key === 'atk' && x.value === -1)) };
    assert.equal(effectiveAtk(xs, s.clock), effectiveAtk(noMinus, s.clock) - 1, '跨回合仍 -1');

    s = applyAction(s, { type: 'endTurn' }).state;
    const j = s.units.find((u) => u.id === 'X').skills.length - 1;
    s = applyAction(s, { type: 'useSkill', unitId: 'X', skillIndex: j }).state;
    const xs2 = s.units.find((u) => u.id === 'X');
    assert.ok(xs2.statuses.some((x) => x.kind === 'stat' && x.key === 'atk' && x.value === 1), '加攻状态已挂上');
    const clean = { ...xs2, statuses: xs2.statuses.filter((x) => !(x.kind === 'stat' && x.key === 'atk')) };
    assert.equal(effectiveAtk(xs2, s.clock), effectiveAtk(clean, s.clock), '加攻可加回（-1 与 +1 抵消）');
  });
});

describe('P6 收尾：QA-38/39 门之钥', () => {
  it('可选敌方目标，交换永久生效，再次使用可换回', () => {
    const j = char('jisi', { id: 'J', slot: 1 });
    const e = plain({ id: 'E', side: 'second', slot: 1, atk: 1, hp: 5, maxHp: 5, initialMaxHp: 5 });
    let g = createGame([j, e]);
    const i = skillIndex(g, 'J', '门之钥');
    const chargeAll = (st) => ({
      ...st,
      units: st.units.map((u) => (u.id === 'J' ? { ...u, skills: u.skills.map((s) => (s.def.name === '门之钥' ? { ...s, charge: 3 } : s)) } : u)),
    });

    let s = applyAction(chargeAll(g), { type: 'useSkill', unitId: 'J', skillIndex: i, targetId: 'E' }).state;
    let ee = s.units.find((u) => u.id === 'E');
    assert.equal(ee.atk, 5, '敌方 atk1/血上限5 → atk5');
    assert.equal(ee.maxHp, 1, '血上限变为 1');

    // 永久：推进回合不恢复。
    s = applyAction(s, { type: 'endTurn' }).state;
    s = applyAction(s, { type: 'endTurn' }).state;
    ee = s.units.find((u) => u.id === 'E');
    assert.equal(ee.atk, 5);
    assert.equal(ee.maxHp, 1);

    // 再次使用换回。
    s = applyAction(chargeAll(s), { type: 'useSkill', unitId: 'J', skillIndex: i, targetId: 'E' }).state;
    ee = s.units.find((u) => u.id === 'E');
    assert.equal(ee.atk, 1);
    assert.equal(ee.maxHp, 5);
  });
});

describe('P6 收尾：QA-41 站位决定相邻', () => {
  it('按站位号判定相邻：扫式只溅射左右相邻，不波及其它位置', () => {
    const g = createGame([
      char('gudongshang', { id: 'A', slot: 1 }),
      plain({ id: 'C', side: 'second', slot: 1, hp: 5, maxHp: 5, initialMaxHp: 5 }),
      plain({ id: 'B', side: 'second', slot: 2, hp: 6, maxHp: 6, initialMaxHp: 6 }),
      plain({ id: 'D', side: 'second', slot: 3, hp: 5, maxHp: 5, initialMaxHp: 5 }),
      plain({ id: 'E', side: 'second', slot: 4, hp: 5, maxHp: 5, initialMaxHp: 5 }),
    ]);
    const i = skillIndex(g, 'A', '藏锋');
    const s = applyAction(g, { type: 'useSkill', unitId: 'A', skillIndex: i, variant: '扫式' }).state;
    const r = applyAction(s, { type: 'attack', attackerId: 'A', targetId: 'B' });
    assert.equal(r.state.units.find((u) => u.id === 'C').hp, 4, '左邻受 1');
    assert.equal(r.state.units.find((u) => u.id === 'D').hp, 4, '右邻受 1');
    assert.equal(r.state.units.find((u) => u.id === 'E').hp, 5, '隔位不受');
    assert.deepEqual(
      r.state.units.map((u) => [u.id, u.slot]).sort(),
      [['A', 1], ['B', 2], ['C', 1], ['D', 3], ['E', 4]],
      '站位不变',
    );
  });
});

