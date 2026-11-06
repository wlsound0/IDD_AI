# 暂停点：P1 钩子子系统开工前（2026-11-06 01:00）

## 当前状态
- P0 完成，裁决全部落地。
- P1 完成 4/6：结算顺序、回合时钟、伤害计算、濒死与救援。
- `npm test` 11 组全绿，`npm run typecheck` 通过。

## 恢复时的第一件事
新建 `core/hooks.ts` + `test/hooks.test.mjs`，然后在 `test/index.mjs` 加一行 import。
钩子点：回合开始 / 小回合结束 / 大回合结束 / 受伤后 / 攻击后 / 死亡时 / 使用技能后。
执行顺序复用 `core/settlement.ts` 的 `sortEffects`（R21），不要再写第二套排序。

## 设计约束（别忘）
- 钩子必须带 `timeUnit`（small/big），见 R26。
- 被动 63 个、主动 11 个、战吼 15 个、CD 14 个、充能 7 个 → 钩子是最大宗的接入面。
- 召唤物是独立单位、无濒死、不可救援（D06），钩子要对召唤物做特判。

## 未决
无。所有规则疑问均已裁决。

## 环境
Node v18.14.1；用 npm；`vite`/`vitest`/`node --test` 均因沙箱禁止子进程而不可用，测试链路固定为 `tsc -p tsconfig.build.json` + `node test/index.mjs`（即 `npm test`）。
