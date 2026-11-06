// P0 断言：抽取产物是否齐备且结构合法。用法： node temp/check-extract.mjs
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('./', import.meta.url);
const p = (f) => new URL(f, root);
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

const md = ['extract/机制.md', 'extract/场地.md', 'extract/道具.md', 'extract/QA.md', 'extract/BP.md', 'extract/角色.md'];
for (const f of md) {
  const exists = existsSync(p(f));
  ok(exists, `存在 ${f}`);
  if (exists) {
    const t = readFileSync(p(f), 'utf8');
    ok(t.length > 200, `非空 ${f} (${t.length} 字符)`);
  }
}
for (const f of ['open-questions.md', 'plan.md']) ok(existsSync(p(f)), `存在 ${f}`);

for (const f of ['data/items.json', 'data/characters.json']) {
  if (!existsSync(p(f))) { ok(false, `存在 ${f}`); continue; }
  try {
    const d = JSON.parse(readFileSync(p(f), 'utf8'));
    const arr = d.items || d.characters || [];
    ok(Array.isArray(arr) && arr.length > 0, `${f} 合法且非空 (${arr.length} 条)`);
    const noText = arr.filter((x) => !x.text && !(x.skills || []).every((s) => s.text));
    ok(noText.length === 0, `${f} 描述字段齐全`);
    const ids = arr.map((x) => x.id);
    ok(new Set(ids).size === ids.length, `${f} id 唯一`);
  } catch (e) {
    ok(false, `${f} 解析失败: ${e.message}`);
  }
}

const qa = existsSync(p('extract/QA.md')) ? readFileSync(p('extract/QA.md'), 'utf8') : '';
const qaCount = (qa.match(/^QA-\d+/gm) || []).length;
ok(qaCount >= 40, `QA 条目数 ${qaCount}`);

const mech = existsSync(p('extract/机制.md')) ? readFileSync(p('extract/机制.md'), 'utf8') : '';
const ruleCount = (mech.match(/^\| R\d+/gm) || []).length;
ok(ruleCount >= 26, `机制条款数 ${ruleCount}`);

console.log(fail === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
