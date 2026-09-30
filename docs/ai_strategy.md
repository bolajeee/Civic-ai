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
- Severity, embeddings, duplicate matching, and clustering remain separate later steps.

## Phase 3 Second Slice: Embeddings

- One SEMANTIC_TEXT embedding per report (text-embedding-3-small, 1536 dimensions, configurable model), stored in report_embeddings with its input text, model and version.
- The text is category label, description, address and the visual evidence sentence from image classification. The job waits for classification to settle (pending/processing) so evidence is included, but a skipped, failed or absent classification does not block it.
- Same durable PostgreSQL queue pattern and retry policy as classification. Disabled unless both AI_EMBEDDINGS_ENABLED=true and OPENAI_API_KEY are set.
- Image-vector embeddings are not built: OpenAI has no image embedding endpoint, so this needs a separate model (e.g. CLIP) as a new embedding_type.

## Operating the AI queues

- **Backfill:** at startup, each enabled flag queues a job for every report that has none (`src/ai/backfill.ts`). Enabling a flag is therefore the consent to bill for the whole back catalogue; it is idempotent and safe across restarts.
- **Crash cap:** a job left PROCESSING for over 10 minutes is re-claimed only while it has attempts left; otherwise it is marked FAILED with `WORKER_CRASHED`.
- **Citizen app:** the report detail screen shows the AI's suggestion as a second opinion, or a "reviewing" note while pending. Failed and skipped checks are hidden.

