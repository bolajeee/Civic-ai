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
  - [x] Invite-code gated registration (`gov_invite_codes` table) // intentionally skipped for now
  - [x] Role guard on `/api/gov/auth/*` — CITIZEN accounts blocked
  - [x] `/logout-all` for full session revocation

### Phase 2: Citizen Reporting (In Progress)
- [x] Create report API endpoint
  - [x] Migrations: `report_categories` (6 seeded), `reports`, `locations` (+ PostGIS `geom`), `report_media`, `report_status` enum, `CR-` public-id sequence
  - [x] `POST /api/reports` — multipart, 1–5 photos, category + description + optional location; images uploaded first, then rows committed in one transaction so a failed insert leaves no orphan images
  - [x] `GET /api/reports/categories` — the selectable list, so the client sends real category ids
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
  - [x] List only — detail screen, filters and paging deferred
  - [x] Submit now clears the draft and returns Home with the new report number

### Phase 3: AI (Pending)
- [ ] Image classification service
- [ ] Confidence scoring
- [ ] Embeddings generation
- [ ] Duplicate candidates detection
- [ ] Issue clustering logic
- [ ] Severity estimation
- [ ] Priority calculation engine

### Phase 4: Government Dashboard (Pending)
- [ ] Overview Dashboard
- [ ] Map interface (PostGIS layers)
- [ ] Reports view
- [ ] Issue clusters view
- [ ] Filters & Search
- [ ] Review queue

### Phase 5: Government Reporting (Pending)
- [ ] Issue report compilation
- [ ] PDF generation
- [ ] Print optimizations
- [ ] Report versioning
- [ ] Audit trail

### Phase 6: Hardening (Pending)
- [ ] Security audits & least privilege
- [ ] Rate limiting
- [ ] Error handling
- [ ] Offline handling (Flutter sync queue)
- [ ] Monitoring & Observability
- [ ] Automated Testing
