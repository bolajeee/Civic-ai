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
  - [x] Detail screen and status filters use loaded report data
  - [ ] Load additional history pages and filter/search the full history — currently only the first 20 reports are loaded; Home search and History filters operate on that page
  - [x] Home/Profile counts use `GET /api/reports/summary` through a shared model/service/provider, independently of history; loading, retry, pull-to-refresh, refresh after submission, and account-change clearing included
  - [x] Submit now clears the draft and returns Home with the new report number

### Citizen UI functionality gaps (reviewed 2026-09-30)

- [ ] Login: Forgot Password, Google sign-in, and Apple sign-in only show "coming soon" messages; no reset or social authentication flow
- [ ] Home: notification bell is decorative; no notification inbox or tap action
- [ ] Profile: Edit Profile, Notifications, Language, Help & Support, and About rows have no tap handlers/screens
- [ ] Profile: Dark Mode only toggles local switch state; it does not change the app theme or persist the preference
- [ ] Profile: Impact Score has no scoring model/API and displays a dash
- [ ] Home/Profile: location labels are hardcoded (Ikeja/Lagos); displayed names are derived from email rather than the stored full name; Profile version is hardcoded
- [ ] Report Details: both Share receipt actions only show a snackbar; no receipt generation or system share sheet
- [ ] Report Details: Priority, Assigned agency, and Citizen reference are unavailable placeholders; timeline is inferred from current status, with no event history/timestamps
- [ ] Report Details: only the thumbnail is displayed, with no full photo gallery; direct links require the report to exist in loaded history (no report-detail fetch endpoint)
- [ ] Notifications: permission request exists, but delivery, device-token registration, and notification preferences are not implemented

Summary integration validation: `flutter analyze` passes; all four new summary
model/provider tests pass. Full Flutter suite: 30 passed, one existing router-test
failure (`authenticated real app routes pass through untouched`). That test expects
`/permissions` to remain open with permissions granted, while the current router
intentionally redirects it to Home; the test and router were not changed here.

### Phase 3: AI (In Progress)
- [x] Focused image classifier, confidence score, and durable PostgreSQL queue (code and migration ready; OpenAI key configuration pending)
- [x] Embeddings generation (semantic text embeddings via pgvector queue; code and migration ready, OpenAI key configuration pending; image-vector embeddings not yet built)
- [x] Duplicate candidates detection (geo + semantic + category scoring; code and migration ready, not yet run against a database)
- [x] Issue clustering logic (open same-category clusters, fixed geographic anchor, automatic high-score assignment, durable review candidates and audit decisions; code and migration ready, database validation pending)
- [x] Severity estimation (independent vision + description analysis, confidence gating, auditable input snapshots and durable retries; code and migration ready, OpenAI key configuration and database validation pending)
- [x] Priority calculation engine (fixed-weight cluster score with stored input snapshots, durable recalculation queue and operator-supplied population/location context; code and migration ready, database validation pending; scores stay INCOMPLETE until sourced context is entered)

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
  and all 8 web tests pass. Chrome overview interaction checks with test API
  responses pass for sign-in, overview, refresh errors, empty/disabled states,
  responsive overflow, and sign-out. Live overview/map queries and account
  authorization pass; password-based browser sign-in remains pending.
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
- [ ] Issue clusters view
- [ ] Cluster evidence view: original report references, descriptions, photos, locations/GPS accuracy, dates, and statuses alongside the combined summary
- [ ] Grouping explanation: match signals, score, threshold, assignment method, and competing candidates; show missing data and AI uncertainty
- [ ] Filters & Search
  - Report search/filters and map category/status filters are implemented; cross-cluster and review-queue search remain pending.
- [ ] Review queue
- [ ] Administrator review actions: approve/dismiss candidates, remove/move reports, merge/split clusters, and record reviewer, timestamp, and reason

### Phase 5: Government Reporting (Pending)
- [ ] Issue report compilation
- [ ] Reviewable cluster report: combined findings linked to source reports, evidence appendix, unresolved disagreements, and review status
- [ ] PDF generation
- [ ] Print optimizations
- [ ] Report versioning
- [ ] Preserve the reviewed evidence snapshot and approval details for each generated report version
- [ ] Audit trail

### Phase 6: Hardening (Pending)
- [ ] Security audits & least privilege
- [ ] Rate limiting
- [ ] Error handling
- [ ] Offline handling (Flutter sync queue)
- [ ] Monitoring & Observability
- [ ] Automated Testing
