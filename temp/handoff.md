# 交接（截至 P0 完成）

## 结论
P0 素材抽取全部完成并通过自检。下一阶段 P1 被 6 个阻塞裁决卡住：未裁决前不写规则代码。

## 交付物
- `temp/plan.md` 三轮方案，第 5 节为最终方向
- `temp/extract/机制.md` 26 条规则 + 结算算法 + 胜负状态机
- `temp/extract/角色.md`、`temp/data/characters.json`（43 角色 / 111 技能）
- `temp/extract/道具.md`、`temp/data/items.json`（15 件）
- `temp/extract/QA.md`（42 条）、`temp/extract/BP.md`（8 步骨架）、`temp/extract/场地.md`
- `temp/open-questions.md` 全部歧义与冲突
- `temp/check-extract.mjs` 自检脚本（`node temp/check-extract.mjs`，当前 PASS）

## 未决问题（阻塞级）
1. Q01 自我救援是否扣血
2. Q02 濒死何时死亡
3. Q07 僵持计数起算点
4. Q08 “主动触发”定义
5. Q10 攻击次数限制
6. Q12 14k 与道具花费是否同资源
7. C1/C2/C3 CD 计数、画作同名、虫群致死（跨文档冲突）
8. Q25 充能写法语义
9. Q26 双阶段 CD 字段
10. Q27 召唤物是否独立单位
11. Q16/Q17 全局 BAN 生命周期、BO3 缺“不同”
12. Q21 道具花费单位，Q24 召唤物占位

## 下一步
用户裁决上述项 → P1：搭 Vite+TS+Vitest 骨架，实现 `core/` 的回合状态机、结算顺序、CD/充能、伤害与救援。
环境：Node v18.14.1，无 pnpm，用 npm。
