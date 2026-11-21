// P5 收尾：把已能被引擎表达的 custom 分支回填到批次文件，再走 merge-effects。
// 只改 temp/p5-batches/*.out.json；改完必须依次跑 merge → validate → coverage。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const dir = 'temp/p5-batches';
const files = readdirSync(dir).filter((f) => f.endsWith('.out.json')).sort();
const docs = files.map((f) => ({ f, d: JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) }));
const owner = new Map();
for (const doc of docs) for (const s of [...(doc.d.skills ?? []), ...(doc.d.items ?? [])]) owner.set(s.id, doc);

const flag = (key, value, ref = 'self') => ({ op: 'flag', ref, key, ...(value === undefined ? {} : { value }) });

// drop: { customKey: [替换成的 op...] }；removeOps: 删掉的旧 op。
const RULES = [
  // ---- 反伤通道 ----
  {
    id: 'jisi/羸弱',
    removeOps: ['damageReduce'],
    drop: { reflectOnly: [{ op: 'reflectMod', ref: 'self', delta: -1 }] },
    impl: 'full',
    notes: '仅反伤造成的伤害 -1（reflectMod）',
  },
  { id: 'mangnv/羸弱', drop: { reflectDamageDown: [{ op: 'reflectMod', ref: 'self', delta: -1 }] }, impl: 'full', notes: '自身反伤伤害 -1' },
  { id: 'jixieshi/羸弱', drop: { reflectDamageMinus1: [{ op: 'reflectMod', ref: 'self', delta: -1 }] }, impl: 'full', notes: '自身反伤伤害 -1' },
  {
    id: 'gudongshang/旧伤',
    drop: { noReflectVsHp1: [flag('noReflectVsHp1')] },
    impl: 'full',
    notes: '对血量为 1 的攻击者不反伤',
  },
  // ---- 免疫类标志 ----
  { id: 'gudongshang/身轻如燕', drop: { cannotGainInvulnerable: [flag('noInvulnerable')] }, impl: 'full', notes: '不会获得不可攻击效果' },
  { id: 'maenna/未声张的怒火', drop: { cannotAttackImmunity: [flag('noCannotAttack')] }, impl: 'full', notes: '不会获得不可攻击效果' },
  // ---- 救援能力（关键词特质） ----
  { id: 'jiqiushou/救援', drop: { grantRescue: [{ op: 'grantRescue', ref: 'self' }] }, impl: 'full', notes: '具备救援能力' },
  { id: 'jizhe/救援', drop: { rescue: [{ op: 'grantRescue', ref: 'self' }] }, impl: 'full', notes: '具备救援能力' },
  { id: 'kongjun/救援', drop: { grantRescue: [{ op: 'grantRescue', ref: 'self' }] }, impl: 'full', notes: '具备救援能力' },
  { id: 'muoushi/救援', drop: { rescue: [{ op: 'grantRescue', ref: 'self' }] }, impl: 'full', notes: '具备救援能力' },
  {
    id: 'feixingjia/救援',
    removeOps: ['rescueRule'],
    drop: { rescueNoCostOption: [{ op: 'grantRescueFlyer', ref: 'self' }] },
    impl: 'full',
    notes: '具备救援能力；救援时可消耗一个飞行器使本次救援无伤（rescue 动作的 useFlyer）',
  },
  {
    // P5-28：悬停 = 每局首次伤害免疫 + 立即触发一次飞行器；飞行器耐久 0 时只免伤、不触发。
    // P5-36：免伤口径按 all（攻击伤害与技能伤害都挡）。
    id: 'feixingjia/悬停',
    ops: [
      { op: 'immune', ref: 'self', scope: 'all', uses: 1 },
      { op: 'triggerFlyer', ref: 'self' },
    ],
    impl: 'full',
    notes: '每局首次伤害免疫（攻击与技能伤害都挡，scope=all）；飞行器耐久 >0 时立即触发一次（消耗 1 耐久、回 1 血、上限 +1），耐久 0 时仅免伤',
  },
  {
    // P6 D 块（QA-18/21/22）：飞行器改为己方回合结束自动触发，不再由玩家手动点。
    id: 'feixingjia/飞行器',
    ops: [{ op: 'triggerFlyer', ref: 'self' }],
    trigger: 'ownTurnEnd',
    type: 'passive',
    manual: false,
    duration: 'permanent',
    impl: 'full',
    notes: '己方回合结束自动触发：耐久 >0 时消耗 1 耐久，血量 +1、上限 +1 并计入初始上限；耐久 0 不触发',
  },
  // ---- 救援规则 ----
  {
    id: 'huajia/感性直观',
    drop: { rescueTwice: [flag('rescueLimit', 2), flag('rescueCostDelta', -1)] },
    impl: 'full',
    notes: '可被救 2 次；救援者扣血 2-1=1（Q32）',
  },
  {
    id: 'yeren/救援',
    drop: { rescueFromBaseHp: [flag('mustUseBodyForRescue')], sealedRescueCost: [flag('sealedRescueCost', 2)] },
    impl: 'full',
    notes: '只扣 1 血且必扣本体；被封技能后扣 2 血（D17）',
  },
  { id: 'leide/59区废墟', drop: { cannotBeRescued: [flag('cannotBeRescued')] }, impl: 'full', notes: '不可被救援' },
  // ---- 目标过滤 / 交换 ----
  {
    id: 'jisi/门之钥',
    drop: { ignoreTempStats: [], targetAtkNotZero: [] },
    target: { mode: 'anyCharacter', filter: { atkNotZero: true } },
    impl: 'full',
    notes: '交换攻击力与血量上限；临时值不参与；攻击力 0 不可选',
  },
  // ---- 免死 ----
  { id: 'niuzai/马背英雄', drop: { tempHpLethalSave: [flag('lethalSave')] }, impl: 'full', notes: '有临时血量时致命伤害保留 1 血' },
  // ---- 时长 ----
  {
    id: 'rulianshi/附容返生',
    drop: { durationToNextAllyTurnEnd: [] },
    durationOn: [
      { op: 'shield', duration: 'untilNextOwnTurnEnd' },
      { op: 'deferDamage', duration: 'untilNextOwnTurnEnd' },
    ],
    impl: 'full',
    notes: '救援规则常驻；护盾与延迟持续至下个友方回合结束',
  },
  {
    id: 'jizhe/观测视角',
    drop: { durationNextAllyTurnEnd: [] },
    durationOn: [{ op: 'tempHp', duration: 'untilNextOwnTurnEnd' }],
    impl: 'partial',
    notes: '临时血量持续至下个友方回合结束；令幻影死亡未实装',
  },
  // ---- 护盾分档 ----
  {
    id: 'yuanding/守护',
    drop: { blockOneDamage: [{ op: 'shield', ref: 'self', mode: 'once', duration: 'untilTurnEnd' }] },
    impl: 'partial',
    notes: '护盾为「抵挡一次伤害」；回合开始重获未实装',
  },
  // ---- 邮差 ----
  { id: 'youcha/期待', drop: { mailTargetOptional: [] }, impl: 'none', notes: '仅风味句；效果并入「邮件」的可空目标（Q40）' },
  {
    id: 'youcha/邮件',
    target: { mode: 'anyCharacter', optional: true },
    impl: 'full',
    branches: [
      { label: '急切', ops: [{ op: 'tempHp', ref: 'selfAndTarget', amount: 1, duration: 'turns:2' }] },
      { label: '诀别', ops: [{ op: 'flag', ref: 'selfAndTarget', key: 'letterFarewell', duration: 'turns:1' }] },
      { label: '冷静', if: 'notFirstBigTurn', ops: [{ op: 'modStat', ref: 'selfAndTarget', stat: 'atk', delta: 1, duration: 'turns:1' }] },
      { label: '勇敢', ops: [{ op: 'rescueRule', ref: 'selfAndTarget', value: 1, duration: 'turns:2' }] },
      {
        label: '激励',
        ops: [
          { op: 'extraAttack', ref: 'selfAndTarget', count: 1, duration: 'untilOwnTurnEnd' },
          { op: 'flag', ref: 'selfAndTarget', key: 'atkCap', value: 1, duration: 'untilOwnTurnEnd' },
        ],
      },
      { label: '希望', ops: [{ op: 'heal', ref: 'selfAndTarget', amountExpr: { base: 5, minus: 'alliesAlive' }, healMode: 'add' }] },
    ],
    notes: '六种信件择一，邮差与收信者同享；目标可空则只对邮差生效（Q40）；激励=本回合可再次攻击但有效攻击力上限 1（Q41）',
  },
  // ---- 自身血量支付 ----
  { id: 'xinlixuejia/移情', drop: { selfHpCost: [{ op: 'damage', ref: 'self', amount: 2, kind: 'effect' }] }, impl: 'full', notes: '回血 2，自身支付 2 点' },
  // ---- P5-15 选择类技能（branches） ----
  {
    id: 'gudongshang/藏锋',
    branches: [
      {
        label: '转式',
        durability: 1,
        ops: [{ op: 'modStat', ref: 'self', stat: 'hp', delta: 1, duration: 'permanent' }],
      },
      {
        label: '扫式',
        durability: 3,
        ops: [
          // P5-24：+1 作用于「造成的伤害」（不是攻击力），且只作用于下一次攻击，用完即失效。
          { op: 'modStat', ref: 'self', stat: 'dmgDealt', delta: 1, duration: 'nextAttack' },
          { op: 'flag', ref: 'self', key: 'noReflect', duration: 'nextAttack' },
          // 对目标相邻的两个角色各 1 点伤害：复用攻击流程里的 splash（见 core/game.ts）。
          { op: 'flag', ref: 'self', key: 'splash', value: 1, duration: 'nextAttack' },
          { op: 'flag', ref: 'self', key: 'atkDownOnHit', value: 1, duration: 'nextAttack' },
        ],
      },
    ],
    target: { mode: 'self' },
    impl: 'full',
    notes: '转式/扫式二选一（耐久 5：转式耗 1、扫式耗 3，P5-35）；扫式的「下次攻击 +1（作用于伤害）/ 不反伤 / 相邻溅射 1 / 被击者 -1」均为一次性，用完即失效（P5-24）',
  },
  {
    id: 'jizhe/独家新闻',
    branches: [
      {
        label: '牵制幻影',
        uses: 3,
        ops: [{ op: 'summon', ref: 'self', unit: { name: '牵制幻影', atk: 0, hp: 2, decay: 1 } }],
      },
      {
        label: '救援幻影',
        uses: 1,
        ops: [{ op: 'summon', ref: 'self', unit: { name: '救援幻影', atk: 0, hp: 2, decay: 1 } }],
      },
    ],
    impl: 'full',
    notes: '两种幻影已可召唤（面板 0/2）；分支每局次数上限已实装（牵制 3 / 救援 1）；幻影每个大回合开始血量 -1，归零即消失（P7-2 X1「消失就是死亡」），消失会触发观测视角；主动销毁由观测视角提供',
  },
  {
    // P7 D：基础/升级两条分支；升级扣 1k（1000）且每局限一次。
    id: 'qiutu/线路控制',
    branches: [
      {
        label: '基础',
        ops: [
          { op: 'modStat', ref: 'self', stat: 'atk', delta: -1 },
          { op: 'modStat', ref: 'target', stat: 'atk', delta: 1 },
        ],
      },
      {
        label: '升级',
        kCost: 1000,
        uses: 1,
        ops: [
          { op: 'modStat', ref: 'self', stat: 'atk', delta: -3 },
          { op: 'modStat', ref: 'target', stat: 'atk', delta: 2 },
        ],
      },
    ],
    impl: 'full',
    notes: '基础：自身攻击-1、友方攻击+1；升级：花费1k改为自身-3、友方+2（每局限一次）。攻击力变化按 P7-D3 裁决默认永久',
  },
  {
    // P7 D：换位后己方回合结束排程换回；swapBack 接死亡与低血两条规则。
    id: 'xiaoshuojia/隐喻',
    ops: [
      { op: 'swapPosition', refA: 'self', refB: 'target' },
      {
        op: 'defer',
        ref: 'self',
        delay: 'ownTurnEnd',
        ops: [{ op: 'swapBack', refA: 'self', refB: 'target' }],
      },
    ],
    impl: 'full',
    notes: '与任意角色（含敌方）换位，己方回合结束换回；一方死亡时活着的一方回原位；被互换的另一方换回时血<3则+1（P7-D4 默认裁决）',
  },
  { id: 'kunchongxuezhe/昆虫研究', drop: { summonChongqun: [{ op: 'summon', ref: 'self', unit: { name: '虫群', atk: 0, hp: 2 } }] }, impl: 'full', notes: '召唤虫群（面板 0/2）；耐久 5、每次 -2' },
  { id: 'qianfeng/救援', ops: [{ op: 'grantRescue', ref: 'self' }, { op: 'rescueRule', ref: 'self', hpCost: 1 }], impl: 'full', notes: '具备救援能力；救援只扣 1 血，可扣临时血（QA-23）' },
  // ---- P5-16① 园丁「守护」：上回合未攻击则回合开始重获护盾 ----
  {
    id: 'yuanding/守护',
    ops: [
      { op: 'shield', ref: 'self', mode: 'once', duration: 'untilTurnEnd' },
      { op: 'shield', ref: 'self', mode: 'once', duration: 'untilTurnEnd', when: 'ownTurnStart', if: 'noAttackLastTurn' },
    ],
    impl: 'full',
    notes: '战吼获得一次护盾；己方回合开始若上回合未攻击则重获，持续至回合结束',
  },
  // ---- P5-16② 延迟结算 ----
  {
    id: 'laladuiyuan/鼓舞',
    ops: [
      { op: 'modStat', ref: 'self', stat: 'atk', delta: 2 },
      { op: 'extraAttack', ref: 'self', count: 1 },
      {
        op: 'defer',
        ref: 'self',
        delay: 'nextOwnTurnStart',
        ops: [{ op: 'modStat', ref: 'self', stat: 'atk', delta: -1, duration: 'turns:1' }],
      },
    ],
    impl: 'full',
    notes: '攻击 +2 且可再次攻击；下个己方回合开始攻击 -1，持续一回合',
  },
  {
    id: 'laladuiyuan/激励',
    branches: [
      {
        label: '雀跃',
        cost: 1,
        ops: [
          { op: 'modStat', ref: 'target', stat: 'atk', delta: 1 },
          { op: 'defer', ref: 'self', delay: 'nextOwnTurnStart', ops: [{ op: 'modStat', ref: 'target', stat: 'atk', delta: -1, duration: 'turns:1' }] },
        ],
      },
      { label: '亢奋', cost: 3, ops: [{ op: 'heal', ref: 'target', amount: 2 }] },
    ],
    impl: 'full',
    notes: '雀跃消耗 1 充能：攻击 +1，下个己方回合开始 -1 持续一回合；亢奋消耗 3 充能：回复 2 血',
  },
  {
    id: 'kantanyuan/陨石磁铁',
    branches: [
      {
        label: '降低攻击',
        ops: [
          { op: 'defer', ref: 'self', delay: 'ownTurnEnd', ops: [{ op: 'modStat', ref: 'target', stat: 'atk', delta: -1 }] },
        ],
      },
      {
        label: '下回合无法攻击',
        ops: [
          {
            op: 'defer',
            ref: 'self',
            when: 'ownTurnEnd',
            ops: [
              { op: 'flag', ref: 'target', key: 'cannotAttack', duration: 'untilNextOwnTurnEnd' },
              { op: 'damage', ref: 'self', amount: 1, kind: 'skill' },
            ],
          },
        ],
      },
    ],
    impl: 'full',
    notes: '两抉择已拆分支并在己方回合结束结算；攻击 -1 按 P7-2-X2 裁决为永久',
  },
  // ---- P5-16③ 玛恩纳「解放者」状态机 ----
  {
    id: 'maenna/解放者',
    ops: [flag('noReflect'), flag('unliberated')],
    impl: 'full',
    notes: '未解放时不可攻击、攻击力恒为 0；攻击时不受到反伤',
  },
  {
    id: 'maenna/未宽解的悲哀',
    ops: [
      { op: 'liberate', ref: 'self', amount: 0, delta: 0, when: 'ownTurnStart', if: 'gloryLastTurn' },
      { op: 'modStat', ref: 'self', stat: 'atk', delta: 1, when: 'ownTurnStart', if: 'gloryLastTurn' },
    ],
    duration: 'untilOwnTurnEnd',
    impl: 'full',
    notes: '上回合使用过「未照耀的荣光」则在本回合开始解放并攻击 +1',
  },
  {
    id: 'maenna/未照耀的荣光',
    ops: [
      { op: 'liberate', ref: 'self', amount: 2, delta: 1 },
      { op: 'modStat', ref: 'self', stat: 'atk', delta: 3 },
      { op: 'flag', ref: 'self', key: 'rampDownArm' },
    ],
    impl: 'full',
    notes: '解放 + 攻击 +3 + 相邻溅射 2 + 伤害下限 1；本回合每攻击一次，后续伤害 -1（可叠加）',
  },
  // ---- P5-16④ 记者幻影 ----
  {
    id: 'jizhe/观测视角',
    trigger: 'summonDeath',
    ops: [
      { op: 'tempHp', ref: 'self', amount: 1, duration: 'untilNextOwnTurnEnd' },
      { op: 'grantDestroySummon', ref: 'self' },
    ],
    impl: 'full',
    notes: '幻影被攻击致死后记者获得 1 点临时血量；记者存活时可主动令自己的幻影死亡',
  },
  // ---- P5-16④ 作曲家「组曲 / 调律」 ----
  {
    id: 'zuoqujia/组曲',
    ops: [
      { op: 'modStat', ref: 'self', stat: 'atk', delta: 1, duration: 'permanent', unless: 'suppressSuiteAtk' },
      { op: 'tempHp', ref: 'self', amount: 1, duration: 'untilNextOwnTurnStart' },
    ],
    impl: 'full',
    notes: '每次攻击后攻击 +1、临时血量 +1；调律期间不加攻击力',
  },
  {
    id: 'zuoqujia/调律',
    ops: [
      { op: 'tempHp', ref: 'self', amount: 2, duration: 'untilOwnTurnEnd' },
      { op: 'extraAttack', ref: 'self', count: 1, duration: 'untilOwnTurnEnd' },
      { op: 'flag', ref: 'self', key: 'suppressSuiteAtk', duration: 'untilOwnTurnEnd' },
    ],
    impl: 'full',
    notes: '获得 2 临时血量；本回合可再次攻击但不再触发组曲加攻（剩余回合都压制）',
  },
  // ---- P5-15 / 幸运包裹 ----
  {
    id: 'xingyuner/幸运包裹',
    branches: [
      '忘忧之香', '护腕', '怀表', '机械玩偶', '橄榄球', '手电筒', '魔术棒', '镇静剂', '信号枪',
    ].map((name, i) => ({
      label: name,
      ops: [
        { op: 'grantItem', ref: 'self', item: ['wangyouzhixiang', 'huwan', 'huaibiao', 'jixiewanou', 'ganlanqiu', 'shoudiantong', 'moshubang', 'zhenjingji', 'xinhaoqiang'][i], count: 1 },
        { op: 'itemDiscount', ref: 'self', item: ['wangyouzhixiang', 'huwan', 'huaibiao', 'jixiewanou', 'ganlanqiu', 'shoudiantong', 'moshubang', 'zhenjingji', 'xinhaoqiang'][i], amount: -1 },
      ],
    })),
    impl: 'full',
    notes: '从 9 件「幸运儿可获取」的道具中指定一件并获得，花费 -1',
  },
  // ---- P5-16⑥ 零碎：击球手 CD / 入殓师标记转移 ----
  {
    id: 'jiqiushou/爆发',
    ops: [
      { op: 'modStat', ref: 'self', stat: 'atk', delta: 1 },
      { op: 'flag', ref: 'self', key: 'atkDownOnHit', value: 1, duration: 'untilOwnTurnEnd' },
      { op: 'atkPenaltyOnCd', skill: '爆发', amount: 1 },
    ],
    impl: 'full',
    notes: '本回合攻击 +1；攻击命中后被攻击者攻击 -1 持续一回合；本技能处于 CD 时自身攻击 -1',
  },
  {
    id: 'rulianshi/入殓',
    ops: [
      // P5-26：给友方上标记（转移由 core/game.ts 的 useSkill 处理：上限 = 己方入殓师数量，一人不可有两个）。
      { op: 'mark', ref: 'target', key: 'furongfansheng', delta: 1 },
      { op: 'grantTransferMark', ref: 'self' },
    ],
    // 战吼部分：开局自己就持有附容返生（原文「战吼：自己获得附容返生效果」）。
    battlecryOps: [{ op: 'mark', ref: 'self', key: 'furongfansheng', delta: 1 }],
    impl: 'full',
    notes: '战吼开局自身持有标记；施放=把己方已有的标记转移到目标（先撤后上），上限 = 战场上己方入殓师数量，同一角色不可持有两个',
  },
  // ---- P6 C 块：Q&A 对齐（QA-19/20/25/26） ----
  {
    id: 'yongbing/坚强',
    ops: [
      { op: 'damageToMark', ref: 'self', key: 'yongbingMark' },
      { op: 'drainMarks', ref: 'self', key: 'yongbingMark', amount: 3, when: 'ownTurnEnd' },
    ],
    impl: 'full',
    notes: '受伤改为等量标记（不触发受伤判定、标记无上限）；己方回合结束最多减 3 点标记并扣等量血；濒死时标记清零',
  },
  {
    id: 'kunchongxuezhe/昆虫研究',
    ops: [{ op: 'summon', ref: 'self', unit: { name: '虫群', atk: 0, hp: 2, durability: 5 } }],
    impl: 'full',
    notes: '召唤虫群（面板 0/2，耐久 5）；受伤害时血量与耐久同时扣，任一 ≤0 即死亡；耐久 5、每次 -2',
  },
  {
    id: 'niuzai/套索技艺',
    ops: [
      { op: 'holdDying', ref: 'target', duration: 'permanent' },
      { op: 'sealSkills', ref: 'target', duration: 'permanent' },
      { op: 'untargetable', ref: 'target', by: 'all', duration: 'permanent' },
      { op: 'deferredRescue', ref: 'target' },
    ],
    impl: 'full',
    notes: '保持濒死、封技能、不可为目标；仅牛仔本人可救（其他救援来源被 cannotBeRescued 挡住），牛仔下个己方回合开始若存活则不扣血救援',
  },
  // ---- P6 E 块：道具折扣语义（QA-33/36） ----
  {
    id: 'moshubang',
    ops: [
      { op: 'interruptDamage', ref: 'victim', factor: 0.5 },
      { op: 'itemDiscount', ref: 'self', item: 'moshubang', amount: 1000, scope: 'once' },
    ],
    reaction: 'beforeAttack',
    impl: 'full',
    notes: '反应式道具（P7-2 X5）：攻击宣告后打开打断窗口，受击方使用后本次伤害减半（向下取整）；下次魔术棒 +1k（仅一次，用后清除、不累积）',
  },
  {
    id: 'yongbing/钢铁冲刺',
    ops: [
      { op: 'grantItem', ref: 'self', item: 'huwan', count: 3 },
      { op: 'itemDiscount', ref: 'self', item: 'huwan', amount: -1000, scope: 'turn', duration: 'permanent' },
    ],
    impl: 'full',
    notes: '每小回合第一个对自己用的护腕免花费（-1k，每回合首次），护腕数量照常消耗',
  },
  // ---- P6 F 块：画作绑名（QA-34） ----
  {
    id: 'huajia/艺术敏感',
    ops: [{ op: 'grantItem', ref: 'self', item: 'huazuo', count: 1, nameFrom: 'victim' }],
    impl: 'full',
    notes: '攻击后获得被攻击者的画作；画作实例绑定被攻击者的角色名（每局限两次）',
  },
  {
    id: 'huazuo',
    ops: [{ op: 'flag', ref: 'target', key: 'cannotAttack' }],
    impl: 'full',
    notes: '只能用于与本画作同名（获取时绑定）的 1 个角色，使其下回合无法攻击；目标校验由 useItem 按 nameKey 执行',
  },
  // ---- P6 A 块：玩具匣（QA-32）；P6-Q10 改为道具级选择 ----
  {
    id: 'wanjushang/玩具匣',
    target: { mode: 'none' },
    ops: [
      { op: 'itemDiscount', ref: 'allAllies', item: '$chosen', amount: -1000, duration: 'permanent' },
      { op: 'itemLock', ref: 'allAllies', item: '$chosen', duration: 'turns:1' },
    ],
    impl: 'full',
    notes: '指定玩家持有的一种道具：该道具本大回合不可使用（临时，到大回合末）；其花费永久 -1k。作用于己方全体（道具属于玩家，不属于某个角色）',
  },
  // ---- P7 A 批：条件被动（core/game.ts syncAuras 重算）与战吼条件 ----
  {
    id: 'leide/“复仇者”',
    ops: [{ op: 'modStat', ref: 'self', stat: 'atk', delta: 2 }],
    condition: [{ hpLt: 3 }],
    impl: 'full',
    notes: '血量小于3时攻击力+2（动态条件被动，每次动作后按条件重算）',
  },
  {
    id: 'jixieshi/胆怯',
    ops: [{ op: 'modStatPer', ref: 'self', stat: 'atk', delta: -1, per: 'woundedAllies' }],
    impl: 'full',
    notes: '己方每有一个受伤角色，自身攻击力-1（modStatPer 按数量动态重算）',
  },
  {
    id: 'maoxianjia/格列佛游记',
    ops: [{ op: 'invulnerable', ref: 'self' }],
    condition: [{ allyAlive: 2 }],
    impl: 'full',
    notes: '己方存活≥2（自己+至少一名队友）时获得「不可被攻击」，队友全灭后失效',
  },
  {
    id: 'binghuan/牵绊',
    ops: [{ op: 'modStat', ref: 'self', stat: 'hp', delta: 1 }],
    condition: [{ allyName: '心理学家' }],
    impl: 'full',
    notes: '战吼：仅当「心理学家」在场时血量+1（条件在 battlecry 触发时求值）',
  },
  // ---- P7 B 批：条件被动 / 全局关键词 / 受限救援 ----
  {
    // 带 condition 的常驻被动由 syncAuras 每次动作后重算；selfRescue 同样是可撤销 flag。
    id: 'feixingjia/特发性震颤',
    drop: { onlyRescuer: [] },
    condition: [{ selfUniqueRescuer: true }],
    impl: 'full',
    notes: '己方只有自己可救援时攻击力-1并获得自我救援；出现第二个可救援角色后自动撤销',
  },
  {
    // 关键词减伤由 core/combat.ts 的 attackDamage 读取 flag:veteranOfManor。
    id: 'lvshi/庄园老友',
    drop: { veteranOfManor: [flag('veteranOfManor')] },
    impl: 'full',
    notes: '关键词「庄园老友」：本大回合已受伤后，后续受到的攻击伤害-1（不叠加）',
  },
  {
    id: 'xinlixuejia/牵绊',
    ops: [
      { op: 'grantRescue', ref: 'self' },
      { op: 'rescueRule', ref: 'self', targetName: '病患' },
    ],
    impl: 'full',
    notes: '具备救援能力，但只能救援角色名「病患」的目标；扣血与普通救援相同（2 点）',
  },
  // ---- P7 C 批：道具使用时机 / 攻击后重置 ----
  {
    // 回合结束 +2 仍是 turnEnd；「攻击后改为2」放在同一条目的 afterAttackOps，由 core/game.ts 攻击路径结算。
    id: 'maoxianjia/探险幻想',
    ops: [{ op: 'modStat', ref: 'self', stat: 'atk', delta: 2 }],
    afterAttackOps: [{ op: 'setStat', ref: 'self', stat: 'atk', value: 2 }],
    impl: 'full',
    notes: '回合结束时攻击力+2；攻击后攻击力改为2（setStat 覆盖此前加攻，之后的 +2 仍可叠加）',
  },
  {
    // 战吼部分并入 battlecryOps，主触发改为「使用道具后」。
    id: 'kongjun/精准打击',
    trigger: 'itemUse',
    condition: [{ itemUsed: 'xinhaoqiang' }],
    battlecryOps: [{ op: 'grantItem', ref: 'self', item: 'xinhaoqiang', count: 1 }],
    ops: [
      { op: 'modStat', ref: 'self', stat: 'atk', delta: -1, duration: 'permanent' },
      { op: 'modStat', ref: 'self', stat: 'hp', delta: 1, duration: 'permanent' },
      { op: 'sealSkills', ref: 'target', duration: 'turns:1' },
    ],
    impl: 'full',
    notes: '战吼获得一把信号枪；使用信号枪后空军攻击力-1、血量+1，并额外封禁该次信号枪目标的技能（turns:1）',
  },
  {
    // 「攻击力不可高于1」是常驻限制，放 battlecryOps 开局落地；回血是受击反应。
    id: 'xinlixuejia/应激',
    trigger: 'damaged',
    condition: [{ hpLt: 4 }],
    battlecryOps: [{ op: 'flag', ref: 'self', key: 'atkCap', value: 1, duration: 'permanent' }],
    ops: [{ op: 'heal', ref: 'self', amount: 2 }],
    impl: 'full',
    notes: '攻击力上限 1（常驻 atkCap）；血量 <4 时受击后回 2 血，每局限 2 次（P7-C1 默认裁决）',
  },
  {
    // 战吼部分并入 battlecryOps，主触发改为「使用道具后」。
    id: 'wunv/二重奏',
    trigger: 'itemUse',
    condition: [{ itemUsed: 'bayinhe' }],
    battlecryOps: [{ op: 'grantItem', ref: 'self', item: 'bayinhe', count: 3 }],
    ops: [
      { op: 'modStat', ref: 'self', stat: 'hp', delta: 1, duration: 'permanent' },
      { op: 'flag', ref: 'self', key: 'bayinheBuffPersist', duration: 'permanent' },
    ],
    impl: 'full',
    notes: '战吼获得三个八音盒；使用八音盒后舞女血量+1，并挂「八音盒增益不消失」flag（八音盒本体的抉择式增益已实装，见 P7-2 X6）',
  },
  {
    // P7-2 X6：八音盒从 custom:modalChoice 改为真正的抉择式道具；两个增益都是「一次性状态」。
    id: 'bayinhe',
    branches: [
      { label: '攻击力+1（被攻击后消失）', ops: [{ op: 'modStat', ref: 'target', stat: 'atk', delta: 1, consumedOn: 'attacked' }] },
      { label: '攻击力-1（攻击后消失）', ops: [{ op: 'modStat', ref: 'target', stat: 'atk', delta: -1, consumedOn: 'attack' }] },
    ],
    target: { mode: 'anyUnit' },
    impl: 'full',
    notes: '抉择二选一：目标攻击力+1（其被攻击后清除）或攻击力-1（其攻击后清除）；状态来源带 bayinheBuffPersist（舞女二重奏）时清除被跳过',
  },
  // ---- P7 E 批：状态机 / 条件副作用 ----
  {
    // 目标为他人：CD-1；目标为自己：自身 CD 技能直接就绪（cdDelta 的 selfReady）。
    id: 'laladuiyuan/振奋',
    ops: [{ op: 'cdDelta', ref: 'target', delta: -1, selfReady: true }],
    impl: 'full',
    notes: '目标为他人时其技能 CD-1；目标为自己时自身所有 CD 技能立即就绪，且振奋自身进入 CD（P7-E1 裁决）',
  },
  {
    // 本体血量将要减少时：直接扣 1 点本体血 + 临时血量 3（救援流程触发时改为 2）。
    id: 'muoushi/“路易”',
    ops: [
      { op: 'loseHp', ref: 'self', amount: 1 },
      { op: 'tempHp', ref: 'self', amount: 3, rescueAmount: 2 },
    ],
    impl: 'full',
    notes: '本体血量将减少时自扣 1 点本体血并获得 3 点临时血量；救援扣血前触发时改为 2 点（P7-E2 默认裁决）',
  },
  {
    // 战吼给三个魔术棒；魔术师本人使用魔术棒后，下一次受到的伤害至多 1 点（一次性）。
    id: 'moshushi/魔术演绎',
    trigger: 'itemUse',
    condition: [{ itemUsed: 'moshubang' }],
    battlecryOps: [{ op: 'grantItem', ref: 'self', item: 'moshubang', count: 3 }],
    ops: [{ op: 'flag', ref: 'self', key: 'wandCap1', value: 1 }],
    impl: 'full',
    notes: '战吼获得三个魔术棒；魔术师使用魔术棒后，下一次受到的伤害至多 1 点（伤害结算后消耗该 flag，P7-E3 默认裁决）',
  },
  {
    // 附身目标：目标 +1 临时血；自身获得无上限免疫，目标临时血扣完时由 settlePossession 结束。
    id: 'xiaonvhai/记忆同步',
    ops: [
      { op: 'possession', ref: 'target', scope: 'all' },
      { op: 'tempHp', ref: 'target', amount: 1 },
    ],
    impl: 'full',
    notes: '附身目标：给予 1 点临时血量；附身期间自身免疫（无数量上限）且目标不可攻击；目标临时血扣完时自动结束并移除免疫（P7-E4 裁决）',
  },
  // ---- P7 E2 批：最后 4 个含 custom 的技能 ----
  {
    // 两式都落成充能分支：消耗 1/3 层，引爆额外禁止目标攻击到其下个己方回合结束。
    id: 'zhoushushi/猿猴咒像',
    target: { mode: 'anyCharacter' },
    branches: [
      {
        label: '咒像守护',
        cost: 1,
        ops: [{ op: 'damage', ref: 'target', amount: 1, kind: 'skill' }],
      },
      {
        label: '咒像引爆',
        cost: 3,
        ops: [
          { op: 'damage', ref: 'target', amount: 2, kind: 'skill' },
          { op: 'restrictAttack', ref: 'target', duration: 'untilNextOwnTurnEnd' },
        ],
      },
    ],
    impl: 'full',
    notes: '咒像守护耗充能 1 造成 1 点伤害；咒像引爆耗充能 3 造成 2 点伤害，并使目标直到其下个己方回合结束不可攻击（见 temp/decisions.md P7-E2-1）',
  },
  {
    // 首次使用持续两回合，之后一回合；临时血扣完时整组撤掉加攻与不反伤。
    id: 'yeren/野性伙伴',
    ops: [
      { op: 'tempHp', ref: 'self', amount: 2, group: 'tempHp:wildPartner' },
      { op: 'modStat', ref: 'self', stat: 'atk', delta: 1, group: 'tempHp:wildPartner' },
      { op: 'flag', ref: 'self', key: 'noReflect', group: 'tempHp:wildPartner' },
    ],
    durationByUse: { first: 'turns:2', later: 'turns:1' },
    impl: 'full',
    notes: '获得 2 点临时血量；首次使用加攻/不反伤持续两回合，之后持续一回合；临时血量扣完时整组结束（时长口径见 temp/decisions.md P7-E2-2）',
  },
  {
    // 三个不同时机：救援后得粘土弹；开局起第二个己方回合结束得冷却弹；受伤后得燃烧弹。
    id: 'zajiyanyuan/即兴演出',
    trigger: 'rescue',
    manual: false,
    type: 'passive',
    ops: [{ op: 'grantItem', ref: 'self', item: 'niantudan', count: 1 }],
    parts: [
      {
        trigger: 'ownTurnEnd',
        condition: [{ turnEq: 2 }],
        ops: [{ op: 'grantItem', ref: 'self', item: 'lengquedan', count: 1 }],
      },
      {
        trigger: 'damaged',
        ops: [{ op: 'grantItem', ref: 'self', item: 'ranshaodan', count: 1 }],
      },
    ],
    impl: 'full',
    notes: '救援后获得粘土弹；开局起的第二个己方回合结束且存活时获得冷却弹；受到伤害后获得燃烧弹（第二个己方回合从开局计数，P7-E2-3 默认裁决）',
  },
  {
    // 钢铁护肘在道具表里即「护腕」（佣兵「钢铁冲刺」同源），复用 huwan 的道具数据。
    id: 'wanjushang/安抚物',
    branches: [
      { label: '镇静剂', ops: [{ op: 'grantItem', ref: 'self', item: 'zhenjingji', count: 1 }, { op: 'itemDiscount', ref: 'self', item: 'zhenjingji', amount: -1 }] },
      { label: '魔术棒', ops: [{ op: 'grantItem', ref: 'self', item: 'moshubang', count: 1 }, { op: 'itemDiscount', ref: 'self', item: 'moshubang', amount: -1 }] },
      { label: '忘忧之香', ops: [{ op: 'grantItem', ref: 'self', item: 'wangyouzhixiang', count: 1 }, { op: 'itemDiscount', ref: 'self', item: 'wangyouzhixiang', amount: -1 }] },
      { label: '钢铁护肘', ops: [{ op: 'grantItem', ref: 'self', item: 'huwan', count: 1 }, { op: 'itemDiscount', ref: 'self', item: 'huwan', amount: -1 }] },
    ],
    impl: 'full',
    anyPhase: true,
    usageLimit: { perGame: 1 },
    notes: '四选一：获得对应道具且该道具花费 -1，每局限一次。钢铁护肘映射到道具表「护腕」huwan（见 temp/decisions.md P7-E2-4）；「任意阶段」含对方回合，不再限制本方行动回合',
  },
  {
    // P7-3：役鸟守护改为反应技能——己方角色将要受到伤害时开反应窗口，免疫整次伤害，先知攻击力永久 -1。
    id: 'xianzhi/役鸟守护',
    ops: [
      { op: 'immune', ref: 'target', scope: 'all', uses: 1, duration: 'instant' },
      { op: 'modStat', ref: 'self', stat: 'atk', delta: -1, duration: 'permanent' },
    ],
    reaction: 'beforeDamage',
    impl: 'full',
    notes: '反应技能：己方角色将要受到伤害时（攻击/技能伤害）选择使用，免疫整次伤害，先知攻击力永久 -1；不能主动施放（P7-3 裁决）',
  },
];

