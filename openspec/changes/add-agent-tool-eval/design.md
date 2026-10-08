# Design

## Context

动机见 proposal.md 的 Why，行为要求见 `specs/agent-tool-eval/spec.md`。这里只记录影响实现方式的现状和约束。

**现状**

- MCP server 有 5 个工具（`jev_models`、`jev_check`、`jev_classify`、`jev_score`、`jev_ask`）。测试只有 fixture 回放的单元测试、`tests/stdio.test.ts` 的工具列表测试和一个调用真实 API 的集成测试，没有 agent 层面的评测。
- 可以复用的部分：`tests/stdio.test.ts` 已经演示了用 `bun run src/index.ts` 通过 stdio 启动 server；`src/errors.ts` 的 `redact` 能遮掉 Bearer 和 key；zod v4 自带 `z.toJSONSchema`。
- 本机目前没有 `node_modules`；`package.json` 里还有一处对 `typesafe-mcp` 自身的误加依赖，没有提交。

**约束**

- 工具链是 Bun + TypeScript，按 CONTRIBUTING 不引入 Python。
- 维护者选择用 Claude Code 无头模式跑评测，走订阅额度，不用 Anthropic API key。订阅额度有限，评测必须能中断和续跑。
- Jev 擅长语义判断，不擅长数值、日期比较和多跳推理，英文效果最好（官方 `jev-1.13` jaggedness 文档）。任务设计要考虑这一点。

**可行性测试结论（2026-10-08，Claude Code 2.1.284，模型别名 `sonnet` 解析为 `claude-sonnet-5-5`）**

1. 在 Claude 桌面应用的终端里直接启动 `claude -p` 会报"未登录"，因为继承了桌面应用注入的环境变量；用只含 `HOME`、`PATH` 等基本变量的干净环境启动，就能用订阅登录正常运行。
2. `--restricted` 配合干净环境时：登录正常，用户的 CLAUDE.md、技能和插件都没有加载（只剩 3 个内置插件），工具只有 `Read`、`Grep`、`Glob`、`StructuredOutput`，以及 `--mcp-config` 指定的 MCP 工具。
3. `--safe-mode` 会把 `--mcp-config` 指定的服务器也禁用掉，不能用；`--bare` 只接受 API key，也不能用。
4. 只有 5 个 jev 工具时，它们在一开始就加载，没有走工具搜索的延迟加载。
5. 第一轮上下文：只有 Read、Grep、Glob 时 4,600 token；加上 5 个 jev 工具后 9,444 token；差值 4,844 token。
6. `--disallowedTools` 会把列出的 MCP 工具从模型可见的清单里去掉；`--allowedTools mcp__jev` 加 `--permission-mode dontAsk` 时，jev 工具不用确认就能调用。
7. `claude` 进程的环境变量会传给它启动的 MCP 服务器，`TYPESAFE_API_KEY` 不用写进配置文件。
8. `--json-schema` 会增加一个 `StructuredOutput` 工具，最终答案出现在结果消息的 `structured_output` 里。
9. `--output-format stream-json --verbose` 会输出 `system/init`（模型、工具清单、MCP 连接状态）、每次模型调用的 `usage`、工具调用和工具结果，以及最终的 `result`（`total_cost_usd`、`usage`、`modelUsage`、`num_turns`、`terminal_reason`、`permission_denials`）；订阅限额信息以 `rate_limit_event` 出现。`total_cost_usd` 按 API 标价折算。
10. `--max-turns` 没有出现在帮助里，但参数会被接受；达到上限时的结束状态要在实现时确认。

## Goals / Non-Goals

**Goals:**

- 首要指标是 token 效率：每次运行处理的 token 总量（input + output + 缓存写入 + 缓存读取，按模型合计），同时列出按 API 标价折算的费用。任务得分是底线：某个组别只有在得分不低于 baseline 时，省下的 token 才算数。
- 用数据检验四个假设，结论写进首份基线报告：
  - **H1**：内容本来就要读进上下文的任务（分拣、门控、核对、打分），jev 组的 token 和费用高于 baseline；门控任务上，严重错误（不该自动批准却批准了）可能更少。
  - **H2**：查找相关文件或文档的任务，在现在的工具设计下 jev 组没有 token 优势，因为内容必须先经过 agent。这一条是后续"传路径、服务端排序"提案的前提。
  - **H3**：只暴露 `jev_ask` 的 `jev` 得分不低于 `jev-all` 和 `jev-v0.1.1`，同时工具定义和工具结果占的上下文更小。
  - **H4**：对照任务（日志精确匹配）里，有 jev 工具不会让结果变差，agent 应该不用或很少用 jev。
