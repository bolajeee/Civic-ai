# Project Progress (MVP Scope)

We are developing the CivicAI MVP iteratively, building the foundation first.
**Crucial Rule:** We do not start with AI to ensure we have a reliable place to store and use the data first.

## Definition of MVP Success
The MVP is successful if we can demonstrate this complete journey reliably:
Citizen encounters pothole -> Opens Flutter app -> Takes photo -> GPS captured -> Submits report -> Backend stores report -> AI identifies pothole & estimates severity -> System searches existing reports & groups into cluster -> Priority calculated -> Government dashboard updates -> Officer sees cluster on map -> Opens issue & sees supporting reports -> Generates official PDF report -> Printed & manually forwarded -> Issue marked resolved.

---

## Phases

### Phase 1: Foundation (Complete)
- [x] Repository Architecture
- [x] Database (PostgreSQL setup, Users table)
- [x] Authentication (API setup)
  - [x] Citizen: `/api/auth/register`, `/login`, `/refresh`, `/logout`, `/me`
  - [x] Refresh token rotation strategy (SHA-256 hashed, 30-day TTL, per-device revocation)
  - [x] JWT `authenticate` preHandler decorator for protected routes
- [x] Object Storage integration
- [x] Government Authentication
  - [x] Invite-code gated registration (`gov_invite_codes` table); API enforces invites, manual provisioning via [government account setup](government-accounts.md)
  - [x] Role guard on `/api/gov/auth/*` — CITIZEN accounts blocked
  - [x] `/logout-all` for full session revocation

### Phase 2: Citizen Reporting (In Progress)
- [x] Create report API endpoint
  - [x] Migrations: `report_categories` (6 seeded), `reports`, `locations` (+ PostGIS `geom`), `report_media`, `report_status` enum, `CR-` public-id sequence
  - [x] `POST /api/reports` — multipart, 1–5 photos, category + description + optional location; images uploaded first, then rows committed in one transaction so a failed insert leaves no orphan images
  - [x] `GET /api/reports/categories` — the selectable list, so the client sends real category ids
  - [x] `GET /api/reports/summary` — all-report counts scoped to the caller, independent of pagination; [response contract](reports-api.md)
  - [x] `GET /api/reports` — the caller's own reports, newest first, with signed thumbnail URLs
  - [x] `full_name` added to `users` and threaded through register / login / `/me` — it was being silently stripped by Zod and had no column
- [x] Flutter citizen app scaffolded (`apps/citizen`)
  - [x] Splash screen (animated, dark green, shield icon)
  - [x] Login screen (email + password, validation, social login stubs)
  - [x] Sign-up screen (Full Name, NIN, Email, Phone, Password, T&C checkbox)
  - [x] `AuthProvider` (ChangeNotifier) — session restore, login, register, logout
  - [x] `ApiClient` (Dio) — Bearer token injection + silent refresh interceptor
  - [x] `TokenStorageService` — flutter_secure_storage (keychain/keystore)
  - [x] `GoRouter` — redirect-based auth guard, refreshListenable wired to provider
  - [x] Shared widgets: `PrimaryButton`, `AppTextField`, `ErrorBanner`
  - [x] Permissions screen (camera, location, notifications — shown once post-login)
  - [x] Android & iOS platform folders generated with full manifest entries
  - [x] All auth gaps resolved: fullName in register body, double-navigation removed, Terms/Privacy links wired via `url_launcher`, `await _proceed()` fixed
  - [x] Splash-screen hang fixed — `unauthenticated` + `/` returned `null` because splash was grouped with the auth routes, so a fresh install never left splash. Redirect rules extracted into a pure `resolveRedirect()` with regression tests (`test/core/router/`)
  - [x] `flutter analyze` — zero issues
- [x] Camera/Gallery integration (Flutter)
  - [x] `image_picker` (native camera + system gallery), downsampled to 1920px @ 85 quality on pick
  - [x] Camera permission pre-check via `permission_handler` — denial surfaces an error + Open Settings instead of failing silently
  - [x] Multi-photo: up to 5 per report, appended, individually removable, with a live counter
  - [x] `ReportDraftProvider` (ChangeNotifier) — draft is dropped when the form is abandoned
  - [x] Report Issue screen (`/report`) per Figma — category, location, photo and description all live
