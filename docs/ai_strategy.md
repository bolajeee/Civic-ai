# AI Strategy & Architecture

## Core Principles

- **Independent Capabilities**: Do not make one giant AI function. Use independent services (ClassificationService, SeverityService, EmbeddingService, etc.) to ensure replaceability (e.g., swapping YOLO v1 for v2 without rewriting the reporting platform).
- **Asynchronous Processing**: AI processing must not block the report API. Use a background job queue (e.g., Redis + BullMQ) so reports are stored immediately and AI processes them asynchronously.
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
