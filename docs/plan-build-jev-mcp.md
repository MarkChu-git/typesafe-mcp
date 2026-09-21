# typesafe-mcp 实现手册：怎么造这个 MCP

日期：2026-09-21
状态：P0 已实现（stdio `jev_models` / `jev_check` + fixture 测试）。P1/P2 未做。OpenSpec change：`openspec/changes/build-jev-mcp/`（proposal / specs / design / tasks）。 CI 工作流由独立 PR 负责，见该 CI PR，本手册不重复配置。
前置阅读：`docs/research-jev-typesafe-mcp.md`（为什么这么做）、`README.md`、`CONTRIBUTING.md`。

本手册回答「具体怎么做」：到文件路径、类型、Zod schema、每个工具的 JSON 入参 / 出参、SDK 调用、任意 MCP host 的 stdio 配置、测试固定件和每一步的 `bun` 命令。与 OpenSpec 产物冲突时，以 specs 为行为契约、以本手册为实现细节。

---

## 0. 一页总览

| 项 | 决定 |
| --- | --- |
| 产品 | 自研 MCP 服务器，薄封装 TypeSafe 官方 JS SDK，让 **任意 MCP host / agent** 把 Jev 当「带概率的 if」。Cursor 只是其中一个客户端 |
| 运行时 | **只用 Bun**（`bun` / `bunx` / `bun add` / `bun test` / `bun.lock`）。禁 Node、npm、pnpm、yarn、npx |
| Lint | **只用 oxlint**（`.oxlintrc.json`）。禁 ESLint、Biome。类型仍用 `tsc --noEmit` |
| 语言 | TypeScript ESM，`bun run src/index.ts` 直跑，不构建 |
| MCP | `@modelcontextprotocol/server` v2（`McpServer` + `serveStdio`），`zod/v4` |
| TypeSafe | `@typesafe-ai/sdk` v0.6.x：`TypeSafeClient`、`systemOne`、`models.list`、`choice` / `score` / `noul` |
| 传输 | 第一期只有 **stdio**（任意本地 MCP host spawn）。Streamable HTTP 留给远程共享。Claude Desktop 等是 stdio 客户端，不是非目标 |
| 工具 | `jev_models`、`jev_check`、`jev_classify`、`jev_score`、`jev_ask`（不做 gate / screen / match） |
| 密钥 | 只读 `TYPESAFE_API_KEY`；工具参数禁止传 key；不提交 `.env` / 本机 host 配置 |
| 模型 | 默认 `jev-latest`；生产建议钉 `jev-1.13.0`；结果回报实际 `model` |
| gating | 代码算 `act / review / abstain`，默认 `0.8 / 0.5`；Choice/Score 用 `confidence`，Noul 用 `|p−0.5|×2` |
| 测试 | `bun test`；注入 `fetch` 回放 fixture；有 key 才跑集成 |
| 流程 | GitHub Flow：`main` → `feature/build-jev-mcp`；Conventional Commits；P0 / P1 / P2 分批 PR |

### 假设（用户未确认，先按默认推进）

| 未确认点 | 默认假设 | 影响 |
| --- | --- | --- |
| 有没有 `TYPESAFE_API_KEY` | **没有**。P0–P2 全靠 fixture；集成测试自动 skip | 只影响能否跑真实 API |
| 第一个业务场景 | 不绑定业务，先做 5 个通用 primitive | opinionated 工具留 P3 |
| 题面语言 | 英文为主，中文可用（官方声明 CJK 较弱） | 工具描述建议英文 instructions；P2 可加中文 fixture |

---

## 1. 目录结构与每个文件的责任

```
typesafe-mcp/
├── package.json                 Bun 项目清单：type=module、bin、scripts、依赖（§2）
├── bun.lock                     锁文件，P0 提交
├── tsconfig.json                只做类型检查（noEmit），Bun 直接跑 TS（§2.3）
├── src/
│   ├── index.ts                 进程入口：#!/usr/bin/env bun；serveStdio(() => createServer())；只接线
│   ├── server.ts                createServer(deps?)：new McpServer + 注册 5 个工具；导出给测试与未来 HTTP 复用
│   ├── config.ts                读 env：TYPESAFE_API_KEY / TYPESAFE_DEFAULT_MODEL / TYPESAFE_TIMEOUT_MS；常量：默认阈值、server name/version
│   ├── client.ts                getClient(overrides?)：TypeSafeClient 懒加载单例；缺 key 抛 ConfigError；显式传 fetch
│   ├── schemas.ts               全部 Zod：jsonValue、state、model、thresholds、五个工具 input / output（§4）
│   ├── questions.ts             Zod 入参 → SDK Questions（noul / choice / score helper）；jev_ask 批量构造（§5.6）
│   ├── gating.ts                certaintyOf(answer)、decide(certainty, thresholds)、withDecision(...)（§6）
│   ├── errors.ts                ConfigError；toToolError(err)：分类 token + 修复提示 + 脱敏（§7）
│   ├── result.ts                ok(structured)：content[text JSON] + structuredContent
│   └── tools/
│       ├── models.ts            jev_models
│       ├── check.ts             jev_check（Noul）
│       ├── classify.ts          jev_classify（Choice）
│       ├── score.ts             jev_score（Score）
│       └── ask.ts               jev_ask（混合批量，一次请求）
├── tests/
│   ├── fixtures/                预录 TypeSafe 响应 JSON（§9.2）
│   ├── helpers/
│   │   ├── fakeFetch.ts         按 URL/序列回放 fixture 的 fetch；记录调用次数与请求体
│   │   └── mcp.ts               进程内 MCP client 工厂（createMcpHandler + StreamableHTTPClientTransport）
│   ├── config.test.ts / client.test.ts / errors.test.ts / gating.test.ts / questions.test.ts / schemas.test.ts
│   ├── tools.check.test.ts / tools.classify.test.ts / tools.score.test.ts / tools.ask.test.ts / tools.models.test.ts
│   ├── server.test.ts           tools/list 恰好 5 个；结构化结果
│   ├── server.errors.test.ts    429/529/超时 → isError；进程仍可 list
│   ├── stdio.test.ts            拉起真实 bun 进程；慢测
│   └── integration/live.test.ts 有 TYPESAFE_API_KEY 才跑
├── examples/
│   ├── stdio.mcp.json           通用 stdio spawn（占位密钥、占位绝对路径）
│   ├── cursor.mcp.json          Cursor 同形示例
│   └── claude-desktop.json      Claude Desktop 同形示例
├── scripts/
│   └── record-fixture.ts        （可选）有 key 时录制真实响应为 fixture，去掉响应头
└── docs/
    ├── research-jev-typesafe-mcp.md
    └── plan-build-jev-mcp.md    本文件
```

为什么这样分：

- `schemas.ts` 是类型链路的源头（§8），工具、测试、README 都引用它，单独成文件避免循环依赖。
- `questions.ts` 是「MCP 入参 → SDK 问题」的唯一转换点；`jev_ask` 和三个单问工具共用，保证 criteria 形状一致（例如 Score criteria 在 SDK v0.6 起必须是数组）。
- `gating.ts`、`errors.ts` 不依赖 MCP，可用纯函数单测覆盖全部边界。
- `server.ts` 导出工厂而不是在 `index.ts` 内联，是官方 v2 推荐的可测形态（`createMcpHandler(createServer)` 进程内驱动），也为 P3 HTTP 复用。
- 一工具一文件：每个文件 60–120 行，review 粒度小，PR 可按工具切。

---

## 2. package.json、tsconfig、依赖

### 2.1 `package.json`

