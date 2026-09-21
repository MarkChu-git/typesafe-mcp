# Contributing

This repo uses **GitHub Flow** and [Conventional Commits](https://www.conventionalcommits.org/).

Work happens on a short-lived branch and lands on `main` only through a pull request. Direct pushes to `main` are blocked except for the repository owner emergency bypass described below.

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

CI runs on pull requests and on pushes to `main`. It uses **Bun only** (`oven-sh/setup-bun`, currently Bun `1.4.2` to match local `bun --version`). Do not add `npm ci`, `npx`, or `actions/setup-node` as the package manager.

When `package.json` exists, CI:

1. Fails with a readable error if `bun.lock` / `bun.lockb` is missing
2. `bun install --frozen-lockfile`
3. `bunx tsc --noEmit`
4. `bun test --pass-with-no-tests --path-ignore-patterns='**/integration/**'`

`TYPESAFE_API_KEY` is not set in CI. Live tests under `tests/integration/` are excluded.

When `package.json` is not in the repo yet, CI still checks out the code and installs Bun, then skips install / typecheck / test so the required check can stay green.

## Branch protection on `main`

GitHub protects `main` as follows:

| Rule | Setting |
| --- | --- |
| Require a pull request before merging | Yes |
| Required status check | **CI** |
| Force push | Blocked for everyone except the repository owner / admin bypass |
| Delete `main` | Blocked |
| Enforce rules on administrators | **No** (owner `MarkChu-git` keeps an emergency bypass) |

Who may force-push `main`:

- **Owner `MarkChu-git`**: allowed as a last-resort escape hatch (admin bypass). Use it only to recover a broken default branch, not for day-to-day work.
- **Everyone else**: must not force-push `main`. GitHub rejects it.

If you are not the owner, recover mistakes with a revert PR.

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
