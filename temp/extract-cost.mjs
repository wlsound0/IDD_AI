// 一次性脚本：把 temp/extract/角色.md 的「花费：Nk」写进 data/characters.json 的 cost 字段。
// 用法：node temp/extract-cost.mjs
// 只处理 data/characters.json，不动 temp/data/（旧抽取产物）。
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...xs) => join(ROOT, ...xs);

const md = readFileSync(p('temp', 'extract', '角色.md'), 'utf8').split(/\r?\n/);
const costs = new Map(); // name -> k 数值
let current = null;
for (const line of md) {
  const h = line.match(/^##\s+(.+?)\s*$/);
  if (h) { current = h[1]; continue; }
  const c = line.match(/^-\s*花费：\s*(\d+)\s*k/i);
  if (c && current) {
    if (costs.has(current)) throw new Error('重复角色名：' + current);
    costs.set(current, Number(c[1]));
  }
}

const json = JSON.parse(readFileSync(p('data', 'characters.json'), 'utf8'));
const chars = json.characters;
const missing = [];
const rows = [];
for (const ch of chars) {
  const k = costs.get(ch.name);
  if (k === undefined) { missing.push(ch.name); continue; }
  ch.cost = k * 1000;
  rows.push(`${ch.name}\t${k}k\t${ch.rarity}`);
}
if (missing.length) {
  console.error('FAIL 未在角色.md 找到花费：' + missing.join('、'));
  process.exit(1);
}
const bad = chars.filter((c) => !(Number.isFinite(c.cost) && c.cost >= 1000 && c.cost <= 5000));
if (bad.length) {
  console.error('FAIL 花费越界：' + bad.map((c) => c.name + '=' + c.cost).join('、'));
  process.exit(1);
}
writeFileSync(p('data', 'characters.json'), JSON.stringify(json, null, 2) + '\n', 'utf8');
console.log(`PASS ${chars.length} 个角色已写入 cost`);
for (const r of rows) console.log('  ' + r);
