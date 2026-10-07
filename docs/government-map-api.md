# Government map API

`GET /api/gov/dashboard/map` requires a bearer JWT and a currently active
OPERATOR or ADMIN account. It uses the same database access guard as the overview.
Responses use `Cache-Control: no-store`. Invalid filters return `400`, invalid
tokens `401`, revoked access `403`, and database failures a sanitized `500`.

| Query | Contract |
| --- | --- |
| `bbox` | Required `west,south,east,north`, in longitude/latitude degrees; finite coordinates within ±180/±90, west < east, south < north. Split antimeridian views into separate requests. |
| `layer` | `all` (default), `reports`, or `clusters` |
| `status` | Optional `PENDING`, `IN_PROGRESS`, `RESOLVED`, or `REJECTED`; applies to each entity's own status |
| `category` | Optional exact category slug returned by the API, e.g. `POTHOLE`; case is preserved |
| `limit` | Integer 1–500, default 250 **per layer** |

Unknown query fields are rejected. Values are bound SQL parameters.

The response contains `generatedAt`, the requested `bbox`, `limit`, all selectable
`categories` (`slug`, `label`), and `reports`/`clusters` GeoJSON FeatureCollections.
Each collection also contains:

- `total`: number of matching mapped entities in the requested viewport, before the cap.
- `withoutGeometry`: matching entities without mappable coordinates **across all areas**,
  because those entities cannot be assigned to a viewport. Unselected layers return zero.
- `features`: newest-first points, capped independently per layer, with UUID tie-breakers.
  An unselected layer returns an empty collection.

Features have `type: "Feature"`, the entity UUID as `id`, and a Point `geometry`
with `[longitude, latitude]` coordinates. Shared properties are `kind`
(`report`/`cluster`), `publicId`, `status`, `category` (label), and `categorySlug`.
Report properties also contain `submittedAt`, nullable `address`, nullable GPS
`accuracy` in metres, and nullable `clusterPublicId`. Cluster properties contain
`reportCount` and `createdAt`.

Report points come from `locations.geom`. Cluster points come from the stored
centroid of available supporting observations; they are not hazard boundaries or
the fixed clustering anchor. Empty clusters retained for audit are excluded.
This endpoint exposes no citizen identifiers, contact information, photos,
severity estimates, or priority scores.

One PostgreSQL statement supplies the layers and metadata from the same snapshot.
Viewport predicates use the existing GiST indexes and
[PostGIS envelopes](https://postgis.net/docs/ST_MakeEnvelope.html). No migration
beyond `20261005120000_create_issue_clusters.sql` or AI worker/model key is required.

## Validation

From `services/api`, run `npm run validate:government` with the configured
`DATABASE_URL`. The script requires an existing active government account.
It checks real overview/map handlers against PostgreSQL/PostGIS, then uses
session-local temporary fixture tables to check boundaries, ordering, limits,
missing coordinates, empty clusters, memberships, and empty viewports. Fixtures
are rolled back; public data is not changed and no AI workers run.

The script signs a short-lived JWT with an isolated local test key to verify
database account authorization. It does **not** verify the account password or
browser sign-in. Validate that separately with a provisioned account's credentials.
