# Stream fixtures

`claude -p --output-format stream-json --verbose` output, one event per line. Paths, session ids, account details and request ids are scrubbed.

Real recordings (Claude Code 2.1.284, 2026-10-08):

| File | What it shows |
| --- | --- |
| `init-jev-all.jsonl` | Init with Read/Grep/Glob/StructuredOutput + 5 jev tools, no tool calls, answered. First call context 9,444 tokens. |
| `probe-baseline.jsonl` | Init with Read/Grep/Glob/StructuredOutput only, answered. First call context 4,600 tokens. |
| `jev-tool-error.jsonl` | v0.1.1 with only `jev_ask` and `jev_models` visible; `jev_models` returns `is_error: true` (rejected key); then answered. |
| `answered-read.jsonl` | Baseline tools, one Read call, a `rate_limit_event` with status `allowed`, answered. |
| `max-turns.jsonl` | `--max-turns 1` reached: `subtype: error_max_turns`. |
| `budget.jsonl` | `--max-budget-usd` reached: `subtype: error_max_budget_usd`. |
| `not-logged-in.jsonl` | Login missing: `is_error: true`, `terminal_reason: api_error`. |

Synthetic (derived from the real files above):

| File | Derived from | Change |
| --- | --- | --- |
| `rate-limited.jsonl` | `answered-read.jsonl` | Quota status `rejected`, result `is_error` with `api_error_status: 429`, no answer. |
| `no-answer.jsonl` | `answered-read.jsonl` | StructuredOutput call and `structured_output` removed. |
| `jev-ask-two-calls.jsonl` | `init-jev-all.jsonl` | Two `jev_ask` calls whose results report 423 and 380 Jev input tokens, then answered. |
| `jev-ask-meta.jsonl` | `jev-ask-two-calls.jsonl` | Current server, `jev` arm: one `jev_ask` call; the model reads only the concise answers and the 340 Jev input tokens are in `tool_use_result._meta["typesafe.ai/jev"]`, as Claude Code reports `_meta`. |
