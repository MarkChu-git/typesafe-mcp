# Design

## Context

见 `proposal.md - Why` 与 `docs/research-jev-typesafe-mcp.md` §5–§7。当前仓库只有文档，无 `package.json`、无 `src/`。设计受以下已定约束限制：

- 运行时 / 包管理只用 Bun；禁止 Node、npm、pnpm、yarn、npx。
- MCP 用官方 `@modelcontextprotocol/server` v2（实现 2026-07-28 协议，官方声明支持 Bun），schema 用 Zod v4（`import * as z from "zod/v4"`）。
- TypeSafe 用官方 `@typesafe-ai/sdk`（v0.6.x）。已核对的公开 API：`new TypeSafeClient(config?)`、`client.systemOne({ state, questions, model? }, options?)`、`client.models.list()`、helper `choice(instructions, criteria)` / `score(instructions, criteria)` / `noul(instructions?, criteria?)`、结果 `SystemOneResult<Q>` = `{ answers: { [K]: ResultFor<Q[K]> }, model, usage }`；错误类 `APIError`（含 `status`、`body`、`requestId`）及子类 `AuthenticationError`、`PermissionDeniedError`、`UnprocessableEntityError`、`RateLimitError`、`InternalServerError`、`NotFoundError`、`BadRequestError`，以及 `APIConnectionError`、`APITimeoutError`、`APIUserAbortError`。
- SDK 的 `TypeSafeClientConfig.fetch` 可注入，默认全局 `fetch`；构造函数在密钥缺失或 runtime 不支持时会抛错。
- 第一期只做 Cursor stdio；密钥只从 `TYPESAFE_API_KEY` 读。
- Jev 上下文：64k / 请求，`state` + 最长一题 32k；Score 2–10 级；Choice ≤ 255 选项；JS SDK v0.6.0 起 Score criteria 是有序数组。

## Goals / Non-Goals

**Goals:**

- 一份 Zod schema 驱动 MCP `inputSchema` / `outputSchema`、handler 参数类型和 structured content。
- 每个工具恰好一次 `systemOne`（或一次 `models.list`）；`jev_ask` 把 N 个问题打进同一请求。
- gating、错误映射、问题构造三块逻辑与 MCP 传输解耦，可用 `bun test` 在无网络、无密钥下测试。
- 服务器启动不依赖密钥存在；密钥问题在工具调用时以 `isError` 暴露。
- 结构上为 P3 的 Streamable HTTP 留接口（`createServer()` 工厂），但不实现。

**Non-Goals:**

- HTTP / SSE 传输、鉴权代理、多租户密钥。
- `jev_gate` / `jev_screen` / `jev_match` 等业务化工具。
- 在服务器里做 prompt 工程、翻译、state 裁剪等「帮模型想」的逻辑；这些属于调用方。
- 兼容 MCP v1 SDK 或旧协议客户端（`serveStdio` 默认已兼容旧客户端，不额外处理）。
- 发布到 npm；第一期只从仓库路径以 `bun run` 启动。

## Decisions

### D1. 目录结构：按职责分层，工具一文件一个

```
src/
  index.ts        进程入口：serveStdio(createServer)，只做接线
  server.ts       createServer()：new McpServer + 注册 5 个工具；导出以便测试和未来 HTTP 复用
  client.ts       getClient()：TypeSafeClient 懒加载单例；读 env；缺 key 抛 ConfigError
  config.ts       env 解析：TYPESAFE_API_KEY、TYPESAFE_DEFAULT_MODEL、TYPESAFE_TIMEOUT_MS；常量默认值
  schemas.ts      所有 Zod：state、instructions、criteria、阈值、五个工具 input/output
  questions.ts    Zod 入参 → SDK Questions（choice/score/noul helper），含 jev_ask 的 map 构造
  gating.ts       certaintyOf(answer) 与 decide(certainty, thresholds)
  errors.ts       toToolError(err): { content, isError: true }，分类 + 脱敏
  result.ts       ok(structured): { content: [text JSON], structuredContent }
  tools/
    models.ts     jev_models
    check.ts      jev_check
    classify.ts   jev_classify
    score.ts      jev_score
    ask.ts        jev_ask
tests/
  fixtures/       录制的 TypeSafe 响应 JSON（按工具 / 场景命名）
  helpers/        fakeFetch(fixtureMap)、inProcessClient(createServer)
  *.test.ts       每个 src 模块一个测试文件
examples/
  cursor.mcp.json Cursor 配置示例（占位密钥）
```

