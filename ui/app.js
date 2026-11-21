// 界面层：只把 data/ 的数据摆出来、把玩家点击翻译成 core 的行动，不写任何规则判断。
// 规则疑问一律回 core/；这里出现“如果血量为 X 就……”之类判断即为越界。
(function () {
  var h = React.createElement;
  var useState = React.useState;

  var DATA = (typeof window !== 'undefined' && window.IDD_DATA) || { characters: [], items: [] };
  var CHARS = DATA.characters || [];
  var ITEMS = DATA.items || [];
  var EFFECTS = DATA.effects || { skills: [], items: [] };

  // 效果表索引只建一次（核心只读数据，不判断规则）。
  var FX_INDEX = null;
  function fxIndex() {
    if (!FX_INDEX) FX_INDEX = require(['units']).indexEffects(EFFECTS);
    return FX_INDEX;
  }

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
      statuses: [],
      items: [],
      // P5：技能运行时状态由内核构造；没有效果数据时 effect 为 null，界面只展示原文。
      skills: def.id ? require(['units']).buildUnitSkills(def.id, skills, fxIndex()) : [],
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
    if (s.initialCd != null && s.initialCd !== 0) meta.push('初始CD ' + s.initialCd);
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
        choices && choices.canUndo
          ? h('button', { onClick: props.onUndo }, '撤回上一步')
          : null,
        choices && choices.canConfirm
          ? h('button', { className: 'primary', onClick: props.onConfirm }, '确认本步')
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
        h('h3', null, '可选角色（只有可点的能点；点一次即提交，可用「撤回上一步」退回本步最后一次选择）'),
        h('div', { className: 'chars bp-chars' }, CHARS.map(function (c) {
          var probe = { id: c.id, name: c.name, rarity: c.rarity, cost: c.cost };
          var reason = actor && step ? BP.blockReason(st, actor, step.action, probe, cat) : 'BP 已结束';
          // 本步已选满时禁用全部角色，避免多余点击（内核也会拒绝）。
          if (reason === null && choices && choices.remaining <= 0) reason = '本步已选满，请点「确认本步」';
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
        u.isSummon ? tag('召唤物') : null,
        dying ? tag('濒死', 'warn') : null,
        u.attackedThisBigTurn ? tag('本大回合已攻击', 'dim') : null,
        props.phase === u.side && !u.dead && u.hp > 0 ? tag('行动中', 'live') : null),
      renderActions(u, props),
      skills.length
        ? h('ul', { className: 'skills' }, skills.map(function (s, i) { return skillLine(s, i); }))
        : h('div', { className: 'muted small' }, '无技能数据'));
  }

  // 单位可用操作：只把内核判定的「可用/不可用」翻译成按钮，不在这里做任何规则判断。
  function renderActions(u, props) {
    if (u.dead || props.frozen) return null;
    var trig = require(['trigger']);
    var mine = u.side === props.phase;
    var btns = [];
    (u.skills || []).forEach(function (s, i) {
      if (!s.effect || !s.effect.manual) return;
      // P7-3：反应技能（役鸟守护）不出主动按钮，只在反应窗口里出现。
      if (s.effect.reaction) return;
      var reason = trig.canUseSkill(u, s, props.clock);
      // P7 E2-4：任意阶段技能（安抚物）不受当前小回合限制。
      var anyPhase = Boolean(s.effect.anyPhase);
      var dis = Boolean(reason) || (!mine && !anyPhase);
      var branches = s.effect.branches || [];
      // P5-15：有分支的技能先出小菜单，点哪个分支就带哪个 variant 进内核。
      if (branches.length) {
        btns.push(h('span', { key: 'sk' + i, className: 'branch-group' },
          h('span', { className: 'branch-title' }, s.def.name + '：'),
          branches.map(function (b, bi) {
            // P5-16③：分支可覆盖充能消耗（激励 1/3）。
            var bReason = trig.canUseSkill(u, s, props.clock, b.cost);
            // P5：信件分支级条件（冷静：首回合不可用）。
            if (b.if === 'notFirstBigTurn' && props.clock && props.clock.bigTurn === 1) bReason = '第 1 回合不可使用';
            var bdis = Boolean(bReason) || (!mine && !anyPhase);
            return h('button', {
              key: 'b' + bi,
              className: 'act-btn branch' + (bdis ? ' off' : ''),
              title: (bReason || '点击发动') + '｜' + s.def.text,
              disabled: bdis,
              style: bdis ? { opacity: 0.45 } : null,
              onClick: function (ev) { ev.stopPropagation(); if (!bdis) props.onSkill(u.id, i, s.effect, b.label); }
            }, b.label + (b.cost ? '（' + b.cost + '）' : ''));
          })));
        return;
      }
      // P6-Q10：技能「指定一个道具」——按己方道具栏里出现过的道具出小菜单，点哪个就带哪个 itemId 进内核。
      var chooseItem = (s.effect.ops || []).some(function (o) { return o.item === '$chosen'; });
      if (chooseItem) {
        var seen = {};
        var cands = [];
        ((props.state && props.state.units) || []).forEach(function (x) {
          if (x.side !== u.side || x.dead) return;
          (x.items || []).forEach(function (it) {
            if (!seen[it.itemId]) { seen[it.itemId] = 1; cands.push(it.itemId); }
          });
        });
        var catMap = fxIndex().items;
        btns.push(h('span', { key: 'sk' + i, className: 'branch-group' },
          h('span', { className: 'branch-title' }, s.def.name + '：'),
          cands.length
            ? cands.map(function (id, ci) {
              var cat = catMap.get(id);
              return h('button', {
                key: 'i' + ci,
                className: 'act-btn branch' + (dis ? ' off' : ''),
                title: (reason || '指定一个道具（本大回合不可用 + 永久 -1k）') + '｜' + s.def.text,
                disabled: dis,
                style: dis ? { opacity: 0.45 } : null,
                onClick: function (ev) { ev.stopPropagation(); if (!dis) props.onSkill(u.id, i, s.effect, undefined, id); }
              }, cat ? cat.name : id);
            })
            : h('span', { className: 'muted small' }, '己方道具栏为空')));
        return;
      }
      btns.push(h('button', {
        key: 'sk' + i,
        className: 'act-btn' + (dis ? ' off' : ''),
        title: (reason || '点击发动') + '｜' + s.def.text,
        disabled: dis,
        style: dis ? { opacity: 0.45 } : null,
        onClick: function (ev) { ev.stopPropagation(); if (!dis) props.onSkill(u.id, i, s.effect); }
      }, s.def.name));
    });
    (u.items || []).forEach(function (it, i) {
      var cat = fxIndex().items.get(it.itemId);
      var price = require(['items']).itemPrice({
        item: { id: it.itemId, name: cat ? cat.name : it.itemId, cost: cat ? cat.cost : null },
        owned: it,
        statuses: u.statuses
      });
      var label = (cat ? cat.name : it.itemId) + (it.nameKey ? '·' + it.nameKey : '') + (price != null ? '（' + price + '）' : '');
      var dis = !mine || !cat;
      // P7-2 X6：抉择式道具（八音盒）先出分支小菜单，点哪个分支带哪个 variant 进内核。
      var branches = (cat && cat.effect && cat.effect.branches) || [];
      if (branches.length) {
        btns.push(h('span', { key: 'it' + i, className: 'branch-group' },
          h('span', { className: 'branch-title' }, label + '：'),
          branches.map(function (b, bi) {
            return h('button', {
              key: 'b' + bi,
              className: 'act-btn branch item' + (dis ? ' off' : ''),
              title: (dis ? '当前不可用' : '点击使用道具') + '｜' + b.label,
              disabled: dis,
              style: dis ? { opacity: 0.45 } : null,
              onClick: function (ev) { ev.stopPropagation(); if (!dis) props.onItem(u.id, i, cat.effect, b.label); }
            }, b.label);
          })));
        return;
      }
      btns.push(h('button', {
        key: 'it' + i,
        className: 'act-btn item' + (dis ? ' off' : ''),
        title: cat ? '点击使用道具' : '该道具暂无效果数据',
        disabled: dis,
        style: dis ? { opacity: 0.45 } : null,
        onClick: function (ev) { ev.stopPropagation(); if (!dis) props.onItem(u.id, i, cat.effect); }
      }, label));
    });
    if (u.isSummon && props.canDestroy && props.onDestroy) {
      btns.push(h('button', {
        key: 'destroy',
        className: 'act-btn',
        title: '记者存活时可主动使幻影死亡（不触发受击后的临时血量）',
        onClick: function (ev) { ev.stopPropagation(); props.onDestroy(); }
      }, '令其消散'));
    }
    if (!btns.length) return null;
    return h('div', { className: 'card-actions' }, btns);
  }

  // ---------- 事件日志 ----------
  function eventText(e, nameOf, sideLabel) {
    var n = function (id) { return nameOf(id); };
    switch (e.type) {
      case 'battleStart': return '战斗开始';
      case 'attack': return n(e.attacker) + ' 攻击 ' + n(e.target) + '，造成 ' + e.damage + ' 点伤害（剩 ' + e.hpAfter + '）';
      case 'interruptPending': return (e.kind === 'attack'
        ? n(e.attacker) + ' 宣告攻击 ' + n(e.target)
        : n(e.target) + ' 将要受到伤害') + '：等待受击方决定是否使用反应';
      case 'attackInterrupted': return n(e.unit) + ' 使用 ' + e.item + ' 打断，本次伤害 ×' + e.factor;
      case 'interruptSkill': return n(e.unit) + ' 使用 ' + e.skill + ' 守护 ' + n(e.target) + '，免疫本次伤害';
      case 'reflect': return n(e.target) + ' 反伤 ' + n(e.attacker) + '，造成 ' + e.damage + ' 点（剩 ' + e.hpAfter + '）';
      case 'dying': return n(e.unit) + ' 进入濒死';
      case 'death': return n(e.unit) + ' 死亡';
      case 'rescue': return n(e.rescuer) + ' 救援 ' + n(e.target) + '（自付 ' + e.cost + ' 血）';
      case 'smallTurnEnd': return '第 ' + e.bigTurn + ' 大回合 ' + (e.phase === 'first' ? '先手' : '后手') + ' 小回合结束';
      case 'bigTurnEnd': return '第 ' + e.bigTurn + ' 大回合结束';
      case 'resign': return sideLabel(e.side) + ' 投降';
      case 'damage': return n(e.target) + ' 受到 ' + e.amount + ' 点伤害（剩 ' + e.hpAfter + '）';
      case 'heal': return n(e.target) + ' 回复血量（现在 ' + e.hpAfter + '）';
      case 'tempHp': return n(e.target) + ' 获得临时血量（合计 ' + e.total + '）';
      case 'swapStat': return '交换数值：' + n(e.a) + ' / ' + n(e.b);
      case 'swapPosition': return '交换站位：' + n(e.a) + ' / ' + n(e.b);
      case 'unsupportedEffect': return '【未实装效果】' + (e.key || e.note || '');
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
    var penaltyActive = state.clock.bigTurn === 1;
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
          // P5-16④：记者存活且轮到自己时，可令自己的召唤物消散。
          var owner = u.isSummon && u.ownerId
            ? units.filter(function (x) { return x.id === u.ownerId; })[0]
            : null;
          var canDestroy = Boolean(owner && !owner.dead && owner.canDestroySummon &&
            !state.winner && !mustHandle && phase === owner.side);
          var click = null;
          if (!state.winner && !mustHandle) {
            if (isTarget) click = function () { props.onSelect(u.id); };          // 点敌人＝确认攻击
            else if (mine && !u.dead && u.hp > 0) click = function () { props.onSelect(u.id); }; // 点自己＝换选中
          }
          return h(UnitCard, {
            key: u.id, unit: u, phase: phase, clock: state.clock,
            selected: sel === u.id,
            targetable: isTarget,
            frozen: Boolean(state.winner) || Boolean(mustHandle),
            onSkill: props.onSkill,
            onItem: props.onItem,
            canDestroy: canDestroy,
            onDestroy: canDestroy ? function () { props.onDestroy(owner.id, u.id); } : null,
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
    // P5-16⑥ 飞行家：血量不足时仍可用「消耗飞行器」救援，因此单独列出。
    var flyerRescuers = function (u) {
      return units.filter(function (x) {
        return !x.dead && x.hp > 0 && x.side === u.side && x.id !== u.id && x.canRescueByFlyer && x.hasRescue &&
          x.skills.some(function (s) { return s.def.name === '飞行器' && (s.durability || 0) > 0; });
      });
    };
    // P5-16⑥ 入殓师：「附容返生」可在己方回合无限次转移，给一个最简操作面板。
    var markPanel = (function () {
      var actor = units.filter(function (x) { return x.side === phase && !x.dead && x.canTransferMark; })[0];
      if (!actor || state.winner) return h('div', { className: 'muted small' }, '当前无可用转移');
      var holder = units.filter(function (x) {
        return x.side === actor.side && !x.dead &&
          x.statuses.some(function (s) { return s.kind === 'mark' && s.key === 'furongfansheng'; });
      })[0];
      if (!holder) return h('div', { className: 'muted small' }, '场上还没有附容返生标记');
      var targets = units.filter(function (x) { return x.side === actor.side && !x.dead && x.id !== holder.id; });
      return h('div', { className: 'rescue-btns' },
        h('span', { className: 'muted small' }, '现在在 ' + nameOf(holder.id) + ' 身上：'),
        targets.map(function (t) {
          return h('button', {
            key: 'mk-' + t.id,
            disabled: !!mustHandle,
            onClick: function () { props.onTransferMark(actor.id, holder.id, t.id); }
          }, '移到 ' + nameOf(t.id));
        }));
    })();

    return h('div', { className: 'battle' },
      h('div', { className: 'topbar' },
        h('span', { className: 'badge' }, '第 ' + state.clock.bigTurn + ' 大回合'),
        h('span', { className: 'badge live' }, (phase === 'first' ? '先手' : '后手') + '行动'),
        h('span', { className: 'badge dim', title: '每大回合开始双方各 +3k（QA-02）' },
          '资源 ' + money(state.k.first) + ' / ' + money(state.k.second)),
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
      // P7-2（X5）/ P7-3：伤害前反应窗口——魔术棒（仅攻击）或反应技能（役鸟守护，任意伤害）二选一。
      state.pendingInterrupt ? (function () {
        var win = state.pendingInterrupt;
        var defender = units.filter(function (u) { return u.id === win.targetId; })[0];
        var list = win.kind !== 'attack' || !defender ? [] : defender.items.map(function (it, i) {
          var cat = state.effects && state.effects.items && state.effects.items.get(it.itemId);
          var eff = cat && cat.effect;
          if (!eff || eff.reaction !== 'beforeAttack') return null;
          var cost = it.cost != null ? it.cost : (cat && cat.cost);
          return { i: i, name: (cat && cat.name) || it.itemId, cost: cost };
        }).filter(Boolean);
        var reacts = [];
        state.units.forEach(function (u) {
          if (u.dead || !defender || u.side !== defender.side) return;
          (u.skills || []).forEach(function (sk, si) {
            var eff = sk.effect;
            if (!eff || eff.reaction !== 'beforeDamage') return;
            var lim = eff.usageLimit && eff.usageLimit.perGame;
            if (lim !== undefined && sk.usedPerGame >= lim) return;
            var need = eff.cost && eff.cost.charge != null ? eff.cost.charge : (sk.def && sk.def.cost) || 0;
            if (sk.def && sk.def.type === 'charge' && sk.charge < need) return;
            reacts.push({ unitId: u.id, skillIndex: si, name: (sk.def && sk.def.name) || eff.name, charge: sk.charge, need: need });
          });
        });
        return h('div', { className: 'interrupt-mask' },
          h('div', { className: 'interrupt-card' },
            h('h3', null, win.kind === 'attack' ? '攻击打断窗口' : '伤害反应窗口'),
            h('p', null, win.kind === 'attack' && win.attackerId
              ? nameOf(win.attackerId) + ' 正在攻击 ' + nameOf(win.targetId)
              : nameOf(win.targetId) + ' 将要受到伤害'),
            h('p', { className: 'muted small' },
              '可立即使用一个反应：魔术棒仅在受到攻击时可用（伤害减半）；役鸟守护任意受伤时可用（免疫本次伤害，先知攻击力 -1）。'),
            reacts.map(function (x) {
              return h('button', {
                key: 'rs-' + x.unitId + '-' + x.skillIndex,
                className: 'warn',
                onClick: function () { props.onInterruptSkill(x.unitId, x.skillIndex); }
              }, nameOf(x.unitId) + ' 使用 ' + x.name + '（充能 ' + x.charge + '/' + x.need + '）：免疫本次伤害');
            }),
            list.length === 0 ? null : list.map(function (x) {
              return h('button', {
                key: 'int-' + x.i,
                className: 'warn',
                onClick: function () { props.onInterruptItem(x.i); }
              }, '使用 ' + x.name + (x.cost != null ? '（' + money(x.cost) + '）' : '') + '：伤害减半');
            }),
            reacts.length + list.length === 0
              ? h('span', { className: 'muted small' }, '没有可用的反应')
              : null,
            h('button', { onClick: props.onResolveInterrupt }, '不打断，继续结算')));
      })() : null,
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
                  flyerRescuers(u).map(function (x) {
                    return h('button', {
                      key: 'flyer-' + x.id,
                      onClick: function () { props.onRescueFlyer(u.id, x.id); }
                    }, nameOf(x.id) + ' 消耗飞行器（无伤）');
                  }),
                  h('button', {
                    className: 'danger',
                    onClick: function () { props.onRescue(u.id, null); }
                  }, '放弃救援（该角色死亡）')) : null);
            }))),
          h('h3', null, '附容返生转移'),
          markPanel),
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
    // P5：技能/道具需要选目标时先挂在这里，下一次点角色卡即确认目标。
    var pendState = useState(null);
    var pendingAction = pendState[0], setPendingAction = pendState[1];

    function resetBattle() {
      setState(null);
      setSelected(null);
      setRescueFor(null);
      setError(null);
    }

    function startSeries(mode) {
      setSeries(BP.createSeries(mode, true));
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
      setState(gameApi.createGame(units, { itemBudget: budget, effects: fxIndex() }));
      setPendingAction(null);
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
      if (pendingAction) {
        var act = pendingAction;
        setPendingAction(null);
        if (act.kind === 'skill') run({ type: 'useSkill', unitId: act.unitId, skillIndex: act.index, targetId: id, variant: act.variant, itemId: act.itemId });
        else run({ type: 'useItem', unitId: act.unitId, itemIndex: act.index, targetId: id, variant: act.variant });
        return;
      }
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

    // 技能/道具入口：要目标的挂起等待点选，不需要目标的立即执行。
    // P5-15：variant 为技能分支名；分支自带 target 时以分支为准。
    // P6-Q10：itemId 为「指定一个道具」类技能选中的道具 id。
    function beginAction(kind, unitId, index, effect, variant, itemId) {
      var branch = null;
      if (variant && effect && effect.branches) {
        effect.branches.some(function (b) { if (b.label === variant) { branch = b; return true; } return false; });
      }
      var target = (branch && branch.target) || (effect && effect.target);
      var needTarget = target && target.mode !== 'self' && target.mode !== 'none' && !target.optional;
      setSelected(null);
      setRescueFor(null);
      if (!needTarget) {
        if (kind === 'skill') run({ type: 'useSkill', unitId: unitId, skillIndex: index, variant: variant, itemId: itemId });
        else run({ type: 'useItem', unitId: unitId, itemIndex: index, variant: variant });
        return;
      }
      setPendingAction({ kind: kind, unitId: unitId, index: index, variant: variant, itemId: itemId });
      setError('请点一名角色作为目标（再点一次该技能可取消）');
    }

    function cancelPending() {
      setPendingAction(null);
      setError(null);
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
        onUndo: function () { applyBpAction({ type: 'undo' }); },
        onConfirm: function () { applyBpAction({ type: 'confirmStep' }); },
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
      onSkill: function (unitId, index, effect, variant, itemId) { beginAction('skill', unitId, index, effect, variant, itemId); },
      onItem: function (unitId, index, effect, variant) { beginAction('item', unitId, index, effect, variant); },
      onDestroy: function (unitId, summonId) { run({ type: 'destroySummon', unitId: unitId, summonId: summonId }); },
      pendingAction: pendingAction,
      onCancelPending: cancelPending,
      onPickRescueTarget: function (id) { setRescueFor(id); },
      onRescue: function (targetId, rescuerId) {
        run({ type: 'rescue', targetId: targetId, rescuerId: rescuerId });
        setRescueFor(null);
      },
      onRescueFlyer: function (targetId, rescuerId) {
        run({ type: 'rescue', targetId: targetId, rescuerId: rescuerId, useFlyer: true });
        setRescueFor(null);
      },
      onTransferMark: function (unitId, fromId, toId) {
        run({ type: 'transferMark', unitId: unitId, fromId: fromId, toId: toId });
      },
      onEndTurn: function () { run({ type: 'endTurn' }); setSelected(null); },
      // P7-2（X5）/ P7-3：反应窗口的三个出口（魔术棒 / 役鸟 / 不打断）。
      onInterruptItem: function (itemIndex) {
        if (!state.pendingInterrupt) return;
        run({ type: 'interruptWithItem', unitId: state.pendingInterrupt.targetId, itemIndex: itemIndex });
        setSelected(null);
      },
      onInterruptSkill: function (unitId, skillIndex) {
        run({ type: 'interruptWithSkill', unitId: unitId, skillIndex: skillIndex });
        setSelected(null);
      },
      onResolveInterrupt: function () { run({ type: 'resolveInterrupt' }); setSelected(null); },
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
