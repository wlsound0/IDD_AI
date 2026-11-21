// 校验 data/effects.json：id 对齐、类型对齐、op 白名单、ref/duration 合法，并输出覆盖率。
import { readFileSync } from 'node:fs';

const characters = JSON.parse(readFileSync('data/characters.json', 'utf8'));
const items = JSON.parse(readFileSync('data/items.json', 'utf8'));
const effects = JSON.parse(readFileSync('data/effects.json', 'utf8'));
const chars = Array.isArray(characters) ? characters : characters.characters;
const itemList = Array.isArray(items) ? items : items.items;

const OPS = new Set([
  'modStat', 'modStatPer', 'setStat', 'heal', 'damage', 'tempHp', 'shield', 'damageReduce', 'damageMultiplier',
  'immune', 'invulnerable', 'untargetable', 'sealSkills', 'extraAttack', 'grantItem', 'itemDiscount', 'itemLock',
  'summon', 'cdDelta', 'chargeDelta', 'swapStat', 'swapPosition', 'transferDamage', 'deferDamage',
  // P7 D：隐喻换回
  'swapBack',
  'revive', 'mark', 'flag', 'restrictAttack', 'selfRescue', 'rescueRule', 'copyAtk', 'custom',
  // P5 收尾新增
  'grantRescue', 'reflectMod',
  // P5-16
  'defer', 'liberate',
  // P5 第一轮收尾
  'grantDestroySummon',
  // P5-16⑥ 零碎
  'grantTransferMark', 'grantRescueFlyer', 'atkPenaltyOnCd',
  // P5-28
  'triggerFlyer',
  // P6 C 块
  'damageToMark', 'drainMarks', 'holdDying', 'deferredRescue', 'rescueHeld',
  // P7 E：直接扣本体血 / 附身状态机
  'loseHp', 'possession',
  // P7-2 X5：魔术棒打断窗口的伤害折算
  'interruptDamage',
]);
const TRIGGERS = new Set([
  'manual', 'battlecry', 'turnStart', 'turnEnd', 'ownTurnStart', 'ownTurnEnd', 'enemyTurnStart',
  'enemyTurnEnd', 'beforeDamage', 'afterDamage', 'afterAttack', 'attacked', 'damaged', 'lethalDamage',
  'selfDeath', 'allyDeath', 'enemyDeath', 'enteringDying', 'rescue', 'rescued', 'summonDeath', 'always',
  // P7 C：使用道具后
  'itemUse',
]);
const DURATIONS = new Set([
  'instant', 'untilOwnTurnStart', 'untilOwnTurnEnd', 'untilNextOwnTurnStart', 'untilEnemyTurnStart', 'nextAttack',
  'untilTurnEnd', 'untilBigRoundEnd', 'whileSourceAlive', 'permanent',
  'untilNextOwnTurnEnd', 'untilNextAllyTurnEnd', 'untilNextEnemyTurnEnd',
]);
const REFS = new Set(['self', 'target', 'attacker', 'victim', 'allAllies', 'allEnemies', 'owner', 'selfAndTarget']);
const IMPL = new Set(['full', 'partial', 'none']);
const TYPES = new Set(['battlecry', 'charge', 'cooldown', 'active', 'passive']);
const TARGET_MODES = new Set(['self', 'none', 'anyUnit', 'allyUnit', 'enemyUnit', 'otherAlly', 'anyCharacter']);

function durationOk(d) {
  return DURATIONS.has(d) || /^turns:\d+$/.test(d);
}

const errors = [];
const warnings = [];
const okIds = new Set();

const expectedSkills = new Set();
for (const c of chars) for (const s of c.skills) expectedSkills.add(`${c.id}/${s.name}`);
const expectedItems = new Set(itemList.map((i) => i.id));

// 预取角色/技能原始信息
const skillMeta = new Map();
for (const c of chars) for (const s of c.skills) skillMeta.set(`${c.id}/${s.name}`, { char: c, skill: s });

