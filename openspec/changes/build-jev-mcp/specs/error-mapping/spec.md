# Spec Delta

## Purpose

定义上游 TypeSafe API 错误、传输错误与本地校验错误如何统一映射为 MCP 工具错误结果，保证 agent 能读懂并修复，同时绝不泄露密钥或请求头。

## ADDED Requirements

### Requirement: All failures surface as tool errors, never as crashes
Any failure inside a tool call SHALL be returned as a tool result with `isError: true` and a single text block. The server process MUST keep running and MUST keep serving other calls after any tool failure.

#### Scenario: Upstream failure does not kill the server
- **WHEN** a tool call fails with an upstream 5xx after retries
- **THEN** the caller receives `isError: true` and a subsequent `tools/list` still succeeds on the same connection

### Requirement: Error text is categorized and actionable
The error text SHALL begin with a stable category token from the set {`AUTH`, `RATE_LIMIT`, `OVERLOADED`, `TIMEOUT`, `NETWORK`, `INVALID_REQUEST`, `VALIDATION`, `UPSTREAM`, `CONFIG`} followed by a one-sentence English explanation and a suggested fix. When available, the text SHALL include the upstream `request_id`.

#### Scenario: Missing key
- **WHEN** `TYPESAFE_API_KEY` is not set
- **THEN** the text starts with `CONFIG` and tells the caller to set `TYPESAFE_API_KEY` in the MCP server environment

#### Scenario: 401 / 403
- **WHEN** the API returns 401 or 403
- **THEN** the text starts with `AUTH` and says the key was rejected

#### Scenario: 422
- **WHEN** the API returns 422 with a body describing the offending field
- **THEN** the text starts with `INVALID_REQUEST` and includes the field detail from the body

#### Scenario: 429 after retries
- **WHEN** the API keeps returning 429 after the client's retry policy is exhausted
- **THEN** the text starts with `RATE_LIMIT` and suggests waiting and retrying or batching questions with `jev_ask`

#### Scenario: 529 after retries
- **WHEN** the API keeps returning 529 after retries
- **THEN** the text starts with `OVERLOADED` and suggests retrying later

#### Scenario: Timeout
- **WHEN** the request exceeds the per-attempt timeout on every attempt
- **THEN** the text starts with `TIMEOUT` and mentions reducing `state` size

#### Scenario: Local validation
- **WHEN** input fails local validation（空 `questions`、非法 `options` 数量、阈值倒置、空 `state`）
- **THEN** the text starts with `VALIDATION` and names the offending parameter（批量时含问题 id）

### Requirement: Error output never leaks secrets
Error text and structured content MUST NOT contain the API key, any `Authorization` header value, or raw request headers. Upstream response bodies MAY be quoted only after removing any header-like or token-like fields.

#### Scenario: Auth error with key in environment
- **WHEN** an `AUTH` error is produced while `TYPESAFE_API_KEY` is set
- **THEN** the returned text does not contain any substring of the key longer than 4 characters

### Requirement: Retries are delegated to the SDK policy
The system SHALL rely on the TypeSafe client's built-in retry policy（默认最多 2 次重试，指数退避，尊重 `Retry-After`）for 408/429/5xx and connection errors, and MUST NOT add a second retry loop in tool handlers.

#### Scenario: Transient 429 then success
- **WHEN** the first attempt returns 429 and the retry returns 200
- **THEN** the tool returns a normal successful result and no error is surfaced