- 以后改工具时，只需加一个组别或在新提交上重跑，就能用同一批任务对比。

**Non-Goals:**

- 统计显著性检验。样本小，只报均值和极值。
- 在同一次评测里对比不同 git 提交的 server。现在通过分别在两个提交上跑评测、对比报告来做，需要时再加。
- 模拟 Cursor、Claude Desktop 等其他宿主的工具加载方式。
- 把"让 Claude 读运行记录、提出工具改进"做成自动化流程。先手工做。

## Decisions

### D1. 目录结构

```
evals/
  run.ts                 # CLI 入口：bun run eval
  arms.ts                # 4 个组别的声明
  harness/
    claude.ts            # 拼 claude -p 参数、干净环境、启动子进程
    stream.ts            # 解析 stream-json，产出事件记录与单次指标
    workspace.ts         # 复制任务工作区到临时目录，结束后清理
    probe.ts             # 每个组别的工具定义开销探测
    schedule.ts          # 运行矩阵、交错顺序、总上限、续跑
    report.ts            # metrics.json 与 summary.md
  tasks/
    types.ts             # 任务约定
    index.ts             # 任务注册表
    <task-id>/
      task.ts            # 提示、split、答案 schema、评分配置
      gold.json          # 标准答案
      REVIEW.md          # 人工复核记录
      workspace/**       # 任务数据
  verifiers.ts           # 评分规则
  README.md
tests/evals/*.test.ts    # 不联网的单元测试
```

评测和被测工具放在同一个仓库：改了工具可以直接重跑，版本也不会错位。`package.json` 的 `files` 只发布 `dist` 和 `examples`，评测不会进 npm 包。备选方案是单独开仓库，但两边版本对齐很麻烦，所以不采用。

### D2. 每次运行是一个 `claude -p` 子进程

```
claude -p "<任务提示>"
  --model <默认 sonnet>
  --restricted
  --strict-mcp-config --mcp-config <本次运行的 mcp.json>
  --tools "Read,Grep,Glob"
  [--allowedTools mcp__jev] [--disallowedTools <组别名单之外的 jev 工具>]
  --disable-slash-commands --no-session-persistence
  --permission-mode dontAsk
  --output-format stream-json --verbose
  --json-schema '<任务答案 schema + feedback>'
  --max-turns <n> --max-budget-usd <单次上限>
  --append-system-prompt '<统一的评测说明>[ + directed 组的附加一句]'
  [--effort <level>]
  --exclude-dynamic-system-prompt-sections
cwd = <临时目录>/<run-id>/workspace，stdin = /dev/null
```

- `--restricted`：不读用户、项目和本地设置（因此不会触发 hooks），文件工具只能访问工作目录，执行代码的工具都被移除（可行性测试第 2 条）。
- `--exclude-dynamic-system-prompt-sections`：把工作目录等每次运行都不同的内容移到第一条用户消息里，使系统提示和工具定义能在多次运行之间命中提示缓存，节省订阅额度。各组都开，不影响对比。实现时可以加开关关掉。
- `--effort` 默认不传，使用 Claude Code 的默认值，实际值写进报告；需要时可以固定。
- 评测说明（所有组相同）：只在当前目录工作；完成后通过结构化输出提交答案；在 `feedback` 字段用一两句话说明哪些工具有用、哪里让你困惑。`jev-directed` 组额外加一句：分类、打分、是非判断类的子任务交给 jev 工具完成。

被否决的方案：

- 直接调用 Messages API：需要 API key 并按量付费，维护者已经否决。
- Claude Agent SDK：同样需要 API key。
- `--safe-mode`、`--bare`：见可行性测试第 3 条。

### D3. 干净的子进程环境

子进程只继承一份白名单：`HOME`、`PATH`、`USER`、`LOGNAME`、`SHELL`、`TMPDIR`、`LANG`。只有接入 jev 的组别额外加入 `TYPESAFE_API_KEY`，由 `claude` 进程传给 MCP 服务器（可行性测试第 7 条）。这样做有两个原因：一是从 Claude Code 终端里启动评测也能正常登录（可行性测试第 1 条）；二是 baseline 组的进程里不会出现 key。

### D4. 组别的实现

