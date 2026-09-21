# Proposal

## Why

调研（`docs/research-jev-typesafe-mcp.md`）已确认方向：自研一个 Bun + TypeScript 的 MCP 服务器，薄封装 TypeSafe 官方 JS SDK，让 Cursor 里的 agent 能把 Jev 当成「带概率的 if」来调用（路由、审核、打分、guardrail）。仓库目前只有文档、没有任何服务器代码。本 change 把调研结论落成可执行的实现规格：先在 Cursor 本地 stdio 跑通 5 个 primitive 工具，并把 `act | review | abstain` 阈值判断放在代码里，为后续业务场景提供可测、类型安全的基础。

## What Changes

- 新增 Bun + TypeScript ESM 项目骨架：`package.json`（`type: module`、`bin`、`scripts`、`packageManager: bun`）、`tsconfig.json`、`bun.lock`、`src/`、`tests/`。全部依赖用 `bun add` 安装：`@typesafe-ai/sdk`、`@modelcontextprotocol/server`、`zod`；开发依赖 `@modelcontextprotocol/client`、`typescript`、`@types/bun`。
- 新增 MCP stdio 服务器进程：`bun run src/index.ts` 启动，用 `serveStdio` 承载 `McpServer`；日志只走 stderr。
- 新增 `TypeSafeClient` 单例封装：只从环境变量 `TYPESAFE_API_KEY` 读取密钥，缺失时启动不崩、工具调用时返回 `isError` 提示；默认模型 `jev-latest`，可用 `TYPESAFE_DEFAULT_MODEL` 或工具参数 `model` 覆盖。
- 新增 5 个 MCP 工具（第一期全部范围）：
  - `jev_models`：列出账号可用模型，兼做探活，不消耗推理 token
  - `jev_check`：Noul 是/否，返回 0–1 概率
  - `jev_classify`：Choice 闭集分类，返回选项、概率分布、confidence
  - `jev_score`：Score 有序量表，返回期望分、legend、概率分布、confidence
  - `jev_ask`：同一 `state` 上并行提出多个混合类型问题，一次 `systemOne` 请求完成
- 新增代码侧 gating：Choice/Score 用 `confidence`，Noul 用概率距 0.5 的距离；默认阈值 `act ≥ 0.8`、`review ≥ 0.5`，否则 `abstain`；可按调用覆盖。Jev 本身不参与「能否执行」的决定。
- 新增错误映射：SDK 错误（401/403、422、429、529、超时、连接失败）与本地校验错误（空 questions、非法 criteria、缺 key）统一映射成带修复提示的 `isError: true` 工具结果，永不把密钥或请求头回显到结果里。
- 新增类型安全链路：一份 Zod schema 同时产出 MCP `inputSchema` / `outputSchema` 与 handler 类型；SDK `choice/score/noul` helper 构造 `Questions`，`ResultFor` 推断答案类型；结果通过 `structuredContent` 返回。
- 新增 `bun test` 测试：无密钥时用注入 `fetch` 的 fixture 回放；有 `TYPESAFE_API_KEY` 时才跑集成用例，否则 skip。
- 新增 Cursor 配置示例 `examples/cursor.mcp.json`（`command: bun`，`env` 注入密钥）与 README 用法段落。`.gitignore` 已忽略 `.cursor/mcp.json`，保持不提交。
- 非目标（记录，不实现）：Streamable HTTP、Claude Desktop、`jev_gate` / `jev_screen` / `jev_match`、文本生成、Python SDK、Node/npm 工具链。

## Capabilities

### New Capabilities

- `mcp-server-runtime`：进程启动、stdio 传输、`TYPESAFE_API_KEY` 只从环境读取、默认模型解析、stderr 日志、工具注册入口。
- `jev-decision-tools`：`jev_models` / `jev_check` / `jev_classify` / `jev_score` / `jev_ask` 五个工具的输入 schema、输出 structured content、与 `systemOne` / `models.list` 的对应关系。
- `decision-gating`：`act | review | abstain` 的计算公式、默认阈值、边界处理、按调用覆盖。
- `error-mapping`：SDK 错误与本地校验错误到 MCP `isError` 结果的映射规则与脱敏要求。

### Modified Capabilities

（无。仓库尚无既有 spec。）

## Impact

- 代码：新增 `package.json`、`tsconfig.json`、`bun.lock`、`src/**`、`tests/**`、`examples/cursor.mcp.json`；修改 `README.md`（用法与配置）。
- 依赖：`@typesafe-ai/sdk`（v0.6.x，JS SDK 2026-09-15 起 Score criteria 为有序数组）、`@modelcontextprotocol/server`（v2，实现 2026-07-28 协议，官方支持 Bun）、`zod`（v4，MCP v2 通过 `zod/v4` 导入）；开发依赖 `@modelcontextprotocol/client`（进程内测试）、`typescript`、`@types/bun`。
- 外部系统：TypeSafe API `POST /v1/systemone`、`GET /v1/models`；需要用户持有 early-access `TYPESAFE_API_KEY`。
- 客户端：Cursor（stdio）。用户需在用户级或项目级 `mcp.json` 配置 `bun` 命令与密钥。
- 流程：按 CONTRIBUTING，从 `main` 开 `feature/build-jev-mcp` 分支，Conventional Commits，按 P0 → P1 → P2 分批 PR。
