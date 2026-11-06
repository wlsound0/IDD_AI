import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BP_BUDGET,
  BP_MAX_PICKS,
  applyBp,
  advanceSeries,
  blockReason,
  createBp,
  createSeries,
  currentStep,
  forfeitBp,
  legalBpChoices,
  recordRoundWinner,
  roundSteps,
  sidePlayers,
  stepActor,
  toItemBudget,
  variantsForMode,
} from '../temp/build/core/bp.js';

const chars = JSON.parse(readFileSync(new URL('../data/characters.json', import.meta.url), 'utf8')).characters;
const catalog = chars.map((c) => ({ id: c.id, name: c.name, rarity: c.rarity, cost: c.cost }));
const byName = (name) => catalog.find((c) => c.name === name);

/** 受控目录：用来精确测预算与稀有度。 */
const fake = [
  { id: 'n1', name: '普通A', rarity: 'normal', cost: 1000 },
  { id: 'n2', name: '普通B', rarity: 'normal', cost: 1000 },
  { id: 'n3', name: '普通C', rarity: 'normal', cost: 2000 },
  { id: 'n4', name: '普通D', rarity: 'normal', cost: 2000 },
  { id: 'n5', name: '普通E', rarity: 'normal', cost: 2000 },
  { id: 'e1', name: '史诗A', rarity: 'epic', cost: 3000 },
  { id: 'e2', name: '史诗B', rarity: 'epic', cost: 3000 },
  { id: 'l1', name: '限定A', rarity: 'limited', cost: 4000 },
  { id: 'l2', name: '限定B', rarity: 'limited', cost: 4000 },
  { id: 'l3', name: '限定C', rarity: 'limited', cost: 4000 },
];
const fakeBy = (id) => fake.find((c) => c.id === id);

/** 10 个 5k 角色：专门用来把预算顶到 14k 之外，同时留足 BAN 名额。 */
const pricey = Array.from({ length: 10 }, (_, i) => ({
  id: 'x' + (i + 1),
  name: '贵' + (i + 1),
  rarity: 'normal',
  cost: 5000,
}));

function driveStep(s, cat = catalog) {
  const choices = legalBpChoices(s, cat);
  assert.ok(choices, 'BP 未结束却没有合法行动');
  if (choices.canEndStep) return applyBp(s, { type: 'endStep' }, cat);
  assert.ok(choices.chars.length > 0, '当前步没有可选项');
  return applyBp(s, { type: choices.action, charId: choices.chars[0].id }, cat);
}

function advanceSteps(s, cat, n) {
  let cur = s;
  let guard = 0;
  while (cur.stepIndex < n && guard++ < 20) cur = driveStep(cur, cat);
  assert.equal(cur.stepIndex, n, '未能推进到第 ' + n + ' 步');
  return cur;
}

function driveAll(state, cat = catalog) {
  let s = state;
  let guard = 0;
  while (!s.finished && guard++ < 100) {
    const choices = legalBpChoices(s, cat);
    assert.ok(choices, 'BP 未结束却没有合法行动');
    if (choices.chars.length === 0) {
      assert.ok(choices.canEndStep, '当前步没有可选项却不能结束');
      s = applyBp(s, { type: 'endStep' }, cat);
      continue;
    }
    s = applyBp(s, { type: choices.action, charId: choices.chars[0].id }, cat);
  }
  assert.ok(s.finished, 'BP 未在步数内结束');
  return s;
}

describe('BP 数据与变体', () => {
  it('43 个角色都有合法 cost（1k–5k）', () => {
    assert.equal(chars.length, 43);
    for (const c of chars) {
      assert.equal(typeof c.cost, 'number', c.name + ' 缺 cost');
      assert.ok(c.cost >= 1000 && c.cost <= 5000, c.name + ' cost 越界：' + c.cost);
      assert.ok(c.cost % 1000 === 0, c.name + ' cost 应为整 k');
    }
  });

  it('三种赛制的变体参数与 BP.md 一致', () => {
    const shape = (mode) =>
      variantsForMode(mode).map((v) => [v.banFirstRound, v.banSecondRound, v.distinctFirstPicks, v.entersGlobalBan]);
    assert.deepEqual(shape('single'), [[2, 2, false, false]]);
    assert.deepEqual(shape('bo3'), [[2, 2, true, true], [2, 1, true, true], [1, 1, false, false]]);
    assert.deepEqual(shape('bo5'), [
      [2, 2, true, true],
      [2, 1, true, true],
      [1, 1, true, true],
      [1, 1, false, false],
      [1, 1, false, false],
    ]);
  });

  it('8 步骨架：ban→ban→pick→pick→ban→ban→pick→pick', () => {
    const steps = roundSteps(variantsForMode('bo3')[0]);
    assert.equal(steps.length, 8);
    assert.deepEqual(steps.map((s) => s.action), ['ban', 'ban', 'pick', 'pick', 'ban', 'ban', 'pick', 'pick']);
    assert.deepEqual(steps.map((s) => s.actor), ['first', 'second', 'first', 'second', 'first', 'second', 'first', 'second']);
    assert.deepEqual(steps.map((s) => s.count), [2, 2, 2, 2, 2, 2, 3, 3]);
    assert.equal(steps[6].atMost, true);
    assert.equal(steps[7].atMost, true);
  });
});

