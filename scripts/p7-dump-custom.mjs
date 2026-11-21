// P7 侦察：导出含 custom 的技能条目（紧凑格式），供人工裁决。
import { readFileSync, writeFileSync } from 'node:fs';

const eff = JSON.parse(readFileSync('data/effects.json', 'utf8'));
const chars = JSON.parse(readFileSync('data/characters.json', 'utf8'));
const skills = new Map();
const walk = (o) => {
  if (Array.isArray(o)) return o.forEach(walk);
  if (o && typeof o === 'object') {
    if (o.id && Array.isArray(o.skills)) for (const s of o.skills) skills.set(`${o.id}/${s.name}`, s);
    Object.values(o).forEach(walk);
  }
};
walk(chars);

const lines = [];
for (const e of eff.skills ?? eff) {
  const has = JSON.stringify(e).includes('"custom"');
  if (!has) continue;
  const s = skills.get(e.id) ?? {};
  lines.push(`### ${e.id}`);
  lines.push(`impl=${e.impl} trigger=${e.trigger ?? '-'} target=${JSON.stringify(e.target ?? s.target ?? null)} dur=${e.duration ?? '-'} type=${e.type ?? '-'}`);
  lines.push(`cfg: ${JSON.stringify({ cost: s.cost, cd: s.cd, text: s.text ?? s.desc })}`);
  lines.push(`ops: ${JSON.stringify(e.ops)}`);
  if (e.battlecryOps) lines.push(`cry: ${JSON.stringify(e.battlecryOps)}`);
  if (e.notes) lines.push(`notes: ${e.notes}`);
  lines.push('');
}
writeFileSync('temp/p7-custom-dump.md', lines.join('\n'), 'utf8');
console.log('skills with custom:', lines.filter((l) => l.startsWith('### ')).length, 'bytes', lines.join('\n').length);
