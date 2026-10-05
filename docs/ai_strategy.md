# AI Strategy & Architecture

## Core Principles

- **Independent Capabilities**: Do not make one giant AI function. Use independent services (ClassificationService, SeverityService, EmbeddingService, etc.) to ensure replaceability (e.g., swapping YOLO v1 for v2 without rewriting the reporting platform).
- **Asynchronous Processing**: AI processing must not block the report API. The MVP uses a PostgreSQL-backed queue so the report and its analysis job can be committed together without adding Redis. Move to a dedicated queue when throughput requires it.
- **Auditability**: Every AI prediction must retain the model, version, input reference, prediction, and confidence to answer questions like "Why did CivicAI classify this as flooding?".
- **Data Preservation**: AI is an enhancement, not the foundation of data integrity. If AI fails, the citizen's report must still exist. AI uncertainty should never destroy citizen data.

## Processing Pipeline

When a citizen submits a report:
1. Backend validates and stores media & report data.
2. Returns 201 to the citizen immediately.
3. Enqueues a background AI job.
4. **AI Processing Job**:
   - Image Classification (Pretrained vision model + Nigerian civic dataset)
   - Object Detection
   - Severity Estimation (Visual severity + description + geographic context)
   - Embedding Generation (Image + semantic embeddings)
   - Duplicate Candidate Search (Geographic proximity + visual/semantic/category similarity)
5. Backend stores AI results.
6. Issue Clustering (Groups if score >= threshold). High confidence -> automatic grouping. Low confidence -> review queue.
7. Priority Calculation.
8. Dashboard reflects updates.

## Issue Clustering & Priority

- **Clustering**: Similarity Score = geographic similarity + visual similarity + semantic similarity + category similarity.
- **Priority**: Priority should not simply equal severity. Initial MVP uses a transparent weighted formula: Severity (40%), Report Volume (20%), Persistence (15%), Population context (15%), Location importance (10%).

## Admin Transparency and Cluster Report Review

Transparency is a core requirement of the government/admin experience. A cluster
report combines citizen observations into a reviewable account of an issue;
administrators must be able to inspect the data and reasoning behind that account.
The following are requirements for the dashboard and reporting phases, not
features already delivered by the clustering worker.

- **Combined evidence:** Present the cluster reference, category, status, report count, geographic spread, observation dates, and a combined findings summary. Each factual summary claim must reference the supporting report IDs. Preserve differing observations instead of smoothing them into a single asserted fact.
- **Source inspection:** Let the reviewer open every supporting report's original description, photos, submitted location, GPS accuracy, submission date, and status. Distinguish the original citizen observation, AI suggestions, and administrator conclusions.
- **Grouping explanation:** Show why a report joined the cluster: matched report, geographic distance, semantic similarity, category match, combined score, threshold, assignment method, and scoring/clustering versions. Explain the score in plain language and show competing candidates when relevant. A singleton created for review must be distinguishable from an approved grouping.
- **Visible uncertainty:** Show missing coordinates/media, incomplete or failed processing, conflicting categories, low scores, pending review, and absent model capabilities. Display unavailable severity/priority as unavailable; when implemented, expose their contributing inputs and weights. Scores must not be presented as verified facts or calibrated probabilities.
- **Human review:** Administrators must be able to approve or dismiss proposed matches, remove or move a report, and merge or split clusters. Record the reviewer, timestamp, reason, and before/after membership for each change. Automatic grouping and administrative approval are separate states; retain the original automated decision alongside later review actions.
- **Report traceability:** The compiled cluster report and exported PDF must include the combined findings, source report references, evidence appendix, outstanding uncertainty, review status, and approval details where present. Each version preserves the evidence and membership snapshot reviewed at that time, so later changes do not rewrite an earlier approved report.


## Model Strategy (MVP)
Do not train five sophisticated models from scratch for the MVP. Start with pretrained vision models tailored with Nigerian civic datasets and standard embedding models for similarity.

## Phase 3 First Slice: Image Classification

