# Project Progress (MVP Scope)

We are developing the CivicAI MVP iteratively, building the foundation first.
**Crucial Rule:** We do not start with AI to ensure we have a reliable place to store and use the data first.

## Definition of MVP Success
The MVP is successful if we can demonstrate this complete journey reliably:
Citizen encounters pothole -> Opens Flutter app -> Takes photo -> GPS captured -> Submits report -> Backend stores report -> AI identifies pothole & estimates severity -> System searches existing reports & groups into cluster -> Priority calculated -> Government dashboard updates -> Officer sees cluster on map -> Opens issue & sees supporting reports -> Generates official PDF report -> Printed & manually forwarded -> Issue marked resolved.

---

## Phases

### Phase 1: Foundation (In Progress)
- [x] Repository Architecture
- [ ] Database (PostgreSQL/PostGIS setup, Users table)
- [ ] Authentication (API setup)
- [ ] Object Storage integration
- [ ] Government Authentication

### Phase 2: Citizen Reporting (Pending)
- [ ] Create report API endpoint
- [ ] Camera/Gallery integration (Flutter)
- [ ] GPS capture
- [ ] Description submission
- [ ] Report history retrieval

### Phase 3: AI (Pending)
- [ ] Image classification service
- [ ] Confidence scoring
- [ ] Embeddings generation
- [ ] Duplicate candidates detection
- [ ] Issue clustering logic
- [ ] Severity estimation
- [ ] Priority calculation engine

### Phase 4: Government Dashboard (Pending)
- [ ] Overview Dashboard
- [ ] Map interface (PostGIS layers)
- [ ] Reports view
- [ ] Issue clusters view
- [ ] Filters & Search
- [ ] Review queue

### Phase 5: Government Reporting (Pending)
- [ ] Issue report compilation
- [ ] PDF generation
- [ ] Print optimizations
- [ ] Report versioning
- [ ] Audit trail

### Phase 6: Hardening (Pending)
- [ ] Security audits & least privilege
- [ ] Rate limiting
- [ ] Error handling
- [ ] Offline handling (Flutter sync queue)
- [ ] Monitoring & Observability
- [ ] Automated Testing
