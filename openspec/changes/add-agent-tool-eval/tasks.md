# Tasks

## 1. P0 — 准备

- [x] 1.1 从 `main` 开分支 `feature/agent-tool-eval`。如果 `package.json` 里还有对 `typesafe-mcp` 自身的依赖，先用一个单独的 `chore` 提交移除它。然后执行 `bun install`。验证：改动前 `bun test` 和 `bunx tsc --noEmit` 全部通过。
- [x] 1.2 修改配置：`tsconfig.json` 的 `include` 加入 `evals`；`.oxlintrc.json` 允许 `evals/**/*.ts` 使用 `console`；`.gitignore` 加入 `evals/results/`；`package.json` 加入 `"eval": "bun run evals/run.ts"`。验证：`bunx tsc --noEmit` 和 `bunx oxlint` 通过，`git check-ignore evals/results/x` 有输出。

## 2. P0 — 启动与隔离

- [x] 2.1 实现 `evals/harness/claude.ts`：按 design D2 拼接 `claude -p` 参数；按 D3 构造环境变量白名单；启动前检查 CLI 版本不低于 2.1.284、在干净环境下 `claude auth status` 显示已登录、仓库里有 `node_modules`，任一项不满足就给出明确提示并退出。验证：`tests/evals/claude.test.ts` 覆盖各组别的参数快照、白名单里不含宿主注入的变量、`baseline` 不含 `TYPESAFE_API_KEY`、三种前置检查失败时的提示文字（用模拟的子进程，不真的启动 `claude`）。
- [x] 2.2 实现 `evals/arms.ts`：声明各个组别（现为 `baseline`、`jev`、`jev-directed`、`jev-all`、`jev-v0.1.1`）；为每组生成 MCP 配置、`--allowedTools`、`--disallowedTools` 和预期工具清单（D4）。验证：`tests/evals/arms.test.ts` 断言 `jev` 只看得到 `jev_ask`，jev 组的 MCP 配置指向工作区的 `src/index.ts`，`baseline` 的 `mcpServers` 为空。
- [x] 2.3 实现 `evals/harness/workspace.ts`：每次运行把任务工作区复制到新的临时目录，结束后删除；加上 `--keep-workspaces` 时保留。验证：`tests/evals/workspace.test.ts` 断言两次运行的目录互不影响，删除和保留都按预期生效。
- [x] 2.4 手工验证隔离：每个组别用一个简单提示真实运行一次，确认工具清单与预期一致，确认 agent 上下文里没有用户 CLAUDE.md 的内容（问它能否看到 RTK 相关指令）。把 CLI 版本、各组工具清单和结论写进 `evals/README.md` 的"已验证的 Claude Code 行为"一节。验证：该节存在，并列出 4 个组别的工具清单。

## 3. P0 — 事件解析、状态判定与探测

- [x] 3.1 录制样本：真实运行若干次，覆盖已作答、工具报错、没有结构化输出、达到最大轮数、达到费用上限等情况，保存到 `tests/evals/fixtures/streams/*.jsonl`。订阅限额的样本难以主动触发，按已观察到的 `rate_limit_event` 和 `result` 结构手工构造，并在文件里注明。提交前去掉本机路径、会话 id 和账号信息。验证：每个状态至少有一个样本，并且 `rg` 检查样本里没有 `/Users/`、邮箱或 key 字样。
- [x] 3.2 实现 `evals/harness/stream.ts`：把事件流解析成运行记录和单次指标（D6），包括按模型分开的 token、各工具调用次数和报错、jev 参数与结果的字符数、Jev 用量、工具耗时和结束状态。验证：`tests/evals/stream.test.ts` 用 3.1 的样本覆盖每种结束状态，并覆盖 spec 中"两次 `jev_ask` 的 Jev 用量合计 803"的场景。
- [x] 3.3 （2026-10-08 用 `--probes-only` 实测，不需要 key：`jev-v0.1.1` 的 5 个工具占 4,842 token，与 4,844 一致）实现 `evals/harness/probe.ts`：每个组别跑一次探测，记录第一轮上下文 token（D7）。验证：`tests/evals/probe.test.ts` 用样本测试计算逻辑；手工运行时，在同一 CLI 版本下，`baseline` 和 `jev-all` 的差值与可行性测试的 4,844 一致或相近，差异较大时在 README 里说明原因。
- [x] 3.4 实现写盘前脱敏（D12）：所有文本先经过 `redact`，再把 `TYPESAFE_API_KEY` 的值替换为 `***`。验证：`tests/evals/redact.test.ts` 断言含 key 的工具结果写盘后只剩 `***`。

