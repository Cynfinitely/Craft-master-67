# Working conventions

General conventions for any agent or human working in this repo. Repo-specific naming, API, and layout conventions belong in their own section at the end (or a separate file listed in `README.md`).

## Workflow

- Restate the goal before a non-trivial change. When a business rule is unclear, ask with concrete options instead of guessing.
- Break multi-step work into small steps and finish each one (builds, tests pass) before the next.
- Prefer editing existing files over creating new ones. Follow the patterns already in the code.
- Do not refactor unrelated code in the same change.
- Never say something is done, tested, or passing unless you ran it. If a step was skipped, say so.

## Git

- The main branch is deployable. Work on feature branches and merge through PRs.
- Commit messages and PR titles are conventional commits: `type(optional-scope): subject` (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `build`, `perf`, `revert`, `style`). Enforced by commitlint locally and on the PR title in CI.
- No AI attribution anywhere in git history ([no-ai-attribution.md](no-ai-attribution.md)).
- Never force-push or rewrite shared branches. Never use `--no-verify`.
- Git history is the project log. Do not keep a hand-appended changelog of every change in a shared file (it conflicts on every merge); release notes are fine.

## Code quality

- Strict typing. Avoid `any`; add types at module boundaries.
- Validate input at IO boundaries (HTTP, queues, files, env) with a schema library.
- Lint with zero warnings allowed (`--max-warnings 0`). Fix the cause instead of disabling the rule; a disable needs a reason in the comment.
- Add unit tests for non-trivial logic in the same change.
- Keep hand-written files under ~600 lines ([file-size-limit.md](file-size-limit.md)).
- Remove dead code instead of commenting it out. Knip flags unused files, exports, and dependencies.

## Security

- Never print, log, commit, or paste secrets. Redact them in examples and logs.
- Configuration comes from the environment. A required setting has no hardcoded fallback; the app fails at startup when it is missing.
- Least privilege and short-lived tokens by default.
- Never return raw error messages or stack traces to clients; log them server-side.
- Run `npm run audit:ci` after dependency changes.

## Debugging

- Compare against a working reference first (config, package.json, environment, deploy structure) before reading runtime code.
- Reproduce, then isolate one component at a time.
- Gather logs, steps, and the timeline of recent changes before proposing a fix.
- Fix the root cause; if you ship a workaround, say so and note what the real fix would be.

## Communication

- Be concise and specific. Give commands and file paths, not general advice.
- When several options are valid, recommend one and give the trade-off in a sentence.
- Be explicit about uncertainty and limitations.

## Repo-specific conventions

- **Imports:** `@/*` maps to `src/*`. Use it across folders; relative imports within a folder.
- **Server-only code:** modules that touch the DB or the network (`src/lib/craft` brain + data, `src/lib/materials`) start with `import "server-only"`. Never import them from client components (`"use client"`); add the import to any new module of that kind.
- **API routes:** `src/app/api/<resource>/route.ts`, usually with `export const dynamic = "force-dynamic"`. Validate request bodies with zod; respond with `NextResponse.json({ <resource> })` on success and `{ error }` with a 4xx status on failure.
- **Naming:** React components in PascalCase files (`SavedPlansList.tsx`); lib modules in camelCase (`resolveItem.ts`).
- **Styling:** Tailwind utility classes; shared tokens in `tailwind.config.ts` and `src/app/globals.css`.
- **Game data:** never hand-edit `data/snapshot/*.json`. Regenerate with the `data:*` scripts. Hand-curated tables live in `src/lib/craft/data/`.
