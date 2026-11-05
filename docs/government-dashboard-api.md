# Government overview API

`GET /api/gov/dashboard/overview` requires a valid bearer JWT and an active
OPERATOR or ADMIN account, checked against `users` rather than JWT role claims.
It returns `401` for invalid JWTs, `403` for unauthorized accounts, and the standard
`500` error on database failures. Responses use `Cache-Control: no-store`.

All fields share one PostgreSQL statement snapshot. There are no filters or
pagination parameters in this first overview slice.

| Field | Meaning |
| --- | --- |
| `generatedAt` | Snapshot timestamp |
| `reports` | Numeric `total`, `pending`, `inProgress`, `resolved`, `rejected`, `withoutLocation` counts across all reports |
| `clusters` | Numeric `total`, `open`, `resolved`, `rejected` counts for non-empty clusters; open means PENDING or IN_PROGRESS |
| `unclusteredReports` | Reports with no membership, including closed reports |
| `groupingReview` | Pending candidate-pair count (`candidates`) and distinct source-report count (`reports`) |
| `categories` | All categories, including zero-count categories, with `slug`, `label`, `display_order`, `total` and `open` report counts |
| `recentReports` | At most eight observations, newest first with id as tie-breaker: `id`, `publicId`, `category`, `status`, `submittedAt`, nullable `address`, `hasLocation`, nullable `clusterPublicId` |
| `priority` | `{ enabled: false }` when disabled; otherwise `enabled: true` and numeric `completed`, `incomplete`, `unavailable`, `inactive`, `pending`, `failed` counts |

Priority counts cover non-empty open clusters. Missing calculations, revision
mismatches and elapsed refresh times count as pending. An error code counts as
failed. Only current calculations contribute to readiness states. `inactive`
includes open clusters with no open supporting reports. An unavailable or
incomplete estimate does not become a zero score. This endpoint does not expose
scores, model inputs, or full evidence; the existing cluster priority endpoint
remains the source for calculation details.

Requires the reports and issue-clustering migrations even when the AI workers
are disabled. Priority tables are queried only when `AI_PRIORITY_ENABLED=true`.
The dashboard can run without enabling any billed model calls.
