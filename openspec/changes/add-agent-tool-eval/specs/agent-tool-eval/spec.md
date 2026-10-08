# Spec Delta

## Purpose

在同一批贴近真实场景的任务上，对比 agent 在不同工具配置下的任务得分、token 消耗、费用和工具使用情况，为 jev 工具的设计提供可重复的数据依据。

## ADDED Requirements

### Requirement: Run matrix from selection
评测运行器 SHALL 根据选定的任务、组别和重复次数生成运行矩阵，并为矩阵中的每一项启动一次独立的 agent 运行。任务 SHALL 可以按 id 选择，也可以按 split（`dev`、`holdout`）选择。

#### Scenario: Matrix size
- **WHEN** 选择 2 个任务、2 个组别，重复 3 次
- **THEN** 共执行 12 次运行，每次运行都是一个独立的新会话

#### Scenario: Select by split
- **WHEN** 只选择 `holdout` split
- **THEN** 只运行标记为 `holdout` 的任务

#### Scenario: Unknown id
- **WHEN** 选择了不存在的任务 id 或组别 id
- **THEN** 运行器以非零状态退出并指出未知的 id，且不启动任何运行

### Requirement: Dry run starts nothing
在 dry-run 模式下，运行器 SHALL 输出运行矩阵、运行次数和消耗估算，并且 MUST NOT 启动任何 agent 运行或调用 TypeSafe API。

#### Scenario: Dry run output
- **WHEN** 以 dry-run 模式选择 2 个任务、4 个组别，重复 3 次
- **THEN** 输出 24 次运行的清单和消耗估算，进程以 0 退出，没有启动任何 agent 会话

### Requirement: Runs use headless Claude Code with the existing login
每次运行 SHALL 以无头模式启动本机的 Claude Code，使用其已登录的账号，不需要 Anthropic API key，且会话 MUST NOT 被持久化保存。Claude Code 未登录时，运行器 SHALL 在启动任何运行前报错退出并提示登录方法。

#### Scenario: Not logged in
- **WHEN** 本机 Claude Code 未登录
- **THEN** 运行器在启动任何运行前退出，提示先执行 `claude auth login`

#### Scenario: Launched from inside a Claude Code session
- **WHEN** 运行器是在 Claude Code 自己的终端里启动的，进程继承了宿主注入的环境变量
- **THEN** 每次运行仍然使用本机的登录状态正常执行，不受这些继承变量影响

### Requirement: Runs are isolated from personal configuration
每次运行 MUST NOT 加载用户级、项目级或本地的 Claude Code 设置、hooks、CLAUDE.md 记忆、技能、非内置插件，以及评测未指定的 MCP 服务器。每次运行 SHALL 在当前任务工作区的一份全新副本中进行，运行结束后副本被清理。

#### Scenario: No personal instructions leak
- **WHEN** 用户的全局 CLAUDE.md 里有自定义指令
- **THEN** 运行中 agent 的上下文不包含这些指令

#### Scenario: Fresh workspace per run
- **WHEN** 同一任务连续运行两次
- **THEN** 第二次运行看到的工作区与任务原始数据完全一致，不受第一次运行影响

### Requirement: File tools are read-only and confined
所有组别的 agent SHALL 只拥有读文件、按内容搜索、按通配符列文件这三类内置工具，并且 MUST 只能访问本次运行的工作区副本。执行命令、写入或编辑文件、联网的工具 MUST NOT 可用。

#### Scenario: Read outside the workspace
- **WHEN** agent 试图读取工作区以外的文件
- **THEN** 读取被拒绝，工作区以外的内容不会进入对话

#### Scenario: No shell or write tools
- **WHEN** 查看任一运行开始时 agent 可用的工具清单
- **THEN** 清单中没有执行命令、写文件或联网的工具

### Requirement: Arms declare the only differences
每个组别 SHALL 声明三件事：是否接入 jev MCP 服务器、允许 agent 看到的 jev 工具名单、可选的附加系统提示。除此之外，同一任务在各组别下的提示、模型、内置工具和限制条件 MUST 相同。运行开始时 agent 实际可见的工具清单 MUST 与组别声明一致，否则该运行 SHALL 标记为 `invalid` 且不计入结果。

