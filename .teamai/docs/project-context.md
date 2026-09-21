# typesafe-mcp 项目上下文

本仓库给 TypeSafe AI 的 Jev（System One 决策模型）做 MCP。当前阶段只做调研和仓库工具配置，不要写 MCP 服务器主逻辑。

调研结论见仓库根目录 `docs/research-jev-typesafe-mcp.md`。

- Jev 不是聊天模型，不生成文本
- TypeSafe 是公司/API，不是泛指 TypeScript MCP
- 推荐后续实现：TypeScript 薄封装 `@typesafe-ai/sdk` + 官方 MCP SDK
- 密钥只用环境变量 `TYPESAFE_API_KEY`，不要写进仓库或 tool 参数
