// 生成 P5 覆盖率报告：每类 op 被用了几次、哪些技能含未实装 custom、哪些是纯风味。
import { readFileSync, writeFileSync } from 'node:fs';

const fx = JSON.parse(readFileSync('data/effects.json', 'utf8'));
const chars = JSON.parse(readFileSync('data/characters.json', 'utf8')).characters;

const impl = { full: 0, partial: 0, none: 0 };
const customBySkill = [];
const opCount = {};
for (const s of fx.skills) {
  impl[s.impl] += 1;
  // P5-15：分支里的 op 与技能级 ops 同等计入。
  const allOps = [
    ...(s.ops ?? []),
    ...(s.battlecryOps ?? []),
    ...(s.afterAttackOps ?? []),
    ...(s.parts ?? []).flatMap((p) => p.ops ?? []),
    ...(s.branches ?? []).flatMap((b) => b.ops ?? []),
  ];
  const customs = allOps.filter((o) => o.op === 'custom');
  if (customs.length) customBySkill.push({ id: s.id, keys: customs.map((c) => c.key ?? 'custom') });
  for (const o of allOps) opCount[o.op] = (opCount[o.op] || 0) + 1;
}
const itemImpl = { full: 0, partial: 0 };
for (const i of fx.items) itemImpl[i.impl] += 1;
for (const i of fx.items) for (const o of [...(i.ops ?? []), ...(i.branches ?? []).flatMap((b) => b.ops ?? [])]) opCount[o.op] = (opCount[o.op] || 0) + 1;

const md = [];
md.push('# P5 覆盖率报告（自动生成）');
md.push('');
md.push(`- 技能：**${fx.skills.length}**（full ${impl.full} / partial ${impl.partial} / none ${impl.none}）`);
md.push(`- 道具：**${fx.items.length}**（full ${itemImpl.full} / partial ${itemImpl.partial}）`);
md.push(`- 引擎已实现的原子操作被引用次数：`);
md.push('');
md.push(
  Object.entries(opCount)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n}`)
    .join('、'),
);
md.push('');
md.push('## 含 custom（未实装分支）的技能');
md.push('');
md.push('| 技能 id | custom 键 |');
md.push('|---|---|');
for (const s of customBySkill) md.push(`| ${s.id} | ${s.keys.join(', ')} |`);
md.push('');
md.push('## 纯风味（impl=none，无机制）');
md.push('');
for (const s of fx.skills.filter((x) => x.impl === 'none')) md.push(`- ${s.character}「${s.name}」`);
md.push('');
md.push('## 说明');
md.push('');
md.push('- `custom` 只表示「原文有内容但引擎暂未覆盖的分支」，数值与目标已在数据里如实记录，未被静默丢弃。');
md.push('- 判定口径见 `temp/p5-effect-spec.md`；数据改动走 `scripts/merge-effects.mjs` + `scripts/validate-effects.mjs`。');

writeFileSync('temp/p5-coverage.md', md.join('\n') + '\n', 'utf8');
console.log('full', impl.full, 'partial', impl.partial, 'none', impl.none, '| custom 技能数', customBySkill.length);