```json
{
  "name": "typesafe-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "MCP server exposing TypeSafe AI's Jev decision model (Choice / Score / Noul) as typed tools.",
  "license": "UNLICENSED",
  "packageManager": "bun@1.3.0",
  "engines": { "bun": ">=1.2.0" },
  "bin": { "typesafe-mcp": "./src/index.ts" },
  "scripts": {
    "start": "bun run src/index.ts",
    "dev": "bun --watch run src/index.ts",
    "typecheck": "bunx tsc --noEmit",
    "lint": "oxlint",
    "test": "bun test --filter-out integration",
    "test:all": "bun test",
    "test:integration": "bun test tests/integration",
    "test:stdio": "bun test tests/stdio.test.ts",
    "inspect": "bunx @modelcontextprotocol/inspector bun run src/index.ts",
    "record": "bun run scripts/record-fixture.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/server": "^2.0.0",
    "@typesafe-ai/sdk": "^0.6.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@modelcontextprotocol/client": "^2.0.0",
    "@types/bun": "latest",
    "oxlint": "latest",
    "typescript": "^5.6.0"
  }
}
```

注意：

- `packageManager` 的版本号在实现时用 `bun --version` 实际值替换。
- `bun test --filter-out` 若当前 Bun 版本不支持，改为 `bun test tests/*.test.ts`（不含子目录 `integration/`）。
- `bin` 直接指向 TS 文件，首行 `#!/usr/bin/env bun`。第一期不发布到 npm，`bin` 只为 `bunx --bun ./` 本地便利。
- 版本号 `^2.0.0` / `^0.6.0` 是根据官方文档写的期望；`bun add` 时以 registry 实际最新为准，写进 `bun.lock`。

### 2.2 安装命令（P0 任务 2.2）

```bash
cd /Users/mark/typesafe-mcp
bun add @typesafe-ai/sdk @modelcontextprotocol/server zod@^4
bun add -d @modelcontextprotocol/client typescript @types/bun oxlint
bun install --frozen-lockfile   # 验证锁文件一致
```

### 2.3 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["bun-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src", "tests", "scripts"]
}
```

`bunx tsc --noEmit` 只做类型检查；运行永远是 `bun run`。

---

## 3. 运行时骨架：index.ts / server.ts / config.ts / client.ts

### 3.1 `src/config.ts`

```ts
export const SERVER_NAME = "typesafe-mcp";
export const SERVER_VERSION = "0.1.0";

export const ENV = {
  apiKey: ["TYPESAFE", "API", "KEY"].join("_"),
  defaultModel: ["TYPESAFE", "DEFAULT", "MODEL"].join("_"),
  timeoutMs: ["TYPESAFE", "TIMEOUT", "MS"].join("_"),
} as const;

export const DEFAULT_MODEL = "jev-latest";
export const PINNED_MODEL_HINT = "jev-1.13.0"; // README 建议生产钉版
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_THRESHOLDS = { act_above: 0.8, review_above: 0.5 } as const;

export interface RuntimeConfig {
  apiKey: string | undefined;   // undefined = 缺失（trim 后为空也算缺失）
  defaultModel: string;
  timeoutMs: number;
}

export function readConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  const key = env[ENV.apiKey]?.trim();
  const model = env[ENV.defaultModel]?.trim();
  const timeout = Number(env[ENV.timeoutMs]);
  return {
    apiKey: key ? key : undefined,
    defaultModel: model ? model : DEFAULT_MODEL,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}
```

### 3.2 `src/client.ts`

```ts
import { TypeSafeClient, type Fetch } from "@typesafe-ai/sdk";
import { readConfig, type RuntimeConfig } from "./config.ts";
import { ConfigError } from "./errors.ts";

export interface ClientDeps {
  fetch?: Fetch;                 // 测试注入；默认 globalThis.fetch
  env?: Record<string, string | undefined>;
}

let cached: TypeSafeClient | undefined;

export function getClient(deps: ClientDeps = {}): TypeSafeClient {
  if (cached) return cached;
  const cfg: RuntimeConfig = readConfig(deps.env);
  if (!cfg.apiKey) {
    throw new ConfigError(
      "TYPESAFE_API_KEY is not set. Add it to the MCP server env in your host config (stdio spawn env). Get a key at https://console.typesafe.ai",
    );
  }
  cached = new TypeSafeClient({
    apiKey: cfg.apiKey,
    defaultModel: cfg.defaultModel,
    timeout: cfg.timeoutMs,
    fetch: deps.fetch ?? (globalThis.fetch as Fetch),  // 显式传 Bun 的 fetch，见 §10 R1
    logLevel: "warn",                                    // debug 会打 body，禁止
  });
  return cached;
}

/** 测试用：重置单例 */
export function resetClient(): void { cached = undefined; }
```

已核对的 SDK 事实：`TypeSafeClientConfig` 字段为 `apiKey?`、`baseURL?`、`defaultModel?`、`fetch?`、`timeout?`（默认 10000ms / 每次尝试）、`retry?`、`logLevel?`（默认 `warn`）、`logger?`、`defaultHeaders?`、`dangerouslyAllowBrowser?`（永不设）。构造函数「密钥缺失、配置非法或 runtime 不支持时抛错」。

### 3.3 `src/server.ts`

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { SERVER_NAME, SERVER_VERSION } from "./config.ts";
import type { ClientDeps } from "./client.ts";
import { registerModels } from "./tools/models.ts";
import { registerCheck } from "./tools/check.ts";
import { registerClassify } from "./tools/classify.ts";
import { registerScore } from "./tools/score.ts";
import { registerAsk } from "./tools/ask.ts";

export function createServer(deps: ClientDeps = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerModels(server, deps);
  registerCheck(server, deps);
  registerClassify(server, deps);
  registerScore(server, deps);
  registerAsk(server, deps);
  return server;
}
```

每个 `registerX(server, deps)` 内部调用 `server.registerTool(name, { title, description, inputSchema, outputSchema, annotations: { readOnlyHint: true, idempotentHint: true } }, handler)`。

### 3.4 `src/index.ts`

```ts
#!/usr/bin/env bun
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.ts";

process.on("uncaughtException", (e) => { console.error("[typesafe-mcp] fatal:", e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("[typesafe-mcp] unhandled:", e); });

serveStdio(() => createServer());
```

铁律：**stdout 只给 JSON-RPC**。任何日志用 `console.error`。一个 `console.log` 就会让任意 MCP host 解析失败。

---

## 4. Zod schema（`src/schemas.ts`）

