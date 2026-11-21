# 交接：P5 收尾第一档之后（2026-11-07）

> 状态以本文件为准。**不要**重跑全量验证去"重新发现"：交接时 `npm run verify` 已全绿（typecheck + 23 组测试 + 效果表校验 + 界面构建 + 界面冒烟）。

## 一句话状态

P5 收尾推进了第一档：新 op 落地 + 20 个技能回填，`custom` 从 **92 次 / 62 技能** 降到 **63 次 / 44 技能**；覆盖率 **full 63 / partial 44 / none 4**。剩下的是**分支机制、召唤物数值、状态机**三类，不是重建。

## 已完成（不用重做）

### 内核（`core/`）

- `shield` 分档：`{op:'shield', mode:'once'}` = 抵挡一次伤害。`status.ts` 用 **value = -1 作哨兵**，`consumeShield` 整次吞掉后移除；`totalShield` 已排除哨兵（界面若要显示请用 `hasShieldOnce`）。
- `reflectMod`：只改反伤数值，落成 `flag` key=`reflect` 的累加值；反伤路径在 `game.ts` 攻击分支，已叠加 `noReflectVsHp1`（血量为 1 的攻击者不反伤）。
- `grantRescue`：授予「救援」关键词能力。**关键**：`trigger:"always"` 的被动过去从不结算，现由 `game.ts` 的 `applyAlwaysPassives` 在 `createGame` 里跑一次，但**只跑静态授予类 op**（`grantRescue`/`flag`/`reflectMod`/`shield`/`immune`/`untargetable`/`invulnerable`）；`modStat` 这类动态增减故意不跑。
- `rescueRule` 扩展：`limit`（可被救次数）、`costDelta`（救援者扣血增减）、`noHalve`、`fromBaseHp`（必扣本体）、`sealedCost`（封技能后扣血）。这些落成 `flag`，由 `rescue.ts` 的 `withRescueStatuses` 叠加到单位字段；`game.ts` 三处调用点（`resolveDying` / `legalRescueOps` / rescue 动作）已全部套用。
- 新 flag：`cannotBeRescued`（`isRescuableAtAll` 首选判断）、`lethalSave`（有临时血量时致命伤害保留 1 血，在 `combat.applyDamage` 里）。
- `duration` 新增 `untilNextOwnTurnEnd` / `untilNextAllyTurnEnd`（同义）/ `untilNextEnemyTurnEnd`；**op 可自带 `duration` 覆盖技能级取值**（`runEffect` 已改）。
- 目标过滤 `filter.atkNotZero`（门之钥），在 `useSkill` 校验。
- 修了三个旧 bug：`swapStat` 对 hp/maxHp 取错基值且只回写 atk；`legalAttackTargets` 不校验 `cannotAttack`（前锋「机械盲」现在点不出攻击目标）；`always` 被动从不结算。

### 数据

- 回填脚本 `scripts/p5-tune.mjs`（**幂等**，按 `drop/removeOps/force` 规则改 `temp/p5-batches/*.out.json`）。跑完必须依次：`node scripts/p5-tune.mjs` → `merge-effects.mjs` → `validate-effects.mjs` → `coverage-effects.mjs`。
- 已覆盖：祭司/盲女/机械师羸弱、古董商旧伤与身轻如燕、玛恩纳未声张的怒火、5 个「救援」关键词（飞行家保留 partial）、画家感性直观、野人救援、雷德 59 区废墟、门之钥、牛仔马背英雄、入殓师附容返生、记者观测视角、园丁守护（护盾部分）、邮差期待/邮件、心理学家移情。
- `test/effects.test.mjs` 覆盖率断言已更新为 63/44/4，并新增 6 条行为断言（护盾分档、反伤修正、不反伤血 1、grantRescue 开局授予、救援次数/不可被救、新 duration）。

## 未完成（下一会话按此顺序接力）

