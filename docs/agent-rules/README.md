# Agent rules

Canonical instructions for coding agents (Claude Code, Cursor, GitHub Copilot, and others). Edit a hard stop here first. Root `AGENTS.md` holds the short MUST summaries; `CLAUDE.md`, `.cursorrules`, and `.github/copilot-instructions.md` only point here.

| Rule                                    | File                                               |
| --------------------------------------- | -------------------------------------------------- |
| No AI attribution in commits / PRs      | [no-ai-attribution.md](no-ai-attribution.md)       |
| Pre-commit hook                         | [pre-commit-hooks.md](pre-commit-hooks.md)         |
| Pre-push hook                           | [pre-push-hooks.md](pre-push-hooks.md)             |
| Hand-written file size                  | [file-size-limit.md](file-size-limit.md)           |
| Database schema changes (repo-adapted)  | [generated-migrations.md](generated-migrations.md) |
| Working, code, and security conventions | [conventions.md](conventions.md)                   |

Add repo-specific hard stops (domain rules, compliance, auth) as new files in this folder and list them here and in `AGENTS.md`.

## Dependency audit

CI runs `npm run audit:ci` (`scripts/npm-audit-ci.sh`), never bare `npm audit`, because `npm audit` exits 1 both for real findings and for an unreachable registry. The wrapper fails on high/critical findings and, after bounded retries, warns and passes when the registry is down. An advisory with no patched release on a dev-only chain may be waived in `scripts/npm-audit-allowlist.json` (`advisory`, `package`, `workspaces`, `reason`, `review_by`); expired or malformed entries waive nothing.