- [x] GPS capture
  - [x] `geolocator` + `geocoding`; a fix is taken on entry to the form, with a 20s ceiling and a last-known-position fallback
  - [x] Service-disabled, denied, permanently-denied and no-fix are distinct `LocationFailure` values with their own remedies — "Open Settings" appears only when Settings is actually the fix
  - [x] Location is **optional** at submit: a citizen indoors can still file a report, and the API stores `location_id` as null
  - [x] Accuracy preserved alongside the coordinates (`locations.accuracy`, `locations.geom` as `geometry(Point,4326)`)
  - [x] Reverse geocoding is best-effort — a failure shows coordinates rather than blocking the field
- [x] Description submission
  - [x] `TextField` on the draft (1000 chars, matching the column) with a live counter
  - [x] Carried as a multipart field on `POST /api/reports` and stored on `reports.description`
- [x] Report history retrieval
  - [x] `ReportHistoryProvider` — loading / error / empty states, pull-to-refresh, stale list kept on a failed refresh
  - [x] `/reports` — newest-first list with thumbnail, category, `CR-` number, location and relative date
  - [x] Status badges (Pending / In Progress / Resolved / Rejected) coloured from `AppColors`
  - [x] Status filters use loaded history data; detail screens refresh from the owner-scoped report-detail endpoint
  - [x] Load additional history pages and filter/search the full history — owner-scoped status/search parameters, deterministic API pagination, infinite History loading, debounced full-dataset Home search, account-switch clearing, and stale-response protection are implemented with API/provider regression tests
  - [x] Home/Profile counts use `GET /api/reports/summary` through a shared model/service/provider, independently of history; loading, retry, pull-to-refresh, refresh after submission, and account-change clearing included
  - [x] Submit now clears the draft and returns Home with the new report number

### Citizen UI functionality gaps (reviewed 2026-09-30)

- [x] Login: password reset plus verified Google and Apple sign-in flows (social identities link to an existing NIN-backed citizen account)
- [x] Home notification bell opens an in-app report-status inbox; activity rows open report details (push delivery remains separately scoped below)
- [x] Profile: Edit Profile, Notifications, Language, Help & Support, and About have routed screens and working actions
- [x] Profile: Dark Mode changes `ThemeMode`, includes a dark palette, and persists through `SharedPreferences`
- [x] Profile: Impact Score is returned by `/api/reports/summary` using a documented 0–100 contribution/engagement/resolution model
- [x] Home/Profile: names use stored `full_name`; location uses the newest report with a saved location (or an honest empty state); version/build comes from the installed package
- [x] Report Details: both Share receipt actions generate a text receipt and open the native system share sheet
- [x] Report Details: owner-scoped API supplies cluster priority, assigned-agency state, citizen reference, and timestamped lifecycle events
- [x] Report Details: ordered photo gallery supports full-screen zoom; direct links fetch report details independently of loaded history
- [x] Notifications: durable report-status inbox, owner-scoped preferences, FCM device-token registration/rotation, logout cleanup, retrying HTTP v1 delivery worker, deep links, and Android/iOS client wiring are implemented with API/model tests; production Firebase/APNs configuration and physical-device acceptance remain shipping gates ([setup and acceptance test](notifications.md))

Citizen validation (re-run 2026-10-15): `flutter analyze` reports no issues and
all 48 Flutter tests pass, including history pagination/search, notification
parsing, receipt generation, detail parsing, settings persistence, summary
parsing and router redirects.
- [x] Update the stale router test so the Flutter suite is green

### Phase 3: AI (In Progress)
**Status key:** `[x]` in this phase means *implemented with unit tests*, not *validated end to end*. Re-audited 2026-10-15: all 21 pre-notification migrations are recorded in the configured development database, including clustering, severity, priority, report versioning, approvals, and submission idempotency. The live government validation passes with the priority branch enabled. No AI flag is enabled and no OpenAI key is configured, so the model-backed pipeline still has not been validated end to end.