**理由**：`schemas.ts` 单独成文件是因为它是类型链路的源头，被工具、测试、文档三方引用；`questions.ts` 把「MCP 入参 → SDK 问题」的转换集中，是 `jev_ask` 与单问工具共用的唯一路径；`gating.ts` / `errors.ts` 不依赖 MCP 与 SDK 类型之外的任何东西，可纯单测。`server.ts` 导出 `createServer()` 工厂而不在 `index.ts` 内联，是为了测试能用 `@modelcontextprotocol/client` 进程内驱动，也为 P3 HTTP 直接复用。

**备选**：单文件 `src/index.ts` 全写——短期快，但 gating / 错误 / schema 无法单测，且 5 个工具的 schema 会膨胀到几百行。否决。

### D2. 运行方式：`bun run src/index.ts` 直跑 TS，不做构建

`package.json` 的 `bin` 指向 `src/index.ts`（首行 `#!/usr/bin/env bun`），Cursor 配置 `command: "bun"`, `args: ["run", "<abs>/src/index.ts"]`。不引入 `tsc` 构建产物、不提交 `dist/`。`tsc --noEmit` 只做类型检查（`bun run typecheck`）。

**理由**：Bun 原生跑 TS，省掉构建步骤和 `dist/` 同步问题；Cursor 每次启动进程都是最新源码。**备选**：`bun build --target=bun` 产出单文件——留给 P3 发布时再考虑。

### D3. 一份 Zod，四处复用（类型安全链路）

```
Zod inputSchema  ──(SDK 自动)──▶  MCP tools/list 的 JSON Schema（.describe() 保留）
       │
       └──(z.infer)──▶ handler 参数类型 ──▶ questions.ts 构造 SDK Questions
                                                  │
                                       systemOne<Q>() 返回 SystemOneResult<Q>
                                                  │ ResultFor<Q[K]> 推断 choice/score/noul 答案
                                                  ▼
                                  gating + 组装 ──▶ Zod outputSchema.parse() ──▶ structuredContent
```

`outputSchema` 同样是 Zod；handler 返回前用 `parse` 保证形状，SDK 再校验一次并把 JSON Schema 广播给客户端。`content[0].text` 固定为 `JSON.stringify(structuredContent)`，让不支持 structured content 的客户端也能读。

**Zod 类型要点**：
- `state`: `z.union([z.string().min(1), z.record(z.string(), jsonValue), z.array(jsonValue)])`，`jsonValue` 用 `z.lazy` 递归定义。
- `instructions`（工具里叫 `question`）：`z.string().min(1)`。第一期不开放对象型 instructions，减少 agent 误用；对象型留给 P3。
- `options`（Choice criteria）：`z.record(z.string().min(1), z.string().nullable()).refine(2 ≤ keys ≤ 255)`。
- `levels`（Score criteria）：`z.array(z.string().nullable()).min(2).max(10)`。
- `criteria`（Noul）：`z.object({ true: z.string().optional(), false: z.string().optional() }).optional()`。
- `model`: `z.string().min(1).optional()`。
- 阈值：`act_above`、`review_above` 各 `z.number().min(0).max(1).optional()`，跨字段 `refine(review ≤ act)`。
- `jev_ask.questions`: `z.record(id, z.discriminatedUnion("type", [noulQ, choiceQ, scoreQ])).refine(size ≥ 1)`。

**备选**：手写 JSON Schema + `as` 断言——失去推断，两份 schema 会漂移。否决。

### D4. `jev_ask` 的多题打包与类型保持

入参 `questions` 是运行时的 `Record<string, QuestionInput>`，编译期无法知道键名，所以 `systemOne<Q>` 的 `Q` 退化为 `Questions`（宽类型），`answers[id]` 是三种 `*Response` 的联合。处理方式：按入参 `type` 做 switch，用 `answer.type` 判别再读字段；对每题独立算 `decision`。三种单问工具则保留精确推断（键名固定为 `"q"`）。

调用形式（伪代码，与官方签名一致）：

```ts
const questions: Questions = Object.fromEntries(
  Object.entries(input.questions).map(([id, q]) => [id, toSdkQuestion(q)])
);
const res = await client.systemOne({ state: input.state, questions, model: input.model });
// res.answers[id].type ∈ "noul" | "choice" | "score"
```

一次请求、一次计费；官方 cookbook 显示 13 题打包比逐题便宜约 12 倍。

### D5. gating 放在代码，Noul 用「距 0.5 的距离」当 certainty

- Choice / Score：`certainty = answer.confidence`（API 已由分布算好）。
- Noul：API 不给 confidence，用 `certainty = |noul − 0.5| × 2`。这样 `decision` 只回答「这个是/否有多确定」，而 `answer = noul ≥ 0.5` 单独回答「是还是否」。
- 默认 `act_above = 0.8`、`review_above = 0.5`；比较用 `≥`。
- 结果同时返回 `certainty` 与生效的 `thresholds`，方便调用方审计。