function checkRefs(entry, ops) {
  ops.forEach((o, i) => {
    const where = `${entry.id} ops[${i}] ${o.op}`;
    if (!OPS.has(o.op)) errors.push(`${where}: 未知 op`);
    for (const k of ['ref', 'refA', 'refB', 'from', 'to']) {
      if (k in o && !REFS.has(o[k])) errors.push(`${where}: 非法 ${k}=${o[k]}`);
    }
    if (o.op === 'custom' && entry.impl === 'full') errors.push(`${where}: 有 custom 却标 impl=full`);
    if (o.op === 'modStat' && !['atk', 'hp', 'maxHp', 'dmgDealt', 'dmgTaken'].includes(o.stat)) errors.push(`${where}: 非法 stat=${o.stat}`);
    if (o.op === 'flag' && !o.key) errors.push(`${where}: flag 缺 key`);
    if (o.op === 'grantItem' && !expectedItems.has(o.item) && o.item !== undefined) warnings.push(`${where}: 未知道具 ${o.item}`);
    // P7-2 X6：一次性状态只能声明在这两个时机清除。
    if (o.consumedOn !== undefined && !['attack', 'attacked'].includes(o.consumedOn)) errors.push(`${where}: 非法 consumedOn=${o.consumedOn}`);
  });
}

// P5-15：技能分支与技能级 ops 用同一套校验；P7-2 X6 起道具也可以有抉择分支。
function checkBranches(entry, branches) {
  for (const b of branches ?? []) {
    if (!b || typeof b.label !== 'string' || !b.label) { errors.push(`${entry.id}: 分支缺 label`); continue; }
    if (!Array.isArray(b.ops)) { errors.push(`${entry.id}/${b.label}: 分支 ops 必须是数组`); continue; }
    if (b.target && !TARGET_MODES.has(b.target.mode)) errors.push(`${entry.id}/${b.label}: 非法 target.mode=${b.target.mode}`);
    if (b.duration && !durationOk(b.duration)) errors.push(`${entry.id}/${b.label}: 非法 duration=${b.duration}`);
    if (b.durability !== undefined && !(typeof b.durability === 'number' && b.durability > 0)) errors.push(`${entry.id}/${b.label}: 非法 durability=${b.durability}`);
    // P7 D：分支级 k 花费与每局次数上限。
    if (b.kCost !== undefined && !(typeof b.kCost === 'number' && b.kCost > 0)) errors.push(`${entry.id}/${b.label}: 非法 kCost=${b.kCost}`);
    if (b.uses !== undefined && !(Number.isInteger(b.uses) && b.uses > 0)) errors.push(`${entry.id}/${b.label}: 非法 uses=${b.uses}`);
    checkRefs({ ...entry, id: `${entry.id}/${b.label}` }, b.ops);
  }
}

