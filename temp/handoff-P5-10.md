# 交接：P5 遗留清零（2026-11-07）

## 结论

- 三项 P5 遗留全部完成：P5-33（撤销击球手首回合 CD 惩罚）、藏锋两分支耐久（1/3）、悬停免伤覆盖技能伤害（scope=all）。
- `npm run verify` 全绿（30 组测试 + 效果表校验 + 界面构建 + 界面冒烟）。
- 覆盖率：full 79 / partial 28 / none 4，含 `custom` 技能 27 个（原 77/30/4）。无新增未决项。

## 关键改动

1. P5-33：`core/game.ts` 的 `cdPenaltyOf` 增加 `usedPerGame > 0` 前置，从未使用过的技能不计「处于 CD」；测试改为「首回合伤害 2 / 用过且 CD 中伤害 1」。
2. P5-35：`EffectBranch` 新增 `durability`；支付段改为 `branch?.durability ?? effect.cost?.durability`，不足则抛「耐久度不足」；数据走 `scripts/p5-tune.mjs`（转式 1、扫式 3）。
3. P5-36：`EffectContext` 新增 `beforeDamage` 钩子，`dealDamage` 在技能伤害前调用，`core/game.ts` 的 `useSkill` 注入 `fire({trigger:'beforeDamage'})`；数据 `scope:"all"`，`feixingjia/悬停` 升 full。

## 交付物

- 代码：`core/effects.ts`、`core/game.ts`
- 数据：`data/effects.json`（四步链生成）、`scripts/p5-tune.mjs`、`scripts/validate-effects.mjs`
- 测试：`test/effects.test.mjs`（覆盖率断言更新 + 3 组行为断言增强）
- 文档：`README.md`、`temp/decisions.md`（P5-33 落地记录、P5-35、P5-36）、本文件

## 未决问题

- 无。P6（42 条 Q&A 逐条落测试）为下一阶段起点。

## 本次步数

约 20 步工具调用（无子代理）。
