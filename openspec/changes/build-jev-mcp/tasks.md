# Tasks

说明：全部命令只用 `bun` / `bunx`；每个任务对应 `docs/plan-build-jev-mcp.md` 的同号章节，那里有文件级细节。任务按 P0 → P1 → P2 分组，P3 为非目标只登记不做。

## 1. P0 — 分支与 SDK 可行性 spike

- [x] 1.1 从 `main` 创建 `feature/build-jev-mcp` 分支；验证 `git branch --show-current` 输出该名字
- [x] 1.2 在 `/tmp` 临时目录用 `bun init -y && bun add @typesafe-ai/sdk` 装 SDK，用 `bun -e` 构造 `new TypeSafeClient({ apiKey: "dummy", fetch: globalThis.fetch })` 并调用 `client.models.list()`；验证不抛 runtime 错误、失败只在 401（无真 key）；把结论（是否需要显式 `fetch`、SDK 实际版本号）记进 `design.md` R1
- [x] 1.3 用同一临时目录 `bun add @modelcontextprotocol/server zod@^4` 跑官方 `serveStdio` 最小示例并用 `echo '{"jsonrpc":"2.0","id":1,"method":"initialize",...}' | bun run x.ts` 验证能返回 initialize 响应；确认 `zod/v4` 子路径可解析

## 2. P0 — 项目骨架

- [x] 2.1 在仓库根创建 `package.json`（`name: typesafe-mcp`、`type: module`、`private: true`、`packageManager: bun@<version>`、`bin.typesafe-mcp: ./src/index.ts`、scripts `start` / `dev` / `test` / `test:integration` / `typecheck` / `lint` / `inspect`）；验证 `bun run --silent typecheck` 能识别脚本（此时可失败于无 src，但脚本存在）
- [x] 2.2 `bun add @typesafe-ai/sdk @modelcontextprotocol/server zod@^4` 与 `bun add -d @modelcontextprotocol/client typescript @types/bun oxlint`；验证 `bun.lock` 生成且 `bun install --frozen-lockfile` 成功；`bun run lint`（oxlint）通过。不要加 ESLint / Biome
- [x] 2.3 创建 `tsconfig.json`（`module: ESNext`、`moduleResolution: bundler`、`target: ES2022`、`strict: true`、`types: ["bun-types"]`、`noEmit: true`、`verbatimModuleSyntax: true`）；验证 `bunx tsc --noEmit` 在空 `src/` 下通过
- [x] 2.4 创建 `src/config.ts`：解析 `TYPESAFE_API_KEY`（trim 后空视为缺失）、`TYPESAFE_DEFAULT_MODEL`（默认 `jev-latest`）、`TYPESAFE_TIMEOUT_MS`（默认 10000）、导出 `DEFAULT_THRESHOLDS = { act_above: 0.8, review_above: 0.5 }` 与 `SERVER_NAME/VERSION`；验证 `tests/config.test.ts` 覆盖「空白 key 视为缺失」「默认模型」两例通过
- [x] 2.5 创建 `src/client.ts`：`getClient(overrides?)` 懒加载单例，缺 key 抛 `ConfigError`，显式传 `fetch`（默认 `globalThis.fetch`，可被测试注入）、`defaultModel`、`timeout`、`logLevel: "warn"`；验证 `tests/client.test.ts`：无 key 抛 `ConfigError`、有 key 返回同一实例
- [x] 2.6 创建 `src/errors.ts`：`ConfigError`、`toToolError(err, ctx?)` 按 design D7 映射为 `{ content:[{type:"text",text}], isError:true }`，含类别 token、request_id、脱敏；验证 `tests/errors.test.ts` 对 401/422/429/529/timeout/connection/ConfigError/ZodError 各一例，且含 key 的输入文本被替换为 `***`
- [x] 2.7 创建 `src/result.ts`：`ok(structured)` 返回 `{ content:[{type:"text",text:JSON.stringify(structured)}], structuredContent: structured }`；验证单测 1 例
- [x] 2.8 创建 `src/schemas.ts` 第一批：`jsonValue`（递归）、`stateSchema`、`modelSchema`、`thresholdsFields` + refine、`usageSchema`、`metaSchema`、`modelsOutput`、`checkInput` / `checkOutput`；验证 `tests/schemas.test.ts` 覆盖空 state 拒绝、阈值倒置拒绝、`apiKey` 额外键拒绝