```ts
import * as z from "zod/v4";

// ---- 基础 ----
export const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)]),
);
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export const stateSchema = z
  .union([z.string().min(1), z.record(z.string(), jsonValue), z.array(jsonValue).min(1)])
  .describe(
    "The content Jev evaluates: a plain string, a JSON object (fields can be referenced from the question as `field`), or an array of JSON values. Send only what the question needs; irrelevant detail lowers accuracy. Max ~32k tokens together with the longest question.",
  );

export const questionSchema = z
  .string()
  .min(1)
  .describe(
    "The question in plain English (other languages work but are less accurate). Jev reads literally: state the exact condition, avoid double negatives and multi-hop reasoning. Jev does NOT generate text; it only answers this structured question.",
  );

export const modelSchema = z
  .string()
  .min(1)
  .optional()
  .describe("Model id or alias. Default jev-latest. Pin a versioned id like jev-1.13.0 when thresholds are tuned.");

const forbiddenKeys = ["apiKey", "api_key", "apikey", "authorization", "token", "TYPESAFE_API_KEY"];
export const rejectSecretKeys = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).strict().superRefine((_v, ctx) => { /* strict 已拒绝未知键；此处留作显式错误文案 */ });

// ---- 阈值 ----
export const thresholdFields = {
  act_above: z.number().min(0).max(1).optional()
    .describe("Certainty at or above this → decision \"act\". Default 0.8. Raise for high-stakes actions."),
  review_above: z.number().min(0).max(1).optional()
    .describe("Certainty at or above this (but below act_above) → \"review\". Below → \"abstain\". Default 0.5."),
};
export const refineThresholds = <T extends { act_above?: number; review_above?: number }>(v: T, ctx: z.RefinementCtx) => {
  const act = v.act_above ?? 0.8, rev = v.review_above ?? 0.5;
  if (rev > act) ctx.addIssue({ code: "custom", path: ["review_above"], message: "review_above must not exceed act_above" });
};

// ---- 共用输出片段 ----
export const decisionSchema = z.enum(["act", "review", "abstain"]);
export const thresholdsOut = z.object({ act_above: z.number(), review_above: z.number() });
export const usageSchema = z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() });
export const metaFields = { model: z.string().min(1), usage: usageSchema };
export const gateFields = { certainty: z.number().min(0).max(1), decision: decisionSchema, thresholds: thresholdsOut };

// ---- criteria ----
export const noulCriteriaSchema = z.object({
  true: z.string().min(1).optional().describe("What a YES (probability near 1) means."),
  false: z.string().min(1).optional().describe("What a NO (probability near 0) means."),
}).optional().describe("Optional descriptions of the yes/no outcomes. Keep them aligned with the question.");

export const optionsSchema = z
  .record(z.string().min(1), z.string().nullable())
  .refine((o) => Object.keys(o).length >= 2, "at least 2 options are required")
  .refine((o) => Object.keys(o).length <= 255, "at most 255 options are allowed")
  .describe("Closed set of options: label → short rubric (or null). 2–255 entries. Jev must pick exactly one.");

export const levelsSchema = z
  .array(z.string().nullable())
  .min(2).max(10)
  .describe("Ordered rubric levels, index 0 first. 2–10 entries. Returned score is a probability-weighted value across indices.");

// ---- jev_models ----
export const modelsInput = z.object({}).strict();
export const modelsOutput = z.object({
  models: z.array(z.object({ name: z.string(), description: z.string(), release_date: z.string() })),
  default_model: z.string(),
});

// ---- jev_check ----
export const checkInput = z.object({
  state: stateSchema, question: questionSchema, criteria: noulCriteriaSchema, model: modelSchema, ...thresholdFields,
}).strict().superRefine(refineThresholds);
export const checkOutput = z.object({
  type: z.literal("noul"), probability: z.number().min(0).max(1), answer: z.boolean(), ...gateFields, ...metaFields,
});

// ---- jev_classify ----
export const classifyInput = z.object({
  state: stateSchema, question: questionSchema, options: optionsSchema, model: modelSchema, ...thresholdFields,
}).strict().superRefine(refineThresholds);
export const classifyOutput = z.object({
  type: z.literal("choice"), choice: z.string(), probabilities: z.record(z.string(), z.number()), confidence: z.number(),
  ...gateFields, ...metaFields,
});

// ---- jev_score ----
export const scoreInput = z.object({
  state: stateSchema, question: questionSchema, levels: levelsSchema, model: modelSchema, ...thresholdFields,
}).strict().superRefine(refineThresholds);
export const scoreOutput = z.object({
  type: z.literal("score"), score: z.number(), legend: z.record(z.string(), z.string().nullable()),
  probabilities: z.record(z.string(), z.number()), confidence: z.number(), ...gateFields, ...metaFields,
});

// ---- jev_ask ----
export const askQuestionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), question: questionSchema, criteria: noulCriteriaSchema }).strict(),
  z.object({ type: z.literal("choice"), question: questionSchema, options: optionsSchema }).strict(),
  z.object({ type: z.literal("score"), question: questionSchema, levels: levelsSchema }).strict(),
]);
export const askInput = z.object({
  state: stateSchema,
  questions: z.record(z.string().min(1), askQuestionSchema)
    .refine((q) => Object.keys(q).length >= 1, "at least one question is required")
    .describe("Map of your own question ids → question. All are answered in ONE request against the same state. Batching is ~10x cheaper and faster than separate calls."),
  model: modelSchema, ...thresholdFields,
}).strict().superRefine(refineThresholds);

const noulAnswer = z.object({ type: z.literal("noul"), probability: z.number(), answer: z.boolean(), ...gateFields });
const choiceAnswer = z.object({ type: z.literal("choice"), choice: z.string(), probabilities: z.record(z.string(), z.number()), confidence: z.number(), ...gateFields });
const scoreAnswer = z.object({ type: z.literal("score"), score: z.number(), legend: z.record(z.string(), z.string().nullable()), probabilities: z.record(z.string(), z.number()), confidence: z.number(), ...gateFields });
export const askOutput = z.object({
  answers: z.record(z.string(), z.discriminatedUnion("type", [noulAnswer, choiceAnswer, scoreAnswer])),
  ...metaFields,
});

export type CheckInput = z.infer<typeof checkInput>;   // 其余同理导出
```

要点：

- `.strict()` 让 `apiKey` 等未知键直接被 SDK 的入参校验拒绝（返回 `isError: true`，handler 不会跑），满足「密钥当参数被拒」的 spec。
- 所有 `.describe()` 都会进入 `tools/list` 的 JSON Schema，是 agent 唯一能看到的字段文档，写英文。
- 第一期 `question` 只收字符串；SDK 支持对象型 `instructions`（可引用 `state` 字段），留 P3。

---

## 5. 五个工具逐一定义

约定：所有 handler 形如

```ts
async (input) => {
  try {
    const client = getClient(deps);
    ...一次 SDK 调用...
    return ok(outputSchema.parse(structured));
  } catch (e) {
    return toToolError(e, { tool: "jev_check" });
  }
}
```

`ok()` 返回 `{ content: [{ type: "text", text: JSON.stringify(structured) }], structuredContent: structured }`。SDK 会再用 `outputSchema` 校验一次并把 JSON Schema 广播给客户端。

### 5.1 `jev_models`

- **description**（英文）：`List the Jev models available to this account and report the server's default model. Cheap health check: no System One inference tokens are consumed. Call this first if other jev_* tools fail with AUTH or CONFIG.`
- **inputSchema**：`modelsInput`（空对象）
- **outputSchema**：`modelsOutput`
- **SDK**：`const models = await client.models.list();`（返回 `ModelCard[]`：`{ name, description, release_date }`）
- **输出示例**：

```json
{ "models": [ { "name": "jev-latest", "description": "...", "release_date": "2026-09-..." }, { "name": "jev-preview", "...": "..." } ], "default_model": "jev-latest" }
```

- **错误**：缺 key → `CONFIG ...`；401 → `AUTH ...`；网络 → `NETWORK ...`。

### 5.2 `jev_check`（Noul）

- **description**：`Ask Jev one yes/no question about `state` and get the probability (0–1) that the answer is yes. Jev returns structured decisions only — it never generates text or explanations. `decision` (act/review/abstain) is computed by this server from |probability−0.5|×2 against your thresholds; it is not Jev's opinion about whether you may proceed.`
- **inputSchema** `checkInput`：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state` | string \| object \| array | 是 | 要判断的内容 |
| `question` | string | 是 | 是/否问题 |
| `criteria` | `{ true?: string; false?: string }` | 否 | 是/否含义 |
| `model` | string | 否 | 默认 `jev-latest` |
| `act_above` / `review_above` | number 0–1 | 否 | 默认 0.8 / 0.5 |

- **入参示例**：

```json
{ "state": "Help! My payouts have been failing for 3 days.", "question": "Does this message convey urgency?", "criteria": { "true": "Explicitly time-sensitive", "false": "No urgency expressed" } }
```

- **SDK**：

```ts
const res = await client.systemOne({
  state: input.state,
  model: input.model,
  questions: { q: noul(input.question, input.criteria ?? null) },
});
const a = res.answers.q;            // NoulResponse: { type: "noul", noul: number }
const probability = a.noul;
const gate = decide(certaintyOf(a), thresholdsFrom(input));
```

- **outputSchema** `checkOutput` / 出参示例：

```json
{ "type": "noul", "probability": 0.95, "answer": true, "certainty": 0.9, "decision": "act",
  "thresholds": { "act_above": 0.8, "review_above": 0.5 }, "model": "jev-1.13.0", "usage": { "input_tokens": 307, "output_tokens": 20 } }