```ts
type Arm = {
  id: "baseline" | "jev" | "jev-directed" | "jev-all" | "jev-v0.1.1";
  jev: false | { allow: readonly string[]; env?: Record<string, string>; ref?: string };
  extraPrompt?: string;
};
```

- 接入 jev 的组别生成 `{"mcpServers":{"jev":{"command":"bun","args":["run","<仓库绝对路径>/src/index.ts"]}}}`，`env` 原样放进服务器配置（Claude Code 会把它和继承的环境合并）。`baseline` 使用空的 `mcpServers`，加上 `--strict-mcp-config`。
- 带 `ref` 的组别（`jev-v0.1.1`）在评测开始前用 `git archive` 取出该标签的 `src/`，放到临时目录并链接本仓库的 `node_modules`，从那里启动。不联网，结果可复现。
- `allow` 以外的 jev 工具通过 `--disallowedTools mcp__jev__<name>` 屏蔽；接入 jev 时加 `--allowedTools mcp__jev`。
- 每次运行收到 `system/init` 后，比较实际工具清单和预期集合（Read、Grep、Glob、StructuredOutput，加上组别允许的 jev 工具），并确认 jev 服务器状态为 `connected`。不一致时终止该运行，标记为 `invalid`。
- server 永远从工作区源码启动，所以评测启动前要求仓库里有 `node_modules`，缺少时提示先执行 `bun install`。

### D5. 答案通过结构化输出提交

每个任务的答案 schema 用 zod 写，通过 `z.toJSONSchema` 生成 `--json-schema`，外层再包一个可选的 `feedback: string`。最终答案从 `result.structured_output` 读取，并用同一份 zod schema 再校验一次。这样不用额外写一个"提交答案"的 MCP 服务器，各组的提交方式也完全相同。沿用了仓库"一份 zod 多处复用"的做法。

### D6. 指标从 stream-json 采集

运行器逐行读取子进程输出，每收到一行就打上接收时间戳。各类消息的处理方式：

| 消息 | 用途 |
| --- | --- |
| `system/init` | 记录模型、工具清单、MCP 状态，用来做 D4 的校验 |
| `assistant` | 累计每次模型调用的 `usage`；统计 `tool_use` 的工具名和参数字符数 |
| `user`（工具结果） | 统计工具报错；记录结果字符数；对 jev 工具，解析结果 JSON 里的 `usage.input_tokens` 作为 Jev 用量；用和对应 `tool_use` 的时间差估算工具耗时 |
| `rate_limit_event` | 记录订阅额度状态 |
| `result` | 读取 `num_turns`、`duration_ms`、`total_cost_usd`、`modelUsage`（按模型分开，Claude Code 可能在后台调用其他模型）、`terminal_reason`、`structured_output` |

结束状态的判定顺序：`invalid`（D4）→ 子进程超时被终止时为 `timeout` → 遇到限额时为 `rate_limited` → 达到轮数上限为 `max_turns` → 达到费用上限为 `budget_exceeded` → 其他错误为 `error` → 有结构化答案为 `answered`，没有为 `no_answer`。具体对应 `result` 里的哪些字段值，在实现时用录制的样本确认，并写成单元测试。

### D7. 工具定义开销探测

每次评测开始时，每个组别各跑一次探测：提示为"不要调用任何工具，直接用结构化输出返回 answer=OK"，取第一条 `assistant` 消息里 `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` 的和。各组的差值就是工具定义占用的上下文。可行性测试里这样量出 4,600 和 9,444。探测结果单独记录，不计入任务指标。

### D8. 任务约定与首批任务集

```ts
type EvalTask<A> = {
  id: string;
  title: string;
  category: "triage" | "gating" | "retrieval" | "verification" | "scoring" | "control";
  split: "dev" | "holdout";
  prompt: string;
  answer: z.ZodType<A>;
  scorer: ScorerConfig;
};
```

