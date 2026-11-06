import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveAtk,
  attackDamage,
  reflectDamage,
  applyDamage,
  healByAdding,
  healByRestoring,
  rescuedMaxHp,
} from '../temp/build/core/combat.js';
import { createClock, endSmallTurn } from '../temp/build/core/turn.js';

const unit = (over) => ({
  id: 'u',
  atk: 3,
  hp: 5,
  maxHp: 5,
  initialMaxHp: 5,
  tempHp: 0,
  ...over,
});
const turn1 = createClock();
const turn2 = endSmallTurn(endSmallTurn(createClock()));

describe('伤害计算', () => {
  it('R11 攻击力 0 也产生 0 伤害，不会变成负数', () => {
    assert.equal(attackDamage(unit({ atk: 0 }), unit(), turn1), 0);
    assert.equal(effectiveAtk(unit({ atk: 0 }), turn2), 0);
  });

  it('R15 第一回合全体攻击力 -1，大回合 2 恢复', () => {
    assert.equal(effectiveAtk(unit({ atk: 3 }), turn1), 2);
    assert.equal(effectiveAtk(unit({ atk: 3 }), turn2), 3);
  });

  it('R15 与下限 0 同时生效时不会为负', () => {
    assert.equal(effectiveAtk(unit({ atk: 0 }), turn1), 0);
  });

  it('庄园老友：首次不减，第二次 -1，且不叠加', () => {
    const defender = unit({ veteranOfManor: true });
    assert.equal(attackDamage(unit({ atk: 4 }), defender, turn2), 4);
    const hit1 = attackDamage(unit({ atk: 4 }), { ...defender, damageTakenThisBigTurn: 1 }, turn2);
    const hit2 = attackDamage(unit({ atk: 4 }), { ...defender, damageTakenThisBigTurn: 3 }, turn2);
    assert.equal(hit1, 3);
    assert.equal(hit2, 3);
  });

  it('庄园老友只在「攻击」伤害上生效（技能伤害不减），由调用方选择函数', () => {
    const defender = { ...unit({ veteranOfManor: true }), damageTakenThisBigTurn: 2 };
    // 技能伤害走 applyDamage 的显式数值，不经过 attackDamage
    const r = applyDamage(defender, 4, { clock: turn2, kind: 'skill' });
    assert.equal(r.applied, 4);
  });

  it('反伤取受击方当前攻击力，被降攻同样生效', () => {
    assert.equal(reflectDamage(unit({ atk: 2 }), turn2), 2);
    assert.equal(reflectDamage(unit({ atk: 0 }), turn2), 0);
  });

  it('免疫吞掉本次伤害', () => {
    const r = applyDamage(unit({ immune: true }), 99, { clock: turn2, kind: 'attack' });
    assert.equal(r.applied, 0);
    assert.equal(r.target.hp, 5);
  });

  it('临时血量先于真实血量承伤', () => {
    const r = applyDamage(unit({ hp: 5, tempHp: 2 }), 3, { clock: turn2, kind: 'attack' });
    assert.equal(r.absorbedByTemp, 2);
    assert.equal(r.applied, 1);
    assert.equal(r.target.tempHp, 0);
    assert.equal(r.target.hp, 4);
  });

  it('血量归零即濒死，不在这里判定死亡', () => {
    const r = applyDamage(unit({ hp: 1 }), 2, { clock: turn2, kind: 'attack' });
    assert.equal(r.dying, true);
    assert.equal(r.target.hp, -1);
  });

  it('不修改入参对象', () => {
    const t = unit();
    applyDamage(t, 3, { clock: turn2, kind: 'attack' });
    assert.equal(t.hp, 5);
  });
});

describe('D05 加血 / 回血', () => {
  it('回血不突破上限', () => {
    const c = healByRestoring(unit({ hp: 4, maxHp: 5 }), 10);
    assert.equal(c.hp, 5);
    assert.equal(c.maxHp, 5);
  });

  it('加血超过上限时把上限抬到当前血量', () => {
    const c = healByAdding(unit({ hp: 4, maxHp: 5 }), 4);
    assert.equal(c.hp, 8);
    assert.equal(c.maxHp, 8);
  });

  it('加血不改变原始上限（救援仍按战斗初始值减半）', () => {
    const c = healByAdding(unit({ hp: 4, maxHp: 5, initialMaxHp: 5 }), 5);
    assert.equal(c.maxHp, 9);
    assert.equal(c.initialMaxHp, 5);
    assert.equal(rescuedMaxHp(c), 3); // ceil(5/2)
  });
});

describe('D02 救援上限', () => {
  it('初始上限减半向上取整', () => {
    assert.equal(rescuedMaxHp(unit({ initialMaxHp: 5 })), 3);
    assert.equal(rescuedMaxHp(unit({ initialMaxHp: 4 })), 2);
    assert.equal(rescuedMaxHp(unit({ initialMaxHp: 1 })), 1);
  });
});
