# Database Design

**Primary Database**: PostgreSQL + PostGIS (crucial for geographic intelligence).

## Migration Strategy

- Never manually alter production tables.
- Use sequential migrations stored in `infrastructure/database/` (e.g., `001_extensions`, `002_users`, etc.).
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
- `id`, `public_id`, `category`, `status`, `severity`, `priority_score`, `report_count`, `centroid` (approx. geographic center)

### 6. Cluster Membership (`issue_cluster_reports`)
- `issue_cluster_id`, `report_id`, `confidence`, `assignment_method` (AI, HUMAN, SYSTEM)

### 7. AI Analysis
- Every AI processing operation creates an audit record.
- `id`, `report_id`, `model_name`, `model_version`, `analysis_type`, `prediction`, `confidence`, `metadata`

### 8. Audit Logs
- Immutable audit records for important government actions.
- `id`, `actor_id`, `action`, `entity_type`, `entity_id`, `old_value`, `new_value`, `ip_address`

## Important Edge Cases

- **AI Conflicting Result**: Store `citizen_category` and `ai_category` separately, then determine `final_category` for disagreement analysis.
- **Incorrect Deduplication**: Allow operators to manually "remove from cluster", "merge clusters", or "split cluster". Operations must be audited.
- **AI Uncertainty**: Never silently erase citizen data. AI suggests a "Candidate Cluster", which requires review if confidence is low.
