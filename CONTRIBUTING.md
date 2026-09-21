# Contributing

This repo uses **GitHub Flow** and [Conventional Commits](https://www.conventionalcommits.org/).

Work happens on a short-lived branch and lands on `main` only through a pull request. Direct pushes to `main` are blocked except for the repository owner emergency bypass described below.

## Runtime

**Bun only.** Do not use Node, npm, pnpm, yarn, `npx`, pip, or uv in this repository.

- Install: `bun add` / `bun install`
- Run: `bun` / `bunx`
- Lockfile: `bun.lock` (commit it when the package exists)

**Linter: oxlint only.** Do not add ESLint or Biome.

- Config: `.oxlintrc.json`
- Run: `bunx oxlint` (after `package.json` exists: `bun run lint`)
- Install: `bun add -d oxlint`
- Types stay with `bunx tsc --noEmit`. Do not turn on oxlint `typeAware` / `typeCheck` unless we bump TypeScript far enough for `oxlint-tsgolint`.

The TypeSafe client is `@typesafe-ai/sdk`. Do not add Python `typesafe-sdk`.

## Branching

- `main` is always deployable.
- Create short-lived branches from `main`:
  - `feature/<name>`
  - `fix/<name>`
  - `hotfix/<name>`
  - `docs/<name>`
  - `chore/<name>`
  - `release/<version>`
  - `experiment/<name>` or `poc/<name>`
- Open a pull request into `main` when ready. Merge only after the required GitHub Actions check **CI** is green.
- Do not commit or push feature work directly to `main`.
- Do not rebase shared or already-pushed branches. Rebase only local-only branches onto `main` before opening a PR.
- Do not use `--no-verify`. Do not change git config in this repository.

## Pull requests and CI

Every change, including docs and tooling, needs a PR.

Required check name: **CI** (the `ci` job in `.github/workflows/ci.yml`).

CI runs on pull requests and on pushes to `main`. It uses **Bun only** (`oven-sh/setup-bun`, currently Bun `1.4.2`). Do not add `npm ci`, `npx`, or `actions/setup-node` as the package manager.

When `package.json` exists, CI:

1. Fails with a readable error if `bun.lock` / `bun.lockb` is missing
2. `bun install --frozen-lockfile`
3. `bunx tsc --noEmit`
4. `bunx oxlint` (when `.oxlintrc.json` exists and `src/` or `tests/` have TypeScript)
5. `bun test --pass-with-no-tests --path-ignore-patterns='**/integration/**'`

`TYPESAFE_API_KEY` is not set in CI. Live tests under `tests/integration/` are excluded.

Other workflows (all advisory unless added to required checks):

| Workflow | Check name(s) | Purpose |
| --- | --- | --- |
| `ci.yml` `platform` job | `platform (macos-latest)`, `platform (windows-latest)` | Cross-OS verification; this server runs over stdio on users' machines |
| `codeql.yml` | `Analyze` | CodeQL static analysis, PR + main + weekly |
| `security.yml` | `Dependency audit`, `Workflow audit` | `bun audit`, PR dependency review, actionlint + zizmor |
| `pr-title.yml` | `Conventional title` | Conventional Commits on PR titles (squash-merge gate) |

No CI secrets are needed. To smoke-test against the real TypeSafe API, run `bun run test:integration` locally with `TYPESAFE_API_KEY` set.

Recommended additions to required checks once green on `main`: `Conventional title`, both `platform` legs.

## Branch protection on `main`

| Rule | Setting |
| --- | --- |
| Require a pull request before merging | Yes |
| Required status check | **CI** |
| Force push | Blocked for everyone except the repository owner / admin bypass |
| Delete `main` | Blocked |
| Enforce rules on administrators | **No** (owner `MarkChu-git` keeps an emergency bypass) |

Who may force-push `main`:

- **Owner `MarkChu-git`**: last-resort escape hatch only, not day-to-day work.
- **Everyone else**: GitHub rejects force-push to `main`. Recover with a revert PR.

## Commit messages

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `revert`.

Example:

```
docs(research): record Jev and TypeSafe MCP options

The product is TypeSafe AI's System One model, not a chat LLM.
Capture the recommended MCP wrapper before any server code.
```

A commit message template lives at `.gitmessage`. Enable it locally if you want:

```bash
git config commit.template .gitmessage
```

Do not store API keys, `.env` files, or credentials in git.
