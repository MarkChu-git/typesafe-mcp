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
- MCP server implementation not started on purpose

## Stack

- **Runtime and package manager: Bun only.** Do not use Node, npm, pnpm, yarn, `npx`, or Python for this repo.
- **Lint:** **oxlint only** (`.oxlintrc.json`). Do not add ESLint or Biome. Types: `bunx tsc --noEmit`.
- **SDK:** official JS/TS client `@typesafe-ai/sdk` (not `typesafe-sdk` / Python).
- **MCP:** official TypeScript SDK `@modelcontextprotocol/server` (v2; supports Bun).
- Install and run with `bun add`, `bun install`, `bun`, `bunx`.

## Next

1. Confirm API access (`TYPESAFE_API_KEY` from [console.typesafe.ai](https://console.typesafe.ai))
2. Confirm tool surface (thin primitives vs opinionated gates)
3. Scaffold a Bun TypeScript MCP server with `@typesafe-ai/sdk` + `@modelcontextprotocol/server`
