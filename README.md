# IDD

## 这是什么
这是一个回合制游戏 + 当前版本（V0.1）
总目标：内容上完美复刻这个游戏

## 文件路径
D:\写作（？\IDD(？？

## 目录地图
- `IDD制作实现/`  唯一的写入区
- `角色.docx`  角色技能相关，用子智能体进行概括大致内容
- `道具.docx`  道具相关，用子智能体概括大致内容
- `机制.docx`  机制相关，重要！！！
- `Q&A.docx`  细节相关内容，用子智能体概括大致内容
- `场地.docx`  游戏时的界面大致样子，用子智能体概括大致内容
- `普通对局BP流程`  BP环节内容，用子智能体概括大致内容
- `历史版本/` **不要读**
- `AI工作区/` **不要读**

## 术语表
详情见`机制.docx`

## 规则
- 只在 IDD制作实现/ 写入；其他目录只读或不读
- 所有中间产物均写在 IDD制作实现/temp/ 内。
- 改文件用 edit，禁止整篇重写
- 文档正文用 XML 提取，不用 python-docx
- 除了机制内容，其余所有文件均用子智能体阅读，需要具体内容时再询问小模型
- TASK.md为你每次回复、思考都需要遵守的内容
- 冲突与歧义：发现后只在回复里说一句“发现了 N 条”，统一写入 `temp/decisions.md`（裁决表），不逐条追问；用户会一次性回复。`temp/open-questions.md` 仅作原始记录。

## 技术决定（已定，不自行变更）
- 语言/框架：TypeScript + React + Vite，纯前端，桌面浏览器运行。
- 范围：仅本地单机。联网对战、打包 exe 为后话，架构上预留但不实现。
- 架构三层，禁止跨层：`core/` 规则内核（纯函数，无框架无 DOM）、`data/` 数据表（角色/道具/技能/场地/BP 的 JSON）、`ui/` 只渲染内核产出的事件流。
- “完美复刻”指规则与内容一致。场景界面**不要求**与 `场地.docx` 一致，仅供参照，功能与信息齐全即可；细节另行商榷。
- 使用者只熟悉 Python、C++、C#、Unity，不熟悉前端。因此：业务逻辑必须留在 `core/` 与 `data/`，写法接近普通脚本；`ui/` 仅由助手维护；每次交付附“零前端知识也能跑起来”的最短步骤。
- 切换成本窗口：P3（界面）开工前若改用 C#/Unity，代价仅在内核重写；P3 之后不建议切换。

## 目录规划
`core/` `data/` `ui/` `scripts/` `test/` `temp/`（中间产物与计划）

## 非目标
- 不追求界面像素级还原；不做联网；不做 exe 打包；不修改 `TASK.md`。

## 环境与工具链（实测，勿踩坑）
- Node v18.14.1 + npm 可用；**pnpm 未安装**，一律用 npm。
- npm 依赖缓存必须在工作区内（`.npm-cache`），默认缓存在用户目录会被沙箱拒绝。
- **本机沙箱禁止子进程管道（spawn EPERM）**，因此：`vite` / `vitest` 在本项目路径下无法运行（Vite 在非 ASCII 路径上会 exec 外部程序求真实路径，直接 EPERM）；`node --test` 也会因每个测试文件被 spawn 而失败。
- 因此测试链路改为：`tsc` 编译 `core/` 到 `temp/build/core`，再 `node test/index.mjs` 单进程运行 `node:test`。入口统一为 **`npm test`**，已验证 PASS。
- `npm test` 全绿是每个阶段的硬性验收；另 `npm run typecheck` 做类型检查。
- 日常入口：`npm run verify`（类型检查 + 编译 + 16 组测试 + 界面构建 + 界面冒烟）、`npm run play`（跑一整局，日志写 `temp/logs/match.json`）、`npm run check`（校验抽取产物）、`npm run typecheck`；界面单独跑 `npm run ui:build` / `npm run ui:check`。
- 用户侧一键入口：双击根目录 `start.cmd`（先 `ui:build`，再打开 `temp/build/ui/index.html`）。
- 运行时数据在 `data/`（从 `temp/data/` 复制而来），改数据只改 `data/`；`temp/` 只放中间产物与计划。
- Node 18.14 不认识 TS，浏览器也不认识：所有要在浏览器里跑的东西必须先经 `tsc -p tsconfig.build.json` 编译到 `temp/build/core`。
- **UI 路线已定为“无打包器”（E1=B）**：`tsc -p tsconfig.ui.json`（module=AMD + outFile）把 `core/` 编成单文件 `core.js`，配 25 行迷你 AMD 加载器；`data/*.json` 由 `scripts/build-ui.mjs` 内联成 `data.js`（`file://` 下不能 fetch）；React 用 `node_modules` 里的 UMD 副本、不用 JSX。用户侧只需双击 `start.cmd`。禁止引入任何需要子进程的构建工具。

## 当前进度
- 已完成：技术选型、分层与阶段规划（详见 `temp/plan.md`）。
- P0 素材抽取：**已完成**。产物在 `temp/extract/`（机制/角色/道具/QA/BP/场地）与 `temp/data/`（characters.json 43 条、items.json 15 条），自检脚本 `temp/check-extract.mjs` 结果 PASS。
- 裁决 v1：**已完成**。原始问答备份在 `temp/archive/decisions-v1-2026-11-06.md`，可直接照着写代码的版本在 `temp/extract/裁决落地.md`（D01–D21）。**与旧文档冲突时以裁决落地为准。**
- P1 规则内核：**已完成**。`core/` 七个模块（结算顺序、回合时钟、伤害、濒死救援、事件钩子、胜负、对局状态机），15 组测试全绿。
- P2 单场闭环：**已完成**。`core/game.ts` 跑完整局，`npm run play` 输出事件日志到 `temp/logs/match.json`，金标测试锁定结果。
- P3 界面：**已完成**。`ui/`（源码）+ `temp/build/ui/`（产物），无打包器：`tsc` 把 `core/` 编成 AMD 单文件、`data/*.json` 内联成 `data.js`、React 用 `node_modules` 里的 UMD 副本。**双击 `start.cmd`（或 `temp/build/ui/index.html`）即可游玩**：选人（最简版）→ 点己方卡选中 → 点高亮敌人攻击 → 濒死时在右侧选救援者或「放弃救援」。`npm run ui:check` 在 Node 里用 `renderToString` 冒烟：选人界面、对局界面、43 个角色逐个渲染、以及"只用界面动作打完一整局"。
- 濒死规则补充（B01–B04，见 `temp/decisions.md`）：濒死是**强制队列**，队列非空时只能处理队首；同一次攻击双方都濒死时，被攻击者先于攻击者；救援者「救完本体血量 ≥1」才可救（血 2 救 2 被禁）；无人可救时放弃救援不再报错、直接判死。
- 待办：P4 BP 流程 → P5 数据全量（技能 111 个、道具 15 件）→ P6 细节对齐（42 条 Q&A 逐条落测试）。
- 当下任务：P4（BP 规则：先手/后手、全局 BAN、个人 BAN、14k、5 人、稀有度限制）。界面选人区目前是最简版并明确标注「规则未接入」，骨架在 `temp/extract/BP.md`；**14k 预算缺角色价格数据**，需先补数据或补裁决。
- 已登记待办（未开工）：界面上给角色加编号/记号，用于区分同名角色（敌我同名、我方两个同名）。
- 交接文件：当前起点看 `temp/handoff-P4.md`（最新，覆盖 P4 起点、P3 收尾改动与已知坑），历史阶段看 `temp/handoff-P1.md`、`temp/handoff-P2.md`、`temp/handoff-P3.md`。