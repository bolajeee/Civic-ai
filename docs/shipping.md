# CivicAI Shipping Checklist

Last readiness audit: 2026-10-15 (Africa/Lagos)

Use this document for a production release of the API, government dashboard,
and citizen mobile app. A checked item needs reproducible evidence (CI run,
deployment log, store record, screenshot, query result, or named approver).

## Current release decision

**Status: NOT READY TO SHIP.** The implementation is substantial, but the
following release gates remain open:

- [ ] Complete the broader security and least-privilege audit.
- [ ] Fix the two documented AI pipeline ordering/failure gaps and add regression tests.
- [ ] Decide whether image-vector embeddings/visual similarity are a release requirement or an explicitly deferred capability.
- [ ] Configure a production-approved model and key, then validate the complete AI pipeline end to end.
- [ ] Validate government password sign-in and the remaining cluster/review browser flows against a provisioned environment.
- [ ] Configure and live-validate the implemented push notification path.
- [ ] Replace placeholder mobile application IDs and Android debug signing with production identities and signing.
- [ ] Publish and verify the Terms, Privacy Policy, and support endpoints currently referenced by the citizen app.
- [ ] Define the production hosting, deployment, backup, rollback, and secret-management procedures; the repository currently has no deployment manifest or environment template.
- [ ] Validate the citizen app on supported physical Android and iOS devices. Do not use the Android 17/API 37 `gphone16k` emulator as the release acceptance device.

## Verified in the 2026-10-15 audit

- [x] All 21 pre-notification migrations are recorded in the configured development database; the notification migration remains unapplied.
- [x] API: 177 tests pass and the TypeScript production build succeeds.
- [x] Government web: 21 tests pass and the Vite production build succeeds.
- [x] Live government database validation passes for overview, priority modes, map, reports, authorization, and rolled-back fixtures.
- [x] Citizen static analysis reports no issues and all 48 tests pass.

## 1. Release scope and ownership

- [ ] Assign a release owner, backend owner, database owner, web owner, mobile owner, security approver, and rollback decision-maker.
- [ ] Choose the release commit/tag and record its SHA.
- [ ] Freeze the release scope and classify every open item as blocking, deferred with approval, or out of scope.
- [ ] Confirm whether AI processing, push notifications, social sign-in, and both mobile platforms are enabled in this release.
- [ ] Confirm supported Android/iOS versions, browsers, screen sizes, and accessibility expectations.
- [ ] Create release notes covering user-visible changes, migrations, configuration changes, known limitations, and rollback constraints.
- [ ] Require green protected-branch CI and review approval for the release commit.

## 2. Product completion gates

- [ ] Citizen report journey passes: register/sign in -> permissions -> photo -> GPS -> category/description -> submit -> receipt/history/detail.
- [ ] Offline submission passes for disconnect, timeout, retry, app restart, account switch, and duplicate-safe recovery.
- [x] Citizen History loads subsequent pages and applies owner-scoped server-side status filters; Home search queries the full owner-scoped dataset.
- [x] Push delivery, device-token registration/rotation, logout cleanup, notification preferences, and the in-app inbox are implemented; configuration and acceptance remain below.
- [ ] Government journey passes: password sign-in -> overview -> map -> reports -> cluster evidence -> review action -> version -> approval -> PDF/print.
- [ ] Administrator and operator capabilities are verified separately; citizens cannot access government routes.
- [ ] Empty, loading, retry, partial-data, stale-data, permission-denied, and network-failure states are accepted on all critical screens.
- [ ] Product owner accepts all known limitations in writing.

## 3. Database and data safety

