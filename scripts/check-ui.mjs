// 界面冒烟测试：在 Node 里把 app.js 当普通脚本跑一遍，用 renderToString 出 HTML 做断言。
// 这样不用浏览器也能证明“数据能渲染、内核能接上、点得动的那几个入口没写错”。
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import React from 'react';
import ReactDOMServer from 'react-dom/server';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...xs) => join(ROOT, ...xs);
const h = React.createElement;

const ctx = { console, React, window: null, globalThis: null };
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);

const load = (path) => {
  if (!existsSync(path)) throw new Error('缺少文件：' + path);
  vm.runInContext(readFileSync(path, 'utf8'), ctx, { filename: path });
};

load(p('ui', 'vendor', 'amd.js'));
load(p('temp', 'build', 'ui', 'core.raw.js'));

const chars = JSON.parse(readFileSync(p('data', 'characters.json'), 'utf8')).characters;
const items = JSON.parse(readFileSync(p('data', 'items.json'), 'utf8')).items;
ctx.IDD_DATA = { characters: chars, items };
load(p('ui', 'app.js'));

const app = ctx.IDDApp;
const render = (el) => ReactDOMServer.renderToString(el);
const problems = [];
const expect = (cond, msg) => { if (!cond) problems.push(msg); };
const noop = () => {};

// 1) 首屏：选赛制
let html = render(h(app.App));
expect(html.includes('选择赛制'), '首屏缺少「选择赛制」');
for (const label of ['一局一胜', '三局两胜', '五局三胜']) {
  expect(html.includes(label), '首屏缺少赛制入口：' + label);
}
expect(html.includes('道具栏') === false, '首屏不应出现战斗区');

// 1b) BP 面板：用真实内核状态渲染
const bp = ctx.require(['bp']);
const catalog = chars.map((c) => ({ id: c.id, name: c.name, rarity: c.rarity, cost: c.cost }));
let series = bp.createSeries('bo3');
html = render(h(app.BpScreen, { series, error: null, onAct: noop, onEndStep: noop, onResign: noop }));
expect(html.includes('第一次 BAN'), 'BP 面板缺少「第一次 BAN」');
expect(html.includes('第二次 BAN'), 'BP 面板缺少「第二次 BAN」');
expect(html.includes('玩家1'), 'BP 面板缺少玩家1');
expect(html.includes('预算'), 'BP 面板缺少预算显示');
expect(html.includes('可选角色'), 'BP 面板缺少角色网格');
expect(html.includes('全局 BAN'), 'BP 面板缺少全局 BAN 区');
expect(html.includes('投降'), 'BP 面板缺少投降入口');

// 1c) 只按内核给出的合法项走完 BP，再渲染站位确认页
{
  let st = series.current;
  let guard = 0;
  while (!st.finished && guard++ < 120) {
    const ch = bp.legalBpChoices(st, catalog);
    if (!ch) break;
    // 每个中间状态都要能渲染（BAN/pick 两种阶段的卡片、当前行动方高亮）
    const midHtml = render(h(app.BpScreen, {
      series: Object.assign({}, series, { current: st }),
      error: null, onAct: noop, onEndStep: noop
    }));
    expect(midHtml.includes('可选角色'), 'BP 中间状态渲染失败（步 ' + st.stepIndex + '）');
    if (ch.chars.length === 0) { st = bp.applyBp(st, { type: 'endStep' }, catalog); continue; }
    st = bp.applyBp(st, { type: ch.action, charId: ch.chars[0].id }, catalog);
  }
  expect(st.finished, '按内核合法项未能走完 BP');
  series = Object.assign({}, series, { current: st });
  const order = { p1: st.players.p1.picks.slice(), p2: st.players.p2.picks.slice() };
  expect(order.p1.length >= 2 && order.p2.length >= 2, 'BP 结束后至少各 2 人');
  const lineHtml = render(h(app.LineupScreen, { series, order, onMove: noop, onStartGame: noop }));
  expect(lineHtml.includes('开始对局'), '站位确认页缺少「开始对局」');
  expect(lineHtml.includes('调整站位'), '站位确认页缺少站位提示');
}

