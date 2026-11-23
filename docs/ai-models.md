# AI Models: Hosted APIs vs Open-Source

**Status: Proposed. On hold until we run the evaluation below.** Nothing in this document is built. The current system is unchanged.
Written 2026-11-23. Research links checked on the same date.

## 1. Why this document exists

During planning, someone asked whether CivicAI should use a free, open-source vision model for comparing photos (like the ones CCTV systems use) instead of paid AI APIs.

Checking the code changed the starting point: **photo comparison does not use OpenAI.** It uses Google Vertex AI. OpenAI handles classification, severity and text embeddings. Duplicate detection, clustering and priority already run inside Postgres at no model cost.

This document covers four things:
1. Every AI capability in the system.
2. The tradeoffs of hosted APIs versus self-hosted open-source models, for each capability.
3. What a switch would change in the current system.
4. How we would test a switch, using public datasets.

The candidate replacement for photo comparison is a CLIP-family model. The idea is **held**, and this document is the proposal.

## 2. What AI the system uses today

| Capability | Code | Provider and model | Input → output | Stored in | Flag | Model cost |
|---|---|---|---|---|---|---|
| Classification | [classification.ts](../services/api/src/ai/classification.ts) | OpenAI chat, `gpt-6-luna`, structured JSON, `detail: high` | 1 photo + category list → slug, confidence, **one evidence sentence** | `report_ai_analyses` | `AI_CLASSIFICATION_ENABLED` | Billed per call |
| Severity | [severity.ts](../services/api/src/ai/severity.ts) | OpenAI chat, `gpt-6-luna`, rubric `civic-severity-v1` | photo + category, description, location → level, confidence, 4 evidence fields | `report_ai_analyses` | `AI_SEVERITY_ENABLED` | Billed per call |
| Text embedding | [embedding.ts](../services/api/src/ai/embedding.ts) | OpenAI `text-embedding-3-small` | category + description + address + **classification evidence** → `vector(1536)` | `report_embeddings` | `AI_EMBEDDINGS_ENABLED` | Billed, very small |
| Visual embedding | [visual_embedding.ts](../services/api/src/ai/visual_embedding.ts) | Google Vertex `multimodalembedding@001`, region `us-central1` | one JPEG/PNG photo → `vector(1408)` | `report_visual_embeddings` | `AI_IMAGE_EMBEDDINGS_ENABLED` | Billed per image |
| Duplicates | [duplicates.ts](../services/api/src/ai/duplicates.ts), [duplicate_worker.ts](../services/api/src/ai/duplicate_worker.ts) | Postgres (PostGIS + pgvector) | 0.3 geo + 0.3 visual + 0.3 semantic + 0.1 category, or 0.4 / 0.4 / 0.2 when a report has no visual vector | `report_duplicate_candidates` | `AI_DUPLICATE_DETECTION_ENABLED` | None |
| Clustering | [clustering.ts](../services/api/src/ai/clustering.ts) | Postgres | auto-assign at score ≥ 0.85 unless the runner-up is within 0.05 | `issue_clusters`, `report_cluster_decisions` | `AI_CLUSTERING_ENABLED` | None |
| Priority | [priority.ts](../services/api/src/ai/priority.ts) | Postgres | weighted formula using accepted severity | `issue_cluster_priority_*` | `AI_PRIORITY_ENABLED` | None |

How the capabilities feed each other:

```text
photo ──► classification ──(evidence sentence)──┐
  │                                             ▼
  │      description, address, category ──► text embedding ──┐
  │                                                          ▼
  ├────► visual embedding ───────────────────────────► duplicate candidates ──► clustering ──┐
  │                                                                                          ▼
  └────► severity ──────────────────────────────────────────────────────────────────────► priority
```

Every capability follows the same pattern: a durable Postgres queue, three attempts, the model name and version stored with each result, and its own feature flag. That is what makes swapping one capability at a time possible.

## 3. Tradeoffs: hosted API vs self-hosted open-source

