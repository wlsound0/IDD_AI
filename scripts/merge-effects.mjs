// 合并 temp/p5-batches/b*.out.json → data/effects.json，并按 data/*.json 校正 id/name/cost。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const characters = JSON.parse(readFileSync('data/characters.json', 'utf8'));
const items = JSON.parse(readFileSync('data/items.json', 'utf8'));
const chars = Array.isArray(characters) ? characters : characters.characters;
const itemList = Array.isArray(items) ? items : items.items;

const skillNameById = new Map();
for (const c of chars) for (const s of c.skills) skillNameById.set(`${c.id}/${s.name}`, { char: c.name, name: s.name, type: s.type });
const itemById = new Map(itemList.map((i) => [i.id, i]));

const skills = [];
const itemEffects = [];
for (const f of readdirSync('temp/p5-batches').filter((n) => n.endsWith('.out.json')).sort()) {
  const data = JSON.parse(readFileSync(`temp/p5-batches/${f}`, 'utf8'));
  for (const s of data.skills ?? []) {
    const meta = skillNameById.get(s.id);
    if (!meta) throw new Error(`未知技能 id：${s.id}（来自 ${f}）`);
    // Q40：唯一 unknown 已改 passive。
    const type = meta.type === 'unknown' ? 'passive' : meta.type;
    skills.push({ ...s, character: meta.char, name: meta.name, type });
  }
  for (const it of data.items ?? []) {
    const meta = itemById.get(it.id);
    if (!meta) throw new Error(`未知道具 id：${it.id}（来自 ${f}）`);
    itemEffects.push({ ...it, name: meta.name, cost: meta.cost, timing: meta.timing, originalText: meta.text });
  }
}

skills.sort((a, b) => a.id.localeCompare(b.id));
itemEffects.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync('data/effects.json', JSON.stringify({ version: 1, skills, items: itemEffects }, null, 2) + '\n', 'utf8');
console.log('skills', skills.length, 'items', itemEffects.length);
const impl = {};
for (const s of skills) impl[s.impl] = (impl[s.impl] || 0) + 1;
console.log('impl', JSON.stringify(impl));
