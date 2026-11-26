# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

CivicAI: citizens report infrastructure problems (Flutter app); the API turns reports into issue clusters; government operators triage them (React dashboard). Core idea: **a report is an observation, a cluster is the underlying civic problem.** Not deployed yet — release gates are in `docs/shipping.md`.

## Which docs to trust

`README.md` matches the code. `docs/architecture.md` is the original design and is partly out of date (it mentions a Python/FastAPI AI service, Redis, `/api/v1` routes, Tailwind and TanStack Query — none of these exist). When they disagree, trust the code and README. `docs/progress.md` tracks what is built; feature docs (`docs/sos.md`, `docs/government-*.md`, `docs/database.md`, `docs/ai_strategy.md`) are current and should be updated alongside the code they describe.

## Commands

Each package is installed and run from its own directory. CI (`.github/workflows/ci.yml`) runs exactly these:

| Package | Install | Test | Build / analyze |
|---|---|---|---|
| `services/api` | `npm ci` | `npm test` | `npm run build` |
| `apps/government` | `npm ci` | `npm test` | `npm run build` (runs `tsc --noEmit`) |
| `apps/citizen` | `flutter pub get` | `flutter test` | `flutter analyze` |

- Single test file: `npx tsx --test test/priority.test.ts` (API and dashboard both use `node:test` via `tsx`, not Jest/Vitest). Filter by name with `--test-name-pattern="..."`. Flutter: `flutter test test/path/to_test.dart`.
- API tests need no database or network: the `pg` pool and `fetch` are replaced with `mock.method`. Keep it that way for new tests.
- Flutter is pinned to **3.44.0**; newer stable deprecates `package:flutter/material.dart` and breaks `flutter analyze`. Don't upgrade casually.
- Local stack: `npx supabase start` from the repo root (needs Docker; applies `supabase/migrations`), then `npm run dev` in `services/api` (port 3000) and `apps/government` (port 5173, proxies `/api` to 3000). Setup details, `.env` values and the first-admin invite flow are in `README.md`.
- No linter is configured for the TypeScript packages; `tsc` is the check.

## Architecture

### API (`services/api`, Fastify, ESM)
- `src/index.ts` registers every route plugin with its prefix (`/api/auth`, `/api/reports`, `/api/sos`, `/api/gov/...`) and starts all background workers. Routes are **not** versioned.
- Database access is raw SQL through `pg` (`src/db.ts` exports `pool` and `query`). It connects as the table owner, so RLS does not apply to it. `@supabase/supabase-js` is used only for Storage (photos), with the service-role key.
- Request validation uses zod schemas in `src/schemas/`. Auth is `fastify.authenticate` from `src/plugins/authenticate.ts`, which must be registered before any route that uses it.
- **Government visibility scoping** (`src/lib/gov-scope.ts`): STATE accounts see only rows whose resolved `location.state_id` matches theirs; FEDERAL sees everything, including reports with no location. Every `/api/gov/*` query or mutation that takes a report or cluster id must apply this scope, otherwise a STATE user can reach another state's data by guessing ids.
- **AI and notifications are in-process polling workers**, not a separate service (`src/ai/*_worker.ts`, `src/notifications/*_worker.ts`). Each is off unless its `AI_*_ENABLED` / provider env var is set (see `.env.example`). They read durable job tables in Postgres (e.g. `issue_cluster_priority_jobs` with `revision`/`evaluated_revision`/`next_run_at`); triggers bump revisions when inputs change. Pure scoring logic sits next to each worker (`severity.ts`, `priority.ts`, `clustering.ts`) and is tested separately from the worker.
- AI never silently changes citizen data. Low-confidence results become review candidates, and operator merge/split/remove actions on clusters are audited.

### Database (`supabase/migrations`)
- Every schema change is a new timestamped migration (`YYYYMMDDHHMMSS_description.sql`). Never edit an applied migration.
- **Every new `public` table must enable RLS** (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, usually with no policies, since only the API touches data). `public.assert_public_tables_have_rls()` raises if any table lacks it. Call it at the end of migrations that create tables.
- PostGIS: `locations.geom`, and `state_id` is set by the `set_location_state()` trigger (`ST_Contains` against `nigeria_states`), never in application code. Preserve GPS `accuracy`; later severity and clustering use it.
- pgvector holds text and image embeddings for duplicate detection.

### Government dashboard (`apps/government`)
- React 19 + Vite. No router library, no Tailwind, no data-fetching library. Views are top-level components in `src/` (`ReportsView`, `ClustersView`, `MapView` with Leaflet, `ReviewQueueView`, `AdminView`); all HTTP goes through `src/api.ts`; shared types are in `src/types.ts`.
- Styling is plain CSS. Design tokens (`--color-*`, `--space-*`) live in `src/design-system.css`. Use these tokens; don't introduce new colors or spacing values. This is a dense operational tool, not a marketing UI.

### Citizen app (`apps/citizen`, Flutter)
- Feature-first: `lib/features/<feature>/` (auth, report, sos, notifications, ...), cross-cutting code in `lib/core/` (router, providers, services, security, theme), reusable widgets in `lib/shared/`.
- `go_router` for navigation, `provider` for state, `dio` for HTTP, `flutter_secure_storage` for tokens.
- API base URL comes from `--dart-define=API_BASE_URL` (default `10.0.2.2:3000` on the Android emulator, `127.0.0.1:3000` elsewhere). Google/Apple sign-in and push also need `--dart-define` values (`docs/citizen-auth.md`, `docs/notifications.md`).

## Claude Code setup (`.claude/`)
- Skills: `new-migration` (any schema change) and `new-gov-route` (any `/api/gov/*` endpoint). They hold the RLS and state-scoping checklists; follow them rather than improvising.
- Hook: after any edit to a `.ts`/`.tsx` file in `services/api` or `apps/government`, `.claude/hooks/typecheck.sh` runs `tsc --noEmit` for that package and reports errors back. It stays silent until that package's `node_modules` is installed.

## Conventions
- Comments explain *why* (constraints, failure modes), not what. Follow the existing style in `src/db.ts` and the migrations.
- Use sentence case for UI copy in both apps.