| Factor | Hosted API (today) | Self-hosted open-source |
|---|---|---|
| **Cost model** | Pay per call. Near zero when idle, and grows with report volume. Turning on a flag also bills the whole backlog ([backfill.ts](../services/api/src/ai/backfill.ts)). | No per-call fee. You pay for compute that is always on (a bigger API instance, or a GPU), whether or not reports arrive. |
| **Quality** | Large general models. Strong on unusual photos, but not tuned to Nigerian streets. | Small models vary more. CLIP-family models are trained on web images and need checking on local street scenes (rain, laterite roads, informal drainage). |
| **Data residency** | Citizen photos and locations are sent to OpenAI and to Google `us-central1` (USA). This is a consideration under Nigeria's Data Protection Act 2023 for a ministry deployment. It is not legal advice. | Photos stay on infrastructure we control. This may matter more to a ministry than cost. |
| **Latency** | One network round trip per call (timeouts are 30–45 s in code). | No network call. CPU inference speed depends on the host, and the workers already run in the background, so citizens never wait on it. |
| **Running burden** | No servers to run, but we hold keys and quotas and depend on two vendors. | Model files to ship and cache, memory to size, and our own upgrades. A CLIP-sized model adds hundreds of MB of RAM to the API process. |
| **Explainability** | Chat models return an evidence sentence, shown to citizens and admins as a "second opinion". | Embedding and zero-shot models return only scores. There is no evidence sentence. |
| **Auditability** | Model name and version are stored with every result. | Same. Nothing changes, as long as we record the model name and version we pin. |
| **Vendor risk** | Models get renamed, repriced or retired (for example, a model ID can change under us). | Weights are pinned and can't change, but nobody patches them for us. |
| **Failure modes** | Rate limits (429), outages, refusals. All are handled as retryable or permanent errors today. | Out-of-memory, slow cold starts, a broken model download. These are new failure codes to add. |
| **Testability** | Tests mock `fetch`, so no billed calls happen in CI. | Needs a new mock point around the model runtime, so CI never downloads a model. |

## 4. Verdict by capability

### 4.1 Visual embedding (photo comparison): best candidate to switch

- **Today:** Vertex `multimodalembedding@001`, 1408 numbers per photo, billed per image, photos sent to `us-central1`.
- **Open-source candidates:**
  - CLIP (OpenAI, code MIT): checked; the weights licence isn't stated on the repo page, so confirm before shipping.
  - SigLIP base (`google/siglip-base-patch16-224`, Apache-2.0).
  - DINOv2 (Meta). Code and the main weights are Apache-2.0. The Cell-DINO and XRay-DINO variants are non-commercial, so avoid those.
- **Runtime:** Transformers.js (ONNX Runtime) supports the `image-feature-extraction` and `zero-shot-image-classification` tasks. Its docs page talks about the browser, so running it server-side in Node must be confirmed in the evaluation spike.
- **Why it fits:** It does the same job as today with the same output shape, a vector compared by cosine similarity. Nothing downstream changes except the vector size and the thresholds.
- **About CCTV tools:** CCTV comparison usually uses frame differencing or perceptual hashing, which assume a fixed camera. Citizens photograph the same problem from different angles, on different phones, in different light. Those tools would miss most real duplicates, so a learned embedding (CLIP, SigLIP or DINOv2) is the right kind of open-source tool.
- **Recommendation:** evaluate first (section 7). Switch only if it passes the go/no-go criteria.

### 4.2 Classification: worth testing, but it costs us the evidence sentence

- **Today:** `gpt-6-luna` picks one of POTHOLE, FLOODING, STREETLIGHT, WASTE, WATER_LEAK, OTHER, or UNSURE, and writes a one-sentence evidence.
- **Open-source option:** CLIP or SigLIP zero-shot. Compare the photo against text prompts per category (for example, "a photo of a pothole on a road"). It's free, and plausible for six broad categories.
- **Cost of switching:** no evidence sentence. That removes the "Visible evidence" line from the text embedding input ([embedding.ts](../services/api/src/ai/embedding.ts), `buildEmbeddingText`). It also removes the AI "second opinion" shown in the citizen app and in the dashboard's cluster evidence view. CLIP's confidence is also a softmax over our prompts, not the model's own judgement, so the `AI_CLASSIFICATION_MIN_CONFIDENCE` threshold (0.65) would need resetting.
- **Recommendation:** run it alongside the current model in the evaluation. Switch only if accuracy is close and we accept losing the evidence sentence.

### 4.3 Severity: keep the hosted model for now

- Severity needs reasoning against a written rubric, five fields of structured output, and refusal handling ([severity.ts](../services/api/src/ai/severity.ts)). Embedding models can't do this.
- Open vision-language models (for example, the Qwen-VL and LLaVA families) could, but they need a GPU host. At pilot volumes a GPU likely costs more than the API calls.
- **Revisit when:** report volume is high enough that a GPU host is cheaper, or data residency rules out the hosted model.

### 4.4 Text embedding: keep the hosted model

- `text-embedding-3-small` costs $0.02 per 1M tokens (see section 9). A report's text is a few lines, so the cost per report is negligible.
- Open models (MiniLM, bge, e5 families) would save almost nothing and add memory use. The only reason to switch would be data residency.

## 5. What a switch changes in the current system

These apply to any model swap, mainly the visual embedding:

