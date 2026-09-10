# Project Progress (MVP Scope)

We are developing the CivicAI MVP iteratively, building the foundation first.
**Crucial Rule:** We do not start with AI to ensure we have a reliable place to store and use the data first.

## Definition of MVP Success
The MVP is successful if we can demonstrate this complete journey reliably:
Citizen encounters pothole -> Opens Flutter app -> Takes photo -> GPS captured -> Submits report -> Backend stores report -> AI identifies pothole & estimates severity -> System searches existing reports & groups into cluster -> Priority calculated -> Government dashboard updates -> Officer sees cluster on map -> Opens issue & sees supporting reports -> Generates official PDF report -> Printed & manually forwarded -> Issue marked resolved.

---

## Phases

### Phase 1: Foundation (In Progress)
- [x] Repository Architecture
- [x] Database (PostgreSQL setup, Users table)
- [x] Authentication (API setup)
  - Citizen: `/api/auth/register`, `/login`, `/refresh`, `/logout`, `/me`
  - Refresh token rotation strategy (SHA-256 hashed, 30-day TTL, per-device revocation)
  - JWT `authenticate` preHandler decorator for protected routes
- [x] Object Storage integration
- [x] Government Authentication
  - Invite-code gated registration (`gov_invite_codes` table)
  - Role guard on `/api/gov/auth/*` — CITIZEN accounts blocked
  - `/logout-all` for full session revocation

### Phase 2: Citizen Reporting (In Progress)
- [ ] Create report API endpoint
- [x] Flutter citizen app scaffolded (`apps/citizen`)
  - Splash screen (animated, dark green, shield icon)
  - Login screen (email + password, validation, social login stubs)
  - Sign-up screen (Full Name, NIN, Email, Phone, Password, T&C checkbox)
  - `AuthProvider` (ChangeNotifier) — session restore, login, register, logout
  - `ApiClient` (Dio) — Bearer token injection + silent refresh interceptor
  - `TokenStorageService` — flutter_secure_storage (keychain/keystore)
  - `GoRouter` — redirect-based auth guard, refreshListenable wired to provider
  - Shared widgets: `PrimaryButton`, `AppTextField`, `ErrorBanner`
  - Placeholder `HomeScreen` (to be replaced in Phase 2)
- [ ] Camera/Gallery integration (Flutter)
- [ ] GPS capture
- [ ] Description submission
- [ ] Report history retrieval

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