describe('BP 流程', () => {
  it('一局一胜可自动走完：每人 BAN 4 个、pick 5 个、预算不超', () => {
    let s = createBp({ mode: 'single' });
    assert.equal(stepActor(s), 'p1');
    s = driveAll(s);
    for (const key of ['p1', 'p2']) {
      assert.equal(s.players[key].bans.length, 4, key + ' BAN 数不对');
      assert.ok(s.players[key].picks.length >= 2 && s.players[key].picks.length <= BP_MAX_PICKS);
      assert.ok(s.players[key].spent <= BP_BUDGET);
    }
    // 用便宜目录再跑一遍：第二轮可以选满 5 人
    const rich = driveAll(createBp({ mode: 'single' }), fake);
    assert.equal(rich.players.p1.picks.length, 5);
    assert.equal(rich.players.p2.picks.length, 5);
  });

  it('第二阶段「至多三个」选 0 个也合法（endStep）', () => {
    let s = advanceSteps(createBp({ mode: 'single' }), catalog, 6);
    assert.equal(currentStep(s).atMost, true);
    s = applyBp(s, { type: 'endStep' }, catalog);
    assert.equal(s.players.p1.picks.length, 2);
    assert.equal(s.stepIndex, 7);
  });

  it('BAN 阶段不能 pick，pick 阶段不能 BAN', () => {
    const s = createBp({ mode: 'single' });
    assert.throws(() => applyBp(s, { type: 'pick', charId: catalog[0].id }, catalog), /BAN/);
  });

  it('BAN 只作用于对方：对方 BAN 的不能选，自己 BAN 的还能选', () => {
    let s = createBp({ mode: 'single' });
    s = applyBp(s, { type: 'ban', charId: catalog[0].id }, catalog);
    s = applyBp(s, { type: 'ban', charId: catalog[1].id }, catalog);
    s = applyBp(s, { type: 'ban', charId: catalog[2].id }, catalog);
    s = applyBp(s, { type: 'ban', charId: catalog[3].id }, catalog);
    assert.equal(blockReason(s, 'p1', 'pick', catalog[2], catalog), '被对方 BAN');
    assert.equal(blockReason(s, 'p1', 'pick', catalog[0], catalog), null);
  });

  it('对方已 BAN 的名字仍可 BAN；同一个玩家不能重复 BAN（用户口径）', () => {
    let s = createBp({ mode: 'single' });
    s = applyBp(s, { type: 'ban', charId: catalog[0].id }, catalog);
    s = applyBp(s, { type: 'ban', charId: catalog[1].id }, catalog);
    // p1 不能重复 BAN 自己已 BAN 的
    assert.equal(blockReason(s, 'p1', 'ban', catalog[0], catalog), '自己本局已 BAN 过该角色');
    // p2 可以 BAN p1 已 BAN 的角色
    assert.equal(blockReason(s, 'p2', 'ban', catalog[0], catalog), null);
    s = applyBp(s, { type: 'ban', charId: catalog[0].id }, catalog);
    s = applyBp(s, { type: 'ban', charId: catalog[2].id }, catalog);
    assert.equal(s.players.p2.bans.length, 2);
    assert.ok(s.players.p1.bans.includes(catalog[0].name));
    assert.ok(s.players.p2.bans.includes(catalog[0].name));
  });

  it('预算 14k：超过 14k 的第 3 个 5k 角色被拒，便宜的仍可选', () => {
    let s = createBp({ mode: 'single' });
    for (let i = 0; i < 4; i++) s = applyBp(s, { type: 'ban', charId: pricey[i].id }, pricey);
    s = applyBp(s, { type: 'pick', charId: 'x1' }, pricey);
    s = applyBp(s, { type: 'pick', charId: 'x2' }, pricey);
    assert.equal(s.players.p1.spent, 10000);
    s = advanceSteps(s, pricey, 6);
    // 10k + 5k > 14k
    assert.equal(blockReason(s, 'p1', 'pick', pricey[4], pricey), '预算不足 14k');
    const cheap = { id: 'c1', name: '便宜', rarity: 'normal', cost: 1000 };
    assert.equal(blockReason(s, 'p1', 'pick', cheap, pricey), null);
  });

  it('稀有度：同名限定/史诗各限 1 个、同名普通限 2 个、限定总数 ≤2', () => {
    let s = advanceSteps(createBp({ mode: 'bo3', roundIndex: 2 }), fake, 2);
    s = applyBp(s, { type: 'pick', charId: 'l1' }, fake);
    assert.equal(blockReason(s, 'p1', 'pick', fakeBy('l1'), fake), '同名角色上限');
    s = applyBp(s, { type: 'pick', charId: 'l2' }, fake);
    s = advanceSteps(s, fake, 6);
    assert.equal(blockReason(s, 'p1', 'pick', fakeBy('l3'), fake), '限定角色已达 2 个');
    assert.equal(blockReason(s, 'p1', 'pick', fakeBy('e2'), fake), null);
    // n1 在推进过程中已被双方 BAN 掉，换一个没被 BAN 的普通角色测同名上限
    s = applyBp(s, { type: 'pick', charId: 'n5' }, fake);
    s = applyBp(s, { type: 'pick', charId: 'n5' }, fake);
    assert.equal(blockReason(s, 'p1', 'pick', fakeBy('n5'), fake), '同名角色上限');
  });

  it('要求「不同」的小局（三局两胜 BO1）同一步不能选同名', () => {
    const t0 = applyBp(advanceSteps(createBp({ mode: 'bo3', roundIndex: 0 }), fake, 2), { type: 'pick', charId: 'n3' }, fake);
    assert.throws(() => applyBp(t0, { type: 'pick', charId: 'n3' }, fake), /两个不同/);
  });

  it('不要求「不同」的小局（三局两胜 BO3）允许同选同名普通角色（Q17/Q38）', () => {
    const t0 = applyBp(advanceSteps(createBp({ mode: 'bo3', roundIndex: 2 }), fake, 2), { type: 'pick', charId: 'n3' }, fake);
    const t1 = applyBp(t0, { type: 'pick', charId: 'n3' }, fake);
    assert.deepEqual(t1.players.p1.picks, ['普通C', '普通C']);
  });
});

