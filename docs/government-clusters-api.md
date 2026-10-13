# Government issue clusters API

`GET /api/gov/issue-clusters/` and `GET /api/gov/issue-clusters/:id` require a
valid bearer JWT and a currently ACTIVE OPERATOR or ADMIN account, checked in
the database on every request. Responses use `Cache-Control: no-store`.

## Cluster listing

The list accepts `page` (1–1,000,000), `limit` (1–100), optional exact `status`
and `category`, and a case-insensitive literal `q` search over cluster reference
and category label. Unknown parameters are rejected. Filters are bound SQL
parameters, run before pagination, and return only clusters with at least one
supporting report.

The response contains `generatedAt`, `page`, `limit`, matching `total`, all
selectable categories, `priorityEnabled`, and newest-changed `clusters`. Each
cluster includes its internal UUID and public reference, category, cluster
status, report count, created/updated times, nullable centroid, pending grouping
review count, report-status aggregates, and a compact priority state. When the
priority feature is disabled, priority tables are not queried.

## Cluster summary

The UUID detail route loads independently of the current page. It adds the fixed
grouping anchor, counts by AI/HUMAN/SYSTEM assignment method, average recorded
assignment confidence, and first/last assignment times. It intentionally does
not return original descriptions, media, citizen data, competing candidates,
priority input snapshots, or mutation controls. Those belong to the separate
evidence, grouping-explanation, and review workflows.

Cluster status and supporting-report statuses are separate. Centroids summarize
available member GPS points and are not asserted as an exact incident location.
A missing anchor, centroid, confidence, or priority score remains explicitly
unavailable rather than being inferred.

Invalid input returns `400`, invalid tokens `401`, revoked access `403`, an
unknown or empty cluster `404`, and database failures a sanitized `500`.

## Validation

No new migration is needed; this uses the issue-clustering schema introduced by
`20261005120000_create_issue_clusters.sql` and conditionally uses the priority
schema when `AI_PRIORITY_ENABLED=true`.

From `services/api`:

```sh
npm run build
npm test
```

From `apps/government`:

```sh
npm test
npm run build
```

Automated tests cover authentication and current database authorization,
strict filters, literal search and pagination bindings, disabled/enabled
priority SQL, identity/evidence exclusions, missing clusters, sanitized errors,
and authenticated client URL construction. Live database fixture and browser
interaction validation remain to be completed.
