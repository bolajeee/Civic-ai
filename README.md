# CivicAI

**AI-Powered Civic Intelligence & Infrastructure Monitoring Platform**

CivicAI is a platform that allows citizens to report public infrastructure and environmental issues while transforming those reports into structured intelligence for government decision-makers.

The core principle is:
> A citizen report is an observation. An issue cluster represents the underlying civic problem.

## System Architecture

CivicAI uses a centralized architecture composed of:
- **Citizen Client**: Flutter
- **Government Client**: React + TypeScript + Vite
- **Backend API**: TypeScript + Node.js (Fastify/Express)
- **Primary Database**: PostgreSQL + PostGIS
- **AI Layer**: Python-based AI services (FastAPI)
- **Object Storage**: S3-compatible storage

For a detailed view, read the [Architecture Documentation](docs/architecture.md).

## Repository Structure

This repository uses a monorepo structure with explicit boundaries:

```text
civicai/
├── apps/
│   ├── citizen/       # Flutter mobile application
│   └── government/    # React admin dashboard
├── services/
│   ├── api/           # Node.js backend API
│   └── ai/            # Python AI services
├── packages/
│   ├── shared-types/  # Shared TypeScript interfaces
│   ├── validation/    # Shared validation logic (Zod)
│   └── config/        # Shared configuration
├── infrastructure/
│   ├── docker/        # Containerization configurations
│   ├── database/      # SQL migrations
│   └── deployment/    # Deployment scripts
└── docs/              # Project documentation
```

## Documentation

- [Architecture Overview](docs/architecture.md)
- [Project Progress & MVP Scope](docs/progress.md)
- [Database Schema & Migrations](docs/database.md)
- [AI Strategy & Pipeline](docs/ai_strategy.md)
