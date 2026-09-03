# Architecture Overview

## Tech Stack Overview

### Citizen Application
- **Framework**: Flutter + Dart
- **Reasoning**: Android-first deployment, single codebase, strong device integration (camera/GPS).

### Government Dashboard
- **Framework**: React + TypeScript + Vite
- **Libraries**: React Router, TanStack Query, Tailwind CSS, mapping & charting libraries.
- **Focus**: Operations interface, not a generic SaaS admin template.

### Backend
- **Framework**: Node.js + TypeScript (Fastify or Express)
- **Database**: PostgreSQL + PostGIS
- **Cache/Queue**: Redis
- **Storage**: S3-compatible Object Storage

### AI Services
- **Framework**: Python + FastAPI
- **Dependencies**: PyTorch, OpenCV, scikit-learn
- **Design Rule**: AI service should not directly own the database truth. It runs asynchronously via background jobs.

## System Boundaries

**CivicAI Owns:**
- Citizen reports & media
- Geographic information
- AI classifications & confidence
- Duplicate detection & issue clustering
- Severity & priority scoring
- Issue lifecycle & government review
- Generated PDF reports

**CivicAI DOES NOT Own:**
- Another agency's internal workflow or database
- Agency-specific case management
- Electronic inter-agency integrations
- Government procurement or physical dispatch

## API Structure

The API should be RESTful and versioned from day one.

**Core Routes:**
- `/api/v1/auth`
- `/api/v1/users`
- `/api/v1/reports`
- `/api/v1/issues`
- `/api/v1/media`
- `/api/v1/analytics`
- `/api/v1/dashboard`
- `/api/v1/government-reports`
- `/api/v1/admin`

## Security Controls

- **Authentication**: JWT/access tokens with refresh-token strategy. Role-Based Access Control (RBAC). Government uses MFA.
- **Data Isolation**: Citizens only access their own reports. Operators access government dataset.
- **Image Security**: MIME/extension validation, signed temporary URLs. Never expose private buckets.
- **Rate Limiting**: Sensible thresholds on `/report`, `/login`, etc.
