// 把 43 个角色按 6 批切给子智能体做效果规格（只写 temp/p5-batches/，不碰 data/）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const characters = JSON.parse(readFileSync('data/characters.json', 'utf8'));
const items = JSON.parse(readFileSync('data/items.json', 'utf8'));
const chars = Array.isArray(characters) ? characters : characters.characters;
const itemList = Array.isArray(items) ? items : items.items;

mkdirSync('temp/p5-batches', { recursive: true });

const BATCHES = 6;
const per = Math.ceil(chars.length / BATCHES);
const index = [];
for (let b = 0; b < BATCHES; b++) {
  const slice = chars.slice(b * per, (b + 1) * per);
  const payload = {
    batch: b + 1,
    characters: slice.map((c) => ({
      id: c.id,
      name: c.name,
      rarity: c.rarity,
      atk: c.atk,
      hp: c.hp,
      cost: c.cost,
      skills: c.skills.map((s, i) => ({
        id: `${c.id}/${s.name}`,
        name: s.name,
        type: s.type,
        text: s.text,
        cd: s.cd,
        initialCd: s.initialCd,
        durability: s.durability,
        cost: s.cost,
      })),
    })),
  };
  writeFileSync(`temp/p5-batches/b${b + 1}.json`, JSON.stringify(payload, null, 2), 'utf8');
  index.push({ batch: b + 1, chars: slice.map((c) => c.name), skills: payload.characters.reduce((n, c) => n + c.skills.length, 0) });
}

// 道具单独一批（b0）
writeFileSync(
  'temp/p5-batches/b0.json',
  JSON.stringify({ batch: 0, items: itemList }, null, 2),
  'utf8',
);

writeFileSync('temp/p5-batches/index.json', JSON.stringify(index, null, 2), 'utf8');
console.log(index.map((x) => `b${x.batch}: ${x.skills}技能 ${x.chars.length}角色`).join(' | '));
console.log('items', itemList.length);