1. **P5-10【阻塞】召唤物面板**：牵制幻影 / 救援幻影 / 虫群。原文 0/2（攻击/血量，R09）+ 耐久，但攻击力来源需确认。需用户裁决后才能写 `summon`。**裁决表在 `temp/decisions.md` 的「P5 落地默认」P5-10。**
2. **P5-15【阻塞】选择类技能**：藏锋（转/扫）、独家新闻（两个幻影）、陨石磁铁（两抉择）、安抚物（四选一）、幸运包裹（指定道具）、邮差邮件（六信件）。方案：`useSkill` 动作加 `variant`，技能用 `branches:[{label,ops}]`；界面在技能按钮弹小菜单。**这是唯一需要动 `ui/app.js` 的一块。**
3. **P5-16 非阻塞清单（建议顺序）**：
   - ① 园丁「守护」回合开始「上回合未攻击则重获护盾」→ 需要一个 `lastTurnNoAttack` 类 condition。
   - ② 延迟结算队列（调律、鼓舞、激励、陨石磁铁）：需要 `GameState` 上的 pending 列表 + 回合边界结算，`deferDamage` 现在只落了个 flag。
   - ③ 玛恩纳「解放者」状态机（解放者 / 未宽解的悲哀 / 未照耀的荣光 三技能互相依赖）。
   - ④ 记者幻影的主动销毁与「受击触发」绑定。
   - ⑤ 邮差六种信件的持续与上限。
   - ⑥ 零碎：入殓师标记转移、藏锋相邻伤害、击球手 CD 惩罚、飞行家「消耗飞行器免扣血」。
4. 剩余 **44 条 partial** 的 `custom` 明细见 `temp/p5-coverage.md`（按 custom 键可直接读出缺哪一类）。
5. `temp/decisions.md` 里 P5-11 ~ P5-14 是「已按默认实现、等用户点头」的规则口径，改口径要同步改代码与测试。

## 方案漏洞（写给自己，别重复踩）

1. **漏了界面层**：原计划假设「全是 DSL + 内核 + 数据」，实际有 6 类技能必须让玩家在使用前二选一，绕不开 `ui/`。这类需求要提前在方案里单列。
2. **优先级口径错**：写「高频优先」是无效描述。有效的切分口径是「能否被现有原子操作表达」——按它能一次回填 20 个技能；按「高频」会卡在无法量化上。
3. **"只改数据"不成立**：想回填数据，先得修内核（见上面三个 bug）。以后排期要把「先补内核再回填」当默认，而不是例外。
4. **度量口径偏了**：用「技能条数」衡量覆盖率会把一个技能里的 3 个 custom 算成 1 条；`custom` op 次数（92→63）更接近真实工作量。
5. **静态/动态被动没分开**：`trigger:"always"` 里既有「开局授一次」又有「持续判定」，一开始混为一谈，导致 5 个救援技能空转。现已用 `STATIC_OPS` 白名单区分，新增 always 技能时先判断属于哪类。

## 规矩（别踩）

- 改数据只改 `data/` 或 `temp/p5-batches/*.out.json`（再 merge）；`temp/data/` 是旧抽取产物，别动。
- `data/effects.json` 是生成物，**不要手改**。
- 测试只能走 `test/index.mjs`（沙箱禁子进程：`node --test` / `vitest` 都会 EPERM）。
- 新增 core 模块或改 `core/` 的导出后，必须 `npm run ui:build`，`ui/app.js` 的 `require([...])` 才拿得到。
- 写 JSON 一律 UTF-8 无 BOM（`JSON.parse` 遇 BOM 直接炸）。
- 同一文件多次修改合并成一次 edit；文档正文用 XML 提取。

## 入口

- 交接起点：本文件；上一份 `temp/handoff-P5-2.md`；阶段起点 `temp/handoff-P6.md`。
- 覆盖率现状：`temp/p5-coverage.md`；DSL 说明：`temp/p5-effect-spec.md`；待裁决：`temp/decisions.md`（P5 段）。