| id | split | 类别 | 规模 | 评分 | 假设 |
| --- | --- | --- | --- | --- | --- |
| `triage-tickets` | dev | 批量分类 | 30 张工单，分到 5 个团队，并判断是否紧急 | 团队准确率 ×0.7 + 紧急准确率 ×0.3 | H1 |
| `refund-gating` | dev | 风险门控 | 20 个退款申请 + 退款政策，分为自动批准、转人工、拒绝 | 代价表加权，误自动批准的代价 ×5 | H1 |
| `repo-feature-files` | dev | 相关文件查找 | 24 个文件的小仓库，找出实现退款流程的文件；有一个答案文件名里不带 refund，另有干扰文件 | 集合 F1 | H2 |
| `payment-log-duplicates` | dev | 对照 | 280 行支付日志（确定性生成），找出被重复扣款的客户 | 集合 F1 | H4 |
| `docs-page-finder` | dev | 相关文档查找 | 25 篇文档，找出能回答指定问题的页面 | 集合 F1 | H2 |
| `citation-check` | dev | 主张核对 | 一篇约 3,000 词的原文 + 12 条摘要主张 | 逐项准确率 | H1 |
| `bug-severity` | dev | 打分 | 25 份缺陷报告，按 0–3 级量表打分 | 逐项准确率，另报平均绝对误差 | H1 |
| `skill-selection` | dev | 候选挑选 | 60 份技能说明，为 5 个请求各挑 1 个 | 逐项准确率 | H2 |
| `triage-tickets-b` | holdout | 批量分类 | 另一批 30 张工单 | 同 `triage-tickets` | H1 |
| `moderation-gating` | holdout | 风险门控 | 25 条用户帖子 + 社区规则，分为放行、复审、删除 | 代价表加权，误放行违规帖的代价 ×5 | H1 |
| `contract-checklist` | holdout | 主张核对 | 15 份合同摘录 × 检查项 | 逐项准确率 | H1 |
| `module-impact-files` | holdout | 相关文件查找 | 另一个小仓库，找出受某项改动影响的文件 | 集合 F1 | H2 |

P0 先做前 4 个任务，每个假设至少有一个任务覆盖；其余 8 个放在 P1。

数据规则：

- 全部合成，使用英文。
- 刻意加入歧义、多意图、反讽语气、干扰文件等，避免任务过于简单。
- 由 Claude 起草，维护者人工复核标准答案，复核人和日期记在 `REVIEW.md`。
- 工作区里不放 `AGENTS.md`、`CLAUDE.md`，因为内置插件可能会读取它们。
- holdout 只在确认某项改进时跑，防止把工具描述调成只适配 dev 任务。

### D9. 评分规则

只用确定性规则，共四种：

- `exact`：完全匹配。
- 逐项准确率：可设各字段权重。
- 集合 F1：适用于文件、页面、客户 id 这类集合。
- 代价表加权：得分 = 1 − 实际代价 / 最坏代价。

评分前，标签统一转小写、去掉首尾空白；路径转成 posix 相对路径。不用 LLM 当评分员，因为答案都是结构化的，规则足够，而且结果可重复。

### D10. 重复次数、顺序与汇总

- 默认每个"任务 × 组别"组合跑 3 次。
- 执行顺序按"重复 → 任务 → 组别"交错。这样即使因为额度提前停止，各组的样本数也基本一致。
- 默认串行执行，并发数可以调，但订阅额度下不建议调高。
- 报告第一节是 token 效率摘要：每个组别的平均 token 总量、相对 baseline 的变化、平均得分及其变化，以及结论标记（"更省且不降分"、"更省但降分"、"更费"）。得分变化落在 baseline 的极值范围内时算"不降分"。
- 之后按"组别 × 任务"给出均值、最小值和最大值，再按组别汇总。变化百分比相对同一任务的 baseline 均值计算。
- jev 组另外报告"实际调用了 jev 的运行占比"。
- `invalid` 和 `rate_limited` 的运行单独列出，不计入均值。

### D11. 费用、额度与续跑

- 默认上限：单次运行 `--max-turns 40`、`--max-budget-usd 2`、超时 15 分钟；整次评测总上限 30 美元。以上费用都按 API 标价折算。
- 订阅窗口用量：流里的 `rate_limit_event` 带有 5 小时和 7 天窗口的已用比例（`rate_limit_info.unifiedWindows.*.utilization`）。任一窗口达到 `--stop-at-utilization`（默认 0.85）时停止启动新的运行，给维护者自己的日常使用留出额度；`status` 不是 `allowed` 时，当前运行记为 `rate_limited`。
- dry-run 的估算：如果有上一次评测的结果，用其中各任务的实际均值；没有就按每次 0.5 美元估算。
- 结果目录里写 `config.json`，记录模型、组别、任务、重复次数、CLI 版本和 git 提交。`--resume <目录>` 读取这份配置，跳过已有终态记录的运行；状态为 `rate_limited` 或 `error` 的运行会重跑。

### D12. 结果目录与脱敏

