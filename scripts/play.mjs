// 用内核跑一整局，输出事件日志。P2 的验收工具。
// 用法：npm run play
import { mkdirSync, writeFileSync } from 'node:fs';
import { createGame, applyAction, legalAttackTargets } from '../temp/build/core/game.js';

const mk = (over) => ({
  id: 'x',
  name: 'X',
  side: 'first',
  slot: 1,
  atk: 3,
  hp: 6,
  maxHp: 6,
  initialMaxHp: 6,
  tempHp: 0,
  ...over,
});

// 固定阵容：先手 2 人（其中 1 人有救援），后手 2 人（其中 1 人有反伤）。
const units = [
  mk({ id: 'F1', name: '先手一号', side: 'first', slot: 1, atk: 4, hp: 6 }),
  mk({ id: 'F2', name: '先手二号', side: 'first', slot: 2, atk: 2, hp: 5, hasRescue: true, mustUseBodyForRescue: true }),
  mk({ id: 'S1', name: '后手一号', side: 'second', slot: 1, atk: 3, hp: 7, hasReflect: true }),
  mk({ id: 'S2', name: '后手二号', side: 'second', slot: 2, atk: 5, hp: 4 }),
];

let state = createGame(units);
const lines = [];
const record = (t) => lines.push(t);

let guard = 0;
// 濒死必须先处理，否则内核拒绝其他动作。演示脚本一律「放弃救援」。
const flushDying = () => {
  while (!state.winner && state.dyingQueue.length > 0) {
    const id = state.dyingQueue[0];
    const before = state;
    state = applyAction(state, { type: 'rescue', targetId: id, rescuerId: null }).state;
    for (const e of state.events.slice(before.events.length)) {
      if (e.type === 'death') record(`T${state.clock.bigTurn} 死亡 ${e.unit}`);
    }
  }
};
while (!state.winner && guard++ < 40) {
  const side = state.clock.phase;
  const actors = state.units.filter((u) => u.side === side && !u.dead && u.hp > 0 && !u.attackedThisBigTurn);

  for (const actor of actors) {
    const targets = legalAttackTargets(state, actor.id);
    if (targets.length === 0) break;
    // 简单策略：打血量最低的目标，便于快速收敛
    targets.sort((a, b) => a.hp - b.hp);
    const before = state;
    state = applyAction(state, { type: 'attack', attackerId: actor.id, targetId: targets[0].id }).state;
    for (const e of state.events.slice(before.events.length)) {
      if (e.type === 'attack') record(`T${state.clock.bigTurn}-${side} 攻击 ${e.attacker}->${e.target} 伤害${e.damage} 剩余${e.hpAfter}`);
      if (e.type === 'reflect') record(`T${state.clock.bigTurn}-${side} 反伤 ${e.attacker}->${e.target} 伤害${e.damage} 剩余${e.hpAfter}`);
      if (e.type === 'death') record(`T${state.clock.bigTurn}-${side} 死亡 ${e.unit}`);
      if (e.type === 'dying') record(`T${state.clock.bigTurn}-${side} 濒死 ${e.unit}`);
    }
  }
  flushDying();

  if (state.winner) break;
  const before = state;
  state = applyAction(state, { type: 'endTurn' }).state;
  for (const e of state.events.slice(before.events.length)) {
    if (e.type === 'smallTurnEnd') record(`T${e.bigTurn} ${e.phase} 小回合结束`);
    if (e.type === 'bigTurnEnd') record(`T${e.bigTurn} 大回合结束`);
  }
}

const summary = {
  winner: state.winner,
  bigTurns: state.clock.bigTurn,
  units: state.units.map((u) => ({ id: u.id, name: u.name, side: u.side, hp: u.hp, maxHp: u.maxHp, dead: u.dead })),
};

mkdirSync('temp/logs', { recursive: true });
writeFileSync('temp/logs/match.json', JSON.stringify({ summary, lines, events: state.events }, null, 2), 'utf8');

console.log(lines.join('\n'));
console.log('---');
console.log(JSON.stringify(summary));
if (!state.winner) {
  console.error('FAIL: 对局未在 40 回合内结束');
  process.exit(1);
}
