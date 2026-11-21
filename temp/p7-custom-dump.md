### wanjushang/安抚物
impl=partial trigger=manual target=null dur=- type=active
cfg: {"cost":null,"cd":null,"text":"安抚物：游戏的任意阶段，可获取镇静剂、魔术棒、忘忧之香和钢铁护肘中的任意一个道具，并使其花费减一，限一次。"}
ops: []
notes: 四选一已拆分支；三件道具可获取且花费 -1；钢铁护肘缺道具数据

### yeren/野性伙伴
impl=partial trigger=manual target={"mode":"self"} dur=- type=cooldown
cfg: {"cost":null,"cd":1,"text":"野性伙伴（CD：1）：增加两点临时血量，第一次使用时持续两回合，之后持续一回合。期间野人攻击力+1且攻击时不受到反伤，临时血量扣完时技能自动结束。"}
ops: [{"op":"tempHp","ref":"self","amount":2},{"op":"modStat","ref":"self","stat":"atk","delta":1},{"op":"flag","ref":"self","key":"noReflect"},{"op":"custom","key":"durationByUse","note":"首次持续2回合，之后1回合"},{"op":"custom","key":"endWhenTempHpGone","note":"临时血量扣完时自动结束"}]
notes: 时长随使用次数变化，未写死亡时处理

### zajiyanyuan/即兴演出
impl=partial trigger=rescue target=null dur=- type=passive
cfg: {"cost":null,"cd":null,"text":"即兴演出：杂技演员救援后，获得一个“粘土弹”。第二个己方回合结束时，若杂技演员存活，获得一个“冷却弹”。杂技演员受到伤害后，获得一个“燃烧弹”。"}
ops: [{"op":"grantItem","ref":"self","item":"niantudan","count":1},{"op":"custom","key":"grantsOnSecondOwnTurnEnd","note":"第二个己方回合结束且存活时获得冷却弹"},{"op":"custom","key":"grantsAfterDamaged","note":"受到伤害后获得燃烧弹"}]
notes: 三个不同时机；第二个己方回合从何时计数未写死

### zhoushushi/猿猴咒像
impl=partial trigger=manual target={"mode":"anyCharacter"} dur=- type=charge
cfg: {"cost":null,"cd":null,"text":"猿猴咒像（自己及相邻的两个角色受到伤害时充能一次：0/5）：咒像守护（消耗充能：1）：对一个角色造成1点伤害。咒像引爆（消耗充能：3）：对一个角色造成2点伤害，并使其下个回合不可攻击。"}
ops: [{"op":"custom","key":"charmGuard","note":"耗充能1：对一个角色造成1点伤害"},{"op":"custom","key":"charmDetonate","note":"耗充能3：对一个角色造成2点伤害，并使其下回合不可攻击"}]
notes: 两式充能消耗1/3；上限5，自身及相邻角色受伤时+1
