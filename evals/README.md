# Agent 工具评测

在同一批任务上，对比 agent 接入不同 jev 工具配置时的 token 消耗和任务得分。首要指标是 token 效率：得分不下降的前提下，token 越少越好。设计和行为约定见 `openspec/changes/add-agent-tool-eval/`。

## 前置条件

- 本机已安装并登录 Claude Code，版本不低于 2.1.284（`claude auth status` 显示已登录）。评测走你的订阅，不需要 Anthropic API key。
- 已执行 `bun install`。jev 组从工作区源码启动 MCP 服务器，需要依赖。
- 跑 jev 组的任务时，终端里要有 `TYPESAFE_API_KEY`。只跑 `baseline`、或只用 `--probes-only` 测工具定义开销时不需要。
- 任务目录里有 `REVIEW.md`（标准答案经过人工复核）才能正式运行。试跑可以加 `--allow-unreviewed`，报告会注明结果不能用来下结论；`--dry-run` 不受这个限制。

## 常用命令

只打印运行矩阵和消耗估算，不启动任何运行：

```bash
bun run eval --dry-run
```

只测各组工具定义占多少上下文（每组一次探测，不需要 key，几分钱）：

```bash
bun run eval --probes-only --arms baseline,jev,jev-all,jev-v0.1.1
```

所有 dev 任务 × 默认 3 个组别（`baseline`、`jev`、`jev-v0.1.1`），每组跑 1 次（先用来校准消耗）：

```bash
bun run eval --reps 1
```

指定任务和组别：

```bash
bun run eval --tasks triage-tickets --arms baseline,jev,jev-directed
```

额度用完后续跑（已完成的运行不会重跑）：

```bash
bun run eval --resume evals/results/<目录名>
```

全部参数：`bun run eval --help`。

## 组别

| 组别 | jev 服务器 | agent 可见的 jev 工具 |
| --- | --- | --- |
| `baseline` | 无 | 无 |
| `jev` | 工作区源码，默认配置 | `jev_ask` |
| `jev-directed` | 同 `jev`，系统提示要求 agent 的判断都交给 jev | `jev_ask` |
| `jev-all` | 工作区源码，`TYPESAFE_TOOLS=all` | 全部 5 个 |
| `jev-v0.1.1` | 上一个发布版本：用 `git archive` 取出标签 `v0.1.1` 的 `src/`，链接本仓库的 `node_modules` 运行，不联网 | 全部 5 个 |

默认跑 `baseline`、`jev`、`jev-v0.1.1`：一次评测里同时回答"接 jev 值不值"和"这版比上一个发布版省了多少"。

## 额度控制

- 默认串行执行。单次运行最多 40 轮、$2；整次评测最多 $30。费用都按 API 标价折算，用来比较消耗，不是订阅的实际扣费。
- 订阅的 5 小时或 7 天窗口用到 85% 时停止启动新运行（`--stop-at-utilization`），给你自己的日常使用留出额度。遇到限额也会停。之后用 `--resume` 续跑。
- 建议先跑一轮 `--reps 1`，看报告里每次运行的平均消耗，再决定重复次数。

## 怎么读报告

每次评测写到 `evals/results/<时间>-<模型>/`（不进 git）：

- `summary.md`：
  - **Token 效率摘要**：每组的平均 token/次、相对 baseline 的变化、得分变化和结论（更省且不降分、更省但降分、更费）。
  - **工具定义开销**：每组第一轮请求的上下文 token，差值就是工具定义占的量。
  - 各任务明细、未计入的运行、未执行的运行。
- `metrics.json`：汇总数据。
- `runs/*.jsonl`：每次运行的完整事件流，已脱敏。

人工整理的结论放到 `docs/evals/`，原始结果不提交。

## 分析和改进流程

1. 跑 dev 任务，看哪一组更省、哪里掉分。
2. 挑几份有代表性的 `runs/*.jsonl` 交给 Claude，让它找出 agent 卡住、误用工具或浪费 token 的地方。
3. 改完工具，在 dev 上重跑，看 `jev` 相对 `baseline` 和上一个发布版（`jev-v0.1.1`）的变化；确认有改进后，再用 `--split holdout` 验证。

