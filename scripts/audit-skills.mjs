// P5 审计：把 111 个技能 + 15 件道具按「有明确数值效果 / 需裁决 / 纯风味」分类。
// 只读 data/*.json，产出 temp/p5-skill-audit.md 与终端聚合。不修改 core。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const characters = JSON.parse(readFileSync('data/characters.json', 'utf8'));
const items = JSON.parse(readFileSync('data/items.json', 'utf8'));
const chars = Array.isArray(characters) ? characters : characters.characters;
const itemList = Array.isArray(items) ? items : items.items;

// 效果词表：命中即视为「有机制」
const TAGS = [
  ['dmg', /造成\s*\d*\s*点?伤害|受到.*伤害|\d+\s*点伤害/],
  ['tmpHp', /临时血量|临时生命/],
  ['heal', /回复.{0,4}血量|恢复.{0,4}血量|回血|加.{0,3}点血量/],
  ['atkUp', /攻击力\s*\+\s*\d|攻击力提高|攻击力\s*加/],
  ['atkDown', /攻击力\s*-\s*\d|攻击力降低|攻击力\s*减/],
  ['dmgReduce', /伤害\s*-\s*\d|伤害减|减半|减一|减伤/],
  ['seal', /封印|无法使用技能|封其技能/],
  ['invuln', /无敌/],
  ['immune', /免疫/],
  ['rescue', /救援|濒死|复活/],
  ['summon', /召唤|上场|放置/],
  ['extraAttack', /再次攻击|额外攻击|多攻击一次/],
  ['cd', /CD\s*[:：]|冷却/],
  ['charge', /充能/],
  ['item', /道具|获得一个|指定道具/],
  ['choice', /选择[:：]|或者|要么/],
  ['duration', /持续|回合内|直至|直到|结束/],
];
const MECH_VERB = /使|令|获得|失去|不能|可以|无法|立即|每个|每名|所有|任意|若|当/;

function classify(text) {
  const t = String(text || '');
  const tags = TAGS.filter(([, re]) => re.test(t)).map(([k]) => k);
  const hasNum = /\d/.test(t);
  const hasVerb = MECH_VERB.test(t);
  let kind;
  if (hasNum || tags.length >= 1) kind = 'mechanical';
  else if (hasVerb) kind = 'needsRuling';
  else kind = 'flavor';
  // 风味句里出现「使/令」但没有数值与效果词的，归 needsRuling 供人工过目
  return { kind, tags, hasNum };
}

const rows = [];
for (const c of chars) {
  for (const s of c.skills) {
    const r = classify(s.text);
    rows.push({
      owner: c.name,
      ownerId: c.id,
      skill: s.name,
      type: s.type,
      ...r,
      text: s.text,
    });
  }
}
const itemRows = itemList.map((i) => ({ ...classify(i.text), item: i.name, cost: i.cost, timing: i.timing, text: i.text }));

const cnt = (arr) =>
  arr.reduce((acc, r) => ((acc[r.kind] = (acc[r.kind] || 0) + 1), acc), {});
const byType = {};
for (const r of rows) {
  byType[r.type] ??= { mechanical: 0, needsRuling: 0, flavor: 0 };
  byType[r.type][r.kind]++;
}
const tagCount = {};
for (const r of rows) for (const t of r.tags) tagCount[t] = (tagCount[t] || 0) + 1;

const md = [];
md.push('# P5 技能/道具审计（自动生成，勿手改）');
md.push('');
md.push(`- 技能总数：**${rows.length}**；道具总数：**${itemRows.length}**`);
md.push(`- 技能分类：${JSON.stringify(cnt(rows))}`);
md.push(`- 道具分类：${JSON.stringify(cnt(itemRows))}`);
md.push('');
md.push('## 按技能类型 × 分类');
md.push('');
md.push('| type | mechanical | needsRuling | flavor | 合计 |');
md.push('|---|---:|---:|---:|---:|');
for (const [k, v] of Object.entries(byType)) {
  md.push(`| ${k} | ${v.mechanical} | ${v.needsRuling} | ${v.flavor} | ${v.mechanical + v.needsRuling + v.flavor} |`);
}
md.push('');
md.push('## 效果标签频次（一个技能可多标签）');
md.push('');
md.push(Object.entries(tagCount).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join('、'));
md.push('');
md.push('## 逐条明细');
md.push('');
md.push('| # | 角色 | 技能 | type | 分类 | 标签 |');
md.push('|---:|---|---|---|---|---|');
rows.forEach((r, i) => {
  md.push(`| ${i + 1} | ${r.owner} | ${r.skill} | ${r.type} | ${r.kind} | ${r.tags.join(',')} |`);
});
md.push('');
md.push('## 道具明细');
md.push('');
md.push('| # | 道具 | 花费 | 分类 | 标签 |');
md.push('|---:|---|---:|---|---|');
itemRows.forEach((r, i) => {
  md.push(`| ${i + 1} | ${r.item} | ${r.cost} | ${r.kind} | ${r.tags.join(',')} |`);
});

mkdirSync('temp', { recursive: true });
writeFileSync('temp/p5-skill-audit.md', md.join('\n') + '\n', 'utf8');

// 终端只输出聚合，不贴原文
console.log('skills', rows.length, 'items', itemRows.length);
console.log('skills.class', JSON.stringify(cnt(rows)));
console.log('items.class', JSON.stringify(cnt(itemRows)));
console.log('byType', JSON.stringify(byType));
console.log('tags', JSON.stringify(tagCount));
const nonMech = rows.filter((r) => r.kind !== 'mechanical');
console.log('nonMechanical', nonMech.length);