- Classify the first supported uploaded photo into the category table's current slugs, or UNSURE.
- Store the citizen-selected category unchanged. The AI result is a separate suggestion with a confidence score and short visual evidence.
- Do not block report submission on image download, OpenAI latency, or model failure.
- Use the durable report_ai_analyses queue and retry transient failures up to three times.
- Configure the OpenAI key on the API server only. Classification stays disabled unless both AI_CLASSIFICATION_ENABLED=true and OPENAI_API_KEY are set.
- Default to gpt-6-luna for image input and structured output; keep the model configurable. OpenAI API inference is usage-billed, so there is no automatic call without explicit server configuration.
- A result below AI_CLASSIFICATION_MIN_CONFIDENCE keeps its score and evidence but has no predicted category id.
- Confidence is a model-reported score, not a calibrated probability; use it for triage and review, not as ground truth.
- Severity, embeddings, duplicate matching, and clustering run as separate capabilities described below.

## Phase 3 Second Slice: Embeddings

- One SEMANTIC_TEXT embedding per report (text-embedding-3-small, 1536 dimensions, configurable model), stored in report_embeddings with its input text, model and version.
- The text is category label, description, address and the visual evidence sentence from image classification. The job waits for classification to settle (pending/processing) so evidence is included, but a skipped, failed or absent classification does not block it.
- Same durable PostgreSQL queue pattern and retry policy as classification. Disabled unless both AI_EMBEDDINGS_ENABLED=true and OPENAI_API_KEY are set.
- Image-vector embeddings are not built: OpenAI has no image embedding endpoint, so this needs a separate model (e.g. CLIP) as a new embedding_type.

## Operating the AI queues

- **Backfill:** at startup, each enabled flag queues a job for every report that has none (`src/ai/backfill.ts`). Enabling a flag is therefore the consent to bill for the whole back catalogue; it is idempotent and safe across restarts.
- **Crash cap:** a job left PROCESSING for over 10 minutes is re-claimed only while it has attempts left; otherwise it is marked FAILED with `WORKER_CRASHED`.
- **Citizen app:** the report detail screen shows the AI's suggestion as a second opinion, or a "reviewing" note while pending. Failed and skipped checks are hidden.

## Phase 3 Third Slice: Duplicate Candidates

- When a report's embedding is COMPLETED, a worker finds earlier open (PENDING / IN_PROGRESS) reports within `AI_DUPLICATE_RADIUS_METERS` (default 200 m, PostGIS `ST_DistanceSphere`) whose embeddings are also complete, and keeps the best five scoring at least `AI_DUPLICATE_MIN_SCORE` (default 0.6).
- Score = 0.4 x geographic closeness (linear to 0 at the radius) + 0.4 x semantic cosine similarity + 0.2 x same citizen-selected category. Visual similarity is absent until image embeddings exist. The formula is versioned (`geo-semantic-category-v1`) and each candidate stores its distance, similarity and category match.
- Results go to `report_duplicate_candidates`; `report_duplicate_searches` marks each report as searched (COMPLETED, NO_LOCATION or FAILED). There is no API cost, so it has its own flag, `AI_DUPLICATE_DETECTION_ENABLED`, and needs embeddings enabled.
- The duplicate worker only writes suggestions. The separate clustering worker below consumes them without deleting or hiding reports.
- Known limits: only earlier reports are searched, so an older report whose embedding finished later is missed; resolved/rejected reports are excluded on purpose; reports without a location are marked NO_LOCATION.

## Phase 3 Fourth Slice: Issue Clustering