- [ ] Back up the production database and verify restore into an isolated environment.
- [ ] Record the production migration level before deployment.
- [ ] Review every unapplied migration for locks, runtime, data backfills, extension requirements, and rollback behavior.
- [ ] Apply all migrations in order and verify all 22 expected versions are recorded.
- [ ] Verify PostgreSQL extensions required by the schema, including PostGIS and pgvector.
- [ ] Verify uniqueness and foreign-key constraints for users, refresh tokens, reports, client submission IDs, clusters, memberships, report versions, and approvals.
- [ ] Confirm the reports object-storage bucket exists, is private, and has the intended retention/CORS policy.
- [ ] Verify signed photo URLs expire and never expose service-role credentials or raw internal storage keys.
- [ ] Run the read-only/rollback-protected government database validation against production-like data.
- [ ] Define database rollback/forward-fix steps; never roll back a migration that would discard accepted reports or audit records.

## 4. API configuration and security

- [ ] Run the formal security and least-privilege review and resolve all critical/high findings.
- [ ] Set `NODE_ENV=production`; confirm the process refuses insecure fallback secrets.
- [ ] Store and rotate `DATABASE_URL`, `JWT_SECRET`, `PASSWORD_RESET_PEPPER`, `SUPABASE_SERVICE_ROLE_KEY`, email credentials, OAuth settings, AI credentials, and `METRICS_TOKEN` in the deployment secret manager.
- [ ] Set `CORS_ORIGINS` to exact production government origins; verify unlisted origins are rejected.
- [ ] Set `TRUST_PROXY=true` only behind a trusted proxy and verify client IP handling/rate limits there.
- [ ] Replace per-instance in-memory rate limiting or explicitly accept its limits for the deployed instance count.
- [ ] Confirm refresh-token rotation, logout, logout-all, password reset, invite revocation, suspended accounts, and session expiry in production-like tests.
- [ ] Verify all government authorization decisions re-check current database role/status.
- [ ] Verify citizens cannot override owner/user IDs in query strings or bodies.
- [ ] Verify 4xx/5xx responses and logs do not leak SQL, tokens, storage keys, secrets, stack traces, or citizen identity.
- [ ] Run dependency, license, secret, and static-security scans for Node, Flutter/Dart, Gradle, CocoaPods, and generated artifacts.
- [ ] Confirm production logs redact authorization/cookie headers and carry `x-request-id` end to end.
- [ ] Store the Firebase service-account credentials only in the API secret manager; enable `PUSH_NOTIFICATIONS_ENABLED` only after migration and mobile configuration are complete.
- [ ] Review retention/deletion requirements for NIN, location, photos, auth sessions, AI snapshots, and audit records.

## 5. AI pipeline

- [ ] Fix the terminal embedding-failure path so every eligible report reaches a documented cluster/fallback outcome.
- [ ] Fix out-of-order embeddings so later completion cannot permanently prevent a valid duplicate match.
- [ ] Remove `citizenId` from government priority evidence and add error handling around `requireGovernment` in `gov-priority.ts`.
- [ ] Add regression tests for all three reviewed pipeline gaps.
- [ ] Confirm approved model names and availability; do not ship an unverified default model identifier.
- [ ] Configure `OPENAI_API_KEY` only on the API server and set each `AI_*_ENABLED` flag deliberately.
- [ ] Establish model spend limits, request timeouts, retry limits, concurrency, and alert thresholds.
- [ ] Submit controlled reports and verify classification -> embedding -> duplicate search -> clustering -> severity -> priority.
- [ ] Verify low-confidence, refusal, malformed output, unsupported media, timeout, rate-limit, and permanent-failure behavior.
- [ ] Verify manual cluster corrections and approvals remain authoritative after worker restarts/retries.
- [ ] Verify priority remains incomplete when required sourced context is absent.
- [ ] Record model versions, thresholds, scoring versions, and validation evidence for the release.

## 6. Government web application

