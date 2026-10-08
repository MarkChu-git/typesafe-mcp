# Contributing

This repo uses **GitHub Flow** and [Conventional Commits](https://www.conventionalcommits.org/).

Work happens on a short-lived branch and lands on `main` only through a pull request. Direct pushes to `main` are blocked except for the repository owner emergency bypass described below.

## Runtime

**Bun only.** Do not use Node, npm, pnpm, yarn, `npx`, pip, or uv in this repository.

- Install: `bun add` / `bun install`
- Run: `bun` / `bunx`
- Lockfile: `bun.lock` (commit it when the package exists)

**Linter: oxlint only.** Do not add ESLint or Biome.

- Config: `.oxlintrc.json`. Every rule turned off there says why.
- Run: `bun run lint` (`oxlint --type-aware --deny-warnings`; the type-aware rules come from `oxlint-tsgolint`)
- Types stay with `tsc --noEmit` (`bun run typecheck`). oxlint's `--type-check` does not replace it.

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
- Open a pull request into `main` when ready. Merge only after the required checks are green; `gh pr merge --auto --squash` merges once they are.
- Do not commit or push feature work directly to `main`.
- Do not rebase shared or already-pushed branches. Rebase only local-only branches onto `main` before opening a PR.
- Do not use `--no-verify`. Do not change git config in this repository.

## Pull requests and CI

Every change, including docs and tooling, needs a PR.

Required checks: **CI** (the `ci` job in `.github/workflows/ci.yml`), `platform (macos-latest)`, `platform (windows-latest)` and `Conventional title`.

CI runs on pull requests and on pushes to `main`. It uses **Bun only** (`oven-sh/setup-bun`; the Bun version comes from `packageManager` in `package.json`). Do not add `npm ci`, `npx`, or `actions/setup-node` as the package manager. The release workflow uses Node only to run `npm publish`.

Every CI step is a `package.json` script, so a green local run predicts a green CI:

| Command | What it runs | Runs in |
| --- | --- | --- |
| `bun run verify:fast` | `tsc --noEmit`, `oxlint --type-aware --deny-warnings`, unit tests | seconds; run it after every change |
| `bun run verify` | `verify:fast`, knip (unused files, exports and dependencies), the single-file build, a stdio smoke test of `dist/` | `CI`, both `platform` jobs, Release |
| `bun run release:pack <dir>` | packs the npm tarball, checks its file list, installs it into a scratch project and smoke-tests the installed bin | `CI`, Release |
| `bun run scan secrets` | gitleaks over the whole git history; exceptions in `.gitleaks.toml`, each with a reason | `CI` |
| `bun run scan deps` | osv-scanner over `bun.lock`; fails unless it accounts for every locked package | `Security`, also weekly |
| `bun run release:sbom <file>` | SPDX SBOM of the production dependency tree, via syft | Release |

`TYPESAFE_API_KEY` is never set in CI, so the live tests under `tests/integration/` stay skipped. No CI secrets are needed. To smoke-test against the real TypeSafe API, run `bun run test:integration` locally with `TYPESAFE_API_KEY` set.

The other workflows are advisory, except `Conventional title`:

| Workflow | Check name(s) | Purpose |
| --- | --- | --- |
| `codeql.yml` | `Analyze` | CodeQL static analysis, PR + main + weekly |
| `security.yml` | `Dependency audit`, `Workflow audit` | osv-scanner and PR dependency review; actionlint and zizmor (`min-severity: low`) on the workflows. Also weekly |
| `pr-title.yml` | `Conventional title` | Conventional Commits on PR titles (squash-merge gate) |

### Pinned tools

GitHub Actions are pinned by commit SHA with a `# vX.Y.Z` comment, and Dependabot bumps them. Dependabot cannot read `bun.lock` lockfileVersion 2 yet, so update npm dependencies with `bun update` by hand until it can.

gitleaks, osv-scanner and syft run from release binaries pinned in `scripts/ci/tools.json`: a version plus the SHA-256 of each platform's asset (linux-x64 for CI, darwin-arm64 for local runs). They download into `.cache/ci-tools/` on first use, and a file whose checksum differs is rejected. `bun run tools:update` moves every tool to its latest release, copying checksums from the GitHub release API (the digest GitHub recorded at upload), never from a downloaded file. Review the diff and open a `ci` PR.


## Branch protection on `main`

| Rule | Setting |
| --- | --- |
| Require a pull request before merging | Yes |
| Required status checks | `CI`, `Conventional title`, `platform (macos-latest)`, `platform (windows-latest)` |
| Branches up to date before merging | Yes: after another PR merges, update yours with `gh pr update-branch` and let CI rerun |
| Auto-merge | Allowed: `gh pr merge --auto --squash` |
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

## Releasing

`typesafe-mcp` publishes to npm via `.github/workflows/release.yml` (manual `workflow_dispatch`, `main` only). It builds the tarball once and publishes that exact file:

1. **Build** (read-only token): `bun run verify`; checks the version is new (semver, no `v<version>` tag, not on npm); `release:pack` builds and smoke-tests the tarball; `release:sbom` writes the SBOM.
2. **Publish** (GitHub environment `release`): checks the tarball against `build-metadata.json`, runs `npm publish --provenance` on it, attests it and its SBOM with GitHub artifact attestations, and creates the GitHub release: tag `v<version>` on the built commit, with the tarball, SBOM and metadata attached. Each step skips work that is already done, so **Re-run failed jobs** finishes a half-done release.
3. **Verify published**: waits for the registry, then smoke-tests `bunx typesafe-mcp@<version>` over stdio.

To rehearse from any branch, run the workflow with **dry-run** ticked: it runs Build and publishes nothing.

Release steps:

```bash
git checkout -b chore/release-vX.Y.Z main
npm version X.Y.Z --no-git-tag-version   # bumps package.json only
git commit -am "chore(release): vX.Y.Z" && git push -u origin HEAD
gh pr create --title "chore(release): vX.Y.Z" --body "Release vX.Y.Z"
# merge the PR, then: Actions → Release → Run workflow (branch: main)
```

The workflow fails early if `v<version>` or `typesafe-mcp@X.Y.Z` already exists — the version bump is the only required manual step. The server reads the version it reports to MCP clients (`SERVER_VERSION` in `src/config.ts`) from `package.json`, so no other file carries a version.

To check where a release tarball came from: `gh attestation verify typesafe-mcp-X.Y.Z.tgz --repo MarkChu-git/typesafe-mcp`.

**One-time npm setup** (choose one):

- *Preferred — Trusted Publishing (OIDC, no secret):* npmjs.com → `typesafe-mcp` → Settings → Publishing access → Trusted Publisher → GitHub Actions → repo `MarkChu-git/typesafe-mcp`, workflow filename `release.yml`. Then `npm publish` in CI exchanges the GitHub OIDC token automatically; 2FA is bypassed for that workflow only. To let only the publish job publish, also set the trusted publisher's environment to `release`; GitHub creates that environment on the first release run, and you can add required reviewers to it under Settings → Environments.
- *Fallback — token:* create a Granular Access Token with publish rights on `typesafe-mcp` and "Bypass 2FA", store it as repo secret `NPM_TOKEN`. The workflow uses it automatically when present.