```

- **错误**：空 `question` / 空 `state` → SDK 入参校验 `isError`（`VALIDATION`）；阈值倒置 → `VALIDATION review_above must not exceed act_above`；缺 key → `CONFIG`；429/529 → `RATE_LIMIT` / `OVERLOADED`；超时 → `TIMEOUT`。

### 5.3 `jev_classify`（Choice）

- **description**：`Ask Jev to pick exactly one option from a closed set you define (2–255 labels), given `state`. Returns the chosen label, the full probability distribution and Jev's confidence (0–1, derived from how concentrated the distribution is). Jev never invents new labels and never generates text. `decision` is computed by this server from `confidence` against your thresholds.`
- **inputSchema** `classifyInput`：`state`、`question`、`options`（record label → rubric|null）、`model?`、阈值。
- **入参示例**：

```json
{ "state": { "ticket": "Help! My payouts have been failing for 3 days." },
  "question": "Which team should handle `ticket`?",
  "options": { "billing": "Payments, invoicing, refunds", "technical": "Bugs, outages, integrations", "sales": null } }
```

- **SDK**：

```ts
const res = await client.systemOne({ state, model, questions: { q: choice(question, options) } });
const a = res.answers.q;   // ChoiceResponse<typeof options>: { type:"choice", choice, probabilities, confidence }
```

- **出参示例**：

```json
{ "type": "choice", "choice": "billing", "probabilities": { "billing": 0.88, "technical": 0.12, "sales": 0.0 }, "confidence": 0.81,
  "certainty": 0.81, "decision": "act", "thresholds": { "act_above": 0.8, "review_above": 0.5 }, "model": "jev-1.13.0", "usage": { "input_tokens": 318, "output_tokens": 34 } }
```

- **错误**：`options` <2 或 >255 → `VALIDATION`；其余同 5.2。

### 5.4 `jev_score`（Score）

- **description**：`Ask Jev to rate `state` on an ordered rubric you define (2–10 levels, index 0 first). Returns the probability-weighted score (may fall between levels), the legend, the per-level distribution and confidence. Use the score to compare against a threshold, not to reconstruct exact numbers. Jev never generates text; `decision` is computed by this server from `confidence`.`
- **inputSchema** `scoreInput`：`state`、`question`、`levels`（array 2–10）、`model?`、阈值。
- **入参示例**：

```json
{ "state": "Help! My payouts have been failing for 3 days.", "question": "How frustrated is the customer?", "levels": ["Calm", "Frustrated", "Very angry"] }
```

- **SDK**（v0.6 起 criteria 为有序数组）：

```ts
const res = await client.systemOne({ state, model, questions: { q: score(question, levels as [string|null, string|null, ...(string|null)[]]) } });
const a = res.answers.q;   // ScoreResponse: { type:"score", score, legend, probabilities, confidence }
```

- **出参示例**：

```json
{ "type": "score", "score": 1.05, "legend": { "0": "Calm", "1": "Frustrated", "2": "Very angry" }, "probabilities": { "0": 0.0, "1": 0.95, "2": 0.05 },
  "confidence": 0.92, "certainty": 0.92, "decision": "act", "thresholds": { "act_above": 0.8, "review_above": 0.5 }, "model": "jev-1.13.0", "usage": { "input_tokens": 304, "output_tokens": 18 } }
```

`legend` 与 `probabilities` 的键统一转成字符串索引再输出（SDK 类型允许 number 或 `${number}` 键）。

### 5.5 `jev_ask`（混合批量）

- **description**：`Ask Jev several questions (noul / choice / score, mixed) about the SAME state in ONE request. Use this instead of multiple jev_* calls: one request is roughly 10x cheaper and faster and gives identical answers. Each answer carries its own probability/confidence and a server-computed decision. Jev never generates text.`
- **inputSchema** `askInput`：`state`、`questions`（record id → 判别联合）、`model?`、阈值（对所有题生效）。
- **入参示例**：

```json
{ "state": { "ticket": "Help! My payouts have been failing for 3 days." },
  "questions": {
    "urgent": { "type": "noul", "question": "Does `ticket` convey urgency?" },
    "dept":   { "type": "choice", "question": "Which team should handle `ticket`?", "options": { "billing": null, "technical": null, "sales": null } },
    "anger":  { "type": "score", "question": "How frustrated is the customer?", "levels": ["Calm", "Frustrated", "Very angry"] }
  } }
```

- **出参示例**：

```json
{ "answers": {
    "urgent": { "type": "noul", "probability": 0.95, "answer": true, "certainty": 0.9, "decision": "act", "thresholds": { "act_above": 0.8, "review_above": 0.5 } },
    "dept":   { "type": "choice", "choice": "billing", "probabilities": { "billing": 0.88, "technical": 0.12, "sales": 0.0 }, "confidence": 0.81, "certainty": 0.81, "decision": "act", "thresholds": { "act_above": 0.8, "review_above": 0.5 } },
    "anger":  { "type": "score", "score": 1.05, "legend": { "0": "Calm", "1": "Frustrated", "2": "Very angry" }, "probabilities": { "0": 0.0, "1": 0.95, "2": 0.05 }, "confidence": 0.92, "certainty": 0.92, "decision": "act", "thresholds": { "act_above": 0.8, "review_above": 0.5 } }
  }, "model": "jev-1.13.0", "usage": { "input_tokens": 340, "output_tokens": 72 } }
```

- **错误**：`questions` 为 `{}` → `VALIDATION at least one question is required`（不发请求）；某题非法 → `VALIDATION questions.dept.options: at least 2 options are required`（Zod path 自带题 id）；其余同上。

### 5.6 `src/questions.ts`：把多题打进同一次 `systemOne`

```ts
import { choice, noul, score, type Questions, type Question } from "@typesafe-ai/sdk";
import type { z } from "zod/v4";
import type { askQuestionSchema } from "./schemas.ts";

type AskQ = z.infer<typeof askQuestionSchema>;

export function toSdkQuestion(q: AskQ): Question {
  switch (q.type) {
    case "noul":   return noul(q.question, q.criteria ?? null);
    case "choice": return choice(q.question, q.options);
    case "score":  return score(q.question, q.levels as [unknown, unknown, ...unknown[]] as never);
  }
}

export function buildQuestions(record: Record<string, AskQ>): Questions {
  return Object.fromEntries(Object.entries(record).map(([id, q]) => [id, toSdkQuestion(q)]));
}
```

`jev_ask` handler：

```ts
const questions = buildQuestions(input.questions);
const res = await client.systemOne({ state: input.state, model: input.model, questions }); // 恰好一次
const th = thresholdsFrom(input);
const answers = Object.fromEntries(
  Object.entries(res.answers).map(([id, a]) => [id, withDecision(a, th)]),  // withDecision 按 a.type 判别
);
return ok(askOutput.parse({ answers, model: res.model, usage: res.usage }));
```

因为键名是运行期的，这里 `Q` 退化为宽类型 `Questions`，`res.answers[id]` 是 `NoulResponse | ChoiceResponse | ScoreResponse` 联合，靠 `a.type` 判别。三个单问工具键名固定为 `q`，保留精确推断。

---

## 6. gating（`src/gating.ts`）