1. **Vector size is fixed in the schema.** `report_visual_embeddings.embedding` is `vector(1408)` with `CHECK (dimensions = 1408)` ([migration](../supabase/migrations/20261015210000_add_visual_embeddings.sql)). `report_embeddings` is `vector(1536)` ([migration](../supabase/migrations/20260930120000_create_report_embeddings.sql)). A model with a different size (CLIP ViT-B/32 is 512) needs a new column or table and its own HNSW index.
2. **Vectors from different models could be compared.** The duplicate query joins visual embeddings on `status = 'COMPLETED'` only, with no filter on `model_name` ([duplicate_worker.ts](../services/api/src/ai/duplicate_worker.ts), the visual `LATERAL` join). If two models with the same vector size ever share a table, the query compares meaningless pairs. A model filter must ship with any swap.
3. **Backfill can't re-embed old reports.** [backfill.ts](../services/api/src/ai/backfill.ts) only inserts rows for media that have none. Old reports would keep old vectors. A switch needs a re-embed job, or a new table that backfill fills from empty.
4. **Thresholds must be recalibrated.** `AI_DUPLICATE_MIN_SCORE` (0.6) and `AI_CLUSTER_AUTO_MIN_SCORE` (0.85) suit the current models' cosine ranges. CLIP-family similarities run high even between unrelated photos, so raw values aren't comparable. Bump `DUPLICATE_SCORING_VERSION` (currently `geo-visual-semantic-category-v2`) so stored scores stay explainable.
5. **Image formats.** Vertex accepts JPEG and PNG only ([visual_embedding.ts](../services/api/src/ai/visual_embedding.ts)). Local decoding could add WebP. HEIC/HEIF photos stay `SKIPPED` unless we add conversion.
6. **API server load.** The model would load inside the API process alongside the HTTP server and nine background workers (seven AI, push, SMS). Expect hundreds of MB more RAM, and slower first inference after a deploy. The hosting plan must be sized for this.
7. **Classification changes ripple.** Replacing classification removes the evidence sentence from three places:
   - the text embedding input
   - the citizen's report detail screen (`aiClassification` in [routes/reports.ts](../services/api/src/routes/reports.ts), shown by [report_details_screen.dart](../apps/citizen/lib/features/report/screens/report_details_screen.dart))
   - the dashboard's cluster evidence view ([gov-clusters.ts](../services/api/src/routes/gov-clusters.ts) → [ClustersView.tsx](../apps/government/src/ClustersView.tsx), "Classification visual evidence") Severity and priority are unaffected.
8. **Tests.** [ai-clients.test.ts](../services/api/test/ai-clients.test.ts) and [visual-embedding.test.ts](../services/api/test/visual-embedding.test.ts) mock HTTP. A local model needs an injectable embedder so tests stay offline and fast.
9. **Config and docs.** New flags, a model path or cache setting, and updates to `.env.example`, [ai_strategy.md](ai_strategy.md) and [shipping.md](shipping.md). The Vertex credentials could then be removed.

## 6. Proposed migration path (held)

1. Add an embedder interface beside `generateVisualEmbedding`, with a local CLIP/SigLIP implementation behind a new flag. Keep Vertex as is.
2. Create a new table (or column) sized for the new model, with its own HNSW index and `model_name` recorded.
3. Run both models in parallel ("shadow mode"): store both vectors, keep scoring with Vertex, and log what the new model would have decided.
4. Recalibrate the thresholds on the evaluation data and real shadow data. Bump `DUPLICATE_SCORING_VERSION`.
5. Switch the duplicate query to the new vectors, filtered by model. Re-embed the backlog.
6. After a stable period, turn off Vertex and remove its credentials.

Each step can be rolled back by flipping a flag.

## 7. Evaluation plan

We run this offline on a developer machine against local Supabase. It never runs in CI, never uses real citizen photos, and never sends photos to a new service.

**Visual duplicates (main test)**
- Build pairs that are the same problem (several photos of one pothole) and pairs that are different problems.
- Where a dataset doesn't have several views of the same object, make the second view ourselves: random crop, rotation, brightness and blur.
- Metrics: precision and recall at the chosen threshold, plus the score gap between same and different pairs. Run on Vertex and on each open model.

**Classification (if tested)**
- Macro-F1 across the six categories, against dataset labels. Compare CLIP/SigLIP zero-shot with `gpt-6-luna`.

**Running costs**
- Peak RAM, time per photo on our target host, and cold start time.

**Cost**
- Actual cost per 1,000 reports, from the billing pages (see section 9).

**Go / no-go for the visual switch.** All must hold:
- duplicate recall within 5 points of Vertex, at equal or better precision
- the API instance stays within its memory limit under load
- no regression in the API test suite

## 8. Datasets for seeding and testing

These are public datasets we could use to fill a local database and run the evaluation. Licences were checked on 2026-11-23. "Not verified" means the source page couldn't be read or didn't state a licence. Confirm before downloading.

