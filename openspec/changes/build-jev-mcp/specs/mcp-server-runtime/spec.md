# Spec Delta

## Purpose

定义 typesafe-mcp 服务器进程如何启动、如何通过 stdio 与 Cursor 通信、如何从环境获取 TypeSafe 密钥与默认模型，以及日志和进程生命周期约束。

## ADDED Requirements

### Requirement: Server runs as a Bun stdio process
The system SHALL start with a single Bun command（`bun run <entry>`）and SHALL speak MCP JSON-RPC over stdin/stdout. The system MUST NOT write anything other than protocol messages to stdout; all diagnostics MUST go to stderr.

#### Scenario: Cursor launches the server
- **WHEN** an MCP host spawns the server with `command: bun` and the entry file path
- **THEN** the process completes MCP initialization and answers `tools/list` with exactly the five tools `jev_models`、`jev_check`、`jev_classify`、`jev_score`、`jev_ask`

#### Scenario: Diagnostics never pollute stdout
- **WHEN** the server logs a warning or error（例如缺密钥、上游 429）
- **THEN** the message appears on stderr only, and the stdout stream remains parseable JSON-RPC

#### Scenario: Host closes stdin
- **WHEN** the host closes the stdio connection
- **THEN** the process exits with code 0 within 5 seconds without leaving pending requests

### Requirement: API key is read only from the environment
The system SHALL read the TypeSafe API key exclusively from the `TYPESAFE_API_KEY` environment variable. No tool SHALL accept an API key, bearer token, or `Authorization` header as an input parameter. The system MUST NOT echo the key（完整或部分）into tool results, logs, or error messages.

#### Scenario: Key present
- **WHEN** `TYPESAFE_API_KEY` is set to a non-empty value
- **THEN** every tool call authenticates against the TypeSafe API with that key without further configuration

#### Scenario: Key missing at startup
- **WHEN** `TYPESAFE_API_KEY` is unset or whitespace-only
- **THEN** the server still starts and lists all five tools, and each tool call returns an `isError: true` result whose text says the variable name to set and where to obtain a key（console.typesafe.ai），without crashing the process

#### Scenario: Key passed as tool argument
- **WHEN** a client sends an extra argument such as `apiKey` or `authorization` to any tool
- **THEN** the argument is rejected by input validation and the call does not reach the TypeSafe API

### Requirement: Default model is resolvable and overridable
The system SHALL use `jev-latest` as the default model. The system SHALL allow overriding the default via the `TYPESAFE_DEFAULT_MODEL` environment variable, and SHALL allow a per-call override via an optional `model` string parameter on every decision tool. Every decision tool result SHALL report the versioned model id that actually answered（来自 API 响应的 `model` 字段）.

#### Scenario: No override
- **WHEN** neither `TYPESAFE_DEFAULT_MODEL` nor the `model` argument is provided
- **THEN** the request is sent with model `jev-latest` and the result reports the resolved versioned id（例如 `jev-1.13.0`）

#### Scenario: Per-call pin
- **WHEN** a tool is called with `model: "jev-1.13.0"`
- **THEN** the request uses `jev-1.13.0` regardless of environment defaults

### Requirement: Tool surface is fixed for this release
The system SHALL expose exactly five tools and MUST NOT expose text-generation, explanation, or free-form extraction tools. Each tool description SHALL state in English that Jev returns structured decisions only and does not generate text.

#### Scenario: Tool list contents
- **WHEN** a client calls `tools/list`
- **THEN** the response contains `jev_models`、`jev_check`、`jev_classify`、`jev_score`、`jev_ask` and no other tools, and each has a non-empty English description and a JSON Schema derived from its input definition
