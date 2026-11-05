# Government Reports view API

`GET /api/gov/reports/` and `GET /api/gov/reports/:id` require a valid bearer
JWT and a currently ACTIVE OPERATOR or ADMIN account, checked against `users` on
every request. Responses use `Cache-Control: no-store`. Invalid input returns
`400`, invalid tokens `401`, revoked access `403`, unknown report UUIDs `404`, and
database failures a sanitized `500`.

## List and filters

| Query | Meaning |
| --- | --- |
| `page` | Integer 1–1,000,000, default 1 |
| `limit` | Integer 1–100, default 20 |
| `q` | Trimmed literal substring, maximum 200 characters, case insensitive; searches report reference, description, address, category label and assigned cluster reference. `%` and `_` are literal characters. |
| `status` | Optional `PENDING`, `IN_PROGRESS`, `RESOLVED`, or `REJECTED`; the original report's status |
| `category` | Optional exact category slug, e.g. `POTHOLE` |
| `grouping` | `all` (default), `assigned`, or `unassigned` |
| `location` | `all` (default), `present`, or `missing`; whether the report has a saved GPS location |
| `from`, `to` | Optional ISO calendar dates (`YYYY-MM-DD`), inclusive in Africa/Lagos (WAT). From must be on or before To. |

Unknown fields, including citizen identity overrides, are rejected. SQL parameters
are bound. All filters search the full dataset before pagination.

The response has `generatedAt`, `page`, `limit`, numeric `total`, all selectable
`categories` (`slug`, `label`), and `reports`. Total is the matching count before
pagination. Reports are newest first by `submittedAt`, then UUID descending.
An empty or out-of-range page returns `reports: []`, with the matching total intact.
Each response uses one database snapshot; concurrent changes can affect subsequent
pages, so this is offset pagination rather than a persisted export snapshot.

Every list report includes:

- `id`, `publicId`, nullable `description`, `status`, `submittedAt`, `updatedAt`.
- `category`: `{ slug, label }`, the citizen-selected category.
- `location`: null or `{ latitude, longitude, accuracy, address }`. Accuracy and
  address may be null; accuracy is in metres.
- `cluster`: null or `{ id, publicId, status }`. Cluster and report statuses are separate.
- Numeric `photoCount`. The list does not sign photos or depend on object-storage availability.

## Individual report and photos

The detail endpoint takes a report UUID and fetches the report independently of
the loaded list. It returns `{ report, photosExpireInSeconds: 900 }`. Report
fields match the list, with `photos` replacing `photoCount`. Photos are ordered
by `displayOrder`, then media UUID, and contain `id`, `mediaType`, `displayOrder`,
and nullable `url`.

Signed photo links expire after 15 minutes. Reload the detail endpoint to renew
links. Batch-signing failure or a missing object produces a null URL for the
affected photo; report metadata remains available. Internal storage keys are
never returned. The web view also handles failed image downloads and displays an
unavailable-photo message with a refresh remedy.

These endpoints expose no structured citizen identity, NIN, email, phone,
classification/severity prediction, or inferred event history. Descriptions and
photos remain original citizen observations; the view does not invent a combined
cluster summary or offer status/review mutations.

## Setup and validation

Uses the existing reports, media, and issue-clustering migrations through
`20261005120000_create_issue_clusters.sql`. No additional migration, AI worker,
or model key is required. Photo signing uses the API's existing Supabase reports
bucket and service configuration.

From `services/api`:

```sh
npm run build
npm test
npm run validate:government
npm run validate:government -- --storage
```

The live script checks the configured database using an existing active government
account and an isolated local test JWT. It uses session-local temporary tables
and rolls them back to test pagination beyond 20 rows, equal-timestamp ordering,
literal search, WAT day boundaries, all filters, missing GPS, empty results, report
details, and media metadata. Photo signing is stubbed for fixture data. The
`--storage` option signs and retrieves an existing report photo when one exists.
No public rows are changed and no AI workers run. This does not validate the
account's password-based browser login.

Validation completed: both builds, 106 API tests, 10 web tests, live database
queries/temporary fixtures, and signing/retrieval of an existing stored photo.
Chrome checks with intercepted test responses passed for pagination, filters and
reset, date validation, detail focus, photo fallback, escaped descriptions,
refresh errors, late-response protection, empty states, responsive overflow,
and sign-out.