| Dataset | Category | Size | Photo type | Image licence | Fit |
|---|---|---|---|---|---|
| [RDD2022](https://github.com/sekilab/RoadDamageDetector) (road damage) | POTHOLE | 47,420 images, 6 countries (Japan, India, Czech Republic, Norway, USA, China) | Road-level, mostly vehicle cameras; the USA part is Google Street View | **CC BY-SA 4.0** (repo README) | **Good.** Large, permissive, street-level. Not African. Share-alike applies if we redistribute the images. |
| [Kaggle / Roboflow pothole sets](https://universe.roboflow.com/brad-dwyer/pothole-voxrl) | POTHOLE | ~665 images | Street photos | Not verified (page refused automated access) | Small top-up only. Check the licence on each set. |
| [TACO](https://github.com/pedropro/TACO) (litter) | WASTE | ~1,500 images in the original paper; it has grown since | Phone photos in woods, roads, beaches | Not verified. The repo is MIT (code); no image licence is stated. | Usable if the licence is confirmed. It shows litter items, not dumpsites, so it is a partial fit. |
| AlleyFloodNet ([paper](https://www.mdpi.com/2079-9292/14/10/2082)) | FLOODING | Not verified | Ground-level urban flood photos, flooded and not flooded | Search results say CC BY; not verified (page refused automated access) | **Promising.** Ground-level, and aimed at flood-prone low-income areas. |
| [Urban Flood Image Dataset](https://www.hydroshare.org/resource/24866122a6ee456c8f7c80aa87a9abcb/) (HydroShare) | FLOODING | 103.7 MB, count not stated | Camera images; view type not stated | **CC BY 4.0** | Inspect before relying on it. |
| [Chennai streetlights](https://github.com/Team16Project/Street-Light-Dataset/) ([paper](https://arxiv.org/abs/2407.01117)) | STREETLIGHT | 800+ images, Chennai, India | Street photos sorted by working status | Not stated for the data (the paper is CC BY 4.0) | Good fit if the authors confirm a licence. |
| [Bristol streetlights](https://zenodo.org/records/6046759) | STREETLIGHT | ~350k images, Bristol, UK | Cameras on lampposts pointing **up** at the bulb | **CC BY 4.0** | **Poor fit.** Not what a citizen photographs. |
| Water leaks / burst pipes | WATER_LEAK | — | — | — | **Gap.** No suitable public street-photo dataset found. Roboflow has small community sets with unclear licences. Plan to collect our own (staff photos, or consented pilot reports). |

**Nigerian and African coverage.** We found no Nigeria-specific public dataset for these categories. Results on European or Asian roads may not carry over to Nigerian streets. That makes a small Nigerian test set the most valuable addition: about 50 consented photos per category, taken by the team or with pilot partners, held out for final checks only.

**Licence rules for us:**
- Prefer CC BY and CC BY-SA. Avoid NC (non-commercial) licences, such as Mapillary's CC BY-NC-SA, for anything that might ship.
- Keep downloaded data out of the repo. Record the source and licence in the seed script.

## 9. Cost

Published prices, checked 2026-11-23 on [OpenAI API pricing](https://developers.openai.com/api/docs/pricing):

| Model | Input | Output | Notes |
|---|---|---|---|
| `gpt-6-luna` | $0.10 per 1M tokens | $0.50 per 1M tokens | Image inputs are counted as input tokens. The page gives no separate image price. |
| `text-embedding-3-small` | $0.02 per 1M tokens | — | — |
| Vertex `multimodalembedding@001` | not retrieved | — | Pricing page didn't load; check the Vertex AI pricing page or the billing console. |

Cost per report = classification call + severity call + text embedding + visual embedding (one per photo).
- Classification output is capped at 120 tokens and severity at 700 (`max_completion_tokens` in code).
- The largest unknown is how many input tokens a `detail: high` photo costs on `gpt-6-luna`.

**Don't estimate. Measure:** take the real bill for a period and divide by the number of reports processed in it. That figure goes in the decision log.

## 10. Open questions

1. Does the ministry require citizen data to stay in Nigeria, or with approved processors? If yes, that decides the question more than cost does.
2. What host and memory size will production use? Shipping still lists hosting as undecided ([shipping.md](shipping.md)).
3. Will the team accept losing the evidence sentence if classification moves to CLIP?
4. Can pilot partners supply consented Nigerian photos for the held-out test set?

## 11. Decision log

| Date | Decision | Evidence |
|---|---|---|
| 2026-11-23 | Proposed: evaluate CLIP/SigLIP for visual embeddings; keep severity and text embedding hosted; trial zero-shot classification. On hold. | This document |
| — | *(to be filled after the evaluation)* | — |