**理由**：官方 Confidence 文档明确「阈值随风险变化，由代码编码风险偏好」；Jaggedness 文档明确 Noul 与 Choice 的数值不可互换、阈值不可跨类型迁移，所以每种类型的 certainty 来源必须显式且不同。**备选**：Noul 用 `max(p, 1−p)`——语义等价但 0.5 时得 0.5 而不是 0，与 `review_above = 0.5` 默认值冲突，容易把「完全不确定」判成 review。否决。

### D6. 密钥与客户端生命周期

- `client.ts` 导出 `getClient()`：首次调用时 `new TypeSafeClient({ apiKey, defaultModel, timeout, fetch: globalThis.fetch })`，缓存实例。显式传 `fetch` 是为了在 Bun 下绕开 SDK 可能的 runtime 探测差异（见 R1），同时也是测试注入点（`createServer({ fetch })` 覆盖）。
- 缺 key 时 `getClient()` 抛 `ConfigError`，由 `errors.ts` 映射为 `CONFIG ...`；服务器仍正常启动，`tools/list` 正常。
- 工具 input schema 用 `z.object({...})` 默认 strip 未知键；额外再对 `apiKey` / `authorization` / `api_key` 键做显式拒绝（`.strict()` 或 refine）以满足 spec 的「密钥当参数被拒」场景。

**备选**：启动时校验密钥、缺失即退出——Cursor 会显示服务器不可用且无提示，用户难排查。否决。

### D7. 错误映射表

| 来源 | 判定 | 类别 token | 文案要点 |
| --- | --- | --- | --- |
| `ConfigError` | 本地 | `CONFIG` | set `TYPESAFE_API_KEY` in mcp.json env |
| `ZodError` / refine | 本地 | `VALIDATION` | 参数名（批量含题 id） |
| `AuthenticationError` / `PermissionDeniedError` | `status` 401/403 | `AUTH` | key rejected |
| `UnprocessableEntityError` / `BadRequestError` | 422/400 | `INVALID_REQUEST` | 附 body 的字段说明（脱敏后） |
| `RateLimitError` | 429 | `RATE_LIMIT` | wait/retry; batch via jev_ask |
| `APIError` `status === 529` | 529 | `OVERLOADED` | retry later |
| `APITimeoutError` | — | `TIMEOUT` | shrink state |
| `APIConnectionError` | — | `NETWORK` | check connectivity |
| 其它 `APIError` | 5xx 等 | `UPSTREAM` | 附 status 与 request_id |
| 其它 `Error` | — | `UPSTREAM` | message 脱敏 |

脱敏：对最终文本做一次替换，把与 env 中密钥完全匹配或 ≥ 5 字符前缀匹配的子串替换为 `***`；不把 `headers` 序列化进任何输出。`SystemOneResult` 与 `APIError.body` 不含密钥，但 `body` 可能回显请求，故只摘取 `detail` / `message` 类字段。

### D8. 测试策略：注入 fetch 回放 fixture；集成测试按 env 开关

- 单测（无网、无 key）：`fakeFetch(fixtures)` 按 URL 路径（`/v1/systemone`、`/v1/models`）返回预录 JSON；通过 `createServer({ fetch })` 注入到 `TypeSafeClient`，再用 `@modelcontextprotocol/client` 的 `createMcpHandler(createServer)` + `StreamableHTTPClientTransport({ fetch: handler.fetch })` 进程内驱动，断言 `structuredContent` 与 `isError`。这是官方 v2 推荐的测试接线，不需要开端口。
- fixture 内容按官方 API 参考页的响应样例手写（`noul: 0.95`、`choice: "billing"` 等），后续有 key 时可用脚本录制覆盖。
- 纯函数（gating、errors、questions）直接 `bun test` 单测，不经过 MCP。
- 集成（真实 API）：`tests/integration/*.test.ts` 顶部 `if (!process.env.TYPESAFE_API_KEY) test.skip(...)`；只调 `jev_models` 和一条最小 `jev_check`，控制花费。
- stdio 端到端：一条 smoke 测试用 `StdioClientTransport({ command: "bun", args: ["run", "src/index.ts"] })` 拉起真实进程，仅断言 `tools/list` 的 5 个名字与 stdout 干净；标记为慢测，`bun test --filter stdio` 单独跑。

### D9. Cursor 配置形态

`examples/cursor.mcp.json`：

```json
{
  "mcpServers": {
    "jev": {
      "command": "bun",
      "args": ["run", "/ABSOLUTE/PATH/typesafe-mcp/src/index.ts"],
      "env": {
        "TYPESAFE_API_KEY": "<paste-your-key>",
        "TYPESAFE_DEFAULT_MODEL": "jev-latest"
      }
    }
  }
}
```

