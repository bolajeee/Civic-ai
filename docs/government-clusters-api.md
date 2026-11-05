# Government issue clusters API

`GET /api/gov/issue-clusters/`, `GET /api/gov/issue-clusters/:id`, and
`GET /api/gov/issue-clusters/:id/evidence` require a
valid bearer JWT and a currently ACTIVE OPERATOR or ADMIN account, checked in
the database on every request. Responses use `Cache-Control: no-store`.

## Administrator review actions

All `POST` routes below require a currently ACTIVE **ADMIN** (OPERATORs get 403,
checked in the database on every request) and a JSON body with a mandatory
`reason` (trimmed, 1-1000 characters); bodies are strict. Each action runs in one
transaction that first takes the clustering worker's advisory lock, then locks the
affected clusters, so reviewers and the worker never interleave. Reports moved by
a reviewer become `HUMAN` assignments with no confidence value.

| Route | Body | Effect |
| --- | --- | --- |
| `POST /review-queue/:reportId/:clusterId/approve` | `reason` | Moves the report from its current cluster into the proposed one and marks that proposal ACCEPTED |
| `POST /review-queue/:reportId/:clusterId/dismiss` | `reason` | Marks the proposal DISMISSED; the report stays where it is |
| `POST /:id/reports/:reportId/move` | `targetClusterId`, `reason` | Moves a member of cluster `:id` into another cluster |
| `POST /:id/reports/:reportId/remove` | `reason` | Moves the report into a new cluster of its own (refused if it is already alone) |
| `POST /:id/merge` | `sourceClusterId`, `reason` | Moves every report of the source into `:id`; the source is left empty and hidden |
| `POST /:id/split` | `reportIds` (1-100), `reason` | Moves the listed reports into a new cluster; at least one must stay behind |

Destination clusters must be non-empty, open (PENDING or IN_PROGRESS) and have the
report's category; merges need two open, non-empty clusters of one category.
Violations return 409, unknown clusters, proposals or non-members 404. A merged
or moved report keeps its original grouping decision; the cluster's fixed anchor
location is not changed by a merge, so a merged cluster may extend beyond the
usual radius. Resolving a report's placement also resolves its other pending
proposals (the one for the destination is ACCEPTED, the rest DISMISSED), and
pending proposals into a cluster that has become empty are dismissed
automatically.

Success returns `{ action: { id, type, reason, createdAt }, clusters: [{ id, publicId, reportCount }] }`.

Every action is stored in the append-only `issue_cluster_review_actions` table
(reviewer, timestamp, reason, affected clusters, and a snapshot of the report and
cluster references). Resolved proposals also carry `reviewedBy`, `reviewedAt` and
`reviewReason` in the review queue. `GET /:id/review-actions?page&limit` (OPERATOR
or ADMIN, limit up to 50) lists actions touching a cluster, newest first, naming
the reviewer by public reference rather than email.

Repeatable live check (rolled back, nothing persisted), from `services/api`:
`npx tsx scripts/validate-cluster-actions.ts`.

## Cluster listing

The list accepts `page` (1–1,000,000), `limit` (1–100), optional exact `status`
and `category`, and these discovery controls:

| Query | Meaning |
| --- | --- |
| `q` | Case-insensitive literal search over cluster/category, supporting report reference/description/address, and related review source/candidate references; maximum 200 characters |
| `review` | `all` (default), `pending`, or `clear`; pending includes proposals where the cluster is either the current source cluster or proposed target |
| `assignment` | `all` (default), `AI`, `HUMAN`, or `SYSTEM`; matches when at least one current member uses the method |
| `location` | `all` (default), `present`, or `missing`; matches when at least one current member has that GPS state |

Unknown parameters are rejected. Filters are bound SQL parameters, run before
pagination, and return only clusters with at least one supporting report. `%`
and `_` in search text are literal characters rather than SQL wildcards.

