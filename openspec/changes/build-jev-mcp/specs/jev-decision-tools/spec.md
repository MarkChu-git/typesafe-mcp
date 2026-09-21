# Spec Delta

## Purpose

定义五个 Jev 决策工具的输入、输出与上游调用约束：`jev_models` 探活列模型，`jev_check` / `jev_classify` / `jev_score` 分别对应 Noul / Choice / Score primitive，`jev_ask` 在同一 state 上一次请求并行多问。

## ADDED Requirements

### Requirement: Shared state input
Every decision tool（`jev_check`、`jev_classify`、`jev_score`、`jev_ask`）SHALL accept a required `state` parameter that is either a string, a JSON object, or an array of JSON values. The system SHALL forward `state` to the TypeSafe API unchanged（不拼接、不截断、不翻译）.

#### Scenario: String state
- **WHEN** `state` is `"I was charged twice."`
- **THEN** the upstream request body carries `state` as that exact string

#### Scenario: Object state
- **WHEN** `state` is `{"ticket": "...", "customer_tier": "gold"}`
- **THEN** the upstream request body carries the same object and question instructions can reference fields such as `` `ticket` ``

#### Scenario: Empty state
- **WHEN** `state` is an empty string
- **THEN** the call is rejected before reaching the API with an `isError: true` result explaining that `state` must be non-empty

### Requirement: Shared response metadata
Every decision tool result SHALL include `model`（实际应答的版本化模型 id）and `usage`（`input_tokens`、`output_tokens`）in its structured content, and SHALL include a human-readable text rendering of the same data.

#### Scenario: Successful decision
- **WHEN** any decision tool completes successfully
- **THEN** `structuredContent.model` is a non-empty string and `structuredContent.usage.input_tokens` is a non-negative integer, and `content[0].text` is a JSON string of the structured content

### Requirement: jev_models lists models and acts as health check
`jev_models` SHALL take no required parameters, SHALL call the TypeSafe models listing endpoint, and SHALL return the list of `{ name, description, release_date }` entries plus the resolved default model name. It MUST NOT consume System One inference tokens.

#### Scenario: Healthy account
- **WHEN** `jev_models` is called with a valid key
- **THEN** the structured result contains `models` with at least `jev-latest` and `default_model` equal to the configured default

#### Scenario: Invalid key
- **WHEN** `jev_models` is called and the API returns 401
- **THEN** the result is `isError: true` with text stating the key was rejected and naming `TYPESAFE_API_KEY`

### Requirement: jev_check answers a yes/no question with a probability
`jev_check` SHALL accept `state`、a required non-empty `question` string、optional `criteria` object with optional `true` and `false` descriptions、optional `model`、and optional gating thresholds. It SHALL send exactly one Noul question and SHALL return `probability`（0–1）、`answer`（`probability ≥ 0.5` 为 `true`）、`decision`、and the shared metadata.

#### Scenario: Clear yes
- **WHEN** the API answers `noul: 0.95`
- **THEN** the structured result has `probability: 0.95`、`answer: true`、and `decision: "act"` under default thresholds

#### Scenario: Ambiguous
- **WHEN** the API answers `noul: 0.52`
- **THEN** the structured result has `answer: true` and `decision: "abstain"` under default thresholds

#### Scenario: Missing question
- **WHEN** `question` is omitted or empty
- **THEN** input validation rejects the call with `isError: true` before any network request

### Requirement: jev_classify picks one option from a closed set
`jev_classify` SHALL accept `state`、a required `question` string、a required `options` object mapping 2–255 option labels to a description or `null`、optional `model`、and optional gating thresholds. It SHALL send exactly one Choice question and SHALL return `choice`（必为 `options` 的某个键）、`probabilities`（键与 `options` 一致，和约为 1）、`confidence`、`decision`、and the shared metadata.

#### Scenario: Confident classification
- **WHEN** `options` is `{"billing": "...", "technical": "...", "sales": null}` and the API answers `choice: "billing"`, `confidence: 0.81`
- **THEN** the structured result has `choice: "billing"`、`confidence: 0.81`、`decision: "act"`、and `probabilities` keyed exactly by `billing`、`technical`、`sales`

#### Scenario: Too few options
- **WHEN** `options` has fewer than 2 keys
- **THEN** input validation rejects the call with `isError: true` explaining that at least two options are required

#### Scenario: Too many options
- **WHEN** `options` has more than 255 keys
- **THEN** input validation rejects the call with `isError: true` explaining the 255 limit

### Requirement: jev_score rates against an ordered rubric
`jev_score` SHALL accept `state`、a required `question` string、a required `levels` array of 2–10 ordered level descriptions（元素可为 `null`）、optional `model`、and optional gating thresholds. It SHALL send exactly one Score question and SHALL return `score`（期望值，可落在两级之间）、`legend`（索引 → 描述）、`probabilities`（索引字符串 → 概率）、`confidence`、`decision`、and the shared metadata.

#### Scenario: Three-level rubric
- **WHEN** `levels` is `["Calm", "Frustrated", "Very angry"]` and the API answers `score: 1.05`, `confidence: 0.92`
- **THEN** the structured result has `score: 1.05`、`legend: {"0":"Calm","1":"Frustrated","2":"Very angry"}`、`confidence: 0.92`、`decision: "act"`

#### Scenario: Invalid level count
- **WHEN** `levels` has fewer than 2 or more than 10 entries
- **THEN** input validation rejects the call with `isError: true` before any network request

### Requirement: jev_ask batches mixed questions into one request
`jev_ask` SHALL accept `state`、a required non-empty `questions` object whose values are discriminated by `type` ∈ {`noul`, `choice`, `score`} with the same per-type fields as the single-question tools、optional `model`、and optional gating thresholds. It SHALL send all questions in exactly one System One request and SHALL return `answers` keyed by the caller's question ids, each carrying the per-type answer fields plus its own `decision`.

#### Scenario: Mixed batch
- **WHEN** `questions` is `{ "urgent": {type:"noul", ...}, "dept": {type:"choice", ...}, "anger": {type:"score", ...} }`
- **THEN** exactly one upstream request is made, and the structured result has `answers.urgent.probability`、`answers.dept.choice`、`answers.anger.score`, each with a `decision`

#### Scenario: Empty batch
- **WHEN** `questions` is `{}`
- **THEN** input validation rejects the call with `isError: true` explaining that at least one question is required, and no network request is made

#### Scenario: One malformed question in the batch
- **WHEN** one entry has `type: "choice"` but fewer than 2 options
- **THEN** the whole call is rejected with `isError: true` naming the offending question id, and no network request is made

### Requirement: Input schemas carry agent-facing documentation
Every tool parameter SHALL have an English description in the advertised JSON Schema that explains what the field means to a calling agent, including that Jev answers literally and that instructions should state exact conditions.

#### Scenario: Schema inspection
- **WHEN** a client reads `tools/list`
- **THEN** each property of every tool's `inputSchema` has a non-empty `description`
