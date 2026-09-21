# Contributing

This repo uses **GitHub Flow** and [Conventional Commits](https://www.conventionalcommits.org/).

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
- Open a pull request when ready. Merge after review and CI.
- Do not commit directly to `main` for feature work.
- Do not rebase shared or already-pushed branches. Rebase only local-only branches onto `main` before opening a PR.

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