```ts
import type { ChoiceResponse, NoulResponse, ScoreResponse } from "@typesafe-ai/sdk";
import { DEFAULT_THRESHOLDS } from "./config.ts";

export type Decision = "act" | "review" | "abstain";
export interface Thresholds { act_above: number; review_above: number }
type Answer = NoulResponse | ChoiceResponse | ScoreResponse;

export function thresholdsFrom(input: { act_above?: number; review_above?: number }): Thresholds {
  return { act_above: input.act_above ?? DEFAULT_THRESHOLDS.act_above, review_above: input.review_above ?? DEFAULT_THRESHOLDS.review_above };
}

/** Choice/Score 用 API 的 confidence；Noul 用距 0.5 的归一化距离 */
export function certaintyOf(a: Answer): number {
  if (a.type === "noul") return Math.min(1, Math.max(0, Math.abs(a.noul - 0.5) * 2));
  return Math.min(1, Math.max(0, a.confidence));
}

export function decide(certainty: number, th: Thresholds): Decision {
  if (certainty >= th.act_above) return "act";
  if (certainty >= th.review_above) return "review";
  return "abstain";
}

export function withDecision(a: Answer, th: Thresholds) {
  const certainty = certaintyOf(a);
  const gate = { certainty, decision: decide(certainty, th), thresholds: th };
  switch (a.type) {
    case "noul":   return { type: "noul" as const, probability: a.noul, answer: a.noul >= 0.5, ...gate };
    case "choice": return { type: "choice" as const, choice: a.choice, probabilities: a.probabilities, confidence: a.confidence, ...gate };
    case "score":  return { type: "score" as const, score: a.score, legend: stringKeys(a.legend), probabilities: stringKeys(a.probabilities), confidence: a.confidence, ...gate };
  }
}
```

规则与边界（对应 `specs/decision-gating`）：

| certainty | 默认 0.8 / 0.5 | 结果 |
| --- | --- | --- |
| 0.80 | ≥ act | `act` |
| 0.79 | < act, ≥ review | `review` |
| 0.49 | < review | `abstain` |
| Noul p=0.95 → 0.9 | | `act`, answer=true |
| Noul p=0.05 → 0.9 | | `act`, answer=false |
| Noul p=0.5 → 0 | | `abstain` |
| Choice conf=0.2（即使 top prob 0.6） | | `abstain` |
| override act_above=0.95, cert=0.9 | | `review` |
| review_above > act_above | | `VALIDATION` 拒绝 |

为什么不让 Jev 决定：官方 Confidence 文档说阈值随风险变化、由代码编码风险偏好；Jaggedness 文档说 Noul 与 Choice 的数值不可互换。所以 certainty 来源按类型分开、阈值可按调用覆盖、结果回报 `certainty` 与 `thresholds` 供审计。

---

## 7. 错误映射（`src/errors.ts`）

```ts
import { APIConnectionError, APIError, APITimeoutError, AuthenticationError, PermissionDeniedError,
         RateLimitError, UnprocessableEntityError, BadRequestError } from "@typesafe-ai/sdk";
import { ZodError } from "zod/v4";

export class ConfigError extends Error { name = "ConfigError" }

export type ErrorCategory = "AUTH" | "RATE_LIMIT" | "OVERLOADED" | "TIMEOUT" | "NETWORK" | "INVALID_REQUEST" | "VALIDATION" | "UPSTREAM" | "CONFIG";

export function classify(err: unknown): { category: ErrorCategory; hint: string; requestId?: string; detail?: string } { /* 见下表 */ }

export function toToolError(err: unknown, ctx: { tool: string }) {
  const c = classify(err);
  const text = redact(`${c.category}: ${c.hint}${c.detail ? ` Detail: ${c.detail}` : ""}${c.requestId ? ` (request_id ${c.requestId})` : ""} [tool ${ctx.tool}]`);
  console.error(`[typesafe-mcp] ${ctx.tool} ${c.category}${c.requestId ? ` ${c.requestId}` : ""}`);
  return { content: [{ type: "text" as const, text }], isError: true as const };
}
```

| 判定顺序 | 条件 | category | hint |
| --- | --- | --- | --- |
| 1 | `err instanceof ConfigError` | `CONFIG` | Set TYPESAFE_API_KEY in the MCP server env (host config → env, or the process environment). Get a key at console.typesafe.ai. |
| 2 | `err instanceof ZodError` | `VALIDATION` | `issues.map(i => path.join('.') + ': ' + message)` |
| 3 | `AuthenticationError` \| `PermissionDeniedError`（401/403） | `AUTH` | TYPESAFE_API_KEY was rejected. Check the key and account status; run jev_models to verify. |
| 4 | `UnprocessableEntityError` \| `BadRequestError`（422/400） | `INVALID_REQUEST` | The API rejected the request body. + body 的 `detail`/`message`（脱敏） |
| 5 | `RateLimitError`（429） | `RATE_LIMIT` | Rate limited after retries. Wait a few seconds, or batch questions into one jev_ask call. |
| 6 | `APIError && status === 529` | `OVERLOADED` | TypeSafe is temporarily overloaded. Retry shortly. |
| 7 | `APITimeoutError` | `TIMEOUT` | Request timed out after retries. Reduce state size or raise TYPESAFE_TIMEOUT_MS. |
| 8 | `APIConnectionError` | `NETWORK` | Could not reach api.typesafe.ai. Check connectivity/proxy. |
| 9 | 其它 `APIError` | `UPSTREAM` | `HTTP ${status}` |
| 10 | 其它 | `UPSTREAM` | `err.message` |

脱敏 `redact(text)`：读取 `process.env.TYPESAFE_API_KEY`；若存在，把文本里与完整 key 相同、或与 key 的 ≥5 字符前缀相同的子串替换为 `***`；同时正则替换 `Bearer\s+\S+` → `Bearer ***`。永不把 `err.headers` 序列化。

重试全部交给 SDK 默认 `RetryPolicy`（`maxRetries: 2`、退避 500ms→5000ms、尊重 `Retry-After`、重试 408/429/5xx 与连接/超时错误）。handler 里不再包第二层重试。

---

## 8. 类型安全链路

```
src/schemas.ts (Zod)
   │  registerTool({ inputSchema })      → SDK 自动派生 JSON Schema，含 .describe()，进入 tools/list
   │  z.infer<typeof checkInput>          → handler 参数类型（SDK 先校验再调用 handler）
   ▼
src/questions.ts   noul()/choice()/score()  → SDK Questions（ChoiceQuestion<T> 等带 criteria 泛型）
   ▼
client.systemOne<Q>(...)                    → SystemOneResult<Q> = { answers: { [K]: ResultFor<Q[K]> }, model, usage }
   │   ResultFor<ChoiceQuestion<T>> = ChoiceResponse<T>（choice: keyof T & string）
   │   ResultFor<ScoreQuestion<T>>  = ScoreResponse<T>（legend: ScoreLegend<T>）
   │   ResultFor<NoulQuestion>      = NoulResponse
   ▼
src/gating.ts withDecision(answer, thresholds)  → 附 certainty / decision / thresholds
   ▼
outputSchema.parse(structured)              → handler 内先 parse，SDK 再校验一次
   ▼
{ content: [{ type: "text", text: JSON.stringify(structured) }], structuredContent: structured }
```

三处保证：Zod 在入口（SDK 自动）；TS 在中间（SDK 泛型推断）；Zod 在出口（`outputSchema`）。任何一处形状漂移都在 `bunx tsc --noEmit` 或 `bun test` 阶段暴露，而不是在 host 里出现难以排查的字符串。

---

## 9. 测试策略与固定件

### 9.1 三层测试

| 层 | 文件 | 依赖 | 命令 |
| --- | --- | --- | --- |
| 纯函数单测 | `tests/gating.test.ts`、`errors.test.ts`、`questions.test.ts`、`schemas.test.ts`、`config.test.ts`、`client.test.ts` | 无网络、无 key | `bun test tests/gating.test.ts` 等 |
| 工具 / 服务器（进程内） | `tests/tools.*.test.ts`、`server.test.ts`、`server.errors.test.ts` | `fakeFetch` + `@modelcontextprotocol/client` | `bun test` |
| stdio 端到端 | `tests/stdio.test.ts` | 拉起 `bun run src/index.ts` | `bun run test:stdio` |
| 真实 API 集成 | `tests/integration/live.test.ts` | `TYPESAFE_API_KEY` | `bun run test:integration` |

### 9.2 fixture 清单（`tests/fixtures/`）

内容按官方 API 参考页样例手写，后续有 key 时用 `scripts/record-fixture.ts` 覆盖。