## 3. P0 — jev_models 与 jev_check 跑通 stdio

- [x] 3.1 创建 `src/tools/models.ts`：调用 `getClient().models.list()`，输出 `{ models:[{name,description,release_date}], default_model }`；错误走 `toToolError`；验证 fixture 单测：正常列表、401 → `AUTH`
- [x] 3.2 创建 `src/gating.ts`：`certaintyOf(answer)`（choice/score 取 `confidence`，noul 取 `|p-0.5|*2`）与 `decide(certainty, thresholds)`；验证 `tests/gating.test.ts` 覆盖 spec 里全部边界（0.80/0.79/0.49、noul 0.95/0.05/0.5、choice conf 0.2、override 0.95）
- [x] 3.3 创建 `src/questions.ts` 第一部分：`toNoulQuestion(input)` 用 SDK `noul(question, criteria)`；验证单测断言生成对象 `type === "noul"` 且 criteria 透传
- [x] 3.4 创建 `src/tools/check.ts`：一次 `systemOne({ state, questions:{ q: noul(...) }, model })`，读 `answers.q.noul`，组装 `{ probability, answer, certainty, decision, thresholds, model, usage }` 并 `checkOutput.parse`；验证 fixture 单测：0.95 → act/true，0.52 → abstain/true，缺 key → `CONFIG`
- [x] 3.5 创建 `src/server.ts` 的 `createServer(deps?)`：`new McpServer({ name, version })`，注册 `jev_models`、`jev_check`（英文 description 写明 Jev 不生成文本）；`deps.fetch` 透传到 `getClient`；验证 `tests/server.test.ts` 用 `createMcpHandler` + `StreamableHTTPClientTransport({ fetch: handler.fetch })` 列出 2 个工具并成功调用 `jev_check`
- [x] 3.6 创建 `src/index.ts`：`#!/usr/bin/env bun` + `serveStdio(() => createServer())`，未捕获异常写 stderr；验证 `bun run src/index.ts < /dev/null` 退出码 0，且 `tests/stdio.test.ts` 用 `StdioClientTransport({ command:"bun", args:["run","src/index.ts"] })` 拿到工具列表
- [x] 3.7 创建 `examples/stdio.mcp.json`（规范 spawn）、`examples/cursor.mcp.json`、`examples/claude-desktop.json`（占位密钥、绝对路径占位）。手工验收用 MCP Inspector 或任一 MCP host：`jev` 已连接、能看到工具，无 key 时 `jev_check` 返回 `CONFIG`。不要把验收绑死在 Cursor 上。
- [x] 3.8 提交 P0：`chore(scaffold): bun project with mcp server skeleton`、`feat(tools): add jev_models and jev_check`、`test(...)`；验证 `bun test` 全绿、`bunx tsc --noEmit` 通过、`git status` 无 `.env` / `mcp.json`

## 4. P1 — classify / score / ask 与 gating 接入