// 2) 用真实内核造一局，再把对局界面渲染出来
const game = ctx.require(['game']);
const mk = (def, side, slot) => app.makeUnit(def, side, slot);
const first = chars.slice(0, 5).map((c, i) => mk(c, 'first', i + 1));
const second = chars.slice(5, 10).map((c, i) => mk(c, 'second', i + 1));
let state = game.createGame([...first, ...second]);
state = game.applyAction(state, { type: 'attack', attackerId: first[0].id, targetId: second[0].id }).state;
state = game.applyAction(state, { type: 'endTurn' }).state;

html = render(h(app.BattleScreen, {
  state, selected: first[1].id, rescueFor: null, error: null,
  onSelect: noop, onPickRescueTarget: noop, onRescue: noop, onEndTurn: noop, onRestart: noop
}));
expect(html.includes('事件日志'), '对局界面缺少事件日志');
expect(html.includes('第 1 大回合') || html.includes('第 2 大回合'), '对局界面未显示大回合');
expect(html.includes('可攻击目标'), '对局界面未显示可攻击目标提示');
expect(html.includes('攻击') && html.includes('剩'), '日志里没有攻击事件');
expect(html.includes(first[0].name), '对局界面没有渲染出角色名');
expect(html.includes(' · #'), '事件日志/角色标签里没有「玩家 · #站位号」');
expect(html.includes('投降'), '对局界面缺少投降入口');
expect(html.includes('targetable'), '选中攻击者后，敌人卡没有可攻击标记（点不动）');
expect(html.includes('反伤'), '角色卡没有显示反伤数值');
expect(html.includes('首回合：攻击 -1'), '首回合攻击 -1 没有提示');

// 2b) 投降：内核记事件，界面出确认条文案与胜方
{
  const resigned = game.applyAction(state, { type: 'resign', side: 'second' });
  expect(resigned.events[0].type === 'resign', '投降没有产生 resign 事件');
  expect(resigned.state.winner === 'first', '投降后胜方不对');
  const rHtml = render(h(app.BattleScreen, {
    state: resigned.state, selected: null, rescueFor: null, error: null, footer: null,
    playerNames: { first: '玩家1', second: '玩家2' },
    onSelect: noop, onPickRescueTarget: noop, onRescue: noop, onResign: noop, onEndTurn: noop, onRestart: noop
  }));
  expect(rHtml.includes('玩家2 投降'), '日志里没有「玩家2 投降」');
  expect(rHtml.includes('玩家1 胜'), '顶栏没有显示投降后的胜方');
}

// 2c) 冠军页：快速重开 + 返回首页
{
  const champSeries = Object.assign({}, series, { wins: { p1: 2, p2: 0 }, champion: 'p1' });
  const cHtml = render(h(app.ChampionScreen, { series: champSeries, onRestart: noop, onHome: noop }));
  expect(cHtml.includes('快速重开'), '冠军页缺少「快速重开」');
  expect(cHtml.includes('返回首页'), '冠军页缺少「返回首页」');
}