let touched = 0;
for (const r of RULES) {
  const doc = owner.get(r.id);
  const s = doc ? [...(doc.d.skills ?? []), ...(doc.d.items ?? [])].find((x) => x.id === r.id) : undefined;
  if (!s) throw new Error(`找不到技能：${r.id}`);
  // P5-15：整组分支替换（幂等：内容相同就跳过）。
  if (r.branches) {
    const same = JSON.stringify(s.branches) === JSON.stringify(r.branches)
      && (s.ops ?? []).length === 0
      && (!r.target || JSON.stringify(s.target) === JSON.stringify(r.target))
      && (r.anyPhase === undefined || Boolean(s.anyPhase) === Boolean(r.anyPhase))
      && (!r.usageLimit || JSON.stringify(s.usageLimit ?? null) === JSON.stringify(r.usageLimit))
      && (!r.impl || s.impl === r.impl);
    if (same) continue;
    s.branches = r.branches;
    s.ops = [];
    if (r.target) s.target = r.target;
    if (r.anyPhase !== undefined) s.anyPhase = r.anyPhase;
    if (r.usageLimit) s.usageLimit = r.usageLimit;
    if (r.impl) s.impl = r.impl;
    if (r.notes) s.notes = r.notes;
    touched += 1;
    continue;
  }
  // P5-16：整组 ops 替换（含 trigger/duration 覆盖；幂等）。
  if (r.ops) {
    const same = JSON.stringify(s.ops) === JSON.stringify(r.ops)
      && JSON.stringify(s.battlecryOps ?? null) === JSON.stringify(r.battlecryOps ?? null)
      && JSON.stringify(s.afterAttackOps ?? null) === JSON.stringify(r.afterAttackOps ?? null)
      && JSON.stringify(s.parts ?? null) === JSON.stringify(r.parts ?? null)
      && JSON.stringify(s.durationByUse ?? null) === JSON.stringify(r.durationByUse ?? null)
      && (!r.target || JSON.stringify(s.target) === JSON.stringify(r.target))
      && (!r.impl || s.impl === r.impl)
      && (!r.trigger || s.trigger === r.trigger)
      && (!r.duration || s.duration === r.duration)
      && (!r.type || s.type === r.type)
      && (r.manual === undefined || s.manual === r.manual)
      && (r.reaction === undefined || s.reaction === r.reaction)
      && (!r.clearReaction || !s.reaction);
    if (same) continue;
    s.ops = r.ops;
    // P6-Q10：ops 路径也要能改 target（玩具匣从 allyUnit 改为 none）。
    if (r.target) s.target = r.target;
    if (r.condition) s.condition = r.condition;
    if (r.battlecryOps) s.battlecryOps = r.battlecryOps;
    else delete s.battlecryOps;
    // P7 C：同一技能条目里的「攻击后部分」。
    if (r.afterAttackOps) s.afterAttackOps = r.afterAttackOps;
    else delete s.afterAttackOps;
    // P7 E2：额外触发时机与「按时长随使用次数变化」。
    if (r.parts) s.parts = r.parts;
    else delete s.parts;
    if (r.durationByUse) s.durationByUse = r.durationByUse;
    else delete s.durationByUse;
    if (r.impl) s.impl = r.impl;
    if (r.notes) s.notes = r.notes;
    if (r.trigger) s.trigger = r.trigger;
    if (r.duration) s.duration = r.duration;
    if (r.type) s.type = r.type;
    if (r.manual !== undefined) s.manual = r.manual;
    // P7-2（X5）：反应式道具标记（只有打断窗口能用的道具）。
    if (r.reaction) s.reaction = r.reaction;
    else if (r.clearReaction) delete s.reaction;
    touched += 1;
    continue;
  }
  const ops = [];
  let hit = false;
  for (const o of s.ops ?? []) {
    if (o.op === 'custom' && r.drop && Object.prototype.hasOwnProperty.call(r.drop, o.key)) {
      hit = true;
      ops.push(...r.drop[o.key]);
      continue;
    }
    if (r.removeOps && r.removeOps.includes(o.op)) {
      hit = true;
      continue;
    }
    ops.push(o);
  }
  if (!hit && !r.force) continue; // 幂等：已回填过就跳过
  s.ops = ops;
  if (r.impl) s.impl = r.impl;
  if (r.notes) s.notes = r.notes;
  if (r.target) s.target = r.target;
  if (r.condition) s.condition = r.condition;
  for (const d of r.durationOn ?? []) for (const o of s.ops) if (o.op === d.op) o.duration = d.duration;
  touched += 1;
}

for (const doc of docs) writeFileSync(`${dir}/${doc.f}`, JSON.stringify(doc.d, null, 2) + '\n', 'utf8');
console.log('rules', RULES.length, 'touched', touched);