## 4. P0 — 调度、续跑与报告

- [x] 4.1 实现 `evals/harness/schedule.ts` 和 `evals/run.ts`：支持参数 `--tasks`、`--split`（默认 `dev`）、`--arms`、`--reps`、`--model`、`--effort`、`--max-turns`、`--max-run-usd`、`--max-total-usd`、`--timeout-min`、`--concurrency`、`--dry-run`、`--resume`、`--keep-workspaces`；按"重复 → 任务 → 组别"交错执行；处理总费用上限和单次超时；`--resume` 跳过已有终态的运行，重跑 `rate_limited` 和 `error`（D10、D11）。验证：`tests/evals/schedule.test.ts` 覆盖 2×2×3 共 12 次的矩阵、按 split 选择、未知 id 以非零状态退出且不启动子进程、交错顺序、达到总上限后停止调度、续跑只执行未完成的运行。
- [x] 4.2 实现 dry-run：打印运行清单和消耗估算（有历史结果时用实际均值，否则按每次 0.5 美元估算），不启动任何子进程。验证：测试断言 dry-run 时子进程启动次数为 0；`bun run eval --dry-run --arms baseline,jev-all --reps 3` 在仓库根目录能直接执行。
- [x] 4.3 实现 `evals/harness/report.ts`：生成 `metrics.json` 和 `summary.md`。报告开头写明模型、CLI 版本、git 提交、未提交的改动文件和实际 effort；正文按"组别 × 任务"列出均值、最小值、最大值和相对 baseline 的变化，包括工具定义开销表、jev 实际使用率，以及无效、限额中断和未执行的运行清单；缺少 baseline 时注明。验证：`tests/evals/report.test.ts` 用假数据做快照测试，覆盖"有 baseline"、"无 baseline"、"工作区有改动"三种情况。
- [x] 4.4 编写 `evals/README.md`：前置条件（Claude Code 已登录、已执行 `bun install`、jev 组需要 `TYPESAFE_API_KEY`）、常用命令、订阅额度提示与续跑方法、报告怎么读，以及手工分析流程（把运行记录交给 Claude 找出工具的问题，改动放到单独的 change）。验证：README 里的每条命令在仓库根目录都能执行；需要真实运行的命令用 `--dry-run` 检查。

## 5. P0 — 评分规则与首批 4 个任务

- [x] 5.1 实现 `evals/verifiers.ts`：`exact`、逐项准确率（可设字段权重）、集合 F1、代价表加权，以及标签和路径的归一化（D9）。验证：`tests/evals/verifiers.test.ts` 覆盖 spec 中的评分场景（同一答案得分相同、F1 = 0.75、误自动批准按更高代价扣分）和归一化。
- [x] 5.2 实现 `evals/tasks/types.ts`、`evals/tasks/index.ts`，以及从答案 schema 生成 `--json-schema`（外加可选的 `feedback`）、读取 `structured_output` 后再校验的逻辑（D5）。验证：`tests/evals/tasks.test.ts` 断言生成的 JSON Schema 是带 `required` 的 object，`feedback` 为可选，不合法的结构化输出会被判为 `no_answer`。
- [x] 5.3 编写 `triage-tickets`、`refund-gating`、`repo-feature-files`、`payment-log-duplicates` 四个任务的工作区数据、`gold.json` 和 `task.ts`：英文，加入歧义和干扰项，工作区里不放 `AGENTS.md` 和 `CLAUDE.md`（D8）。验证：测试断言每个任务的标准答案用自身评分规则得 1.0，并且所有工作区里都没有 `AGENTS.md` 和 `CLAUDE.md`。
- [ ] 5.4 维护者人工复核这 4 个任务的标准答案，把复核人、日期和改动记在各任务目录的 `REVIEW.md`。验证：没有 `REVIEW.md` 的任务默认不能运行（`tests/evals/run.test.ts` 覆盖），`--allow-unreviewed` 只用于试跑且报告会注明。

