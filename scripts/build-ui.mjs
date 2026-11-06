// 生成可直接双击打开的界面产物：temp/build/ui/
// 只做文件复制与拼接，不调用任何子进程（本机沙箱禁止 spawn）。
// 用法：npm run ui:build（内部先跑 tsc -p tsconfig.ui.json，再执行本脚本）
import { readFileSync, mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'temp', 'build', 'ui');
const p = (...xs) => join(ROOT, ...xs);
const q = (...xs) => join(OUT, ...xs);

const problems = [];
const requireFile = (path, label) => {
  if (!existsSync(path)) problems.push(`缺少 ${label}：${path}`);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};

mkdirSync(OUT, { recursive: true });
mkdirSync(q('vendor'), { recursive: true });

// 1) core 的 AMD 单文件（tsc 产物）
const coreSrc = requireFile(p('temp', 'build', 'ui', 'core.raw.js'), 'tsc AMD 产物');
if (coreSrc && !coreSrc.includes('define("game"')) problems.push('core.raw.js 里没有 define("game")，AMD 打包失败');
writeFileSync(q('core.js'), coreSrc, 'utf8');

// 2) 内联数据：file:// 下 fetch 会被 CORS 拦，所以把 JSON 变成普通脚本
const chars = JSON.parse(requireFile(p('data', 'characters.json'), 'characters.json') || '{"characters":[]}');
const items = JSON.parse(requireFile(p('data', 'items.json'), 'items.json') || '{"items":[]}');
const payload = { characters: chars.characters ?? [], items: items.items ?? [] };
writeFileSync(q('data.js'), 'window.IDD_DATA = ' + JSON.stringify(payload) + ';\n', 'utf8');

// 3) 静态文件
for (const f of ['index.html', 'style.css', 'app.js']) {
  const src = requireFile(p('ui', f), f);
  if (src) writeFileSync(q(f), src, 'utf8');
}
const amd = requireFile(p('ui', 'vendor', 'amd.js'), 'ui/vendor/amd.js');
if (amd) writeFileSync(q('vendor', 'amd.js'), amd, 'utf8');

// 4) React 本地副本（UMD，浏览器直接可用）
const reactSrc = p('node_modules', 'react', 'umd', 'react.production.min.js');
const reactDomSrc = p('node_modules', 'react-dom', 'umd', 'react-dom.production.min.js');
if (existsSync(reactSrc) && existsSync(reactDomSrc)) {
  copyFileSync(reactSrc, q('vendor', 'react.js'));
  copyFileSync(reactDomSrc, q('vendor', 'react-dom.js'));
} else {
  problems.push('node_modules 里找不到 React UMD 副本');
}

// 5) 断言
if ((payload.characters ?? []).length < 40) problems.push(`角色数据只有 ${payload.characters.length} 条，疑似抽取缺失`);
if ((payload.items ?? []).length < 14) problems.push(`道具数据只有 ${payload.items.length} 条，疑似抽取缺失`);
if (!coreSrc.includes('legalAttackTargets')) problems.push('core.js 里没有 legalAttackTargets，界面无法限制攻击目标');
if (!readFileSync(q('app.js'), 'utf8').includes('window.IDDApp')) problems.push('app.js 未导出 window.IDDApp');

if (problems.length) {
  console.error('FAIL\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`PASS 界面产物：${OUT}`);
console.log(`  角色 ${payload.characters.length} 条，道具 ${payload.items.length} 件`);
console.log('  打开方式：双击 temp/build/ui/index.html');