#### Scenario: Default jev arm
- **WHEN** 运行 `jev` 组
- **THEN** agent 可见的 jev 工具只有 `jev_ask`

#### Scenario: Tool list mismatch
- **WHEN** 某次运行开始时 jev 服务器没有连上，可见工具少于组别声明
- **THEN** 该运行标记为 `invalid`，在报告中单独列出，不计入均值

### Requirement: Server under test is the working tree
接入 jev 的组别 SHALL 通过 stdio 启动本仓库当前工作区源码里的 MCP 服务器，而不是已发布的 npm 包，这样修改工具描述或输出后，不改评测代码就能评测到新版本。用来对照的发布版组别是唯一的例外：它 SHALL 从该版本的 git 标签取出源码启动，不联网下载。

#### Scenario: Description change is picked up
- **WHEN** 修改了某个 jev 工具的描述后再次运行评测
- **THEN** 这次评测中 agent 看到的是修改后的描述

#### Scenario: Release arm runs the tagged source
- **WHEN** 评测包含 `jev-v0.1.1`
- **THEN** 该组的服务器来自标签 `v0.1.1` 的 `src/`，工作区里未提交的改动不影响它

### Requirement: Tasks define a verifiable structured answer
每个任务 SHALL 定义唯一 id、split、任务提示、工作区数据、答案结构和标准答案。agent MUST 以符合答案结构的结构化输出提交最终答案；答案结构另含一个可选的 `feedback` 文本字段，用来收集 agent 对工具的反馈。

#### Scenario: Answer accepted
- **WHEN** agent 提交的结构化答案符合任务的答案结构
- **THEN** 该运行状态为 `answered`，答案进入评分

#### Scenario: No answer
- **WHEN** 运行结束时没有得到结构化答案
- **THEN** 该运行状态为 `no_answer`，得分为 0

### Requirement: Scoring is deterministic
每个任务 SHALL 用确定性规则把答案换算成 0 到 1 之间的得分，并判定是否通过；评分 MUST NOT 调用任何模型。评分前 SHALL 对标签做大小写和首尾空白归一化，对文件路径做规范化。

#### Scenario: Same answer same score
- **WHEN** 同一个答案被评分两次
- **THEN** 两次得分完全相同

#### Scenario: Set F1 for file finding
- **WHEN** 标准答案有 4 个文件，agent 答对其中 3 个，另外多答了 1 个
- **THEN** 得分为 0.75

#### Scenario: Weighted cost for gating
- **WHEN** 门控类任务中，agent 把应转人工处理的申请判为自动批准
- **THEN** 这一项按任务代价表里更高的代价扣分

### Requirement: Per-run metrics are recorded
每次运行 SHALL 记录：结束状态（`answered`、`no_answer`、`max_turns`、`budget_exceeded`、`timeout`、`rate_limited`、`invalid`、`error` 之一）、得分、轮数、按模型分开的 input、output、缓存写入和缓存读取 token、按 API 标价折算的费用、各工具调用次数、工具报错次数、每次工具调用耗时、总耗时、模型调用次数、单次模型调用的峰值上下文 token、jev 工具参数和结果的字符数，以及 jev 结果里报告的 Jev token 用量。

#### Scenario: Jev usage summed
- **WHEN** 一次运行中调用 `jev_ask` 两次，结果分别报告 423 和 380 个输入 token
- **THEN** 该运行记录 `jev_ask` 调用 2 次，Jev token 合计 803

#### Scenario: Turn limit reached
- **WHEN** 运行达到最大轮数仍未提交答案
- **THEN** 状态为 `max_turns`，已产生的 token 和费用照常记录

### Requirement: Tool definition overhead is measured per arm
每次评测 SHALL 为每个组别执行一次不调用工具的探测运行，记录第一轮请求的上下文 token 数，并在报告中给出各组别相对 `baseline` 的差值，作为该组工具定义占用的上下文。

