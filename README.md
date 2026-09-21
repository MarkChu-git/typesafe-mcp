# typesafe-mcp

An MCP server that wraps **Jev**, TypeSafe AI's System One decision model, so **any agent** can ask typed questions and get structured answers back.

- **Jev**: TypeSafe AI's hosted decision model (`jev-latest` / `jev-1.13.0`). It evaluates a `state` plus typed questions (Noul / Choice / Score) and returns structured answers, probabilities, and confidence. It does **not** generate text, code, or explanations.
- **TypeSafe**: the company and API (`https://api.typesafe.ai/v1/systemone`) plus official JS/Python SDKs. The name is not a generic TypeScript MCP library.
- **This repo**: a type-safe MCP wrapper. `decision` (`act`/`review`/`abstain`) is computed by this server in code — it is never Jev's own opinion about whether you may proceed.

## Install and run

```bash
bun install
bun run start        # stdio server — exits immediately if stdin closes
```

The server is stdio-first: your MCP host spawns it. Copy [examples/stdio.mcp.json](examples/stdio.mcp.json), replace `/ABSOLUTE/PATH/TO/typesafe-mcp` with this repo's absolute path, and set `TYPESAFE_API_KEY` in the server `env` block. `examples/cursor.mcp.json` and `examples/claude-desktop.json` are the same JSON shape — the only difference is which host file it goes in.

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

Never commit real keys — `.cursor/mcp.json`, `.mcp.json`, `.env*` are gitignored. Without a key the server still connects and lists tools; calls return a `CONFIG:` error telling you where to put the key.

## Tools

| Tool | Question type | Required input | Output (plus `certainty`, `decision`, `thresholds`, `model`, `usage`) |
| --- | --- | --- | --- |
| `jev_models` | — | none | `models[]`, `default_model` — cheap health check, no inference tokens |
| `jev_check` | Noul | `state`, `question` | `probability` (0–1 yes), `answer` |
| `jev_classify` | Choice | `state`, `question`, `options` (2–255 labels) | `choice`, `probabilities`, `confidence` |
| `jev_score` | Score | `state`, `question`, `levels` (2–10, index 0 first) | `score` (expected value), `legend`, `probabilities`, `confidence` |
| `jev_ask` | mixed | `state`, `questions` (record of the three above, discriminated by `type`) | `answers` keyed by your ids — **one** upstream request, ~10x cheaper than separate calls |

Every answer also carries:

- `certainty` — Noul: `|probability − 0.5| × 2`; Choice/Score: API `confidence`
- `decision` — `act` / `review` / `abstain` from `certainty` vs `thresholds` (default `act_above 0.8`, `review_above 0.5`; both overridable per call, `review_above ≤ act_above`)
- `thresholds` — the values actually applied, so callers can audit the gate

Pin `model` to a versioned id (e.g. `jev-1.13.0`) once you have tuned thresholds — `jev-latest` can drift under your calibrated gates.

**中文提示**：`question`/`state` 支持中文，但官方建议英文——Jev 按字面理解，中文问题准确率略低。`decision`/`certainty`/`thresholds` 的语义与语言无关。

## Errors

Every failure returns `isError: true` with a category prefix — `CONFIG` (missing key), `VALIDATION` (bad args, names the field), `AUTH`, `RATE_LIMIT` (hint: batch via `jev_ask`), `OVERLOADED`, `TIMEOUT`, `NETWORK`, `INVALID_REQUEST`, `UPSTREAM`. Server-side stderr logs mirror the category; API keys are redacted from error text.

## Development

Bun only — no Node/npm/pnpm/yarn/`npx`.

```bash
bun test                 # unit + in-process MCP tests (no key needed)
bun run test:integration # live API — skips entirely without TYPESAFE_API_KEY
bun run typecheck        # tsc --noEmit
bun run lint             # oxlint
bun run inspect          # MCP Inspector over stdio
bun run scripts/record-fixture.ts   # re-record tests/fixtures from the real API (needs key)
```

CI: `.github/workflows/ci.yml` — frozen lockfile, typecheck, oxlint, `bun test` on Ubuntu (required) + macOS/Windows. CodeQL and a security workflow (audit, dependency review, actionlint, zizmor) also run.

## Roadmap — not implemented yet

- **Streamable HTTP transport** (`createMcpHandler` + Hono/`Bun.serve`) for remote/shared deployments
- **Object-shaped `instructions`** on questions (structured prompts referencing `state` fields)
- **Opinionated tools** (`jev_gate` / `jev_screen` / `jev_match`) — pending the first business-scenario decision
- **`bun build` single-file dist + npm publish**

## Status

- P0 done: scaffold + `jev_models`/`jev_check` over stdio
- P1 done: `jev_classify`/`jev_score`/`jev_ask`
- Research notes: [docs/research-jev-typesafe-mcp.md](docs/research-jev-typesafe-mcp.md); plan: [docs/plan-build-jev-mcp.md](docs/plan-build-jev-mcp.md)
- GitHub Flow + Conventional Commits; `main` requires PR + `CI`, `Conventional title`, and both `platform` checks
