# Government web workspace

The government app is primarily a desktop web application, built with React,
TypeScript and Vite. Mobile delivery is planned for later phases; Flutter is
reserved for that later work and code reuse where applicable. The current
government client does not depend on the citizen Flutter app.

## Run locally

Use Node.js 22.12+ or 24. Install and start the API in `services/api` with its
existing database configuration. Apply migrations through
`20261005120000_create_issue_clusters.sql`. If `AI_PRIORITY_ENABLED=true`, also
apply the severity and priority migrations through
`20261005140000_create_cluster_priorities.sql`.

From this directory:

```sh
npm ci
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to http://127.0.0.1:3000 during
development. Sign in with an existing active OPERATOR or ADMIN account through
the government login endpoint. Citizen accounts cannot access the workspace.
There is no registration or account provisioning UI in this slice.
See [government account setup](../../docs/government-accounts.md) for invite
creation and API registration.

```sh
npm run build
npm test
```

Production hosting must route `/api` to the backend on the same origin. Vite's
development proxy does not apply to production or `npm run preview`. Serve
`dist/` over HTTPS. Never add database credentials or an OpenAI key to this app.
Vite setup and proxy behavior follow the [official guide](https://vite.dev/guide/)
and [server options](https://vite.dev/config/server-options.html#server-proxy).

## Implemented Phase 4 slices

- Government sign-in, in-memory access/refresh tokens, silent token rotation,
  single shared refresh for concurrent expired requests, and sign-out.
- Reloading the page requires signing in again. Tokens are not persisted in
  browser storage. A persistent browser session is future work.
- Global overview totals, report lifecycle, category breakdown, grouping-review
  backlog, unassigned reports, missing GPS and priority readiness.
- Latest eight citizen observations with cluster references and WAT timestamps.
- Manual refresh, loading, empty, error, and retained snapshot on refresh failure.
- Issue map with separate report GPS and issue-cluster centroid layers, viewport
  loading, exact category/status filters, manual refresh, and a Nigeria reset view.
- Select markers or accessible result-list buttons to inspect references, status,
  GPS accuracy, cluster assignment and supporting-report counts.
- Explicit per-layer caps, missing-coordinate counts, empty states, safe retained
  snapshots after failed refresh, and street-map loading failure notices.

Full report/cluster lists, evidence inspection, broader search, review
actions, and exported government reports remain subsequent slices. The recent
observations table is an overview, not a complete searchable reports view.

The map uses [Leaflet 1.9.4](https://leafletjs.com/reference-1.9.4.html) and
OpenStreetMap street tiles, with visible contributor attribution. Tile requests
go to the public tile service; authenticated report data stays on the CivicAI API.
Follow the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
when deploying; select an appropriate provider before expanding production usage.
See the [map API contract](../../docs/government-map-api.md) for bounds, filters,
caps and point semantics. Clusters without coordinates are counted, not mapped.

The API uses one statement for a consistent snapshot and checks role/status in
the database on every request. Counts are independent of the eight-row activity
limit. No personal citizen identifiers or photo URLs appear in the overview.
Priority readiness counts only non-empty open clusters; stale calculations count
as pending, failed jobs as failed, and disabled priority exposes no cached scores.
Empty clusters retained for audit are excluded from overview cluster counts.

Validation: API and web builds, mocked API access/contract tests and web session
tests. Chrome overview interaction checks with intercepted test API responses covered
sign-in errors, eight activity rows, retained data after a failed refresh,
empty/disabled states, desktop/mobile overflow and sign-out, with no runtime
errors. Live PostgreSQL/PostGIS overview and map queries, priority enabled/disabled
modes, and authorization against an existing active government account pass via
`npm run validate:government` in `services/api`. Session-local spatial fixtures
also pass and are rolled back. End-to-end password sign-in with a provisioned
government account remains pending; the live script uses an isolated test JWT.
Chrome map checks with intercepted API responses pass for marker/list selection,
escaped address text, category/layer changes, viewport reload, retained refresh
errors, empty/capped states, tile failure fallback, desktop/mobile overflow and
sign-out, with no runtime errors.