- [ ] Set and verify the production API origin; ensure no localhost dependency remains in the built assets.
- [ ] Validate password sign-in with provisioned operator and administrator accounts.
- [ ] Validate invite registration only if it is intentionally exposed for the release.
- [ ] Validate overview, priority states, map tiles, filters, reports, photos, cluster evidence, review queue, and review mutations against production-like services.
- [ ] Validate immutable report versions, administrator approval, audit history, PDF download, and browser printing.
- [ ] Verify operators cannot approve or mutate administrator-only data.
- [ ] Confirm OpenStreetMap tile usage, attribution, availability expectations, and a production-appropriate tile policy/provider.
- [ ] Confirm externally hosted fonts satisfy privacy, CSP, and availability requirements, or self-host them.
- [ ] Configure HTTPS, HSTS, CSP, frame restrictions, referrer policy, MIME protections, and secure caching behavior at the host/proxy.
- [ ] Test the production bundle in supported desktop/mobile browsers and with keyboard-only navigation and screen readers.

## 7. Citizen mobile application

### Shared

- [ ] Replace the `com.example` Android/iOS identifiers with the registered production application identifiers.
- [ ] Set a production version/build number and ensure it is greater than the last distributed build.
- [ ] Build with the HTTPS `API_BASE_URL` and production OAuth identifiers; verify no localhost/emulator URL remains.
- [ ] Build with the production Firebase Dart defines and verify device registration, token rotation, foreground inbox refresh, background delivery, deep-link opening, preference opt-out, and logout cleanup on physical devices ([runbook](notifications.md)).
- [ ] Verify Google and Apple client IDs, redirect URIs, package/bundle identifiers, certificates, and server audience allowlists agree.
- [ ] Test fresh install, upgrade, logout/login, expired session, password reset, offline queue migration, and account switching.
- [ ] Test camera/gallery, permission denial/permanent denial, GPS off/no-fix, five-photo limit, large images, slow upload, retry, and duplicate-safe submission.
- [ ] Confirm encrypted token storage and ensure logs/crash reports contain no tokens, NIN, precise location, or private image URLs.
- [ ] Test on representative physical low/mid/high-tier devices and constrained/unstable networks.
- [ ] Capture store screenshots, descriptions, support URL, Privacy Policy URL, data-safety answers, and reviewer/test credentials.

### Android

- [ ] Create and protect a production upload keystore; remove debug signing from the release build.
- [ ] Configure Play App Signing, package ownership, SHA fingerprints, and Google sign-in credentials.
- [ ] Register the production Android package in Firebase and verify FCM delivery on every supported Android API level.
- [ ] Build and verify a release AAB with the intended Dart defines.
- [ ] Run `bundletool`/Play pre-launch checks and verify 16 KB-page compatibility separately from normal acceptance testing.
- [ ] Validate on a stable API 35/36 physical device or standard emulator; investigate renderer issues independently on experimental API 37 images.
- [ ] Verify manifest permissions are minimal and accurately disclosed in Play Data Safety.

### iOS

- [ ] Register the production bundle ID and set the Apple development team, distribution certificate, and provisioning profile.
- [ ] Configure Sign in with Apple identifiers, associated service configuration, and required capabilities.
- [ ] Enable Apple Push Notifications and remote-notification background mode, upload the APNs key to Firebase, and verify the distribution profile contains the production `aps-environment` entitlement.
- [ ] Archive a release build and pass Xcode validation/TestFlight processing.
- [ ] Verify privacy usage descriptions and App Store privacy nutrition answers match actual behavior.
- [ ] Test on physical iPhone hardware, including camera, photos, location, share sheet, secure storage, and Apple sign-in.

## 8. Legal, privacy, and support

- [ ] Publish valid Terms at `https://civicreport.ng/terms` or replace the placeholder URL in the app.
- [ ] Publish a valid Privacy Policy at `https://civicreport.ng/privacy` or replace the placeholder URL in the app.
- [ ] Verify `support@civicai.ng` is monitored and define support/escalation response times.
- [ ] Document the lawful basis, consent, access controls, retention, correction, export, and deletion process for NIN and other personal data.
- [ ] Document how AI suggestions are reviewed and that they do not silently replace original citizen observations.
- [ ] Approve user-facing language for location, camera, notifications, AI processing, and government review.
- [ ] Complete accessibility and localization review for every language advertised by the app.