```
evals/results/<UTC 时间戳>-<模型>/
  config.json
  probes.json
  runs/<task>__<arm>__<rep>.jsonl   # 原始事件（已脱敏），每行附接收时间
  runs/<task>__<arm>__<rep>.json    # 单次运行指标与得分
  metrics.json
  summary.md
```

- 所有文本在写盘前先经过 `src/errors.ts` 的 `redact`，并额外把 `TYPESAFE_API_KEY` 的值替换成 `***`。
- `evals/results/` 加入 `.gitignore`。
- Claude Code 会把过大的工具输出写到 `~/.claude/projects/<工作目录路径，非字母数字换成 ->/` 下，再让 agent 读取（2026-10-08 试跑发现）。每次运行和探测结束后删除对应目录；删除前确认目录直接位于 `~/.claude/projects` 下、名字含 `typesafe-mcp-eval` 或 `typesafe-mcp-probe`，其他目录一律不动。
- 人工整理的结论放在 `docs/evals/<日期>-<主题>.md`，随代码提交；原始记录不提交。

### D13. 评分规则用 Bend 法则把关（实验）

评分规则决定评测的每个结论，而这部分代码最初由 haiku worker 编写；同一批产出里，支付日志的标准答案与题目定义不一致，而且 worker 自己写的测试没有发现。所以给代价表加权评分（`weightedCost`）加一道机械检查：

- `evals/laws/scoring.bend`：评分规则的 Bend 参考模型，代价表与 `refund-gating` 任务的 `REFUND_COST` 一致。
- `evals/laws/LAWS.bend`：由人编写、AI 不改的 9 条法则，例如全对得满分、得分落在 [0, 1]、缺答按最坏情况算、改对一项不会让总代价变高、误自动批准是最坏的错误。
- `evals/laws/PROOF.bend`：逐条证明。`bend evals/laws/PROOF.bend` 显示 "All terms check." 才算通过。
- `tests/evals/laws.test.ts`：把 TS 实现和 Bend 模型对起来。单条目的 12 种组合和两条目的 144 种组合逐一比对，并检查证明能通过；没有安装 `bend` 的环境（如 CI）跳过。

TypeScript 仍然是运行时的实现：本机安装的 Bend 2.0.26 没有附带 `bend2/main.ts`，JS 不能直接 `import` .bend 文件；而 `-o x.js` 生成的是需要 `main` 的程序，不是库。所以采用"证明模型 + 对照测试"的方式，没有用编译产物替换 TS。

以后的候选：工具重构里的精简返回（例如压缩概率、只保留前 k 个选项），用法则保证压缩前后的决策和首选项不变。

## Risks / Trade-offs

- [Claude Code 升级后参数或输出格式变化] → 启动时检查版本并写进报告；解析时忽略未知字段；关键字段缺失时把该运行标记为 `error`，不要猜测。
- [Claude Code 自带的系统提示会随版本变化，不同版本的结果没法直接比] → 只比较同一次评测内的组别；跨提交对比时，要求 CLI 版本和模型一致。
- [订阅额度有限，评测一次跑不完] → 默认串行、交错执行、可以续跑；先做 16 次运行的小规模试跑，校准每次的消耗，再决定重复次数。
- [模型随机性掩盖组间差异] → 每组跑 3 次并报告极值；差异落在极值范围内时，结论写"没有明显差异"。
- [合成数据不够真实，结论难以外推] → 刻意加入歧义和干扰项；以后再考虑引入脱敏的真实样本。
- [调工具时过拟合 dev 任务] → holdout 只在确认改进时使用。
- [`--restricted` 的语义可能变化，比如不再接受订阅登录] → 每次评测先跑探测；探测失败就整体退出，并提示原因。
- [`total_cost_usd` 是按 API 标价折算的，和订阅实际额度消耗不成比例] → 只用于组间相对比较和限额控制，报告里注明这一点。
- [Claude Code 的默认 effort 可能变化] → 把实际值写进报告；需要严格对比时用 `--effort` 固定。

## Migration Plan

不改变任何运行时行为，不需要迁移。回滚时删除 `evals/`、`tests/evals/`，并撤回配置文件的改动即可。

## Open Questions

- 要不要加中文任务？Jev 官方说非英文效果较差，但我们的用户可能用中文。框架不受影响，P1 之后可以作为新任务加入。
- 要不要换模型复测（例如 `opus`、`haiku`）？框架已经支持 `--model`，只是多花额度。
- 能不能找到可用的脱敏真实样本来补充合成数据？
