// 界面层：只把 data/ 的数据摆出来、把玩家点击翻译成 core 的行动，不写任何规则判断。
// 规则疑问一律回 core/；这里出现“如果血量为 X 就……”之类判断即为越界。
(function () {
  var h = React.createElement;
  var useState = React.useState;

  var DATA = (typeof window !== 'undefined' && window.IDD_DATA) || { characters: [], items: [] };
  var CHARS = DATA.characters || [];
  var ITEMS = DATA.items || [];

  var RARITY_LABEL = { normal: '普通', epic: '史诗', limited: '限定', legend: '传说', unknown: '未知' };

  // ---------- 数据 → 内核单位 ----------
  // atk/hp 直接取数据表；上限按机制取同值。hasRescue 只按技能名是否含「救援」判断。
  function makeUnit(def, side, slot) {
    var skills = def.skills || [];
    var hasRescue = skills.some(function (s) { return s.name.indexOf('救援') >= 0; });
    return {
      id: side + '-' + slot,
      name: def.name,
      side: side,
      slot: slot,
      atk: def.atk || 0,
      hp: def.hp || 1,
      maxHp: def.hp || 1,
      initialMaxHp: def.hp || 1,
      tempHp: 0,
      hasReflect: true, // 默认全员反伤（古董商/盲女等技能文本以此为前提）
      hasRescue: hasRescue,
      charId: def.id
    };
  }

  function charById(id) {
    for (var i = 0; i < CHARS.length; i++) if (CHARS[i].id === id) return CHARS[i];
    return null;
  }

  // ---------- 通用小组件 ----------
  function tag(text, cls) { return h('span', { className: 'tag ' + (cls || '') }, text); }

  function skillLine(s, key) {
    var meta = [];
    if (s.type && s.type !== 'unknown') meta.push(s.type);
    if (s.cd != null) meta.push('CD ' + s.cd);
    if (s.cooldown != null) meta.push('CD ' + s.cooldown);
    if (s.durability != null) meta.push('耐久 ' + s.durability);
    if (s.cost != null) meta.push('费 ' + s.cost);
    return h('li', { key: key, className: 'skill', title: s.text },
      h('span', { className: 'skill-name' }, s.name),
      meta.length ? h('span', { className: 'skill-meta' }, meta.join(' / ')) : null);
  }

  // ---------- 选人（P4：真实 BP，规则全在内核 bp.ts） ----------
  function bpCatalog() {
    return CHARS.map(function (c) { return { id: c.id, name: c.name, rarity: c.rarity, cost: c.cost }; });
  }

  function charByName(name) {
    for (var i = 0; i < CHARS.length; i++) if (CHARS[i].name === name) return CHARS[i];
    return null;
  }

  function money(n) { return n % 1000 === 0 ? (n / 1000) + 'k' : String(n); }

  function countRarity(r) {
    var n = 0;
    for (var i = 0; i < CHARS.length; i++) if (CHARS[i].rarity === r) n += 1;
    return n;
  }

  function modeLabel(mode) { return mode === 'single' ? '一局一胜' : mode === 'bo3' ? '三局两胜' : '五局三胜'; }

  function isLimitedRarity(r) { return r === 'limited' || r === 'legend'; }

  function charTitle(c, reason) {
    var lines = [];
    if (reason) lines.push('不可选：' + reason);
    (c.skills || []).forEach(function (s) { lines.push(s.name + '：' + s.text); });
    return lines.join('\n');
  }

  // 首屏：选赛制
  function StartScreen(props) {
    var modes = [
      { key: 'single', label: '一局一胜', note: '1 小局定胜负' },
      { key: 'bo3', label: '三局两胜', note: '先赢 2 局获胜' },
      { key: 'bo5', label: '五局三胜', note: '先赢 3 局获胜' }
    ];
    return h('div', { className: 'setup' },
      h('div', { className: 'panel' },
        h('h2', null, '选择赛制'),
        h('div', { className: 'mode-btns' }, modes.map(function (m) {
          return h('button', {
            key: m.key,
            className: 'mode-btn',
            onClick: function () { props.onStart(m.key); }
          },
            h('span', { className: 'mode-name' }, m.label),
            h('span', { className: 'muted small' }, m.note));
        })),
        h('p', { className: 'muted small' },
          'BP 顺序：先手 BAN → 后手 BAN → 先手选 2 → 后手选 2 → 先手 BAN → 后手 BAN → 先手至多选 3 → 后手至多选 3。' +
          '第 1 小局由玩家1先手，之后逐小局轮换（Q34）。')),
      h('div', { className: 'panel' },
        h('p', { className: 'muted small' },
          '角色 ' + CHARS.length + ' 个（限定 ' + countRarity('limited') + ' / 史诗 ' + countRarity('epic') +
          ' / 普通 ' + countRarity('normal') + '），每人预算 14k、至多 5 人。' +
          '同名的限定与史诗只能选 1 个，同名普通最多 2 个；一方限定合计最多 2 个（Q20/Q37）。')));
  }

  function BpScreen(props) {
    var BP = require(['bp']);
    var series = props.series;
    var st = series.current;
    var cat = bpCatalog();
    var choices = BP.legalBpChoices(st, cat);
    var step = BP.currentStep(st);
    var sides = BP.sidePlayers(st);
    var actor = choices ? choices.player : null;
    var err = props.error;
    var resignState = useState(null);
    var askResign = resignState[0], setAskResign = resignState[1];

    function column(key, role) {
      var p = st.players[key];
      var isActor = actor === key;
      var firstBans = p.bans.slice(0, st.variant.banFirstRound);
      var secondBans = p.bans.slice(st.variant.banFirstRound);
      var limited = 0;
      var spentText = [];
      p.picks.forEach(function (name) {
        var d = charByName(name);
        var r = d && d.rarity;
        if (isLimitedRarity(r)) limited += 1;
        spentText.push({ name: name, cost: d && d.cost });
      });
      return h('div', { className: 'bp-col' + (isActor ? ' acting' : '') },
        h('h3', null,
          (key === 'p1' ? '玩家1' : '玩家2') + '（' + role + '）',
          isActor ? tag('行动中', 'live') : null),
        h('div', { className: 'bp-meta' },
          h('span', null, '预算 ' + money(14000 - p.spent) + ' / 14k'),
          h('span', null, '人数 ' + p.picks.length + '/5'),
          h('span', null, '限定 ' + limited + '/2')),
        h('div', { className: 'bp-group' },
          h('div', { className: 'bp-label' }, '第一次 BAN（' + st.variant.banFirstRound + '）'),
          firstBans.length
            ? h('div', { className: 'bp-tags' }, firstBans.map(function (n, i) {
              return h('span', { key: i, className: 'tag ban1' }, n);
            }))
            : h('div', { className: 'muted small' }, '—')),
        h('div', { className: 'bp-group' },
          h('div', { className: 'bp-label' }, '第二次 BAN（' + st.variant.banSecondRound + '）'),
          secondBans.length
            ? h('div', { className: 'bp-tags' }, secondBans.map(function (n, i) {
              return h('span', { key: i, className: 'tag ban2' }, n);
            }))
            : h('div', { className: 'muted small' }, '—')),
        h('div', { className: 'bp-group' },
          h('div', { className: 'bp-label' }, '已选阵容'),
          spentText.length
            ? h('ol', { className: 'lineup' }, spentText.map(function (x, i) {
              return h('li', { key: i },
                h('span', { className: 'mono' }, '#' + (i + 1)),
                h('span', { className: 'grow' }, x.name),
                h('span', { className: 'muted small' }, x.cost == null ? '' : money(x.cost)));
            }))
            : h('div', { className: 'muted small' }, '—')),
        h('div', { className: 'bp-group' },
          h('div', { className: 'bp-label' }, '全局 BAN（私有，跨小局累积）'),
          p.globalBans.length
            ? h('div', { className: 'bp-tags' }, p.globalBans.map(function (n, i) {
              return h('span', { key: i, className: 'tag gb' }, n);
            }))
            : h('div', { className: 'muted small' }, '—')));
    }

    return h('div', { className: 'setup bp' },
      h('div', { className: 'topbar' },
        h('span', { className: 'badge' }, modeLabel(series.mode)),
        h('span', { className: 'badge' }, '第 ' + (series.roundIndex + 1) + ' 小局 · ' + st.variant.label),
        h('span', { className: 'badge' }, '比分 ' + series.wins.p1 + ' : ' + series.wins.p2),
        choices
          ? h('span', { className: 'badge live' },
            (actor === 'p1' ? '玩家1' : '玩家2') + ' ' +
            (step.action === 'ban' ? 'BAN' : '选人') + '，还需 ' + choices.remaining + ' 个')
          : h('span', { className: 'badge' }, 'BP 结束'),
        h('span', { className: 'grow' }),
        choices && choices.canEndStep
          ? h('button', { onClick: props.onEndStep }, '结束本轮选择（可少于 3 个）')
          : null,
        h('button', {
          className: 'resign-btn',
          onClick: function () { setAskResign('p1'); }
        }, '玩家1 投降'),
        h('button', {
          className: 'resign-btn',
          onClick: function () { setAskResign('p2'); }
        }, '玩家2 投降')),
      askResign ? h('div', { className: 'resign-confirm' },
        h('span', null, (askResign === 'p1' ? '玩家1' : '玩家2') + ' 确定投降？本小局直接判负（已选角色不退回）。'),
        h('button', {
          className: 'danger',
          onClick: function () { setAskResign(null); props.onResign(askResign); }
        }, '确认投降'),
        h('button', { onClick: function () { setAskResign(null); } }, '取消')) : null,
      err ? h('div', { className: 'error' }, err) : null,
      h('div', { className: 'bp-cols' },
        column(sides.first, '先手'),
        column(sides.second, '后手')),
      h('div', { className: 'panel' },
        h('h3', null, '可选角色（只有可点的能点；点一次即提交，不可撤销）'),
        h('div', { className: 'chars bp-chars' }, CHARS.map(function (c) {
          var probe = { id: c.id, name: c.name, rarity: c.rarity, cost: c.cost };
          var reason = actor && step ? BP.blockReason(st, actor, step.action, probe, cat) : 'BP 已结束';
          var legal = reason === null;
          return h('button', {
            key: c.id,
            className: 'char-pick' + (legal ? '' : ' dim'),
            disabled: !legal,
            onClick: legal ? function () {
              props.onAct(step.action === 'ban' ? { type: 'ban', charId: c.id } : { type: 'pick', charId: c.id });
            } : null,
            title: charTitle(c, reason)
          },
            h('span', { className: 'char-pick-name' }, c.name),
            tag(RARITY_LABEL[c.rarity] || c.rarity, 'r-' + c.rarity),
            h('span', { className: 'char-pick-cost' }, c.cost == null ? '?' : money(c.cost)),
            h('span', { className: 'char-pick-stat' }, '攻 ' + (c.atk == null ? '?' : c.atk) + ' / 血 ' + (c.hp == null ? '?' : c.hp)),
            h('span', { className: 'char-pick-skills' }, (c.skills || []).map(function (s) { return s.name; }).join('、')));
        }))));
  }

  // BP 结束：调整站位 → 开始对局（Q42：BP 阶段可任意变换站位）
  function LineupScreen(props) {
    var BP = require(['bp']);
    var series = props.series;
    var st = series.current;
    var sides = BP.sidePlayers(st);

    function column(key, role) {
      var order = props.order[key] || [];
      return h('div', { className: 'bp-col' },
        h('h3', null, (key === 'p1' ? '玩家1' : '玩家2') + '（' + role + '）'),
        h('div', { className: 'bp-meta' },
          h('span', null, '人数 ' + order.length + '/5'),
          h('span', null, '剩余预算 ' + money(14000 - st.players[key].spent) + ' → 道具 ' +
            money(BP.toItemBudget(14000 - st.players[key].spent)))),
        h('ol', { className: 'lineup' }, order.map(function (name, i) {
          var d = charByName(name);
          return h('li', { key: i },
            h('span', { className: 'mono' }, '#' + (i + 1)),
            h('span', { className: 'grow' }, name),
            tag(RARITY_LABEL[d && d.rarity] || '未知', 'r-' + (d && d.rarity)),
            h('button', { disabled: i === 0, onClick: function () { props.onMove(key, i, -1); } }, '↑'),
            h('button', { disabled: i === order.length - 1, onClick: function () { props.onMove(key, i, 1); } }, '↓'));
        })));
    }

    return h('div', { className: 'setup' },
      h('div', { className: 'topbar' },
        h('span', { className: 'badge' }, modeLabel(series.mode)),
        h('span', { className: 'badge' }, '第 ' + (series.roundIndex + 1) + ' 小局'),
        h('span', { className: 'badge' }, '比分 ' + series.wins.p1 + ' : ' + series.wins.p2),
        h('span', { className: 'badge live' }, 'BP 结束')),
      h('p', { className: 'muted' },
        '调整站位顺序（战斗开始后通常不可变）。「#」即站位号，也是界面上区分同名角色的依据。'),
      h('div', { className: 'bp-cols' },
        column(sides.first, '先手'),
        column(sides.second, '后手')),
      h('div', { className: 'panel' },
        h('button', { className: 'primary', onClick: props.onStartGame }, '开始对局')));
  }

  function ChampionScreen(props) {
    var s = props.series;
    var loser = s.champion === 'p1' ? 'p2' : 'p1';
    return h('div', { className: 'setup' },
      h('div', { className: 'panel' },
        h('h2', null, '系列赛结束'),
        h('p', null, (s.champion === 'p1' ? '玩家1' : '玩家2') + ' 获胜：' +
          s.wins[s.champion] + ' : ' + s.wins[loser] + '（' + modeLabel(s.mode) + '）'),
        h('p', { className: 'muted small' }, '全局 BAN 在系列赛结束时清空。'),
        h('div', { className: 'mode-btns' },
          h('button', { className: 'primary', onClick: props.onRestart }, '快速重开（同赛制）'),
          h('button', { onClick: props.onHome }, '返回首页（重选赛制）'))));
  }

  // ---------- 角色卡 ----------
  function UnitCard(props) {
    var u = props.unit;
    var def = charById(u.charId);
    var skills = def ? (def.skills || []) : [];
    var combat = require(['combat']);
    var eff = combat.effectiveAtk(u, props.clock);
    var penalty = u.atk - eff;
    var dying = u.hp <= 0 && !u.dead;
    var cls = ['card', 'side-' + u.side];
    if (u.dead) cls.push('dead');
    if (dying) cls.push('dying');
    if (props.selected) cls.push('selected');
    if (props.targetable) cls.push('targetable');
    if (props.onClick) cls.push('clickable');

    return h('div', { className: cls.join(' '), onClick: props.onClick },
      h('div', { className: 'card-head' },
        h('span', { className: 'card-slot' }, '#' + u.slot),
        h('span', { className: 'card-name' }, u.name),
        tag(RARITY_LABEL[def && def.rarity] || '未知', 'r-' + (def && def.rarity))),
      h('div', { className: 'card-stat' },
        h('span', { className: 'atk' }, '攻 ' + eff + (penalty > 0 ? '（-1）' : '')),
        h('span', { className: 'hp' }, '血 ' + u.hp + ' / ' + u.maxHp),
        u.tempHp > 0 ? h('span', { className: 'temp' }, '临 +' + u.tempHp) : null,
        u.hasReflect ? h('span', { className: 'reflect' }, '反伤 ' + eff) : null),
      h('div', { className: 'card-flags' },
        u.dead ? tag('已死亡') : null,
        dying ? tag('濒死', 'warn') : null,
        u.attackedThisBigTurn ? tag('本大回合已攻击', 'dim') : null,
        props.phase === u.side && !u.dead && u.hp > 0 ? tag('行动中', 'live') : null),
      skills.length
        ? h('ul', { className: 'skills' }, skills.map(function (s, i) { return skillLine(s, i); }))
        : h('div', { className: 'muted small' }, '无技能数据'));
  }

  // ---------- 事件日志 ----------
  function eventText(e, nameOf, sideLabel) {
    var n = function (id) { return nameOf(id); };
    switch (e.type) {
      case 'battleStart': return '战斗开始';
      case 'attack': return n(e.attacker) + ' 攻击 ' + n(e.target) + '，造成 ' + e.damage + ' 点伤害（剩 ' + e.hpAfter + '）';
      case 'reflect': return n(e.target) + ' 反伤 ' + n(e.attacker) + '，造成 ' + e.damage + ' 点（剩 ' + e.hpAfter + '）';
      case 'dying': return n(e.unit) + ' 进入濒死';
      case 'death': return n(e.unit) + ' 死亡';
      case 'rescue': return n(e.rescuer) + ' 救援 ' + n(e.target) + '（自付 ' + e.cost + ' 血）';
      case 'smallTurnEnd': return '第 ' + e.bigTurn + ' 大回合 ' + (e.phase === 'first' ? '先手' : '后手') + ' 小回合结束';
      case 'bigTurnEnd': return '第 ' + e.bigTurn + ' 大回合结束';
      case 'resign': return sideLabel(e.side) + ' 投降';
      case 'victory': return '对局结束：' + sideLabel(e.winner) + ' 胜（' + e.reason + '）';
      default: return e.type;
    }
  }

  // ---------- 对局界面 ----------
  function BattleScreen(props) {
    var state = props.state;
    var sel = props.selected;      // 己方被选中、准备攻击的单位 id
    var rescueFor = props.rescueFor; // 正在选择救援者的濒死单位 id
    var err = props.error;
    var units = state.units;
    var phase = state.clock.phase;
    var penaltyActive = units.some(function (u) { return require(['combat']).effectiveAtk(u, state.clock) < u.atk; });
    var resignState = useState(null);
    var askResign = resignState[0], setAskResign = resignState[1];
    // 玩家名（由 App 按「本小局谁先手」传入）；单独渲染时退回「先手/后手」。
    var playerShort = function (side) {
      var p = props.playerNames && props.playerNames[side];
      return p || (side === 'first' ? '先手' : '后手');
    };
    var unitLabel = function (u) { return playerShort(u.side) + ' · #' + u.slot + ' · ' + u.name; };
    var nameOf = function (id) {
      for (var i = 0; i < units.length; i++) if (units[i].id === id) return unitLabel(units[i]);
      return id;
    };
    var legal = sel ? require(['game']).legalAttackTargets(state, sel).map(function (u) { return u.id; }) : [];
    var picked = sel ? units.filter(function (u) { return u.id === sel; })[0] : null;

    function row(side, title) {
      var list = units.filter(function (u) { return u.side === side; })
        .sort(function (a, b) { return a.slot - b.slot; });
      return h('div', { className: 'row row-' + side },
        h('div', { className: 'row-title' }, title),
        h('div', { className: 'cards' }, list.map(function (u) {
          var mine = u.side === phase;
          var isTarget = legal.indexOf(u.id) >= 0;
          var click = null;
          if (!state.winner && !mustHandle) {
            if (isTarget) click = function () { props.onSelect(u.id); };          // 点敌人＝确认攻击
            else if (mine && !u.dead && u.hp > 0) click = function () { props.onSelect(u.id); }; // 点自己＝换选中
          }
          return h(UnitCard, {
            key: u.id, unit: u, phase: phase, clock: state.clock,
            selected: sel === u.id,
            targetable: isTarget,
            onClick: click
          });
        })));
    }

    var dyingUnits = units.filter(function (u) { return !u.dead && u.hp <= 0; });
    var gameApi = require(['game']);
    // 濒死必须按内核给的顺序处理；队列非空时其他操作在内核里会被拒绝，界面上直接禁用。
    var pending = gameApi.pendingDying(state);
    var mustHandle = pending.length ? pending[0] : null;
    var rescueOps = rescueFor ? gameApi.legalRescueOps(state, rescueFor) : [];

    return h('div', { className: 'battle' },
      h('div', { className: 'topbar' },
        h('span', { className: 'badge' }, '第 ' + state.clock.bigTurn + ' 大回合'),
        h('span', { className: 'badge live' }, (phase === 'first' ? '先手' : '后手') + '行动'),
        penaltyActive ? h('span', { className: 'badge dim', title: '机制 R15：第一回合全体攻击力 -1（反伤同减）' }, '首回合：攻击 -1') : null,
        state.winner ? h('span', { className: 'badge warn' }, playerShort(state.winner) + '胜') : null,
        mustHandle ? h('span', { className: 'badge warn' }, '必须先处理濒死：' + unitLabel(mustHandle)) : null,
        h('span', { className: 'grow' }),
        h('button', {
          className: 'resign-btn',
          disabled: !!state.winner,
          onClick: function () { setAskResign('first'); }
        }, playerShort('first') + ' 投降'),
        h('button', {
          className: 'resign-btn',
          disabled: !!state.winner,
          onClick: function () { setAskResign('second'); }
        }, playerShort('second') + ' 投降'),
        h('button', { onClick: props.onEndTurn, disabled: !!state.winner || !!mustHandle }, '结束本小回合'),
        h('button', { onClick: props.onRestart }, '重开')),
      askResign ? h('div', { className: 'resign-confirm' },
        h('span', null, playerShort(askResign) + ' 确定投降？认负后本小局立即判负。'),
        h('button', {
          className: 'danger',
          onClick: function () { setAskResign(null); props.onResign(askResign); }
        }, '确认投降'),
        h('button', { onClick: function () { setAskResign(null); } }, '取消')) : null,
      err ? h('div', { className: 'error' }, err) : null,
      h('div', { className: 'board' },
        row('second', playerShort('second') + '（后手）'),
        h('div', { className: 'midline' }, selectedHint(picked, legal.length)),
        row('first', playerShort('first') + '（先手）')),
      h('div', { className: 'side-panels' },
        h('div', { className: 'panel log' },
          h('h3', null, '事件日志'),
          h('ol', null, state.events.map(function (e, i) {
            return h('li', { key: i }, eventText(e, nameOf, playerShort));
          }))),
        h('div', { className: 'panel col-right' },
          h('h3', null, '道具栏（P5 接入）'),
          h('ul', { className: 'items' }, ITEMS.map(function (it) {
            return h('li', { key: it.id, title: it.text },
              h('span', { className: 'item-name' }, it.name),
              h('span', { className: 'item-cost' }, it.cost == null ? '' : (it.cost % 1000 === 0 ? it.cost / 1000 + 'k' : it.cost + '')));
          })),
          h('h3', null, '濒死处理'),
          dyingUnits.length === 0
            ? h('div', { className: 'muted small' }, '当前无人濒死')
            : h('ul', { className: 'rescue-list' }, dyingUnits.map(function (u) {
              var first = mustHandle && mustHandle.id === u.id;
              var open = rescueFor === u.id && first;
              return h('li', { key: u.id },
                h('span', null, unitLabel(u) + ' 濒死', first ? h('span', { className: 'tag warn' }, '必须现在处理') : null),
                first
                  ? h('button', { onClick: function () { props.onPickRescueTarget(open ? null : u.id); } }, open ? '收起' : '救援…')
                  : h('span', { className: 'muted small' }, '排在其后，暂不能处理'),
                open ? h('div', { className: 'rescue-btns' },
                  rescueOps.length === 0
                    ? h('span', { className: 'muted small' }, '无可救援者，只能放弃')
                    : rescueOps.map(function (op) {
                      var rid = op.kind === 'self' ? u.id : op.rescuerId;
                      return h('button', {
                        key: rid,
                        onClick: function () { props.onRescue(u.id, rid); }
                      }, (op.kind === 'self' ? '自我救援' : nameOf(rid) + ' 救援') + '（- ' + op.cost + ' 血）');
                    }),
                  h('button', {
                    className: 'danger',
                    onClick: function () { props.onRescue(u.id, null); }
                  }, '放弃救援（该角色死亡）')) : null);
            })))),
      props.footer ? h('div', { className: 'battle-footer' }, props.footer) : null);
  }

  function selectedHint(picked, n) {
    if (!picked) return h('span', { className: 'muted' }, '点己方角色卡选中，再点高亮敌人攻击');
    return h('span', null, '已选 ' + picked.name + '：可攻击目标 ' + n + ' 个');
  }

  // ---------- 根组件 ----------
  function App() {
    var BP = require(['bp']);
    var gameApi = require(['game']);
    var seriesState = useState(null);
    var series = seriesState[0], setSeries = seriesState[1];
    var orderState = useState(null);
    var order = orderState[0], setOrder = orderState[1];
    var gs = useState(null);
    var state = gs[0], setState = gs[1];
    var selState = useState(null);
    var selected = selState[0], setSelected = selState[1];
    var rescueState = useState(null);
    var rescueFor = rescueState[0], setRescueFor = rescueState[1];
    var errState = useState(null);
    var error = errState[0], setError = errState[1];
    var bpErrState = useState(null);
    var bpError = bpErrState[0], setBpError = bpErrState[1];

    function resetBattle() {
      setState(null);
      setSelected(null);
      setRescueFor(null);
      setError(null);
    }

    function startSeries(mode) {
      setSeries(BP.createSeries(mode));
      setOrder(null);
      setBpError(null);
      resetBattle();
    }

    function applyBpAction(action) {
      try {
        var next = BP.applyBp(series.current, action, bpCatalog());
        setSeries(Object.assign({}, series, { current: next }));
        setBpError(null);
        if (next.finished) {
          setOrder({
            p1: next.players.p1.picks.slice(),
            p2: next.players.p2.picks.slice()
          });
        }
      } catch (e) {
        setBpError('内核拒绝该操作：' + e.message);
      }
    }

    function moveOrder(key, index, dir) {
      var arr = (order[key] || []).slice();
      var j = index + dir;
      if (j < 0 || j >= arr.length) return;
      var tmp = arr[index];
      arr[index] = arr[j];
      arr[j] = tmp;
      var next = Object.assign({}, order);
      next[key] = arr;
      setOrder(next);
    }

    function startGame() {
      var sides = BP.sidePlayers(series.current);
      var units = [];
      function add(side, key) {
        (order[key] || []).forEach(function (name, i) {
          var def = charByName(name);
          if (def) units.push(makeUnit(def, side, i + 1));
        });
      }
      add('first', sides.first);
      add('second', sides.second);
      var budget = {
        first: BP.toItemBudget(14000 - series.current.players[sides.first].spent),
        second: BP.toItemBudget(14000 - series.current.players[sides.second].spent)
      };
      setState(gameApi.createGame(units, { itemBudget: budget }));
      setSelected(null);
      setRescueFor(null);
      setError(null);
    }

    function run(action) {
      try {
        var res = gameApi.applyAction(state, action);
        setState(res.state);
        setError(null);
      } catch (e) {
        setError('内核拒绝该操作：' + e.message);
      }
    }

    function onSelect(id) {
      if (selected && selected !== id) {
        var legal = gameApi.legalAttackTargets(state, selected).map(function (u) { return u.id; });
        if (legal.indexOf(id) >= 0) {
          run({ type: 'attack', attackerId: selected, targetId: id });
          setSelected(null);
          return;
        }
      }
      setSelected(id);
      setRescueFor(null);
    }

    function recordWin(winnerKey, currentSeries) {
      var recorded = BP.recordRoundWinner(currentSeries, winnerKey);
      resetBattle();
      if (recorded.champion) {
        setOrder(null);
        setSeries(recorded);
        return;
      }
      setSeries(BP.advanceSeries(recorded));
      setOrder(null);
      setBpError(null);
    }

    function finishRound() {
      var sides = BP.sidePlayers(series.current);
      recordWin(state.winner === 'first' ? sides.first : sides.second, series);
    }

    // BP 阶段投降：本小局直接判负，已选角色与已产生的全局 BAN 保留。
    function resignBp(loserKey) {
      var forfeited = Object.assign({}, series, { current: BP.forfeitBp(series.current) });
      recordWin(loserKey === 'p1' ? 'p2' : 'p1', forfeited);
    }

    function goHome() {
      setSeries(null);
      setOrder(null);
      setBpError(null);
      resetBattle();
    }

    if (!series) {
      return h(StartScreen, { onStart: startSeries });
    }
    if (series.champion) {
      return h(ChampionScreen, {
        series: series,
        onRestart: function () { startSeries(series.mode); },
        onHome: goHome
      });
    }
    if (!series.current.finished) {
      return h(BpScreen, {
        series: series,
        error: bpError,
        onAct: applyBpAction,
        onEndStep: function () { applyBpAction({ type: 'endStep' }); },
        onResign: resignBp
      });
    }
    if (!state) {
      return h(LineupScreen, {
        series: series,
        order: order || { p1: series.current.players.p1.picks.slice(), p2: series.current.players.p2.picks.slice() },
        onMove: moveOrder,
        onStartGame: startGame
      });
    }

    var footer = null;
    var sidesW = BP.sidePlayers(series.current);
    if (state.winner) {
      var winnerKey = state.winner === 'first' ? sidesW.first : sidesW.second;
      var championSoon = series.wins[winnerKey] + 1 >= BP.seriesWinsNeeded(series.mode);
      footer = h('div', { className: 'series-bar' },
        h('span', null,
          '本小局结束：' + (winnerKey === 'p1' ? '玩家1' : '玩家2') + ' 胜；当前比分 ' +
          (winnerKey === 'p1' ? series.wins.p1 + 1 : series.wins.p1) + ' : ' +
          (winnerKey === 'p2' ? series.wins.p2 + 1 : series.wins.p2)),
        h('button', { className: 'primary', onClick: finishRound },
          championSoon ? '查看系列赛结果' : '记录结果并进入下一小局'));
    }

    return h(BattleScreen, {
      state: state,
      selected: selected,
      rescueFor: rescueFor,
      error: error,
      footer: footer,
      playerNames: {
        first: sidesW.first === 'p1' ? '玩家1' : '玩家2',
        second: sidesW.second === 'p1' ? '玩家1' : '玩家2'
      },
      onResign: function (side) { run({ type: 'resign', side: side }); },
      onSelect: onSelect,
      onPickRescueTarget: function (id) { setRescueFor(id); },
      onRescue: function (targetId, rescuerId) {
        run({ type: 'rescue', targetId: targetId, rescuerId: rescuerId });
        setRescueFor(null);
      },
      onEndTurn: function () { run({ type: 'endTurn' }); setSelected(null); },
      onRestart: function () { startSeries(series.mode); }
    });
  }

  window.IDDApp = {
    App: App,
    BattleScreen: BattleScreen,
    StartScreen: StartScreen,
    BpScreen: BpScreen,
    LineupScreen: LineupScreen,
    ChampionScreen: ChampionScreen,
    makeUnit: makeUnit
  };

  if (typeof document !== 'undefined' && typeof ReactDOM !== 'undefined') {
    ReactDOM.createRoot(document.getElementById('root')).render(h(App));
  }
})();
