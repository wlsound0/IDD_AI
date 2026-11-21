# 交接：P5 完成，P6 起点（V0.2）

> 给下一个会话看。读完这份就够，不用重读源码。

## 一句话状态
技能 111 + 道具 15 全部有结构化效果规格并接进内核与界面；`npm run verify` 全绿（类型检查 + 22 组测试 + 效果表校验 + 界面构建 + 界面冒烟）。

## 验证入口
- `npm run verify`：typecheck → test（22 组）→ check:effects → ui:build → ui:check。
- `npm run coverage:effects`：重算 `temp/p5-coverage.md`。
- 用户侧：双击 `start.cmd` 或 `temp/build/ui/index.html`。

## 代码地图（P5 新增）
- `core/status.ts`：状态层。所有增减益/护盾/免疫/标记都是带 `expiresAt` 的 `Status`；到期判定用 `order = (bigTurn*2 + phaseIdx)*2 + (at==='end'?1:0)`。
- `core/effects.ts`：op 解释器。`applyOp` 覆盖 30 个原子操作，`custom` 只记事件不执行。
- `core/trigger.ts`：触发调度（R21 排序）+ `canUseSkill` + `computeCanAttack` + `evalCondition`。
- `core/items.ts`：道具价格（含 `itemDiscount`）、预算支付。
- `core/units.ts`：`indexEffects` / `buildUnitSkills`，把 `characters.json` + `effects.json` 拼成运行时技能。
- `core/game.ts`：新增 `useSkill` / `useItem` 动作、召唤物 `buildSummon`、回合切换时的 `purgeExpired` / 充能 +1 / CD +1 / 各类触发。
- `data/effects.json`：唯一效果表；改它请改 `temp/p5-batches/*.out.json` 后跑 `node scripts/merge-effects.mjs`，不要手改。
- 脚本：`scripts/split-skills.mjs`（切批）、`scripts/merge-effects.mjs`、`scripts/validate-effects.mjs`、`scripts/coverage-effects.mjs`、`scripts/audit-skills.mjs`。

## 关键决定（别改回去）
1. `canAttack` 不看攻击力：R11 说 0 也能攻击，只有 `cannotAttack` 标记才算不能进攻。
2. 双方从未进攻 → 判后手胜（`lastAggressor ?? 'second'`）。
3. `turns:N` = N 个大回合；到期统一在小回合边界 purge。
4. 道具花费从 `itemBudget` 扣，不足直接拒绝；`state.effects` 必须由调用方注入（界面已注入）。
5. 效果表 `impl` 三档：full 46 / partial 62 / none 3；`custom` 不等于「随便糊过去」，数值必须在 key/note 里。
6. 邮差「期待」已是 `passive`（Q40），`unknown` 分支不再存在。

## P6 起点
1. 42 条 Q&A 逐条落测试（原始材料 `temp/extract/QA.md`）。
2. 收尾 62 条含 `custom` 的技能；重点：换位、延迟伤害、护盾「抵挡一次 vs n 点」、反伤免疫、亡计、邮差六种信件、召唤物面板（原文未给数值，需裁决）。
3. 待确认的规格缺口见 `temp/decisions.md` 的 P5-9（充能速率 / 「下个友方回合结束」/ 护盾语义）。
4. BP「撤回上一步 + 每步确认」仍待开工。

## 已知坑
- 沙箱禁子进程：测试只能走 `test/index.mjs`。
- `data/characters.json` 被重写过一次（Q40），无 BOM；再有 BOM 会导致 `JSON.parse` 直接失败。
- 技能按钮只在「当前小回合方」的角色卡上可点；需要目标的技能点一次后再点目标。
- `temp/data/` 是旧抽取产物，运行时只认 `data/`。