## 6. P0 — 首次评测与基线报告

- [ ] 6.1 试跑：4 个任务 × 默认 3 个组别 × 1 次，共 12 次运行，用实际消耗校准估算。验证：12 次运行都有终态，`summary.md` 已生成，探测结果包含 3 个组别。
- [ ] 6.2 根据 6.1 的消耗决定重复次数（默认 3），跑完整的 P0 矩阵；遇到订阅限额就等额度恢复后续跑。验证：最终报告里没有残留的 `rate_limited` 运行；`invalid` 为 0，或者在报告中说明了原因。
- [ ] 6.3 把结论整理到 `docs/evals/<日期>-baseline.md`：H1 到 H4 各自是成立、不成立还是数据不足，并附关键数字；列出下一个 change 的候选（传路径、服务端排序、`response_format`、减少工具数量），以及每个候选应该改善哪项指标。验证：文档里引用的每个数字都能在对应的 `metrics.json` 里找到。
- [ ] 6.4 提交 P0（`feat(evals): add Claude Code headless eval harness`、`docs(evals): add baseline report`）并开 PR 到 `main`。验证：`bun test`、`bunx tsc --noEmit`、`bunx oxlint` 在本地通过；CI 通过，且 CI 没有启动任何评测运行。

## 7. P1 — 扩充任务集

- [ ] 7.1 编写其余 4 个 dev 任务：`docs-page-finder`、`citation-check`、`bug-severity`、`skill-selection`。验证：标准答案自评 1.0，工作区检查通过。
- [ ] 7.2 编写 4 个 holdout 任务：`triage-tickets-b`、`moderation-gating`、`contract-checklist`、`module-impact-files`。验证：标准答案自评 1.0；`--split` 默认值下不会选中它们。
- [ ] 7.3 维护者人工复核 7.1 和 7.2 的 8 个任务，补齐 `REVIEW.md`。验证：5.4 的测试在 8 个任务注册后仍然通过。
- [ ] 7.4 跑完整的 dev 矩阵，更新基线报告。验证：`docs/evals/` 里的报告覆盖 8 个 dev 任务，引用的数字能在新的 `metrics.json` 里找到。
- [ ] 7.5 在根目录 `README.md` 加"评测"一节，链接到 `evals/README.md`，说明评测会消耗订阅额度、不在 CI 里运行。验证：链接可用，文字与 `evals/README.md` 一致。

## 8. 评分规则的 Bend 法则（实验）

- [x] 8.1 编写 `evals/laws/scoring.bend`（参考模型）和 `evals/laws/LAWS.bend`（9 条法则）。验证：`bend evals/laws/LAWS.bend --check-only` 只报告 9 个待证明项，没有类型错误。
- [x] 8.2 把 `refund-gating` 的代价表导出为 `REFUND_COST`，编写 `evals/laws/table.bend` 和 `tests/evals/laws.test.ts`。验证：单条目 12 种、两条目 144 种组合的 TS 得分与 Bend 模型一致。
- [x] 8.3 编写 `evals/laws/PROOF.bend`（必要时加 `lemmas.bend`），不改 `LAWS.bend`。验证：`bend evals/laws/PROOF.bend` 显示 "All terms check."，`bun test tests/evals/laws.test.ts` 全部通过。
- [x] 8.4 在 design（D13）和 `evals/README.md` 里说明法则的分工和运行方法。验证：README 里的命令能直接执行。

## Workflow follow-up

- 合并后按 CONTRIBUTING 的流程归档本 change（`openspec archive add-agent-tool-eval`），让 `agent-tool-eval` 进入 `openspec/specs/`。
- 根据基线报告开下一个工具重构的 change，并把这套评测作为它的验收方式：先在 dev 上对比，确认后再跑 holdout。
