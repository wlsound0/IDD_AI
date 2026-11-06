import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  rescueCost,
  canRescue,
  availableRescues,
  judgeDying,
  applyRescue,
  isRescuableAtAll,
} from '../temp/build/core/rescue.js';

const unit = (over) => ({
  id: 'a',
  atk: 1,
  hp: 5,
  maxHp: 5,
  initialMaxHp: 5,
  tempHp: 0,
  hasRescue: true,
  ...over,
});

describe('D01 濒死判定', () => {
  it('没有任何救援者时立即死亡', () => {
    const target = unit({ hp: 0 });
    // b 没有「救援」能力，不能救人
    const r = judgeDying(target, [unit({ id: 'b', hasRescue: false })]);
    assert.equal(r.outcome, 'dead');
    assert.equal(r.ops.length, 0);
  });

  it('有救援者时进入选择状态', () => {
    const target = unit({ hp: 0 });
    const rescuer = unit({ id: 'b', mustUseBodyForRescue: true });
    const r = judgeDying(target, [target, rescuer]);
    assert.equal(r.outcome, 'choice');
    assert.equal(r.ops.length, 1);
    assert.equal(r.ops[0].cost, 2);
  });

  it('救援者血量不足时不算可救援', () => {
    const target = unit({ hp: 0 });
    const rescuer = unit({ id: 'b', hp: 1, mustUseBodyForRescue: true });
    assert.equal(canRescue(target, rescuer), false);
  });

  it('玩家放弃选择时立即死亡', () => {
    const target = unit({ hp: 0 });
    const r = applyRescue(target, [target], null);
    assert.equal(r.dead, true);
  });
});

describe('D02 救援结果', () => {
  it('救援者扣 2 血，目标按初始上限减半满血复活', () => {
    const target = unit({ id: 'a', hp: 0, maxHp: 5, initialMaxHp: 5 });
    const rescuer = unit({ id: 'b', mustUseBodyForRescue: true });
    const op = availableRescues(target, [target, rescuer])[0];
    const r = applyRescue(target, [target, rescuer], op);
    assert.equal(r.dead, false);
    assert.equal(r.rescuer.hp, 3);
    assert.equal(r.target.maxHp, 3);
    assert.equal(r.target.hp, 3);
    assert.equal(r.target.rescueCount, 1);
  });

  it('加过血的目标，救援仍按战斗初始上限减半', () => {
    const target = unit({ id: 'a', hp: 0, maxHp: 9, initialMaxHp: 5 });
    const rescuer = unit({ id: 'b', mustUseBodyForRescue: true });
    const op = availableRescues(target, [target, rescuer])[0];
    const r = applyRescue(target, [target, rescuer], op);
    assert.equal(r.target.maxHp, 3);
  });

  it('每小局默认只能被救一次', () => {
    const target = unit({ id: 'a', hp: 0, rescueCount: 1 });
    assert.equal(isRescuableAtAll(target), false);
  });

  it('画家的救援者只扣 1 血', () => {
    const target = unit({ id: 'a', hp: 0, rescueCostDelta: -1 });
    const rescuer = unit({ id: 'b', mustUseBodyForRescue: true });
    const op = availableRescues(target, [target, rescuer])[0];
    assert.equal(op.cost, 1);
    const r = applyRescue(target, [target, rescuer], op);
    assert.equal(r.rescuer.hp, 4);
  });
});

describe('D18 画家', () => {
  it('可被救两次，且被救不减上限', () => {
    const target = unit({
      id: 'a',
      hp: 0,
      rescueLimit: 2,
      noMaxHpHalvingOnRescue: true,
      rescueCostDelta: -1,
    });
    const rescuer = unit({ id: 'b', mustUseBodyForRescue: true });
    const op = availableRescues(target, [target, rescuer])[0];
    const first = applyRescue(target, [target, rescuer], op);
    assert.equal(first.target.maxHp, 5);
    assert.equal(first.target.hp, 5);
    assert.equal(first.target.rescueCount, 1);

    const second = applyRescue({ ...first.target, hp: 0 }, [target, rescuer], op);
    assert.equal(second.dead, false);
    assert.equal(second.target.maxHp, 5);
    assert.equal(second.target.rescueCount, 2);

    const third = applyRescue({ ...second.target, hp: 0 }, [target, rescuer], op);
    assert.equal(third.dead, true);
  });
});

describe('D17 野人', () => {
  it('未封技能：救援只扣 1 血，且必扣本体（不能用临时血量抵扣）', () => {
    const target = unit({ id: 'a', hp: 0 });
    const rescuer = unit({ id: 'b', hp: 5, tempHp: 3, rescueCostBase: 1, mustUseBodyForRescue: true });
    const op = availableRescues(target, [target, rescuer])[0];
    assert.equal(op.cost, 1);
    assert.equal(op.useBodyOnly, true);
    const r = applyRescue(target, [target, rescuer], op);
    assert.equal(r.rescuer.hp, 4);
    assert.equal(r.rescuer.tempHp, 3);
  });

  it('封技能后仍可救援，但改为扣 2 血且优先扣临时血量', () => {
    const target = unit({ id: 'a', hp: 0 });
    const rescuer = unit({
      id: 'b',
      hp: 5,
      tempHp: 2,
      sealed: true,
      canRescueWhenSealed: true,
      rescueCostBase: 1,
      rescueCostWhenSealed: 2,
      mustUseBodyForRescue: true,
    });
    assert.equal(rescueCost(rescuer, target), 2);
    const op = availableRescues(target, [target, rescuer])[0];
    assert.equal(op.useBodyOnly, false);
    const r = applyRescue(target, [target, rescuer], op);
    assert.equal(r.rescuer.tempHp, 0);
    assert.equal(r.rescuer.hp, 5);
  });

  it('封技能且没有救援豁免的角色不能再救人', () => {
    const target = unit({ id: 'a', hp: 0 });
    const rescuer = unit({ id: 'b', sealed: true });
    assert.equal(canRescue(target, rescuer), false);
  });
});

describe('D03 自我救援', () => {
  it('不扣血，按初始上限减半满血复活', () => {
    const target = unit({ id: 'a', hp: 0, maxHp: 5, initialMaxHp: 5, canSelfRescue: true });
    const ops = availableRescues(target, [target]);
    const self = ops.find((o) => o.kind === 'self');
    assert.ok(self);
    const r = applyRescue(target, [target], self);
    assert.equal(r.target.hp, 3);
    assert.equal(r.target.maxHp, 3);
    assert.equal(r.rescuer, undefined);
  });

  it('自我救援也可以被放弃（Q31）', () => {
    const target = unit({ id: 'a', hp: 0, canSelfRescue: true });
    assert.equal(judgeDying(target, [target]).outcome, 'choice');
    assert.equal(applyRescue(target, [target], null).dead, true);
  });
});

describe('D06 召唤物', () => {
  it('召唤物不可被救援、没有濒死', () => {
    const summon = unit({ id: 's', hp: 0, isSummon: true });
    assert.equal(isRescuableAtAll(summon), false);
    assert.equal(judgeDying(summon, [summon, unit({ id: 'b' })]).outcome, 'dead');
  });
});