#### Scenario: Overhead reported
- **WHEN** 评测包含 `baseline` 和 `jev-all`
- **THEN** 报告列出两组第一轮上下文的 token 数及其差值

### Requirement: Reports compare arms against baseline
每次评测 SHALL 在独立的结果目录中写出每次运行的完整事件记录、汇总指标文件和可读的对比报告。报告开头 SHALL 写明模型、Claude Code 版本、git 提交及工作区是否有未提交改动；正文 SHALL 按组别和任务给出得分、token、费用、工具调用数和耗时的均值、最小值、最大值，以及相对 `baseline` 的变化百分比。结果目录 MUST NOT 被 git 跟踪。

#### Scenario: Token efficiency first
- **WHEN** 评测包含 `baseline` 和至少一个 jev 组别
- **THEN** 报告第一节列出每个组别的平均 token 总量、平均费用、平均峰值上下文及它们相对 `baseline` 的变化，以及平均得分的变化，并标出哪些组别"更省且不降分"

#### Scenario: Deltas shown
- **WHEN** 评测包含 `baseline` 和 `jev-all`
- **THEN** 报告中 `jev-all` 的每项指标旁标出相对 `baseline` 的变化百分比

#### Scenario: No baseline
- **WHEN** 评测没有包含 `baseline`
- **THEN** 报告只列绝对值，并注明缺少基线

#### Scenario: Dirty working tree
- **WHEN** 评测时工作区有未提交的改动
- **THEN** 报告开头标明工作区有改动，并列出改动的文件

### Requirement: Budget, quota and resume
运行器 SHALL 支持单次运行的最大轮数、费用上限和时长上限，以及整次评测的总费用上限，费用均按 API 标价折算。达到总上限或遇到订阅限额时，运行器 SHALL 停止启动新的运行，并写出已完成部分的报告；之后指定同一结果目录续跑时，SHALL 只执行尚未完成的运行。

#### Scenario: Global cap reached
- **WHEN** 总上限是 5 美元，第 7 次运行结束时累计 5.10 美元
- **THEN** 不再启动后续运行，报告注明因费用上限提前停止，并列出未执行的运行数

#### Scenario: Quota utilization threshold
- **WHEN** 某次运行结束时，订阅的 5 小时窗口已用比例达到设定阈值（默认 0.85）
- **THEN** 运行器不再启动新的运行，写出已完成部分的报告，并注明可以在额度恢复后续跑

#### Scenario: Subscription limit then resume
- **WHEN** 第 10 次运行遇到订阅限额，之后用同一结果目录续跑
- **THEN** 第 10 次运行标记为 `rate_limited` 且不计入结果；续跑从第 10 次开始，已完成的 9 次不重跑

### Requirement: Secrets stay out of records
`TYPESAFE_API_KEY` MUST 只从环境变量读取，并且只传给接入 jev 的组别。运行记录、报告和日志 MUST NOT 出现任何密钥原文。选择了接入 jev 的组别却没有设置 `TYPESAFE_API_KEY` 时，运行器 SHALL 在启动任何运行前报错退出。

#### Scenario: Missing key for jev arms
- **WHEN** 选择了 `jev-all`，但环境中没有 `TYPESAFE_API_KEY`
- **THEN** 运行器在启动任何运行前退出，并指出哪些组别需要这个变量；只选 `baseline` 时不需要它

#### Scenario: Baseline gets no key
- **WHEN** 运行 `baseline` 组
- **THEN** 该运行的进程环境里没有 `TYPESAFE_API_KEY`

#### Scenario: Redaction
- **WHEN** 某条工具结果的文本里出现了密钥原文
- **THEN** 写入运行记录前被替换为 `***`

### Requirement: Evals stay out of default tests and CI
评测运行 MUST NOT 被 `bun test` 的默认集合或 CI 工作流触发。评分规则、流解析等不联网的部分 SHALL 有单元测试，并纳入 `bun test`。

#### Scenario: CI without keys or login
- **WHEN** 在没有任何密钥、也没有登录 Claude Code 的 CI 环境中运行 `bun test`
- **THEN** 不启动任何评测运行，相关单元测试全部通过