- [ ] 4.1 扩展 `src/schemas.ts`：`optionsSchema`（record，2–255 键，值 string|null）、`levelsSchema`（array 2–10，元素 string|null）、`classifyInput/Output`、`scoreInput/Output`、`askQuestionSchema`（`discriminatedUnion("type")`）、`askInput/Output`（answers 为 record of 三种答案联合）；验证 schema 单测：1 个 option 拒绝、256 个拒绝、11 级拒绝、空 questions 拒绝、批量中某题非法时错误信息含题 id
- [ ] 4.2 扩展 `src/questions.ts`：`toChoiceQuestion`（SDK `choice(question, options)`）、`toScoreQuestion`（SDK `score(question, levels)`，注意 v0.6 起 criteria 为数组）、`toSdkQuestion(q)` switch、`buildQuestions(record)`；验证单测断言输出对象 `type` 与 criteria 形状
- [ ] 4.3 创建 `src/tools/classify.ts`：一次 `systemOne`，输出 `{ choice, probabilities, confidence, certainty, decision, thresholds, model, usage }`；验证 fixture 单测：`billing/0.81` → act；`probabilities` 键集合等于 `options` 键集合
- [ ] 4.4 创建 `src/tools/score.ts`：一次 `systemOne`，输出 `{ score, legend, probabilities, confidence, certainty, decision, thresholds, model, usage }`；验证 fixture 单测：`1.05/0.92` → act，`legend` 索引字符串与 `levels` 对齐
- [ ] 4.5 创建 `src/tools/ask.ts`：`buildQuestions` 后**一次** `systemOne`，遍历 `answers` 按 `answer.type` 组装每题 `{ ...typeFields, certainty, decision, thresholds }`；验证 fixture 单测：3 题混合只触发 1 次 fetch（fakeFetch 计数），每题都有 `decision`；空 `questions` 不触发 fetch
- [ ] 4.6 在 `src/server.ts` 注册 `jev_classify`、`jev_score`、`jev_ask`，补全 `annotations: { readOnlyHint: true }`；验证 `tests/server.test.ts` 列表恰好 5 个名字且顺序稳定
- [ ] 4.7 提交 P1：`feat(tools): add jev_classify, jev_score, jev_ask`、`feat(gating): expose certainty and thresholds`；验证 `bun test` 全绿、`bunx tsc --noEmit` 通过

## 5. P2 — 测试完善、文档、示例

- [ ] 5.1 补 `tests/fixtures/*.json`：`models.ok`、`check.yes095`、`check.ambiguous052`、`classify.billing`、`score.frustration`、`ask.mixed3`、`error.401`、`error.422`、`error.429`、`error.529`；验证每个 fixture 被至少一个测试引用（`rg -l` 检查）
- [ ] 5.2 创建 `tests/helpers/fakeFetch.ts`（按 URL 路径 + 可选序列返回 Response，记录调用次数与请求体）与 `tests/helpers/mcp.ts`（进程内 client 工厂、afterEach 关闭）；验证所有工具测试改用 helper 后 `bun test` 仍全绿
- [ ] 5.3 创建 `tests/integration/live.test.ts`：无 `TYPESAFE_API_KEY` 时整文件 skip；有 key 时调 `jev_models` 与一条 `jev_check`（state ≤ 200 字符）；验证 `bun test tests/integration` 在无 key 环境显示 skipped，不报错
- [ ] 5.4 错误路径端到端：在 server 级测试里注入 429×3 / 529×3 / 超时 fetch，断言 `isError` 文案类别与「进程仍可 `tools/list`」；验证 `tests/server.errors.test.ts` 通过
- [ ] 5.5 更新 `README.md`：安装（`bun install`）、运行（`bun run start`）、**任意 MCP host** 的 stdio 配置（引用 `examples/stdio.mcp.json`；Cursor / Claude Desktop 等为同形示例；绝对路径；密钥不进 git）、5 个工具速查表（入参/出参）、gating 说明、模型钉版建议、中文提示、安全提示；验证 README 中每条命令能在仓库根直接执行
- [ ] 5.6 增加 `scripts/record-fixture.ts`（可选，有 key 时录制真实响应到 `tests/fixtures/`，自动去掉响应头）；验证无 key 运行时给出明确提示并退出 1
- [ ] 5.7 提交 P2：`test(tools): fixtures, helpers, error paths`、`docs(readme): usage and mcp host setup`；验证 `bun test`、`bunx tsc --noEmit` 通过；开 PR 到 `main`，PR 描述附任一 host 或 Inspector 的手工验收记录

## 6. P3 — 非目标登记（不在本 change 实现）

- [ ] 6.1 在 `README.md` 的 Roadmap 段落列出：Streamable HTTP（`createMcpHandler` + `@modelcontextprotocol/hono` 或 `Bun.serve`）、对象型 `instructions`、opinionated 工具（gate/screen/match）、`bun build` 单文件分发；验证该段存在且明确标注「未实现」。不要把 Claude Desktop 列成未实现项（它是 stdio host）。
