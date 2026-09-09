# Startup and Development Guide

This guide covers the necessary steps to set up, install dependencies, and run the Civic-Ai project locally. This document will be updated as the project evolves and new dependencies or services are added.

## 1. Prerequisites

Before starting, ensure you have the following installed on your machine:
- [Node.js](https://nodejs.org/) (v20+ recommended)
- [npm](https://www.npmjs.com/) (comes with Node.js)
- [Docker](https://www.docker.com/) (Required for local Supabase development)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) 

## 2. Dependency Installation

### API Service
The API is located in the `services/api` directory.
```bash
cd services/api
npm install
```

## 3. Database & Local Supabase Setup

The project uses Supabase for the database, authentication, and other backend services. You should run Supabase locally during development.

1. Make sure Docker is running on your machine.
2. Navigate to the root directory of the project.
3. Start the local Supabase instance:
```bash
supabase start
```
This will start the local database and output your local credentials and API URLs (e.g., `http://localhost:54321`).

4. To stop the local Supabase instance without resetting data:
```bash
supabase stop
```

## 4. Running the Project locally

### Starting the API Service
You can run the API locally using the development script.
```bash
cd services/api
npm run dev
```
The API will start and watch for file changes using `tsx`.
