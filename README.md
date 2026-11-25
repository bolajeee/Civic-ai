# CivicAI

**AI-Powered Civic Intelligence & Infrastructure Monitoring Platform**

CivicAI lets citizens report public infrastructure and environmental issues, and turns those reports into structured intelligence for government decision-makers.

The core principle is:
> A citizen report is an observation. An issue cluster represents the underlying civic problem.

**Status: not deployed yet.** Every part below runs locally and in CI, but nothing is in production. The open release gates are listed in [docs/shipping.md](docs/shipping.md).

The citizen app also has **SOS**: it finds emergency facilities nearby and alerts the citizen's trusted contacts by SMS. It is citizen-side only and dispatches no responder. See [docs/sos.md](docs/sos.md).

## System Architecture

- **Citizen app**: Flutter (Android and iOS)
- **Government dashboard**: React + TypeScript + Vite
- **API**: Node.js + TypeScript on **Fastify**
- **Database**: Supabase **Postgres 17** with **PostGIS** (locations, map, radius search) and **pgvector** (report embeddings)
- **Object storage**: Supabase Storage (report photos)
- **AI**: TypeScript background workers that run **inside the API process** (`services/api/src/ai`). They do classification, severity, text and image embeddings, duplicate detection, clustering and priority. Each worker is off by default and is switched on with an `AI_*_ENABLED` flag. There is no separate AI service.

For more detail, read [docs/architecture.md](docs/architecture.md) and [docs/ai_strategy.md](docs/ai_strategy.md).

## Repository Structure

```text
Civic-Ai/
├── apps/
│   ├── citizen/          # Flutter citizen app
│   ├── government/       # React government dashboard (Vite)
│   └── ui_ref_figma/     # UI reference screenshots
├── services/
│   └── api/              # Fastify API
│       ├── src/
│       │   ├── ai/       # AI workers (classification, embeddings, clustering, ...)
│       │   ├── routes/   # HTTP routes
│       │   └── ...
│       ├── scripts/      # Invite, facility import and validation scripts
│       ├── test/
│       └── .env.example
├── supabase/
│   ├── config.toml       # Local Supabase config (Postgres 17)
│   ├── migrations/       # SQL migrations (the database schema)
│   └── seed/             # Emergency facility data for SOS
├── docs/                 # Project documentation
└── .github/workflows/    # CI: API, dashboard and citizen app
```

## Run Locally

### Prerequisites

- Node.js 22 (the version CI uses)
- Docker, running (local Supabase runs in containers)
- Flutter 3.44.0 (the version CI pins), with an Android emulator, iOS simulator or device

All commands start from the repository root. They work in bash and PowerShell.

### 1. Database (local Supabase)

```bash
npm install            # installs the Supabase CLI locally
npx supabase start     # starts Postgres 17 + Storage and applies supabase/migrations
npx supabase status    # prints the local URLs and keys; you need the service_role key next
```

`supabase start` may warn that `supabase/seed.sql` is missing. That warning is harmless.

### 2. API (`services/api`, port 3000)

```bash
cd services/api
npm ci
cp .env.example .env
```

Edit `services/api/.env` and change only these values:

- `SUPABASE_SERVICE_ROLE_KEY`: the `service_role` key that `npx supabase status` printed
- `JWT_SECRET`: any long random string

`DATABASE_URL` and `SUPABASE_URL` already point at local Supabase. Leave the AI, SMS and push settings off for a first run.

```bash
npm run dev            # http://localhost:3000, restarts on changes
npm test               # optional: runs the API test suite
```

Optional: to load the SOS emergency facilities, run this from `services/api`:

```bash
npx tsx scripts/import-facilities.ts ../../supabase/seed/emergency_facilities.csv
```

### 3. Government dashboard (`apps/government`, port 5173)

The dashboard needs no `.env` file. The Vite dev server forwards `/api` to the API on port 3000, so leave the API running.

```bash
cd apps/government
npm ci
npm run dev            # http://localhost:5173
```

Government sign-up needs a one-time invite. To create the first admin, run this from `services/api` (with its `.env` in place):

```bash
node -e "const c=require('crypto');const code=c.randomBytes(24).toString('hex');console.log('code:', code);console.log('hash:', c.createHash('sha256').update(code).digest('hex'))"
node scripts/insert-invite.js <hash>     # inserts a FEDERAL ADMIN invite, valid for 1 day
```

Then open `http://localhost:5173/#register?invite=<code>` and register. Later accounts can be invited from the dashboard's Administration page. For roles, levels and state-scoped invites, see [docs/government-accounts.md](docs/government-accounts.md).

### 4. Citizen app (`apps/citizen`)

```bash
cd apps/citizen
flutter pub get
flutter run
```

You don't need a `.env` file here. By default the app calls the API at `http://10.0.2.2:3000` on an Android emulator and at `http://127.0.0.1:3000` everywhere else. On a physical phone, point it at your computer's LAN IP (the API listens on all interfaces):

```bash
flutter run --dart-define=API_BASE_URL=http://<your-lan-ip>:3000
```

Email and password sign-up works without extra setup. Google and Apple sign-in need more `--dart-define` values (see [docs/citizen-auth.md](docs/citizen-auth.md)), and so do push notifications (see [docs/notifications.md](docs/notifications.md)).

## Documentation

- [Architecture Overview](docs/architecture.md)
- [Project Progress & MVP Scope](docs/progress.md)
- [Production Shipping Checklist](docs/shipping.md)
- [Database Schema & Migrations](docs/database.md)
- [AI Strategy & Pipeline](docs/ai_strategy.md)
- [Citizen Authentication Setup](docs/citizen-auth.md)
- [Government Accounts & Invites](docs/government-accounts.md)
- [Push Notifications](docs/notifications.md)
- [SOS](docs/sos.md)
- [Hardening](docs/hardening.md)
