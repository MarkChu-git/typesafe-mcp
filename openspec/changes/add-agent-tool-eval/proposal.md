# Proposal

## Why

这个 MCP 的目标是 token efficiency：在任务得分不下降的前提下，让 agent 用更少的 token 完成任务。但我们还回答不了一个基本问题：agent 接入 jev 工具以后，任务做得更好还是更差，token 是省了还是多了。目前只有零散的测量。2026-10-08 用 Claude Code 无头模式实测：只开放 Read、Grep、Glob 时，第一轮上下文约 4,600 token；接入 5 个 jev 工具后变成 9,444 token，工具定义本身就占 4,844 token。另外，现在的设计要求 agent 把 `state` 原样抄进工具参数。这些开销换来了什么（准确率、更稳的门控决策），还没有在真实任务上对照过。Anthropic《Writing effective tools for agents — with agents》（2025-09）建议用贴近真实场景的评测来驱动工具设计。本 change 先把评测搭起来拿到基线，再用数据决定后续工具重构（传路径、服务端筛选与排序、精简返回）值不值得做、先做哪个。

## What Changes

- 新增 `evals/` 评测框架（Bun + TypeScript，不进 npm 包）。`bun run eval` 按「任务 × 组别 × 重复次数」跑运行矩阵。
- 每次运行用 Claude Code 无头模式（`claude -p`）执行，使用本机已登录的订阅，不需要 Anthropic API key。运行与本机个人配置隔离：不加载用户和项目的设置、hooks、CLAUDE.md、技能和其他 MCP 服务器；每次运行在任务数据的全新副本里进行；文件工具只有只读的 Read、Grep、Glob，且只能访问这份副本。
- 新增 5 个对照组（arm）：
  - `baseline`：只有 Read、Grep、Glob。
  - `jev`：再加上服务器默认暴露的工具（现在只有 `jev_ask`）。MCP 服务器用本仓库工作区里的源码通过 stdio 启动，不用已发布的 npm 包。
  - `jev-directed`：工具与 `jev` 相同，系统提示多一句"判断类子任务交给 jev"，衡量真用上以后的成本和收益。
  - `jev-all`：工作区源码，用 `TYPESAFE_TOOLS=all` 打开全部 5 个工具，验证"工具少一点是否更好"。
  - `jev-v0.1.1`：上一个发布版本（git 标签 `v0.1.1` 的源码），和工作区版本放在同一次评测里对比。
- 新增任务集：12 个合成任务，覆盖批量分类、带风险门控的决策、相关文件和文档查找、主张核对、打分，以及 1 个 Jev 不擅长的对照任务（日志精确匹配）。其中 8 个用于调优（dev），4 个留作验证（holdout）。每个任务带人工复核过的标准答案和确定性评分规则。agent 通过结构化输出提交答案。
- 新增指标：任务得分、各模型的 token（input、output、缓存读写分开）、按 API 标价折算的费用、轮数、各工具调用次数、工具报错、耗时、jev 工具参数与结果的大小、Jev 用量。另外每个组别跑一次探测，测工具定义占用多少上下文。
- 新增报告：每次评测生成 `metrics.json`、`summary.md`（各组相对 baseline 的变化）和完整运行记录（不进 git）。首份基线结论整理到 `docs/evals/`。
- 新增费用与额度控制：`--dry-run` 只打印运行矩阵和估算，不启动任何运行；单次运行限制轮数、费用和时长；设总费用上限；遇到订阅限额时停止并保存进度，之后可以续跑；默认串行执行。
- 密钥：`TYPESAFE_API_KEY` 只从环境变量读取，只传给接入 jev 的组别，记录里脱敏。评测不进 CI，也不进 `bun test` 的默认集合。
- 非目标：不修改任何 jev 工具的行为或输出；不用 LLM 当评分员；不评测 Jev 模型本身的准确率；不模拟 Cursor、Claude Desktop 等其他宿主；首批不含中文任务（列为待定问题）。

## Capabilities

### New Capabilities

- `agent-tool-eval`：评测运行器、组别与任务的定义约定、运行隔离、确定性评分、指标采集、报告输出，以及费用、额度与密钥约束。

### Modified Capabilities

（无。本 change 不改变 MCP server 的任何既有行为。）

## Impact

- 代码：新增 `evals/**`、`tests/evals/**`、`docs/evals/`；修改 `package.json`（`eval` 脚本）、`tsconfig.json`（`include` 加入 `evals`）、`.oxlintrc.json`（`evals/**` 允许 `console`）、`.gitignore`（忽略 `evals/results/`）、`README.md`（新增评测一节）。
- 依赖：不新增 npm 依赖。需要本机安装并登录 Claude Code CLI（可行性测试用的是 2.1.284），评测启动前自动检查。
- 额度与费用：评测消耗 Claude 订阅额度。结果里按 API 标价折算的费用只用来衡量和限制消耗，不是实际扣费。TypeSafe API 按 $0.042 / 百万 token 计，费用可以忽略。
- 后续：评测结果决定下一个 change（传路径、服务端排序、`response_format`、减少工具数量）的优先级和验收标准。