## 已验证的 Claude Code 行为

2026-10-08，Claude Code 2.1.284，模型别名 `sonnet` 解析为 `claude-sonnet-5-5`：

- 从 Claude Code 桌面应用的终端启动时，继承的环境变量会让子进程报"未登录"。所以评测只传 `HOME`、`PATH` 等白名单变量；jev 组另外传 `TYPESAFE_API_KEY`。
- `--restricted` 下不加载用户和项目的设置、hooks、CLAUDE.md 和技能。实测 agent 看不到用户全局 CLAUDE.md 里的指令。
- 各组 agent 可见的内置工具都是 Glob、Grep、Read、StructuredOutput，jev 工具见上面的组别表。
- 第一轮上下文（`--probes-only`，Sonnet）：`baseline` 4,310 token，`jev` 5,468，`jev-all` 7,340，`jev-v0.1.1` 9,152。也就是工具定义从 v0.1.1 的 4,842 token 降到 1,158 token（其中 `files` 批量模式约占 240）。
- 宿主会通过 MCP `roots` 告诉服务器项目目录（Claude Code 给的是它的工作目录，评测里就是工作区副本），`jev_ask` 的 `files` 只读这个目录。
- agent 读到的是 MCP 结果的 `structuredContent`（序列化成 JSON），`content` 里的文本不会进上下文；`_meta` 也不进上下文，但会出现在 stream-json 事件的 `tool_use_result` 里。评测从那里读 Jev 的 token 用量（v0.1.1 的用量写在结果 JSON 里，同样能读到）。
- `outputSchema` 不占上下文：有无一段很长的输出 schema，第一轮上下文只差 2 token。
- MCP 配置里给服务器的 `env` 会和 Claude Code 继承下来的环境合并，所以 `jev-all` 设了 `TYPESAFE_TOOLS` 也照样拿得到 `TYPESAFE_API_KEY`。
- 只有这 5 个 MCP 工具时，Claude Code 会一开始就加载它们，不走延迟加载。
- 工具输出过大时，Claude Code 会把完整输出写到 `~/.claude/projects/<工作目录对应的键>/` 下再让 agent 读取。评测在每次运行后删除这些目录，只删名字里带 `typesafe-mcp-eval` 或 `typesafe-mcp-probe` 的。

## 评分规则的形式化保证

`evals/laws/` 用 Bend 2 给代价表加权评分（门控类任务用）加了一道机械检查：

- `LAWS.bend`：评分必须满足的法则，例如全对得满分、得分落在 [0, 1]、缺答按最坏情况算、改对一项不会让总代价变高。由人编写，证明它们的 AI 不能修改。
- `scoring.bend`：评分规则的参考模型；`PROOF.bend`：逐条证明；`lemmas.bend`：证明用到的自然数引理。
- `tests/evals/laws.test.ts`：把 TS 的 `weightedCost` 和参考模型逐个组合对照，确保 TS 实现的就是被证明的那套规则。

需要本机安装 Bend 2。改评分规则或代价表后运行：

```bash
bend evals/laws/PROOF.bend
```

显示 "All terms check." 才算通过。没有安装 `bend` 时，相关测试会自动跳过。

## 新增任务

每个任务一个目录 `evals/tasks/<id>/`：

- `task.ts`：用 `defineTask` 定义提示、split、答案 schema（必须是 `z.object`）和评分规则，并在 `evals/tasks/index.ts` 注册。
- `gold.json`：标准答案。
- `workspace/`：agent 能看到的全部数据。它就是 agent 的工作目录，所以提示里的路径要相对于它写。
- `REVIEW.md`：人工复核标准答案后再加。

数据用英文、全部合成；工作区里不放 `AGENTS.md`、`CLAUDE.md`，也不放 `*.test.*`、`*.spec.*` 这类文件名。`bun test` 会检查标准答案用自身评分规则能得 1.0。