- [x] Focused image classifier, confidence score, and durable PostgreSQL queue (code and migration ready; OpenAI key configuration pending; default model name `gpt-6-luna` unverified)
- [x] Embeddings generation (semantic text embeddings via pgvector queue; code and migration ready, OpenAI key configuration pending; image-vector embeddings not yet built)
- [ ] Image-vector embeddings and visual-similarity scoring (the current duplicate score intentionally redistributes that weight across geo, semantic text, and category signals)
- [x] Duplicate candidates detection (geo + semantic + category scoring; code and migration ready, not yet run against a database)
- [x] Issue clustering logic (open same-category clusters, fixed geographic anchor, automatic high-score assignment, durable review candidates and audit decisions; code and migration ready, migration recorded, no model-backed clustering run yet)
- [x] Severity estimation (independent vision + description analysis, confidence gating, auditable input snapshots and durable retries; code and migration ready, migration recorded, OpenAI key configuration and model/database validation pending; default model name `gpt-6-luna` unverified)
- [x] Priority calculation engine (fixed-weight cluster score with stored input snapshots, durable recalculation queue and operator-supplied population/location context; code and migration ready, migration recorded; scores stay INCOMPLETE until sourced context is entered)
- [ ] Validate Phase 3 end to end: enable the flags with a key and confirm a submitted report flows through classification, embedding, duplicate search, clustering, severity and priority
- [ ] Pipeline gaps found in review:
  - [ ] A report whose embedding ends `FAILED` is never duplicate-searched, so it is never clustered and stays "unclustered" with no retry or singleton fallback
  - [ ] Duplicate search only considers earlier reports that are already clustered; if a later report's embedding finishes first, the pair is never matched and they form separate clusters
  - [ ] `GET /api/gov/issue-clusters/:id/priority` returns an input snapshot containing each member report's `citizenId`; `requireGovernment` in `gov-priority.ts` has no error handling

### Phase 4: Government Dashboard (In Progress)

The government application is primarily web-based. The current client uses
React + TypeScript + Vite in `apps/government`; Flutter is reserved for later
mobile delivery and code reuse where applicable.