- Apply `supabase/migrations/20261005120000_create_issue_clusters.sql`, then set `AI_CLUSTERING_ENABLED=true` on the API server. This database-only worker consumes the existing backlog of COMPLETED / NO_LOCATION duplicate searches. New searches require embeddings and duplicate detection enabled. There is no additional model call.
- Only open reports can join open clusters with the same citizen-selected category. Both the candidate report and cluster must still be open at assignment time. The source must be within `AI_DUPLICATE_RADIUS_METERS` of the cluster's fixed seed location; this prevents transitive chains from spreading beyond that radius.
- The strongest match per distinct cluster competes for assignment. A score at least `AI_CLUSTER_AUTO_MIN_SCORE` (default 0.85) assigns automatically, unless the runner-up cluster is within `AI_CLUSTER_AMBIGUITY_MARGIN` (default 0.05). These weighted scores are not calibrated probabilities.
- Weaker or ambiguous eligible matches create a separate singleton plus PENDING review candidates. A report with no eligible match, including one without GPS, gets a singleton. Every report retains its original content and citizen status; cluster status is separate.
- Durable `report_cluster_decisions` stores configuration, version (`anchor-category-v1`) and outcome. Membership is unique per report. A transaction-level advisory lock serializes workers; membership, cluster, review rows and decision commit together. The worker preserves existing memberships, including human assignments, and skips closed reports.
- A failed report transaction rolls back to a savepoint and records FAILED / CLUSTERING_FAILED so it cannot block later reports. After correcting the cause, delete only that FAILED decision to retry. Searches marked FAILED are not consumed; repair/retry duplicate detection first. Completed decisions are not automatically recomputed when thresholds change.
- Counts and centroids update through a membership trigger, including membership moves and report deletion. Empty clusters remain available for audit. A singleton's confidence is null; AI-assigned membership retains its winning score.
- Limits: only candidates already assigned to clusters can be used. The worker processes available searches oldest first, but late predecessor searches can still cause separate singletons. Existing clusters are never automatically merged. Operator review actions, merge/split APIs, review UI, cluster severity aggregation and priority calculation remain later work.
- Validation: TypeScript build and API tests cover decision thresholds, ambiguity, distinct-cluster ranking, transactional writes, worker contention, preserving existing assignments, and failure markers. The migration still needs integration validation against PostgreSQL/PostGIS.

## Phase 3 Fifth Slice: Severity Estimation

- Apply `supabase/migrations/20261005130000_add_severity_estimation.sql`, then configure `OPENAI_API_KEY` and `AI_SEVERITY_ENABLED=true`. `OPENAI_SEVERITY_MODEL` defaults to the existing vision model, `gpt-6-luna`. This flag is independent of classification, embeddings and clustering. It authorizes billed inference for new reports and startup backfill of the existing backlog.
- A `SEVERITY_ESTIMATION` job in `report_ai_analyses` is inserted in the report transaction. The worker uses the first supported photo plus the citizen-selected category, description and supplied location. HEIC/HEIF-only reports are preserved with a SKIPPED analysis. Reports without any media cannot be backfilled.
- Version `civic-severity-v1` defines LOW (minor localized defect), MODERATE (clear damage or partial disruption), HIGH (major damage, blocked access or serious hazard), and CRITICAL (immediate danger to life or widespread loss of essential access). UNSURE means insufficient evidence. These are model suggestions, not verified hazard assessments.
- Accepted levels map to ordinal scores 0.25, 0.5, 0.75 and 1 for future priority inputs. Confidence below `AI_SEVERITY_MIN_CONFIDENCE` (default 0.65), or UNSURE, yields a null accepted level and score, while preserving the suggested level and evidence. Missing evidence never becomes LOW or zero. Critical and unavailable estimates require review. Confidence is not a calibrated probability.
- The prediction separates visible evidence, unverified citizen description, geographic context and uncertainty. Coordinates/address supply context only: the prompt forbids inferring population, nearby facilities, road importance, physical depth, injuries or electrical live status. Verified geographic risk enrichment remains future work.
- Before the first inference, the worker stores an input snapshot containing the exact category/description/location, media id/storage key/MIME type, threshold and rubric version. Retries reuse that snapshot; model name, returned model version, confidence, prediction and timestamps remain available for audit. Media bytes are referenced in storage, not duplicated in the snapshot.
- The worker uses row locks with SKIP LOCKED, three attempts, transient retries after 30s/120s, and stale PROCESSING recovery after ten minutes. Writes require the current attempt number so an expired worker cannot overwrite a later attempt. Refusals, missing credentials and unsupported formats fail permanently. Model/download failures leave the committed report intact.
- `POST /api/reports` includes `aiSeverityStatus`; authenticated history exposes `aiSeverity` with model metadata and the completed estimate. No citizen category/status changes, cluster aggregation or priority calculation are performed. Flutter severity presentation and administrator correction actions remain future work.
- Validation uses mocked model/storage/database clients; no billed calls run in tests. TypeScript build and API tests cover validation, thresholds, retries, snapshot reuse, submission transactions, unsupported photos, and owner-scoped retrieval. Migration and live model accuracy still require deployment validation.

The structured response format follows [official OpenAI documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat).

