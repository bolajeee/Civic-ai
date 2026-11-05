# Hardening Operations

## Offline report delivery

When a report upload fails because of a timeout, connection failure, HTTP 408,
429, or a server-side 5xx response, the citizen app copies every staged photo
to application support storage and saves the report metadata locally. Queued
reports are scoped to the citizen who created them. The app retries after that
citizen's session is restored, when network connectivity returns, or when they
tap Retry on the Home screen. A successful upload removes its durable photo
copies and queue entry.

Every app submission carries a stable UUID. The API stores it under a unique
citizen-scoped index and returns the original report when the same submission
is retried. This prevents an ambiguous timeout from creating duplicate reports.
Apply `20261015180000_add_report_submission_idempotency.sql` before releasing
the updated citizen app.

Validation and authentication errors are not queued because repeating them
cannot succeed without user action. A different signed-in citizen cannot send
or view another citizen's pending queue.

## API monitoring

- `GET /api/health/live` verifies the process is serving requests.
- `GET /api/health/ready` verifies PostgreSQL responds within two seconds.
- `GET /api/metrics` returns Prometheus text metrics when called with
  `Authorization: Bearer <METRICS_TOKEN>`. It returns 503 if `METRICS_TOKEN`
  is not configured.
- Every response carries `x-request-id`; structured logs use the same request
  identifier and redact authorization and cookie headers.
- `SIGTERM` and `SIGINT` stop workers, close the HTTP server, and drain the
  database pool.

Alert on sustained readiness failures, any elevated 5xx rate, and abnormal
memory growth. Keep `METRICS_TOKEN` in the deployment secret store and rotate
it like any other service credential.

## Automated validation

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`. It tests
and builds the API and government web app, then analyzes and tests the Flutter
citizen app. Local equivalents are:

```text
cd services/api && npm test && npm run build
cd apps/government && npm test && npm run build
cd apps/citizen && flutter analyze && flutter test
```