**Admin transparency requirement:** A cluster report must combine the supporting
observations into a reviewable account of the issue. Administrators must be able
to trace summaries and grouping decisions back to the original reports, inspect
uncertainty, and record corrections. See [cluster report review requirements](ai_strategy.md#admin-transparency-and-cluster-report-review).

- [x] Overview Dashboard (first slice implemented; live database queries validated)
  - [x] Government web scaffold, operator/admin sign-in, in-memory sessions, silent refresh rotation, and sign-out
  - [x] Protected `GET /api/gov/dashboard/overview`: global counts, lifecycle/category breakdown, grouping backlog, unassigned reports, missing GPS, and priority readiness
  - [x] Latest eight observations, WAT timestamps, manual refresh, loading/empty/error states, retained snapshot after refresh failure, and responsive web layout
  - [x] Current database role/status checks; stale/failed/disabled priority remains distinguishable; no citizen identity details in overview
  - [x] Validate overview queries against migrated PostgreSQL/PostGIS and database authorization for an existing active government account
  - [ ] Validate end-to-end browser password sign-in with a provisioned government account (live database checks use an isolated test JWT)
  - Setup and scope: [government web README](../apps/government/README.md); [overview API contract](government-dashboard-api.md)

  Validation: API build and all 97 API tests pass; government production build
  and all 8 web tests pass (re-run 2026-10-07). Chrome overview interaction checks
  with test API responses pass for sign-in, overview, refresh errors, empty/disabled
  states, responsive overflow, and sign-out. Live overview/map queries and account
  authorization pass with `AI_PRIORITY_ENABLED=false`; password-based browser
  sign-in remains pending.
  - [x] Live-validate the overview's priority branch (`priority_state` CTE) against the migrated development database (`npm run validate:government`, re-run 2026-10-15).
- [x] Map interface (PostGIS layers)
  - [x] Protected viewport GeoJSON API, report GPS and non-empty cluster centroids, exact category/status filters, per-layer caps and missing-coordinate counts
  - [x] Leaflet street map, layer controls, pan/zoom loading, selectable markers and accessible results, GPS accuracy and centroid uncertainty
  - [x] Live PostgreSQL/PostGIS queries and rolled-back spatial fixtures validate boundaries, ordering, limits, missing GPS, empty clusters, memberships and empty areas
  - [x] Chrome checks with test API responses: marker/list selection, category and layer changes, viewport reload, retained refresh errors, empty/capped states, tile failure fallback, desktop/mobile overflow and sign-out
  - API contract and repeatable live check: [government map API](government-map-api.md)
- [x] Reports view
  - [x] Protected full-dataset report list with server-side search, status/category, WAT dates, GPS and cluster-assignment filters; bounded pagination and deterministic newest-first ordering
  - [x] Individual report details with original description, saved GPS/accuracy, separate report/cluster statuses, ordered photos and renewable 15-minute signed links
  - [x] Loading/empty/error states, retained snapshots after failed refresh, stale-response protection, accessible detail focus and responsive layout
  - [x] Live database queries and rolled-back fixtures validate pagination beyond 20, literal search, WAT boundaries, filters, details and photo metadata; existing stored-photo signing and retrieval pass
  - [x] API/government builds, all 106 API tests and 10 web tests pass; Chrome checks with test responses cover browsing, filters, detail/photo failures, refresh errors, stale responses, mobile overflow and sign-out
  - Contract and validation commands: [government reports API](government-reports-api.md)
- [x] Issue clusters view
  - [x] Protected paginated API and dashboard list with reference/category/status search, non-empty clusters, lifecycle and review counts, centroid, and feature-aware priority state
  - [x] Independently loadable aggregate summary with grouping method counts, confidence, fixed anchor, first/last assignment times, retained refresh errors, responsive layout, and no citizen identity/evidence leakage
  - [x] API/government builds, all 133 API tests and 15 web tests pass
  - [ ] Validate the issue-cluster view with live database fixtures and browser interaction checks
  - Contract and validation commands: [government issue clusters API](government-clusters-api.md)
- [x] Cluster evidence view: original report references, descriptions, photos, locations/GPS accuracy, dates, and statuses alongside the combined summary
  - [x] Independently paginated evidence endpoint and responsive source-report cards with ordered, renewable 15-minute photo links and unavailable-photo fallbacks
  - [x] Evidence stays traceable to original observations without citizen identity, internal storage keys, AI estimates, inferred events, or grouping rationale leakage
  - [x] Evidence pagination, authentication, strict input, photo signing/sanitization and storage-failure behavior covered by API and web-client tests
  - Contract and validation commands: [government issue clusters API](government-clusters-api.md)
- [x] Grouping explanation: match signals, score, threshold, assignment method, and competing candidates; show missing data and AI uncertainty
  - [x] Evidence cards separate current membership from the original decision and expose matched report, distance, semantic/category signals, combined score, automatic threshold, versions, and retained competing review candidates
  - [x] System singleton, AI and human assignment states are distinct; missing GPS/search/decision/signals, failures, and the unavailable visual-similarity capability are explicit; similarity scores are not presented as probabilities
- [x] Filters & Search
  - [x] Reports retain their full-dataset filters; maps retain category/status filters; clusters now search references, categories, member descriptions/addresses and related review references
  - [x] Cluster filters cover lifecycle status, category, pending grouping review, assignment method, member GPS state, pagination and reset; review-related source and target clusters are both discoverable
- [x] Review queue
  - [x] Protected, paginated `GET /api/gov/issue-clusters/review-queue` lists grouping proposals oldest first (default pending) with status, reason, category and literal-search filters, plus overall pending/accepted/dismissed counts
  - [x] Each proposal shows the report awaiting grouping, its current cluster and assignment method, the proposed cluster, the matched report, score, automatic threshold, ambiguity margin, distance/semantic/category signals and versions; missing signals, GPS and decisions are explicit
  - [x] "Review queue" page in the government app
  - [ ] Validate the read-only review queue against the live database and with browser interaction checks
  - Contract: [government issue clusters API](government-clusters-api.md)
- [x] Administrator review actions: approve/dismiss candidates, remove/move reports, merge/split clusters, and record reviewer, timestamp, and reason
  - [x] Administrator-only (database-checked) `POST` actions, each in one transaction serialized with the clustering worker; a reason (1-1000 characters) is mandatory and every action is stored in the append-only `issue_cluster_review_actions` table with reviewer, timestamp and before/after clusters
  - [x] Moved reports become HUMAN assignments; stale proposals for them are resolved; proposals into a cluster left empty are dismissed automatically; same-category, open-target and non-empty rules are enforced (409 otherwise)
  - [x] Review queue shows approve/dismiss with a reason; the cluster evidence view has move/remove/split/merge controls and a review history; operators see history read-only
  - [x] API (152) and web (18) tests and builds pass; the real SQL was validated against the dev PostgreSQL/PostGIS in a rolled-back transaction (`npx tsx scripts/validate-cluster-actions.ts` from `services/api`)

### Phase 5: Government Reporting (Implementation Complete; Shipping Validation Pending)
- [x] Issue report compilation
  - [x] Protected live compilation API and dashboard brief combine current cluster metadata, observation window, lifecycle/location/description coverage, source-linked findings, original described observations, and a current source register without citizen identity
  - [x] Compilation is explicitly labelled a live, unapproved, non-versioned draft; immutable versions, approvals, PDF and print remain separate milestones below
  - Contract and validation commands: [government reporting API](government-reporting-api.md). API build and all 159 tests; government production build and all 20 web tests pass (2026-10-15).
- [x] Reviewable cluster report: combined findings linked to source reports, evidence appendix, unresolved disagreements, and review status
  - [x] The live report separates cited findings and citizen observations from AI category/severity suggestions, grouping method, missing evidence, and the full photo evidence view
  - [x] Explicit grouping proposals, accepted category mismatches, and differing accepted severity assessments are preserved as unresolved disagreements; evidence gaps remain separate uncertainties
  - [x] Derived `BLOCKED`, `NEEDS_REVIEW`, or `READY_FOR_REVIEW` status explains readiness without implying formal approval
- [x] PDF generation
  - [x] Authenticated PDF download is generated from the same live compilation and includes draft status, review readiness, cited findings, unresolved disagreements, uncertainties, and the evidence appendix
  - [x] Multi-page A4 output, safe text escaping, page numbering, attachment headers, loading/error UI, and deterministic renderer tests included; immutable PDF versions remain separately scoped below
- [x] Print optimizations
  - [x] Focused A4 browser print view hides dashboard chrome and avoids splitting report cards; generated PDFs repeat the cluster/version identity, reserve print-safe margins, keep section headings with their content, and include ruled page footers
- [x] Report versioning
  - [x] Active government users can save the current compilation as a numbered immutable JSONB snapshot, browse version metadata, and download a PDF reproduced from that exact snapshot
  - [x] Version numbers are allocated atomically per cluster and stored versions are protected by a database append-only trigger; creating a version does not imply formal approval
  - [x] API build and all 163 API tests; government production build and all 21 web tests pass (2026-10-15)
- [x] Preserve the reviewed evidence snapshot and approval details for each generated report version
  - [x] Each version preserves the compiled source/evidence appendix plus a private media manifest containing exact media IDs, storage references, metadata, display order, and available checksums; listings expose coverage counts but never storage keys
  - [x] Administrator approval is bound to one immutable version and its evidence manifest, and records the approver, timestamp, and required approval statement; blocked snapshots cannot be approved and approved PDFs reproduce these details
- [x] Audit trail
  - [x] Paginated reporting history combines append-only version-created and version-approved events with actor, WAT timestamp, version, captured review readiness, and approval statement; active operators have read access and only active administrators can approve
  - [x] API build and all 167 API tests; government production build and all 21 web tests pass (2026-10-15)

### Phase 6: Hardening (Pending)
- [ ] Security audits & least privilege (done: `JWT_SECRET` and the reset pepper are required when `NODE_ENV=production`, CORS uses a `CORS_ORIGINS` allowlist, `/api/test-upload` removed; broader audit and least-privilege review still pending)
- [x] Rate limiting (`@fastify/rate-limit`: 300/min per IP, 30/min on auth routes; set `TRUST_PROXY=true` behind a proxy; in-memory, so per instance)
- [x] Error handling (global JSON error handler hides 5xx internals; JSON 404)
- [x] Offline handling (Flutter sync queue: durable account-scoped photo/metadata queue, reconnect/session/manual retry, pending-state UI, and queue tests)
- [x] Monitoring & Observability (redacted structured logs, request IDs, liveness/readiness, protected Prometheus metrics, graceful shutdown, and endpoint tests)
- [x] Automated Testing (pull-request/main CI for API and government test/build plus Flutter analyze/test gates; see [hardening operations](hardening.md))

Hardening validation (re-audited 2026-10-15): all 177 API tests and the API
build pass; all 21 government web tests and the production build pass; the live
government database validation passes in both priority modes; Flutter analyze
is clean and all 48 citizen tests pass. All 21 previously existing repository
migrations are recorded in the configured development database; the new
notification migration is implemented but has not yet been applied or
live-validated.
See [Shipping Checklist](shipping.md) for the remaining release gates.