| 文件 | 路径 | 内容摘要 |
| --- | --- | --- |
| `models.ok.json` | `GET /v1/models` | `[{ name:"jev-latest", description, release_date }, { name:"jev-preview", ... }]` |
| `check.yes095.json` | `POST /v1/systemone` | `{ model:"jev-1.13.0", answers:{ q:{ type:"noul", noul:0.95 } }, usage:{ input_tokens:307, output_tokens:20 } }` |
| `check.ambiguous052.json` | 同上 | `noul: 0.52` |
| `check.no005.json` | 同上 | `noul: 0.05` |
| `classify.billing.json` | 同上 | `{ q:{ type:"choice", choice:"billing", probabilities:{ billing:0.88, technical:0.12, sales:0 }, confidence:0.81 } }` |
| `classify.lowconf.json` | 同上 | `probabilities:{ a:0.6, b:0.4 }, confidence:0.2` |
| `score.frustration.json` | 同上 | `{ q:{ type:"score", score:1.05, legend:{"0":"Calm","1":"Frustrated","2":"Very angry"}, probabilities:{"0":0,"1":0.95,"2":0.05}, confidence:0.92 } }` |
| `ask.mixed3.json` | 同上 | `answers:{ urgent:{noul}, dept:{choice}, anger:{score} }` |
| `error.401.json` | 任意 | status 401，body `{ "error": "invalid api key" }` |
| `error.422.json` | `POST /v1/systemone` | status 422，body `{ "detail": [{ "loc": ["questions","q","criteria"], "msg": "..." }] }` |
| `error.429.json` | 同上 | status 429，header `retry-after: 1` |
| `error.529.json` | 同上 | status 529 |

### 9.3 `tests/helpers/fakeFetch.ts`

```ts
import type { Fetch } from "@typesafe-ai/sdk";

export interface Recorded { url: string; init?: RequestInit; body?: unknown }
export interface FakeFetch { fetch: Fetch; calls: Recorded[] }

/** routes: 路径 → 单个响应或按调用顺序消费的响应数组 */
export function fakeFetch(routes: Record<string, FixtureResponse | FixtureResponse[]>): FakeFetch {
  const calls: Recorded[] = [];
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  const fetch: Fetch = async (input, init) => {
    const path = new URL(input).pathname;
    calls.push({ url: input, init, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const q = queues.get(path); const fx = q && (q.length > 1 ? q.shift() : q[0]);
    if (!fx) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(fx.body), { status: fx.status ?? 200, headers: { "content-type": "application/json", ...(fx.headers ?? {}) } });
  };
  return { fetch, calls };
}
```

用法：`const ff = fakeFetch({ "/v1/systemone": load("check.yes095.json") }); const server = createServer({ fetch: ff.fetch, env: { TYPESAFE_API_KEY: "test-key" } });`

`jev_ask` 断言「只发一次请求」：`expect(ff.calls.length).toBe(1)`；`expect(Object.keys(ff.calls[0].body.questions)).toEqual(["urgent","dept","anger"])`。

### 9.4 `tests/helpers/mcp.ts`（官方 v2 推荐接线）

```ts
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "../../src/server.ts";
import type { ClientDeps } from "../../src/client.ts";

export async function inProcessClient(deps: ClientDeps) {
  const handler = createMcpHandler(() => createServer(deps));
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  const client = new Client({ name: "test-harness", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(transport);
  return { client, close: async () => { await client.close(); await handler.close(); } };
}
```

断言 `result.structuredContent` 与 `result.isError`。`afterEach` 里调用 `close()` 并 `resetClient()`。

### 9.5 典型用例（`bun test`）

```ts
import { describe, expect, test, afterEach } from "bun:test";

describe("jev_check", () => {
  afterEach(() => resetClient());
  test("0.95 → act / true", async () => {
    const ff = fakeFetch({ "/v1/systemone": fx("check.yes095.json") });
    const { client, close } = await inProcessClient({ fetch: ff.fetch, env: { TYPESAFE_API_KEY: "test-key" } });
    const r = await client.callTool({ name: "jev_check", arguments: { state: "Help!", question: "Is this urgent?" } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ probability: 0.95, answer: true, decision: "act", model: "jev-1.13.0" });
    expect(ff.calls[0]?.body).toMatchObject({ state: "Help!", questions: { q: { type: "noul" } } });
    await close();
  });
  test("missing key → CONFIG", async () => {
    const { client, close } = await inProcessClient({ env: {} });
    const r = await client.callTool({ name: "jev_check", arguments: { state: "x", question: "y?" } });
    expect(r.isError).toBe(true);
    expect((r.content as any)[0].text).toStartWith("CONFIG");
    await close();
  });
  test("apiKey argument is rejected before network", async () => {
    const ff = fakeFetch({});
    const { client, close } = await inProcessClient({ fetch: ff.fetch, env: { TYPESAFE_API_KEY: "test-key" } });
    const r = await client.callTool({ name: "jev_check", arguments: { state: "x", question: "y?", apiKey: "leak" } });
    expect(r.isError).toBe(true);
    expect(ff.calls.length).toBe(0);
    await close();
  });
});
```

集成测试开关：

```ts
const key = process.env.TYPESAFE_API_KEY;
describe.skipIf(!key)("live TypeSafe API", () => { /* jev_models + 一条 ≤200 字符 jev_check */ });
```

stdio smoke：

```ts
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
const c = new Client({ name: "t", version: "1" });
await c.connect(new StdioClientTransport({ command: "bun", args: ["run", "src/index.ts"], env: { ...process.env, TYPESAFE_API_KEY: "" } }));
const { tools } = await c.listTools();
expect(tools.map(t => t.name).sort()).toEqual(["jev_ask","jev_check","jev_classify","jev_models","jev_score"]);
await c.close();
```

---

## 10. MCP host 配置（stdio）

产品是 **stdio MCP server**。Cursor 只是其中一个客户端。同一 spawn 适用于 Claude Desktop、Claude Code、Codex、Windsurf、Cline、自建 agent。Streamable HTTP 是后续远程选项。

### 10.1 `examples/stdio.mcp.json`（规范形态）

```json
{
  "mcpServers": {
    "jev": {
      "command": "bun",
      "args": ["run", "/ABSOLUTE/PATH/TO/typesafe-mcp/src/index.ts"],
      "env": {
        "TYPESAFE_API_KEY": "<paste-your-key-here>",
        "TYPESAFE_DEFAULT_MODEL": "jev-latest"
      }
    }
  }
}
```

`examples/cursor.mcp.json` 与 `examples/claude-desktop.json` 是同一 JSON，只是目标文件不同（Cursor：`mcp.json`；Claude Desktop：`claude_desktop_config.json`）。

### 10.2 放哪里

