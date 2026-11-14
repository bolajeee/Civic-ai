# Database Design

**Primary Database**: PostgreSQL + PostGIS (crucial for geographic intelligence).

## Migration Strategy

- Never manually alter production tables.
- Use sequential migrations stored in `supabase/migrations/`.
- Every schema change gets a migration.

## Core Domains & Entities

### 1. Users
- `id` (UUID), `public_id`, `email`, `phone`, `nin`, `password_hash`, `role` (CITIZEN, OPERATOR, ADMIN), `status`
- `government_level` (STATE, FEDERAL) and `state_id` (FK to `nigeria_states`) are set only for
  OPERATOR/ADMIN rows — `role` is the permission tier (what the account can do), `government_level`
  is an independent visibility scope (what the account can see). A STATE row must have a `state_id`;
  a FEDERAL row must not. Both are fixed server-side at invite time, the same way `role` already is.
  See [government accounts](government-accounts.md#state-vs-federal-accounts).

### 2. Reports (Citizen Submissions)
- **Note:** A report is an observation, not the issue itself.
- `id`, `public_id`, `citizen_id`, `description`, `category_id`, `status`, `location_id`, `assigned_agency`, `submitted_at`
- `assigned_agency` is nullable; null explicitly means no agency is currently assigned.

### 3. Report Media
- Stored in Object Storage, references kept in DB.
- `id`, `report_id`, `storage_key`, `media_type`, `file_size`, `width`, `height`, `checksum`

### 3a. Report Status Events
- `report_status_events` stores each real lifecycle transition with `report_id`, `status`, and `occurred_at`.
- A database trigger records new reports and status changes. Existing reports are backfilled only with their known submission event; unknown historical transition times are not invented.

### 4. Locations
- Leverages PostGIS.
- `id`, `report_id`, `latitude`, `longitude`, `accuracy`, `geom` (POINT, SRID 4326), `state_id`
- **Rule:** GPS accuracy must be preserved.
- `state_id` (FK to `nigeria_states`) is resolved automatically by a `BEFORE INSERT OR UPDATE OF geom`
  trigger (`set_location_state()`), via `ST_Contains` against `nigeria_states.geom` — never computed
  in application code. It stays `NULL` when `geom` is `NULL` (no GPS fix).

### 4a. Nigeria States (`nigeria_states`)
- `id`, `code` (e.g. `LA`), `name` (e.g. `Lagos`), `geom` (MultiPolygon, SRID 4326)
- Reference data for the 36 states + FCT (37 rows), seeded once from a vendored
  [geoBoundaries](https://www.geoboundaries.org/) `NGA-ADM1` dataset — not a live API call. Used to
  resolve a location's state (point-in-polygon) and to scope STATE-level government accounts.

### 5. Issue Clusters
- Represents the underlying civic problem.
- Implemented in `20261005120000_create_issue_clusters.sql`: `id`, `public_id` (`IC-1000`), `category_id`, `status`, `anchor_location_id`, `report_count`, `centroid`, timestamps.
- The fixed anchor bounds automatic assignments; centroid is the mean of located member reports. A membership trigger refreshes count and centroid on insert, move, and deletion. Reports without coordinates still count.
- Priority is stored separately from the cluster row (see `issue_cluster_priority_*` below); the cluster row holds no score.

### 6. Cluster Membership (`issue_cluster_reports`)
- `issue_cluster_id`, `report_id`, `confidence`, `assignment_method` (AI, HUMAN, SYSTEM)
- `report_id` is the primary key: one report belongs to at most one cluster. Automatic assignment stores the duplicate score as confidence; singleton SYSTEM assignments have null confidence.
- `report_cluster_decisions` records the outcome, configuration, clustering version and matched report/scoring version. `issue_cluster_review_candidates` retains ambiguous or lower-score target clusters for later operator review.

### 7. AI Analysis
- Every AI processing operation creates an audit record.
- The MVP stores image classification work and results in report_ai_analyses, which is also the durable PostgreSQL-backed job queue.
- `id`, `report_id`, `model_name`, `model_version`, `analysis_type`, `prediction`, `confidence`, `metadata`
- Severity (`SEVERITY_ESTIMATION`, migration `20261005130000`) shares the table and queue; its `input_snapshot` JSONB preserves the exact inputs, threshold and rubric version.
- Semantic embeddings live in `report_embeddings` (pgvector `vector(1536)`, HNSW cosine index). Per-photo visual embeddings live in `report_visual_embeddings` (`vector(1408)`, HNSW cosine index). Both are durable queues with model/version, retry, terminal failure, and audit metadata.

### 7a. Cluster Priority (`20261005140000_create_cluster_priorities.sql`)
- `issue_cluster_priority_context`: operator-sourced population / location-importance scores (0-1) with mandatory source, updater and reason; every write is copied to `issue_cluster_priority_context_history`.
- `issue_cluster_priority_calculations`: immutable `input_snapshot` and `result` per calculation, with `scoring_version`.
- `issue_cluster_priority_jobs`: durable queue (`revision`, `evaluated_revision`, `next_run_at`, `error_code`). Triggers on clusters, memberships, reports, severity analyses, review candidates and context bump the revision. Existing clusters are queued by the migration.

### 8. Audit Logs
- Immutable audit records for important government actions.
- `id`, `actor_id`, `action`, `entity_type`, `entity_id`, `old_value`, `new_value`, `ip_address`

## Important Edge Cases

- **AI Conflicting Result**: Store `citizen_category` and `ai_category` separately, then determine `final_category` for disagreement analysis.
- **Incorrect Deduplication**: Allow operators to manually "remove from cluster", "merge clusters", or "split cluster". Operations must be audited.
- **AI Uncertainty**: Never silently erase citizen data. AI suggests a "Candidate Cluster", which requires review if confidence is low.