describe('全局 BAN 与系列赛', () => {
  it('全局 BAN 私有：只约束选过它的人，对手仍可选（Q36）', () => {
    let series = createSeries('bo3');
    series.current = driveAll(series.current);
    const p1Picks = series.current.players.p1.picks.slice();
    const globalFirst = p1Picks.slice(0, 2); // BO1 步 3/4 标了「进入全局BAN」
    series = recordRoundWinner(series, 'p1');
    for (const name of globalFirst) assert.ok(series.globalBans.p1.includes(name), '全局 BAN 未累计：' + name);
    series = advanceSeries(series);
    assert.equal(series.current.roundIndex, 1);
    assert.equal(series.current.firstPlayer, 'p2');
    assert.equal(stepActor(series.current), 'p2');
    assert.deepEqual(sidePlayers(series.current), { first: 'p2', second: 'p1' });
    const probe = byName(globalFirst[0]);
    assert.equal(blockReason(series.current, 'p1', 'pick', probe, catalog), '自己全局 BAN 中');
    // 对手不受影响：挑一个不在对手自己全局 BAN 里的名字，应可选
    const p2Global = series.globalBans.p2;
    const free = catalog.find((c) => !p2Global.includes(c.name) && c.name !== probe.name);
    assert.ok(free, '找不到对手可选的普通角色');
    assert.equal(blockReason(series.current, 'p2', 'pick', free, catalog), null);
  });

  it('先手逐小局轮换：BO1 p1 → BO2 p2 → BO3 p1（Q34）', () => {
    let series = createSeries('bo3');
    assert.equal(series.current.firstPlayer, 'p1');
    series.current = driveAll(series.current);
    series = advanceSeries(recordRoundWinner(series, 'p1'));
    assert.equal(series.current.firstPlayer, 'p2');
    series.current = driveAll(series.current);
    series = advanceSeries(recordRoundWinner(series, 'p2'));
    assert.equal(series.current.firstPlayer, 'p1');
  });

  it('两胜出冠军，之后不能继续推进', () => {
    let series = createSeries('bo3');
    series.current = driveAll(series.current);
    series = recordRoundWinner(series, 'p1');
    assert.equal(series.champion, null);
    series = advanceSeries(series);
    series.current = driveAll(series.current);
    series = recordRoundWinner(series, 'p1');
    assert.equal(series.champion, 'p1');
    assert.throws(() => advanceSeries(series), /已结束/);
  });

  it('剩余预算按 1:2 折算成道具花费', () => {
    assert.equal(toItemBudget(14000), 28000);
    assert.equal(toItemBudget(0), 0);
    assert.equal(toItemBudget(1500), 3000);
  });

  it('认负可随时结束 BP，已选角色与 BAN 保留', () => {
    let s = advanceSteps(createBp({ mode: 'single' }), catalog, 2);
    const first = legalBpChoices(s, catalog).chars[0];
    s = applyBp(s, { type: 'pick', charId: first.id }, catalog);
    assert.equal(s.finished, false);
    const forfeited = forfeitBp(s);
    assert.equal(forfeited.finished, true);
    assert.equal(forfeited.players.p1.picks.length, 1);
    assert.equal(forfeited.players.p1.bans.length, 2);
    // 认负后照常可以记录小局胜者
    let series = createSeries('single');
    series = Object.assign({}, series, { current: forfeitBp(series.current) });
    series = recordRoundWinner(series, 'p2');
    assert.equal(series.wins.p2, 1);
  });

  it('每人最多 5 人（BP_MAX_PICKS）', () => {
    assert.equal(BP_MAX_PICKS, 5);
    const s = driveAll(createBp({ mode: 'single' }));
    assert.ok(s.players.p1.picks.length <= BP_MAX_PICKS);
    assert.ok(s.players.p2.picks.length <= BP_MAX_PICKS);
  });
});