| Host | 常见位置 | 提交？ |
| --- | --- | --- |
| 任意（规范） | 该 host 的 MCP server `env` 或进程环境 | 密钥永不进 git |
| Cursor | 用户级 `~/.cursor/mcp.json`；项目级 `.cursor/mcp.json`（已 gitignore） | 不提交密钥 |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json`（macOS） | 不提交密钥 |
| Claude Code / 其他 | 各自主机文档里的 MCP config | 不提交密钥 |

README 要明确：`examples/` 只放占位符；真密钥只进本机 host 配置或 shell env。

### 10.3 注意事项

- `args` 用**绝对路径**：GUI host 启动子进程时 cwd 不保证是仓库根。
- GUI 启动的 host 不一定继承 shell 的 PATH；找不到 `bun` 时把 `command` 换成 `which bun` 的绝对路径（例如 `/Users/<you>/.bun/bin/bun`）。
- 改完配置后按该 host 的方式重启 MCP server。
- 生产 / 团队共享阈值时把 `TYPESAFE_DEFAULT_MODEL` 设为 `jev-1.13.0`，避免 `jev-latest` 漂移。
- 本地调试可用 `bun run inspect`（MCP Inspector），不必绑死某一个 IDE。

---

## 11. 实现阶段（可交付切片）

分支：`git switch -c feature/build-jev-mcp main`。每阶段一组 Conventional Commits；P0 / P1 / P2 可各开一个 PR，或一个 PR 三组提交。

### P0 — scaffold + `jev_models` + `jev_check`（约 1 个工作日）

| # | 任务 | 改动文件 | 验收 | 验证命令 |
| --- | --- | --- | --- | --- |
| 1.1 | 开分支 | — | 分支名正确 | `git branch --show-current` |
| 1.2 | SDK 在 Bun 下 spike | `/tmp/spike/`（不入库） | `new TypeSafeClient({ apiKey:"dummy", fetch: globalThis.fetch }).models.list()` 只因 401 失败、不报 runtime 错 | `cd /tmp/spike && bun init -y && bun add @typesafe-ai/sdk && bun -e '...'` |
| 1.3 | MCP v2 在 Bun 下 spike | `/tmp/spike/` | 最小 `serveStdio` 能回 initialize | `bun add @modelcontextprotocol/server zod@^4 && printf '...' \| bun run x.ts` |
| 2.1–2.3 | `package.json`、依赖、`tsconfig.json`、`.oxlintrc.json` | 四个文件 + `bun.lock` | 锁文件生成；空 src 下 typecheck 与 oxlint 通过 | `bun add ...`；`bun add -d oxlint`；`bun install --frozen-lockfile`；`bunx tsc --noEmit`；`bunx oxlint` |
| 2.4 | `src/config.ts` | 1 文件 + 测试 | 空白 key 视为缺失；默认模型 | `bun test tests/config.test.ts` |
| 2.5 | `src/client.ts` | 1 文件 + 测试 | 无 key 抛 `ConfigError`；单例 | `bun test tests/client.test.ts` |
| 2.6 | `src/errors.ts` | 1 文件 + 测试 | 10 类映射 + 脱敏 | `bun test tests/errors.test.ts` |
| 2.7 | `src/result.ts` | 1 文件 | `ok()` 形状 | `bun test` |
| 2.8 | `src/schemas.ts`（第一批） | 1 文件 + 测试 | 空 state / 倒置阈值 / `apiKey` 键被拒 | `bun test tests/schemas.test.ts` |
| 3.1 | `src/tools/models.ts` | 1 文件 + fixture + 测试 | 正常列表；401 → `AUTH` | `bun test tests/tools.models.test.ts` |
| 3.2 | `src/gating.ts` | 1 文件 + 测试 | §6 全部边界 | `bun test tests/gating.test.ts` |
| 3.3 | `src/questions.ts`（noul） | 1 文件 + 测试 | `type === "noul"`，criteria 透传 | `bun test tests/questions.test.ts` |
| 3.4 | `src/tools/check.ts` | 1 文件 + fixtures + 测试 | 0.95→act/true；0.52→abstain；缺 key→CONFIG | `bun test tests/tools.check.test.ts` |
| 3.5 | `src/server.ts` | 1 文件 + 测试 | 进程内列出 2 工具并调用成功 | `bun test tests/server.test.ts` |
| 3.6 | `src/index.ts` | 1 文件 + 测试 | `< /dev/null` 退出 0；stdio 拿到列表 | `bun run src/index.ts < /dev/null; echo $?`；`bun run test:stdio` |
| 3.7 | `examples/stdio.mcp.json` + 各 host 同形示例 | 若干文件 | Inspector 或任一 host：已连接、工具可见、无 key 时 `CONFIG` | 手工，记录到 PR |
| 3.8 | 提交 | — | 全绿；无密钥文件 | `bun test && bunx tsc --noEmit && git status` |

提交示例：`chore(scaffold): bun project with mcp server skeleton`、`feat(tools): add jev_models and jev_check`、`test(core): gating, errors, schemas`。

### P1 — `jev_classify` / `jev_score` / `jev_ask` + gating 接入（约 1 个工作日）

| # | 任务 | 改动文件 | 验收 | 验证命令 |
| --- | --- | --- | --- | --- |
| 4.1 | schemas 第二批 | `src/schemas.ts` + 测试 | 1 / 256 options 拒；11 级拒；空 questions 拒；批量错误含题 id | `bun test tests/schemas.test.ts` |
| 4.2 | questions 补全 | `src/questions.ts` + 测试 | choice / score / switch / buildQuestions | `bun test tests/questions.test.ts` |
| 4.3 | `jev_classify` | `src/tools/classify.ts` + fixture + 测试 | `billing/0.81` → act；probabilities 键集合 = options 键集合 | `bun test tests/tools.classify.test.ts` |
| 4.4 | `jev_score` | `src/tools/score.ts` + fixture + 测试 | `1.05/0.92` → act；legend 索引对齐 | `bun test tests/tools.score.test.ts` |
| 4.5 | `jev_ask` | `src/tools/ask.ts` + fixture + 测试 | 3 题只 1 次 fetch；每题有 decision；空题不发请求 | `bun test tests/tools.ask.test.ts` |
| 4.6 | 注册 3 工具 + annotations | `src/server.ts` + 测试 | `tools/list` 恰好 5 个 | `bun test tests/server.test.ts` |
| 4.7 | 提交 | — | 全绿 | `bun test && bunx tsc --noEmit` |

提交示例：`feat(tools): add jev_classify, jev_score, jev_ask`、`feat(gating): expose certainty and thresholds in results`。

### P2 — 测试完善、README、示例（约 0.5–1 个工作日）

| # | 任务 | 改动文件 | 验收 | 验证命令 |
| --- | --- | --- | --- | --- |
| 5.1 | fixture 全集 | `tests/fixtures/*.json` | 每个 fixture 被引用 | `rg -l "check.yes095" tests` 等 |
| 5.2 | helpers | `tests/helpers/fakeFetch.ts`、`mcp.ts` | 所有工具测试改用 helper 后仍全绿 | `bun test` |
| 5.3 | 集成开关 | `tests/integration/live.test.ts` | 无 key 显示 skipped | `bun run test:integration` |
| 5.4 | 错误路径端到端 | `tests/server.errors.test.ts` | 429×3 / 529×3 / 超时 → 对应 token；之后 `tools/list` 仍成功 | `bun test tests/server.errors.test.ts` |
| 5.5 | README | `README.md` | 安装、运行、任意 MCP host 的 stdio 配置、5 工具速查、gating、钉版、中文提示、安全提示；每条命令可直接执行 | 人工逐条跑 |
| 5.6 | （可选）录制脚本 | `scripts/record-fixture.ts` | 无 key 时提示并 exit 1 | `bun run record` |
| 5.7 | 提交 + PR | — | 全绿；PR 附任一 host 或 Inspector 手工验收 | `bun test && bunx tsc --noEmit` |

提交示例：`test(tools): fixtures, helpers, error paths`、`docs(readme): usage and mcp host setup`。

### P3 — 非目标（只登记）

Streamable HTTP（`createMcpHandler` + `Bun.serve` 或 `@modelcontextprotocol/hono`）、对象型 `instructions`、opinionated 工具（gate / screen / match）、`bun build --target=bun` 单文件分发、npm 发布。写进 README Roadmap，标「未实现」。Claude Desktop 不是这项：它走 stdio。

---

## 12. 风险与决策记录

| # | 风险 | 概率 / 影响 | 缓解 |
| --- | --- | --- | --- |
| R1 | `@typesafe-ai/sdk` 构造函数在 Bun 下报「runtime unsupported」（文档写 Node 20+，且构造函数会做 runtime 检查） | 中 / 高 | P0 第一件事 spike（任务 1.2）。先显式传 `fetch: globalThis.fetch`；若仍抛错，检查是否为浏览器误判（绝不设 `dangerouslyAllowBrowser`），最后手段：自写 ~30 行 `fetch` 封装只覆盖 `/v1/systemone` 与 `/v1/models`，类型仍从 SDK 导入。结论回写 `design.md` R1 |
| R2 | Early access：限流动态调整、429 / 529 已有公开报道 | 高 / 中 | 依赖 SDK 重试；错误文案引导用 `jev_ask` 合并；集成测试只打最小请求 |
| R3 | 中文 / CJK 弱于英语 | 中 / 中 | 描述建议英文题面；服务器不翻译；gating 兜底；README 建议先在自有中文数据上验证阈值 |
| R4 | 密钥泄露（transcript、日志、fixture、git） | 低 / 高 | 只读 env；`.strict()` 拒密钥参数；错误文本脱敏；`logLevel: warn`；fixture 无响应头；`.gitignore` 已含 `.env`、`.cursor/mcp.json` |
| R5 | confidence 只描述分布集中度，Jev 会自信地错 | 中 / 中 | 暴露 `probabilities`、`certainty`、`thresholds`；描述明确 decision 是代码阈值；默认 0.8 偏保守 |
| R6 | `jev-latest` 随发版漂移，阈值失效 | 中 / 中 | 结果回报实际 `model`；README 建议钉 `jev-1.13.0` |
| R7 | MCP v2 要求 `zod/v4`；旧 zod 无此子路径 | 低 / 中 | `bun add zod@^4`，`bun.lock` 锁定 |
| R8 | GUI host 找不到 `bun` | 中 / 低 | 文档写绝对路径；stdio 测试用同一命令行 |
| R9 | 大 state 触发 32k / 64k 上限 | 低 / 中 | 不在服务器截断；422 → `INVALID_REQUEST` + 提示缩小 state |
| R10 | 与多个第三方 `jev-mcp` 同名同构 | 低 / 低 | 差异点：官方 SDK、structured content、可测 gating、密钥隔离；README 写明 |

已决定、不再翻案：自研而非 fork；Bun only；第一期 stdio（任意 MCP host）；5 个 primitive 工具；密钥只走 env；gating 在代码；默认 `jev-latest` / 生产钉 `jev-1.13.0`；GitHub Flow + Conventional Commits。不是 Cursor-only。

---

## 13. 已核对的官方 API（2026-09-21）

来源：`docs.typesafe.ai/sdk/javascript.md`、`.../api/classes/TypeSafeClient.md`、`.../api/interfaces/*.md`、`docs.typesafe.ai/api.md`、`docs.typesafe.ai/models.md`、`docs.typesafe.ai/confidence.md`、`docs.typesafe.ai/model-jaggedness/jev-1.13.md`、`ts.sdk.modelcontextprotocol.io/v2/`（`servers/tools`、`serving/stdio`、`testing`、`servers/errors`、`get-started/packages`）。

**TypeSafe JS SDK `@typesafe-ai/sdk`（v0.6.0，2026-09-15）**

- `new TypeSafeClient(config?: TypeSafeClientConfig)`；抛错条件：缺 key、配置非法、runtime 不支持。
- `client.systemOne<Q extends Questions>(request: SystemOneRequest<Q>, options?: RequestOptions): APIPromise<SystemOneResult<Q>>`
  - `SystemOneRequest`：`{ state: EntryType; questions: Q; model?: string }`（**camelCase `systemOne`**，不是 `system_one`）
  - `SystemOneResult`：`{ answers: { [K in keyof Q]: ResultFor<Q[K]> }; model: string; usage: Usage }`
  - 抛错：questions 为空；score criteria 少于 2 项；非 2xx（重试后）；连接 / 超时；用户中止。
- `client.models.list(options?): APIPromise<ModelCard[]>`，`ModelCard = { name; description; release_date }`。
- helper：`choice<T extends ChoiceCriteria>(instructions: EntryType, criteria: T): ChoiceQuestion<T>`；`score<T extends ScoreCriteria>(instructions, criteria): ScoreQuestion<T>`（`ScoreCriteria = readonly [EntryType, EntryType, ...EntryType[]]`，**数组**）；`noul(instructions?: EntryType, criteria?: { true?: EntryType; false?: EntryType } | null): NoulQuestion`。
- 答案：`NoulResponse { type:"noul"; noul: number }`；`ChoiceResponse<T> { type:"choice"; choice: keyof T & string; probabilities; confidence }`；`ScoreResponse<T> { type:"score"; score; legend; probabilities; confidence }`。**字段名是 `choice` / `score` / `noul`，不是 `answer`。**
- `EntryType = string | { [k: string]: JsonValue } | JsonValue[] | null`。
- 错误类：`TypeSafeError` ← `APIError { status; body; headers; requestId }` ← `AuthenticationError`(401) / `PermissionDeniedError`(403) / `BadRequestError`(400) / `UnprocessableEntityError`(422) / `NotFoundError`(404) / `RateLimitError`(429) / `InternalServerError`(5xx)；另有 `APIConnectionError`、`APITimeoutError`、`APIUserAbortError`。529 无专用子类，按 `status` 判。
- `RetryPolicy` 默认：`maxRetries 2`、`backoffInitialMs 500`、`backoffMaxMs 5000`、`backoffJitter 0.25`、`httpStatuses {408, 429, 500–599}`、`respectRetryAfter true`、`maxRetryAfterMs 60000`。
- `TypeSafeClientConfig`：`apiKey?`（回落 `TYPESAFE_API_KEY`）、`baseURL?`（回落 `TYPESAFE_BASE_URL`）、`defaultModel?`（回落 `TYPESAFE_DEFAULT_MODEL`，再 `jev-latest`）、`fetch?`、`timeout?`（默认 10000）、`retry?`、`logLevel?`（默认 `warn`；`debug` 打 body）、`logger?`、`defaultHeaders?`、`dangerouslyAllowBrowser?`。

**TypeSafe HTTP API**

- `POST https://api.typesafe.ai/v1/systemone`，`Authorization: Bearer <key>`；body `{ state, model, questions: { id: { type, instructions, criteria? } } }`。
- Choice ≤ 255 选项；Score 2–10 级；Noul criteria `{ true?, false? }`。
- 响应 `{ model, answers: { id: Answer }, usage: { input_tokens, output_tokens } }`；Choice / Score 带 `confidence`。
- 错误：401、422（body 说明字段）、429、529。
- `GET /v1/models` 列别名；版本化 id 即使不在列表也可用。
- 限额（2026-09）：250k tokens/s、1200 RPM，动态调整。上下文 64k / 请求，`state` + 最长一题 32k。

**MCP TypeScript SDK v2 `@modelcontextprotocol/server`**

- `import { McpServer, createMcpHandler } from "@modelcontextprotocol/server"`；`import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio"`；`import * as z from "zod/v4"`。
- `server.registerTool(name, { title?, description?, inputSchema?: ZodObject, outputSchema?: ZodObject, annotations? }, async (args) => ({ content, structuredContent?, isError? }))`。
- 入参不合法 → SDK 直接返回 `isError: true`（handler 不跑）；handler 抛错 → 同样转 `isError: true`；`isError` 结果跳过 `outputSchema` 校验。
- `serveStdio(factory)` 拥有 stdin/stdout；**日志用 `console.error`**。
- 测试：`@modelcontextprotocol/client` 的 `Client` + `StreamableHTTPClientTransport(url, { fetch: handler.fetch })` 进程内；stdio 用 `@modelcontextprotocol/client/stdio` 的 `StdioClientTransport({ command, args })`。
- 官方声明支持 Node.js、Bun、Deno。

---

## 14. 下一步

规划已完成。实现时：

1. 由用户显式发起 OpenSpec apply（`/opsx-apply` 或「apply build-jev-mcp」），按 `openspec/changes/build-jev-mcp/tasks.md` 逐项勾选。
2. 先做任务 1.2 / 1.3 两个 spike，把 R1 的结论回写 `design.md`，再动 `package.json`。
3. 需要用户确认的点：是否已有 `TYPESAFE_API_KEY`；第一个业务场景；题面主语言。三者都不阻塞 P0–P2。
