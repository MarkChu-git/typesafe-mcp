# typesafe-mcp

Research and scaffolding for an MCP server around **Jev**, TypeSafe AI's System One decision model.

This repository is **not** a finished MCP product yet. The first deliverable is the integration research in [docs/research-jev-typesafe-mcp.md](docs/research-jev-typesafe-mcp.md).

## What this is

- **Jev**: TypeSafe AI's hosted decision model (`jev-latest` / `jev-1.13.0`). It evaluates a `state` plus typed questions (Choice / Score / Noul) and returns structured answers, probabilities, and confidence. It does **not** generate text, code, or explanations.
- **TypeSafe**: the company and API (`https://api.typesafe.ai/v1/systemone`) plus official JS/Python SDKs. The name is not a generic TypeScript MCP library.
- **This repo**: a private place to design, then later implement, a type-safe MCP wrapper so agents can call Jev as tools.

## Status

- Research complete (see `docs/research-jev-typesafe-mcp.md`)
- GitHub Flow + Conventional Commits configured
- CI on pull requests and `main` (required check name **CI**, Bun 1.4.2)
- `main` requires a PR, requires **CI** to pass, and blocks force-push/delete except owner emergency bypass
- MCP server implementation not started on purpose

## How to contribute

Start from `main`, open a short-lived branch (`feature/`, `fix/`, `docs/`, `chore/`, …), and merge through a pull request. The **CI** check must be green. Only owner `MarkChu-git` may force-push `main` as an escape hatch; nobody else can, and `main` cannot be deleted.

Details: [CONTRIBUTING.md](CONTRIBUTING.md). Workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

CI uses Bun only (`bun` / `bunx`, `oven-sh/setup-bun`). When `package.json` exists it runs `bun install --frozen-lockfile`, `bunx tsc --noEmit`, and `bun test` excluding `tests/integration/` (no `TYPESAFE_API_KEY` in CI). Until the package exists, CI still checks out and installs Bun so the required check stays green.

## Next

1. Confirm API access (`TYPESAFE_API_KEY` from [console.typesafe.ai](https://console.typesafe.ai))
2. Confirm tool surface (thin primitives vs opinionated gates)
3. Scaffold a TypeScript MCP server with `@typesafe-ai/sdk` + official MCP TypeScript SDK