The response contains `generatedAt`, `page`, `limit`, matching `total`, all
selectable categories, `priorityEnabled`, and newest-changed `clusters`. Each
cluster includes its internal UUID and public reference, category, cluster
status, report count, created/updated times, nullable centroid, pending grouping
review count, report-status aggregates, and a compact priority state. When the
priority feature is disabled, priority tables are not queried.

## Cluster summary

The UUID summary route loads independently of the current page. It adds the fixed
grouping anchor, counts by AI/HUMAN/SYSTEM assignment method, average recorded
assignment confidence, and first/last assignment times. It does not return
citizen data, competing candidates, priority input snapshots, or mutation
controls.

## Original evidence

The evidence route accepts strict `page` (1–1,000,000) and `limit` (1–50,
default 20) parameters. It returns the cluster reference, matching total, newest
reports first, and `photosExpireInSeconds: 900`. Each source report contains its
reference, original description, category and status, submitted/updated times,
nullable saved location with GPS accuracy, and ordered photos. It loads directly
from cluster membership, independently of the currently loaded cluster page.

Each report also includes a grouping explanation that separates its current
membership from the original automated decision. It contains:

- Current `assignmentMethod`, nullable membership `confidence`, and `assignedAt`.
- Duplicate-search status and candidate count when a search record exists.
- Original decision outcome/time, automatic threshold, ambiguity margin, search
  radius, matched report, and clustering/scoring versions when retained.
- Matched geographic distance, semantic similarity, visual similarity, category
  match and combined score when the scored pair still exists.
- Retained review candidates with proposed cluster/report references, score,
  signals, reason, and review status.

Missing records and signals stay null. The UI distinguishes system singletons,
automatic assignments, human assignments, failed/no-location searches and legacy
memberships. Scores are similarity heuristics, not calibrated probabilities.
Visual similarity is returned when both reports have compatible completed image
vectors. Its status distinguishes available, pending, failed, and unavailable
media; candidate-level `null` means the documented fallback weights were used.

Photo URLs are signed in one batch and expire after 15 minutes. A signing or
individual object failure leaves the report available with a null URL. Internal
storage keys are removed. Reloading the evidence page renews its links. The route
does not return citizen identifiers, contact details, AI classifications,
severity estimates, or inferred events.

Cluster status and supporting-report statuses are separate. Centroids summarize
available member GPS points and are not asserted as an exact incident location.
A missing anchor, centroid, confidence, or priority score remains explicitly
unavailable rather than being inferred.

Invalid input returns `400`, invalid tokens `401`, revoked access `403`, an
unknown or empty cluster `404`, and database failures a sanitized `500`.

## Review queue

`GET /api/gov/issue-clusters/review-queue` lists proposed report-to-cluster
matches that were not applied automatically (`issue_cluster_review_candidates`).
It is read-only; approving and dismissing proposals is separate work.

| Query | Meaning |
| --- | --- |
| `status` | `PENDING` (default), `ACCEPTED`, `DISMISSED`, or `all` |
| `reason` | `all` (default), `LOW_SCORE`, or `AMBIGUOUS_MATCH` |
| `category` | Exact category slug of the report awaiting grouping |
| `q` | Case-insensitive literal search over report/candidate/cluster references and the report description; maximum 200 characters |
| `page`, `limit` | Bounded pagination; `limit` is 1-100, default 20 |

Items are ordered oldest first. Each item has the source report, current
cluster and assignment method, proposed cluster, matched report, score, reason,
status, scoring version, retained signals and the original decision's threshold
and ambiguity margin. The response also carries overall `counts` and
`categories`. Citizen identity, storage keys and photos are not returned.
Invalid input returns `400`, invalid tokens `401`, revoked access `403`.

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
priority SQL, cross-cluster/review search and filters, identity exclusions,
bounded evidence pagination, grouping audit projections, photo ordering,
batch signing and safe signing failures, missing clusters, sanitized errors,
and authenticated client URL construction. Live database fixture and browser
interaction validation remain to be completed.
