# 交接：P5 后续（给下一个会话，2026-11-07）

> 状态以本文件为准，不要重跑全量验证去"重新发现"。

## 一句话状态
P5 主体已落地并全绿（typecheck + 22 组测试 + 效果表校验 + 界面构建 + 界面冒烟）。剩下的是**收尾与补数据**，不是重建。

## 已完成（不用重做）
- `data/effects.json`：111 技能 + 15 道具，格式见 `temp/p5-effect-spec.md`；由 `scripts/merge-effects.mjs` 从 `temp/p5-batches/*.out.json` 生成，不要手改。
- 覆盖率：技能 full 46 / partial 62 / none 3；道具 full 8 / partial 7；明细 `temp/p5-coverage.md`，分类审计 `temp/p5-skill-audit.md`。
- 内核：`core/status.ts`（到期时间状态层）、`core/effects.ts`（30 个 op）、`core/trigger.ts`（R21 调度 + canUseSkill + computeCanAttack + evalCondition）、`core/items.ts`、`core/units.ts`。
- 对局：`useSkill` / `useItem` 动作、`itemBudget` 扣费、召唤物、战吼开局结算、回合边界清理/充能/CD/触发、`canAttack` 按 R11 判（只有 `cannotAttack` 才算不能进攻）、从未进攻判后手胜。
- 界面：技能/道具按钮 + 选目标流程；`effects.json` 已内联进 `data.js`；`ui:check` 有按钮断言。
- Q40：邮差「期待」已由 `unknown` 改为 `passive`，`data/characters.json` 被重写过一次（无 BOM，别用带 BOM 的方式写它）。

## 未完成（P6 起点，按优先级）
1. **62 条含 `custom` 的技能**：清单在 `temp/p5-coverage.md`。重点缺口：
   - 护盾「抵挡一次伤害」与「抵挡 n 点」没有分档；
   - 换位（隐喻/门之钥）、延迟到回合末结算的伤害、反伤免疫、亡计；
   - 邮差六种信件只落了一个 custom，未拆分支；
   - 召唤物面板未给数值（牵制幻影/救援幻影/虫群）→ 需要裁决后再写 `summon`；
   - 条件类技能（牵绊、胆怯等）因 DSL 没定义 condition 字段被标 custom，需先补规格再回填。
2. **规格缺口（需用户裁决，已登记在 `temp/decisions.md` P5-9）**：
   - 充能速率：现一律每小回合 +1，原文有「每两回合充能一次」；
   - 「持续到下个友方回合结束」缺 duration 取值，现用 `turns:2` 近似；
   - 护盾语义未分档。
3. **42 条 Q&A 逐条落测试**（材料 `temp/extract/QA.md`），这是 P6 的主线。
4. **BP「撤回上一步 + 每步确认」**：仍未开工，`applyBp` 是纯函数，界面留 BpState 历史栈即可撤回。
5. `scripts/play.mjs` 仍用固定合成阵容，未走 `data/` + BP；P6 可考虑让它跑真实阵容。

## 规矩（别踩）
- 改数据只改 `data/`；`temp/data/` 是旧抽取产物。
- 测试只能走 `test/index.mjs`（沙箱禁子进程）。
- 界面走 AMD：新增 core 模块后要 `ui:build`，`ui/app.js` 里 `require([...])` 才拿得到。
- 同一文件多次修改请合并为一次 edit；文档正文用 XML 提取，不用 python-docx。
