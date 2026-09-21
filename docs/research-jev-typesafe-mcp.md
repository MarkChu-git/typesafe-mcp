# Jev + TypeSafe MCP 调研

日期：2026-09-21  
范围：只调研怎么做，不实现 MCP 服务器主逻辑。

## 1. 仓库与本地知识现状

| 来源 | 结果 |
| --- | --- |
| `/Users/mark/typesafe-mcp` | 空目录，当时还不是 git 仓库 |
| Tolaria（`user-tolaria`） | 活跃 vault 是 Monash FIT1051 作业；搜 `jev` / `typesafe` / `mcp` 无相关笔记 |
| Open Knowledge（`user-open-knowledge`） | 全局 MCP 需要项目 `cwd`；本机未发现 `.ok/config.yml` 项目，无法检索 |
| 本机 skills | 无 jev / typesafe 专用 skill。官方 TypeSafe skill 在 [typesafe-ai/skills](https://github.com/typesafe-ai/skills) |
| 公开资料 | TypeSafe 官方文档、TechCrunch / TechSpot（2026-09）、若干第三方 `jev-mcp` |

## 2. Jev 是什么

**Jev 是 TypeSafe AI 的托管 System One 决策模型，不是聊天 LLM，也不是本机 runtime。**

证据：

- 官方介绍：[docs.typesafe.ai/introduction](https://docs.typesafe.ai/introduction.md)、[blog](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- 模型页：[docs.typesafe.ai/models](https://docs.typesafe.ai/models.md)
- 媒体：TechCrunch 2026-09-18；TechSpot 2026-09-20。创始人 Diogo Almeida（OpenAI RLHF / instruction-following）

关键事实（以官方文档为准）：

| 项 | 值 |
| --- | --- |
| 产品类别 | System One model：给软件用的结构化判断，不生成自然语言 |
| 当前版本 | `jev-1.13.0` |
| 别名 | `jev-latest`、`jev-preview`（今天都指向 `jev-1.13.0`） |
| 调用 | `POST https://api.typesafe.ai/v1/systemone`，`Authorization: Bearer <TYPESAFE_API_KEY>` |
| 输入 | `state`（string / JSON object / text array）+ `questions` map + `model` |
| 三种问题 | **Choice**（闭集选一）、**Score**（有序量表）、**Noul**（是否，返回 0–1 概率） |
| 输出 | 与问题 id 对齐的 typed answers；Choice/Score 另有 `probabilities` 和 `confidence` |
| 延迟 / 价格 | 官方称约 70–500ms；输入 $0.042 / 百万 token，输出免费 |
| 限额 | 文档默认 250k input tokens/s、1200 RPM；early access 可能变动 |
| 上下文 | 每请求 64k；`state` + 最长一题 32k |
| 部署 | 闭源托管 API，无公开权重，无自托管 |
| 语言 | 英语最好；含中文的 CJK 可用但更弱，要用 confidence 兜底 |
| 训练 | 官方称 RLCD（Reinforcement Learning for Calibrated Decisions）；不按客户数据微调 |

Jev **不能**：写邮件、写代码、解释理由、出图、开放生成。它适合路由、审核、打分、guardrail、在 agent 循环里当「带概率的 if」。

官方客户端：

- JS/TS：`@typesafe-ai/sdk`（文档写 Node 20+；本仓库用 **Bun** 安装和运行），默认读 `TYPESAFE_API_KEY`。HTTP 走可注入的 `fetch`。
- Python：`typesafe-sdk`（本仓库不用）

官方也提供 agent skill（给写 TypeSafe **应用**用，不是 MCP 服务器模板）：[docs.typesafe.ai/agent-skill](https://docs.typesafe.ai/agent-skill.md)。

## 3. 这里的 TypeSafe 是什么

**TypeSafe = TypeSafe AI 这家公司及其 API/SDK，不是泛指「TypeScript 类型安全 MCP」。**

仓库名 `typesafe-mcp` 的合理读法：

1. 给 TypeSafe / Jev 做 MCP（主含义，与产品名一致）
2. 做成类型安全的 MCP（实现约束：Zod / 官方 SDK 推断类型 / structured content）

不要把它理解成某个叫 TypeSafe 的无关 TS 库。官方强调：输出空间由请求定义，模型不会发明新类型；**类型安全保证的是接口，不是事实正确**。

## 4. 已有 MCP 生态（不要闭门造车）

2026-09 已有多个第三方 `jev-mcp`（Glama 上可见，例如 blakestone-x、rashedInt32、codaaiteam、Brainwires）。共同模式：

- 环境变量读 `TYPESAFE_API_KEY`（有的也认 `JEV_API_KEY`），**密钥不当 tool 参数**
- 工具大致对应三种 primitive：`jev_classify` / `jev_score` / `jev_check`，再加批量 `jev_ask` / `jev_decide`
- 有的加上 `jev_gate`、`jev_screen`、`jev_match`、`jev_models` / `jev_health`
- 结果带回概率、confidence，以及代码侧算出的 `act` / `review` / `abstain`

这些仓库说明方向已被验证，但质量、维护方、许可证不统一。本仓库若自研，应明确差异：官方 SDK、严格类型、structured content、密钥隔离、可测的 gating。

## 5. 方案对比

### 方案 A（推荐）：TypeScript MCP 薄封装官方 SDK

```
任意 MCP 客户端（Cursor / Claude Desktop / Claude Code / Codex / Windsurf / Cline / 自建）
        │ stdio（本地）或 Streamable HTTP（远程）
        ▼
typesafe-mcp（本仓库）
  Zod 校验 tool 入参
  @typesafe-ai/sdk → POST /v1/systemone
        ▼
Jev（托管）
        ▼
structured answers + probabilities + confidence
  代码里做阈值 / 路由，不让模型写散文
```

| 项 | 建议 |
| --- | --- |
| 运行时 / 包管理 | **只用 Bun**（`bun add` / `bun` / `bunx`）。不用 Node、npm、pnpm、yarn、npx |
| 语言 | TypeScript ESM |
| MCP | 官方 `@modelcontextprotocol/server`（v2；官方支持 Bun） |
| TypeSafe | `@typesafe-ai/sdk`（`choice` / `score` / `noul` + `TypeSafeClient`）。不用 Python SDK |
| 校验 | Zod：一份 schema → JSON Schema + handler 类型 |
| 传输 | 先 stdio（任意本地 MCP host）；需要共享再加 Streamable HTTP |
| 鉴权 | 只读环境变量 `TYPESAFE_API_KEY`；禁止 tool 参数传 key |
| 模型默认 | 开发用 `jev-latest`；生产阈值钉死 `jev-1.13.0` |

建议第一批工具（少而清）：

| 工具 | 对应 primitive | 作用 |
| --- | --- | --- |
| `jev_check` | Noul | 是/否 + 概率 |
| `jev_classify` | Choice | 闭集分类 |
| `jev_score` | Score | 有序打分 |
| `jev_ask` | 三种混合 | 同一 `state` 并行多问 |
| `jev_models` | `GET /v1/models` | 探活、列模型 |

第一期不要做：文本生成、解释、从自由文本抽任意数字/邮箱（那是 cookbook 里「代码先抽候选，Jev 再选」的模式，不是 MCP 必做）。

类型安全怎么做：

1. Tool 入参用 Zod 描述 `state`、`instructions`、`criteria`
2. 用 SDK helper 构造 `Questions`，让 `ResultFor<Q>` 推断答案类型
3. 用 MCP `outputSchema` / structured content 把 typed JSON 交给客户端，避免模型再 parse 一遍字符串
4. 阈值（`act_above` / `review_above`）在 **代码** 里算 `act | review | abstain`，不要让 Jev「决定能不能执行」
5. 问题文案和阈值集中在一个模块，方便人审（官方 skill 的硬建议）

和 Jev 怎么接：每个 tool 一次 `client.systemOne({ state, model, questions })`。多问务必打进同一次请求（官方 cookbook：并行问题可明显省钱省延迟）。429/529 交给 SDK 默认重试。

### 方案 B：Python MCP + `typesafe-sdk`

本仓库已规定 **只用 Bun**，此方案排除。即使没有这条约束，和本仓库 TypeScript MCP 方向也不匹配。

### 方案 C：复用 / fork 现成 `jev-mcp`

最快能跑。风险：许可证、维护、和官方 SDK 是否同步、密钥处理是否干净。适合「先验证产品」而不是「作为自己的产品仓库」。

### 方案 D：只当库、不当 MCP

`@typesafe-ai/sdk` 直接写进应用。MCP 的价值是让 **agent** 在循环里调用 Jev。如果调用方永远是你自己的后端，不需要 MCP。

### 方案 E：远程托管 MCP

把服务器放到 Streamable HTTP + 自己的鉴权后面。适合多客户端共享一个 key。成本：部署、鉴权、限流。本地 stdio 更简单，也避免把 TypeSafe key 放到云上。

## 6. 推荐做法

**做方案 A：本仓库自研 Bun + TypeScript MCP，薄封装官方 JS SDK，工具对齐三种 primitive。**

理由：

- 和 TypeSafe 官方 JS SDK、官方 MCP TS SDK（明确支持 Bun）对齐，类型能从问题定义一路推到答案
- 仓库名、私有 GitHub、后续自研控制都匹配
- 现成 `jev-mcp` 可当对照，不必当依赖
- 第一期范围小，能很快验证「agent 能否用 Jev 做路由 / 审核」

不推荐一上来做 gate/screen/match 全家桶，也不推荐把 Jev 伪装成聊天模型。

## 7. 建议实现顺序（确认后再写代码）

1. 用户确认：有无 `TYPESAFE_API_KEY` / 是否过 waitlist；工具集；stdio only 还是也要 HTTP
2. `package.json` + Bun + TS ESM + `@typesafe-ai/sdk` + `@modelcontextprotocol/server` + Zod（`bun add`，提交 `bun.lock`）
3. 实现 `jev_models`（不花钱探活）和 `jev_check`
4. 补 `jev_classify`、`jev_score`、`jev_ask`
5. 代码侧 gating helper（阈值默认 0.8 / 0.5，可覆盖）
6. 各 MCP host 的 stdio 配置：同一 spawn + `TYPESAFE_API_KEY` 注入（见 `examples/stdio.mcp.json`）
7. Fixture / 录制测试（无 key 时不打真实 API）
8. 再考虑 HTTP transport、opinionated tools。Claude Desktop 已是 stdio 客户端，不是这一步才做。

## 8. 风险、缺口、需要确认的点

**风险**

- Early access：可能要 waitlist；限流会变；`529 Overloaded` 已有公开报道
- 无自托管、无开放权重
- Jev 会错；confidence 只描述分布集中度，不是「可以自动执行」
- 中文 / CJK 弱于英语
- `jev-latest` 会跟着发版漂移；阈值要钉版本
- 密钥进 tool 参数或进 transcript 是安全事故
- 若干同名 `jev-mcp` 已存在，需避免无差异重复

**缺口**

- 本机没有 TypeSafe API key 可验证
- 用户未说明要暴露的业务问题（客服路由？agent guardrail？）
- 未确认要不要兼容 OpenRouter / Vercel AI Gateway（有第三方提到 `typesafe-ai/jev`）

**需要用户确认**

1. 是否已有 `TYPESAFE_API_KEY`，还是还在 waitlist？
2. 自研方案 A，还是先试用现成 `jev-mcp`？
3. ~~第一期只要 Cursor stdio，还是同时要 Claude Desktop / 远程 HTTP？~~ **已确认：给所有 agent。第一期 stdio；HTTP 后置。Claude Desktop 走 stdio。**
4. 工具只要四种 primitive，还是要 `gate` / `screen` / `match`？
5. 主要判断语言是英文还是中文？（影响题面设计和验收）
6. 有没有具体第一个场景（例如：拦截危险 shell、给 ticket 路由、给检索结果打分）？

## 9. 主要来源

- https://docs.typesafe.ai/llms.txt
- https://docs.typesafe.ai/introduction.md
- https://docs.typesafe.ai/api.md
- https://docs.typesafe.ai/models.md
- https://docs.typesafe.ai/sdk/javascript.md
- https://docs.typesafe.ai/agent-skill.md
- https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md
- https://typesafe.ai/blog/introducing-system-one-models-and-jev
- https://techcrunch.com/2026/09/18/a-new-kind-of-ai-model-from-a-chatgpt-inventor-is-thrilling-developers/
- https://github.com/modelcontextprotocol/typescript-sdk
- 第三方 `jev-mcp` 目录（Glama）