// 3) 只用界面暴露的三个动作（attack / rescue / endTurn）跑完一整局
// 挑攻击力高的角色组两队，保证这个“只攻击”的笨策略能分胜负；攻击策略本身照抄 scripts/play.mjs。
const strong = chars.filter((c) => (c.atk || 0) >= 2 && (c.hp || 1) >= 2).slice(0, 10);
{
  let s = game.createGame([
    ...strong.slice(0, 5).map((c, i) => mk(c, 'first', i + 1)),
    ...strong.slice(5, 10).map((c, i) => mk(c, 'second', i + 1))
  ]);
  let guard = 0;
  while (!s.winner && guard++ < 200) {
    // 有人濒死就先处理：这里一律「放弃救援」，等价于界面上点那个按钮。
    // 队列顺序由内核给出（同一次攻击下被攻击者在前）。
    if (s.dyingQueue.length > 0) {
      s = game.applyAction(s, { type: 'rescue', targetId: s.dyingQueue[0], rescuerId: null }).state;
      continue;
    }
    const side = s.clock.phase;
    for (const actor of s.units.filter((u) => u.side === side && !u.dead && u.hp > 0 && !u.attackedThisBigTurn)) {
      const targets = game.legalAttackTargets(s, actor.id).slice().sort((a, b) => a.hp - b.hp);
      if (!targets.length) continue;
      s = game.applyAction(s, { type: 'attack', attackerId: actor.id, targetId: targets[0].id }).state;
      if (s.winner || s.dyingQueue.length > 0) break; // 出现濒死就回外层先处理
    }
    if (s.winner) break;
    if (s.dyingQueue.length > 0) continue; // 下一轮先处理濒死
    s = game.applyAction(s, { type: 'endTurn' }).state;
  }
  expect(!!s.winner, '按界面可用动作无法打完一局（200 步内未分胜负）');
  const finalHtml = render(h(app.BattleScreen, {
    state: s, selected: null, rescueFor: null, error: null,
    onSelect: noop, onPickRescueTarget: noop, onRescue: noop, onEndTurn: noop, onRestart: noop
  }));
  expect(finalHtml.includes('胜'), '结算界面上没有显示胜方');
}

// 3b) 濒死面板：必须出现「放弃救援」，否则玩家无法按规则放弃救援
{
  // 高攻方打低血方，确保一两次攻击就能打到濒死；濒死者要有同阵营的救援者在场，否则内核直接判死。
  const hitter = chars.slice().sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
  const frail = chars.slice().sort((a, b) => (a.hp || 1) - (b.hp || 1))[0];
  const rescuer = chars.filter((c) => (c.skills || []).some((s) => s.name.indexOf('救援') >= 0))
    .sort((a, b) => (b.hp || 0) - (a.hp || 0))[0];
  let s = game.createGame([mk(hitter, 'first', 1), mk(frail, 'second', 1), mk(rescuer, 'second', 2)]);
  for (let i = 0; i < 8; i++) {
    if (s.units.some((u) => !u.dead && u.hp <= 0)) break;
    const attacker = s.units.find((u) => u.side === s.clock.phase && !u.dead && u.hp > 0 && !u.attackedThisBigTurn);
    if (!attacker) { s = game.applyAction(s, { type: 'endTurn' }).state; continue; }
    const t = game.legalAttackTargets(s, attacker.id)[0];
    if (!t) break;
    s = game.applyAction(s, { type: 'attack', attackerId: attacker.id, targetId: t.id }).state;
  }
  const dyingUnit = s.units.find((u) => !u.dead && u.hp <= 0);
  expect(!!dyingUnit, '测试前置失败：没能把某个单位打到濒死');
  if (dyingUnit) {
    const htmlDying = render(h(app.BattleScreen, {
      state: s, selected: null, rescueFor: dyingUnit.id, error: null,
      onSelect: noop, onPickRescueTarget: noop, onRescue: noop, onEndTurn: noop, onRestart: noop
    }));
    expect(htmlDying.includes('放弃救援'), '濒死面板缺少「放弃救援」按钮');
    expect(htmlDying.includes('必须先处理濒死：'), '濒死未处理时，顶栏没有「必须先处理」提示');
  }
}

// 4) 每个角色都能单独渲染（技能文本里含引号、换行也不会炸）
for (const c of chars) {
  const s = game.createGame([mk(c, 'first', 1), mk(chars[0], 'second', 1)]);
  const one = render(h(app.BattleScreen, {
    state: s, selected: null, rescueFor: null, error: null,
    onSelect: noop, onPickRescueTarget: noop, onRescue: noop, onEndTurn: noop, onRestart: noop
  }));
  if (!one.includes(c.name)) problems.push(`角色 ${c.name} 渲染失败`);
  if (problems.length > 5) break;
}

if (problems.length) {
  console.error('FAIL\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`PASS 界面冒烟：选人界面 + 对局界面 + ${chars.length} 个角色逐个渲染`);
