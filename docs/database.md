# Database Design

**Primary Database**: PostgreSQL + PostGIS (crucial for geographic intelligence).

## Migration Strategy

- Never manually alter production tables.
- Use sequential migrations stored in `supabase/migrations/`.
- Every schema change gets a migration.

## Core Domains & Entities

### 1. Users
- `id` (UUID), `public_id`, `email`, `phone`, `nin`, `password_hash`, `role` (CITIZEN, OPERATOR, ADMIN), `status`

### 2. Reports (Citizen Submissions)
- **Note:** A report is an observation, not the issue itself.
- `id`, `public_id`, `citizen_id`, `description`, `category_id`, `status`, `location_id`, `submitted_at`

### 3. Report Media
- Stored in Object Storage, references kept in DB.
- `id`, `report_id`, `storage_key`, `media_type`, `file_size`, `width`, `height`, `checksum`

### 4. Locations
- Leverages PostGIS.
- `id`, `report_id`, `latitude`, `longitude`, `accuracy`, `geom` (POINT, SRID 4326)
- **Rule:** GPS accuracy must be preserved.

### 5. Issue Clusters
- Represents the underlying civic problem.
- Implemented in `20261005120000_create_issue_clusters.sql`: `id`, `public_id` (`IC-1000`), `category_id`, `status`, `anchor_location_id`, `report_count`, `centroid`, timestamps.
- The fixed anchor bounds automatic assignments; centroid is the mean of located member reports. A membership trigger refreshes count and centroid on insert, move, and deletion. Reports without coordinates still count.
- Severity and priority scores belong to the next Phase 3 slices.

### 6. Cluster Membership (`issue_cluster_reports`)
- `issue_cluster_id`, `report_id`, `confidence`, `assignment_method` (AI, HUMAN, SYSTEM)
- `report_id` is the primary key: one report belongs to at most one cluster. Automatic assignment stores the duplicate score as confidence; singleton SYSTEM assignments have null confidence.
- `report_cluster_decisions` records the outcome, configuration, clustering version and matched report/scoring version. `issue_cluster_review_candidates` retains ambiguous or lower-score target clusters for later operator review.

### 7. AI Analysis
- Every AI processing operation creates an audit record.
- The MVP stores image classification work and results in report_ai_analyses, which is also the durable PostgreSQL-backed job queue.
- `id`, `report_id`, `model_name`, `model_version`, `analysis_type`, `prediction`, `confidence`, `metadata`
- Embeddings live in `report_embeddings` (pgvector `vector(1536)`, HNSW cosine index), which is likewise its own durable queue. It keeps `input_text`, model and version for auditability.

### 8. Audit Logs
- Immutable audit records for important government actions.
- `id`, `actor_id`, `action`, `entity_type`, `entity_id`, `old_value`, `new_value`, `ip_address`

## Important Edge Cases

- **AI Conflicting Result**: Store `citizen_category` and `ai_category` separately, then determine `final_category` for disagreement analysis.
- **Incorrect Deduplication**: Allow operators to manually "remove from cluster", "merge clusters", or "split cluster". Operations must be audited.
- **AI Uncertainty**: Never silently erase citizen data. AI suggests a "Candidate Cluster", which requires review if confidence is low.
