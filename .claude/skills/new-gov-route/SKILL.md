---
name: new-gov-route
description: Use when adding or changing a government API endpoint (/api/gov/*) in services/api. Enforces auth, DB-checked role, state scoping, audited mutations, zod validation and mocked-pool tests.
---

# New government route

Government accounts are STATE or FEDERAL. A STATE operator must never see or change another state's reports or clusters, including by guessing an id. Most mistakes here are access bugs, not crashes.

## 1. Find the right file
Routes live in `services/api/src/routes/gov-*.ts` and are registered with a prefix in `src/index.ts`. Add to an existing file when the resource matches; a new file needs a `fastify.register(..., { prefix: '/api/gov/...' })` line.

## 2. Guard every handler
```ts
const access = [app.authenticate, governmentAccess(app)];       // operators + admins
const admin  = [app.authenticate, governmentAdminAccess(app)];  // admins only
app.get('/:id', { preHandler: access }, async (request, reply) => { ... });
```
`governmentAccess` re-reads role, status and scope from the `users` table (JWT claims may be stale) and sets `request.govAccount`. Never trust `request.user.role` for authorization.

## 3. Apply state scoping (`src/lib/gov-scope.ts`)
- **List/aggregate queries:** bind `scopeParams(request.govAccount!)` and add
  `AND ($N::text = 'FEDERAL' OR l.state_id = $N+1::uuid)` against the row's resolved location.
- **Endpoints taking a cluster or report id:** check `clusterInScope(gov, id)` / `reportInScope(gov, id)` first. Out of scope returns **404, not 403**, so the response doesn't reveal that the id exists.
- Actions involving two clusters (merge, move) check scope on **both**.
- FEDERAL also sees rows with no resolved location; STATE does not.

## 4. Validate input
zod at the top of each handler: `.strict()` objects for query/body (unknown keys → 400), `z.uuid()` for ids, bounded `limit`/`page`, `z.enum` for statuses. Return `400` with `parsed.error.flatten()` details for filter errors.

## 5. Queries and responses
- Parameterized SQL only, through `query` from `src/db.ts`. Never interpolate request values.
- Gov responses exclude citizen identity (`citizen_id`, email, NIN) and raw `storage_key`s. Sign photo URLs instead (see `gov-reports.ts`).
- Read endpoints with sensitive data set `Cache-Control: no-store`.
- Wrap the handler body in try/catch → `app.log.error(error)` and a generic 500.

## 6. Mutations
- Run in a transaction (`pool.connect()`, `BEGIN`/`COMMIT`/`ROLLBACK`, `release()` in `finally`). Cluster changes also take the clustering advisory lock (see `transact()` in `gov-cluster-actions.ts`).
- Record every operator action in the same transaction (e.g. `issue_cluster_review_actions` with actor, reason, details). Require a `reason` for destructive actions.
- AI output is never silently overwritten: operator changes are explicit, audited actions.

## 7. Tests (`services/api/test/gov-*.test.ts`)
Follow `test/gov-reports.test.ts`: register `@fastify/jwt`, the `authenticate` plugin and the route on a bare Fastify app; mock `pool.query` with `mock.method`. Cover at least:
1. 401 without or with an invalid token, **with zero DB queries**.
2. 403 when the DB says the user is a CITIZEN, suspended, or missing, even if the JWT says ADMIN.
3. 400 for invalid params and unknown keys.
4. A STATE account gets 404 for another state's id, and list SQL binds `'STATE', <stateId>`.
5. The happy path asserts the exact bound params and that citizen identifiers aren't selected.

Run `npm test` and `npm run build` in `services/api`. Update the matching `docs/government-*-api.md`.