- 用户级 `~/.cursor/mcp.json` 适合个人开发（密钥只在本机）；项目级 `.cursor/mcp.json` 已被 `.gitignore` 忽略，可放但不会被提交。README 明确：不要在 `examples/` 或任何被跟踪文件里写真密钥。
- `args` 必须是绝对路径：Cursor 启动子进程的 cwd 不保证是仓库根。
- 若 `bun` 不在 Cursor 继承的 PATH 中，`command` 写 `bun` 的绝对路径（`which bun`）。

### D10. 分支与提交切片

从 `main` 开 `feature/build-jev-mcp`；按 P0 / P1 / P2 各一个 PR（或一个 PR 三组提交）。提交类型：`chore(scaffold)`、`feat(tools)`、`feat(gating)`、`test(...)`、`docs(readme)`。`bun.lock` 随 P0 提交。

## Risks / Trade-offs

- [R1 SDK 在 Bun 下的 runtime 检查] **P0 spike 结论（2026-09-21，`/tmp/jev-mcp-spike-42326`，不入库）：**
  - Bun `1.4.2` 提供 `globalThis.fetch`；`@typesafe-ai/sdk@0.6.0` 在 Bun 上可直接构造，**不需要**显式 `fetch` 也能跑通。`new TypeSafeClient({ apiKey: "dummy" })` 与 `new TypeSafeClient({ apiKey: "dummy", fetch: globalThis.fetch })` 均不抛 runtime 错误。
  - `client.models.list()` 无真密钥时失败形态仅为 `AuthenticationError` / HTTP 401（文案：`401 Cannot authenticate with the server…`），不是 runtime / missing-fetch。
  - 未设置 `dangerouslyAllowBrowser`。不需要自写 `/v1/systemone` + `/v1/models` 的 fetch 封装。
  - 仍**显式传入** `fetch`（默认 `globalThis.fetch`）：这是测试注入点（`createServer({ fetch })`），也避免将来 runtime 探测差异。
  - 同目录 MCP spike：`@modelcontextprotocol/server@2.0.0` + `zod@4.6.5`；`import * as z from "zod/v4"` 可解析；官方 `serveStdio` 对 initialize JSON-RPC 返回 `protocolVersion: "2025-11-25"` 且 stdin 关闭后退出码 0。进程内 `createMcpHandler` + `@modelcontextprotocol/client` `StreamableHTTPClientTransport({ fetch })` 可 `listTools` / `callTool`。
- [R2 Early access / 限流漂移] 429 / 529 频率不可控。→ 依赖 SDK 重试；错误文案引导用 `jev_ask` 合并；集成测试只打最小请求。
- [R3 中文题面弱] 官方声明英语最好，CJK 可用但弱。→ 工具描述建议英文 instructions；不在服务器里翻译；gating 阈值兜底；README 提示对中文内容先用自有数据验证。
- [R4 密钥泄露] 密钥进 transcript、日志或 fixture。→ 只读 env；schema 拒绝密钥参数；错误文本脱敏；`logLevel` 默认 `warn`（SDK `debug` 会打 body）；fixture 文件不含真实响应头；`.gitignore` 已含 `.env`、`.cursor/mcp.json`。
- [R5 分布集中度 ≠ 可执行] confidence 只描述分布集中，Jev 可能自信地错。→ 结果暴露 `probabilities`、`certainty`、`thresholds`；描述里明确「decision 是代码阈值，不是模型判断」；默认 0.8 偏保守。
- [R6 `jev-latest` 漂移] 别名换版本后阈值失效。→ 每个结果回报实际 `model`；README 建议生产钉 `jev-1.13.0`（`TYPESAFE_DEFAULT_MODEL` 或 per-call `model`）。
- [R7 MCP v2 与 Zod v4 版本耦合] `zod/v4` 子路径要求 zod ≥ 3.25 或 4.x。→ 直接 `bun add zod@^4`；`bun.lock` 锁定。
- [R8 Cursor 找不到 `bun`] GUI 启动的 Cursor 未必继承 shell PATH。→ 文档要求写绝对路径；smoke 测试用相同命令行验证。
- [R9 大 state 触发 32k/64k 上限] → 不在服务器截断（会改变语义）；把 422 映射为 `INVALID_REQUEST` 并提示缩小 state；描述里写明上限。

## Migration Plan

绿地项目，无迁移。回滚 = 关闭 Cursor 里的 `jev` server 条目或切回 `main`。

## Open Questions

- 用户是否已持有 `TYPESAFE_API_KEY`？（不影响 P0–P2 的实现与单测；只影响集成测试能否跑。默认按无 key 推进。）
- 第一个业务场景（例如拦截危险 shell、ticket 路由）——决定 P3 是否加 opinionated 工具。第一期只做通用 primitive。
- 题面主语言：默认英文为主、中文可用；若确认以中文为主，需要在 P2 增加中文 fixture 与阈值验证任务。