## 9. Automated and manual validation

- [ ] API: `cd services/api && npm ci && npm test && npm run build`.
- [ ] Government web: `cd apps/government && npm ci && npm test && npm run build`.
- [ ] Citizen: `cd apps/citizen && flutter pub get && flutter analyze && flutter test`.
- [ ] Run `cd services/api && npm run validate:government` against the release database with rollback protection.
- [ ] Run live object-storage signing/retrieval validation with the explicit storage option in a safe environment.
- [ ] Run end-to-end tests for the complete MVP success journey, including generated PDF and resolution status.
- [ ] Run concurrency/idempotency tests for repeated submissions, token refresh, worker claims, cluster actions, version allocation, and approvals.
- [ ] Run load/soak tests for report uploads, signed-image access, dashboard queries, AI queues, and PDF generation.
- [ ] Run accessibility, responsive-layout, browser, physical-device, poor-network, and recovery testing.
- [ ] Save all reports and link them from the release record.

## 10. Deployment and operations

- [ ] Create reviewed, reproducible deployment manifests for the API and government web app.
- [ ] Pin runtime versions (Node, Flutter, Java/Android, Xcode/iOS) and dependency lockfiles.
- [ ] Configure separate development, staging, and production projects/databases/buckets/secrets.
- [ ] Configure HTTPS domains, DNS, certificates, CDN/proxy behavior, and health checks.
- [ ] Verify `/api/health/live`, `/api/health/ready`, and authenticated `/api/metrics` from the monitoring network.
- [ ] Add alerts for readiness, 5xx rate, latency, memory, database saturation, storage failures, worker backlog/failures, email failures, and AI spend/errors.
- [ ] Define log retention, dashboards, on-call ownership, incident severity, escalation, and status communication.
- [ ] Verify graceful shutdown drains HTTP/database work and stops all workers during rolling deployment.
- [ ] Configure automated database backups, object-storage protection, restore drills, and recovery objectives.
- [ ] Document API/web rollback and mobile forward-fix procedures, including migration compatibility.

## 11. Release execution

- [ ] Announce the release window and freeze conflicting database/deployment work.
- [ ] Capture pre-release metrics, queue depths, database migration level, and backup identifiers.
- [ ] Apply migrations and verify schema/extension health.
- [ ] Deploy the API with AI features disabled unless their end-to-end gate passed.
- [ ] Smoke-test authentication, health/readiness, report submission/idempotency, storage, and government authorization.
- [ ] Deploy the government web application and smoke-test all critical views and PDF download.
- [ ] Promote signed mobile builds through internal testing before staged public rollout.
- [ ] Monitor errors, latency, queues, database, storage, and user reports during the rollout.
- [ ] Record deployment versions, timestamps, operators, evidence, deviations, and the go/no-go decision.

## 12. Rollback and post-release

- [ ] Define objective rollback thresholds before rollout.
- [ ] Confirm the previous API/web artifact is available and compatible with the migrated schema.
- [ ] If rollback is unsafe, execute the documented forward-fix/feature-flag plan.
- [ ] Pause AI workers independently if model cost, correctness, or backlog becomes unsafe.
- [ ] Preserve logs/audit evidence and communicate incidents without exposing citizen data.
- [ ] Verify core journeys after rollback or stabilization.
- [ ] Review metrics and support reports after 1 hour, 24 hours, and 7 days.
- [ ] Close or assign every deferred issue and update `docs/progress.md` with production evidence.
- [ ] Run a release retrospective and update this checklist with learned failure modes.

## Sign-off

| Gate | Owner | Evidence | Approved at |
| --- | --- | --- | --- |
| Product scope |  |  |  |
| Security/privacy |  |  |  |
| Database/data safety |  |  |  |
| API/AI |  |  |  |
| Government web |  |  |  |
| Android |  |  |  |
| iOS |  |  |  |
| Operations/rollback |  |  |  |
| Final go/no-go |  |  |  |
