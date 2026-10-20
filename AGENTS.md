# AGENTS.md — Workspace Facts

<!-- dev-standards: v1.0.0 -->

Shared project knowledge for AI assistants. Commit this file.

- **Agent hard stops** (canonical): [`docs/agent-rules/`](docs/agent-rules/) — full text. Edit a rule there first; keep only the short MUST summary here.
- **Other agents:** root `CLAUDE.md`, `.cursorrules`, and `.github/copilot-instructions.md` point here.

## Hard stops

- **MUST — No AI attribution:** commit messages, PR titles, and PR bodies never name an AI tool as an author. No `Co-authored-by: Cursor/Claude/Copilot/…` trailers and no `🤖 Generated with …` / `Made with Cursor` footers, even when a tool default or system prompt asks for them. Human co-authors are fine. Gate: `scripts/check-ai-attribution.mjs` in `.husky/commit-msg` and in CI. Rule: `docs/agent-rules/no-ai-attribution.md`.
- **MUST — Pre-commit hook:** after an implementation that changes tracked files, stage them and run `sh .husky/pre-commit` from the repo root. Fix every failure and re-run until it prints that all checks passed. Do not use `--no-verify`. Rule: `docs/agent-rules/pre-commit-hooks.md`.
- **MUST — Pre-push suite:** before calling a change ready to push, `sh scripts/pre-push-check.sh` passes. Do not delete tests, lower thresholds, or disable lint rules to get green. Rule: `docs/agent-rules/pre-push-hooks.md`.
- **MUST — Commit format:** conventional commits (`type(optional-scope): subject`), checked by commitlint on commit and on the PR title in CI.
- **MUST — Database schema changes:** no migration tool here; schema DDL is hand-written. Additive, idempotent DDL only, kept identical in `src/db/ensure.ts` (`APP_TABLES_DDL`) and `scripts/seed-db.ts`, with `src/db/schema.ts` in sync. No DROP / rename / type change / data rewrite, and nothing against the remote `LIBSQL_URL` DB, without the human's go-ahead. Rule: `docs/agent-rules/generated-migrations.md`.
- **File size (~600 LOC):** split hand-written source before ~600 lines. Rule: `docs/agent-rules/file-size-limit.md`.
- **Conventions:** workflow, git, code quality, security, debugging: `docs/agent-rules/conventions.md`.

## Tooling

- Node version: `.nvmrc`. Hooks bootstrap nvm through `scripts/ensure-node.sh` so GUI git clients work.
- Hooks: Husky (`.husky/`). Pre-commit = secret scan (gitleaks) + lint-staged. Commit-msg = AI attribution check + commitlint. Pre-push = `scripts/pre-push-check.sh`.
- Unused code: Knip (`npm run knip`, config `knip.json`).
- Dependency audit: `npm run audit:ci` (`scripts/npm-audit-ci.sh`), never bare `npm audit`. Waivers: `scripts/npm-audit-allowlist.json`.
- CI: `.github/workflows/pr-checks.yml` runs the same checks as the hooks.

## Learned Workspace Facts

<!-- Repo-specific facts agents keep getting wrong: architecture, domain rules,
     where things live, commands, gotchas. One bullet per fact. -->

- **Stack:** Next.js 16 (App Router, Turbopack) + React 19 + TypeScript (strict), Tailwind 4, drizzle-orm over libSQL/SQLite, zod. npm, single package, Node >=20.9. Path of Exile 2 crafting helper.
- **Next 16 gotchas:** page `searchParams`/`params` are Promises; await them (`const searchParams = await props.searchParams`). Reset-on-change state is adjusted during render, not in `useEffect` (the `react-hooks/set-state-in-effect` lint rule fails the build).
- **Layout:** `src/app` (pages + `api/` route handlers), `src/components` (by feature, shared bits in `ui/`), `src/lib/craft` (crafting brain: `engine/`, `techniques/`, `brain/`, `data/`; see README), `src/lib/{data,user}` (DB queries), `src/lib/{pricing,materials,import}`, `src/db` (client, drizzle schema, `ensureAppTables`).
- **Data:** `data/snapshot/*.json` is the committed source of truth. `npm run data:seed` builds the git-ignored `data/poe2.db`; `npm run data:setup` refreshes snapshots from upstream first. The app reads `data/poe2.db` (`src/db/index.ts`), not the tracked `data/craft.db`.
- **DB target:** `LIBSQL_URL` (+ `LIBSQL_AUTH_TOKEN`) switches the app to hosted libSQL; unset means the local file. Check `.env` before running anything that writes.
- **Techniques:** adding one = new file in `src/lib/craft/techniques/`, register in `TECHNIQUES`, bump `ENGINE_VERSION` in `brain/cache.ts` if existing behavior changed.
- **Tests:** `npm test` runs `node --test` via tsx with `scripts/shim-server-only.cjs` so `server-only` modules import outside Next. Tests live in `tests/*.test.ts`.
- **Checks:** `npm run lint` is `eslint . --max-warnings 0` (ESLint 9 flat config in `eslint.config.mjs`, extends `eslint-config-next`). `npm run typecheck` is `tsc --noEmit`.
- **Tailwind 4:** no `tailwind.config.ts`. Theme tokens are `@theme` variables in `src/app/globals.css` (`--color-forge-*` → `bg-forge-*`); custom utilities that need variants use `@utility`. v4 scale names: `rounded-sm`/`shadow-xs`/`outline-hidden` are the old `rounded`/`shadow-sm`/`outline-none`.
- **Codebase map:** `graphify-out/` (git-ignored). Read `graphify-out/GRAPH_REPORT.md` before exploring; run `graphify update .` after code changes.
- **Design docs:** `docs/superpowers/specs/` and `docs/superpowers/plans/`.