for (const e of effects.skills ?? []) {
  const meta = skillMeta.get(e.id);
  if (!meta) { errors.push(`skills: 未知技能 id ${e.id}`); continue; }
  okIds.add(e.id);
  if (e.character !== meta.char.name) errors.push(`${e.id}: character 应为 ${meta.char.name}`);
  if (e.name !== meta.skill.name) errors.push(`${e.id}: name 不一致`);
  if (!TYPES.has(e.type)) errors.push(`${e.id}: 非法 type=${e.type}`);
  if (!IMPL.has(e.impl)) errors.push(`${e.id}: 非法 impl=${e.impl}`);
  if (!TRIGGERS.has(e.trigger)) errors.push(`${e.id}: 非法 trigger=${e.trigger}`);
  if (e.duration && !durationOk(e.duration)) errors.push(`${e.id}: 非法 duration=${e.duration}`);
  // P7 E2：时长随使用次数变化（首次/之后）。
  if (e.durationByUse) {
    for (const k of ['first', 'later']) {
      const d = e.durationByUse[k];
      if (!d || !durationOk(d)) errors.push(`${e.id}: 非法 durationByUse.${k}=${d}`);
    }
  }
  if (e.target && !TARGET_MODES.has(e.target.mode)) errors.push(`${e.id}: 非法 target.mode=${e.target.mode}`);
  if (!Array.isArray(e.ops)) errors.push(`${e.id}: ops 必须是数组`);
  else if (e.impl !== 'none' && e.ops.length === 0 && !e.manual) warnings.push(`${e.id}: 无 ops 但 impl=${e.impl}`);
  checkRefs(e, e.ops ?? []);
  // P5-26：与手动效果同条目的「战吼部分」同样校验。
  if (e.battlecryOps !== undefined) {
    if (!Array.isArray(e.battlecryOps)) errors.push(`${e.id}: battlecryOps 必须是数组`);
    else checkRefs({ ...e, id: `${e.id}#battlecry` }, e.battlecryOps);
  }
  // P7 C：同一条目里的「攻击后部分」同样校验。
  if (e.afterAttackOps !== undefined) {
    if (!Array.isArray(e.afterAttackOps)) errors.push(`${e.id}: afterAttackOps 必须是数组`);
    else checkRefs({ ...e, id: `${e.id}#afterAttack` }, e.afterAttackOps);
  }
  // P7 E2：额外触发时机（parts）与主效果同一套校验。
  if (e.parts !== undefined) {
    if (!Array.isArray(e.parts)) errors.push(`${e.id}: parts 必须是数组`);
    else {
      e.parts.forEach((p, i) => {
        const where = `${e.id}#part${i}`;
        if (!p || typeof p !== 'object') { errors.push(`${where}: 必须是对象`); return; }
        if (!TRIGGERS.has(p.trigger)) errors.push(`${where}: 非法 trigger=${p.trigger}`);
        if (p.duration && !durationOk(p.duration)) errors.push(`${where}: 非法 duration=${p.duration}`);
        if (p.target && !TARGET_MODES.has(p.target.mode)) errors.push(`${where}: 非法 target.mode=${p.target.mode}`);
        if (!Array.isArray(p.ops)) errors.push(`${where}: ops 必须是数组`);
        else checkRefs({ ...e, id: where }, p.ops);
      });
    }
  }
  // P5-15：分支与技能级 ops 用同一套校验。
  checkBranches(e, e.branches);
  if (e.impl === 'none' && (e.ops ?? []).some((o) => o.op !== 'custom')) errors.push(`${e.id}: impl=none 不应有实际 op`);
}

for (const e of effects.items ?? []) {
  const meta = itemList.find((i) => i.id === e.id);
  if (!meta) { errors.push(`items: 未知道具 id ${e.id}`); continue; }
  okIds.add(e.id);
  if (!IMPL.has(e.impl)) errors.push(`${e.id}: 非法 impl=${e.impl}`);
  if (!TRIGGERS.has(e.trigger)) errors.push(`${e.id}: 非法 trigger=${e.trigger}`);
  if (e.duration && !durationOk(e.duration)) errors.push(`${e.id}: 非法 duration=${e.duration}`);
  if (!Array.isArray(e.ops)) errors.push(`${e.id}: ops 必须是数组`);
  else {
    checkRefs(e, e.ops);
    if (e.impl !== 'none' && e.ops.length === 0 && !(e.branches ?? []).length) warnings.push(`${e.id}: 无 ops 也无分支但 impl=${e.impl}`);
  }
  if (e.branches !== undefined) {
    if (!Array.isArray(e.branches)) errors.push(`${e.id}: branches 必须是数组`);
    else checkBranches(e, e.branches);
  }
}

for (const id of expectedSkills) if (!okIds.has(id)) warnings.push(`缺技能规格：${id}`);
for (const id of expectedItems) if (!okIds.has(id)) warnings.push(`缺道具规格：${id}`);

const implCount = {};
for (const e of effects.skills ?? []) implCount[e.impl] = (implCount[e.impl] || 0) + 1;
const opCount = {};
for (const e of [...(effects.skills ?? []), ...(effects.items ?? [])]) {
  const allOps = [...(e.ops ?? []), ...((e.branches ?? []).flatMap((b) => b.ops ?? []))];
  for (const o of allOps) opCount[o.op] = (opCount[o.op] || 0) + 1;
}

console.log('skills', (effects.skills ?? []).length, '/', expectedSkills.size, 'items', (effects.items ?? []).length, '/', expectedItems.size);
console.log('impl', JSON.stringify(implCount));
console.log('ops', JSON.stringify(Object.fromEntries(Object.entries(opCount).sort((a, b) => b[1] - a[1]))));
if (warnings.length) console.log('WARN(' + warnings.length + '):\n' + warnings.slice(0, 40).join('\n'));
if (errors.length) {
  console.log('FAIL(' + errors.length + '):\n' + errors.slice(0, 60).join('\n'));
  process.exit(1);
}
console.log('PASS');
