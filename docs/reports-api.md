# Citizen report summary

`GET /api/reports/summary`

Requires `Authorization: Bearer <accessToken>` using the existing citizen login
access token. No request body or query parameters are required.

Successful response (`200 OK`):

```json
{
  "total": 42,
  "pending": 10,
  "inProgress": 15,
  "resolved": 17,
  "rejected": 0
}
```

All fields are non-negative integer JSON numbers and are always present. A citizen
with no reports receives zero for every field. `total` includes every status,
including `REJECTED`, and equals the sum of the four status counts.

Counts come directly from all reports whose `citizen_id` matches the verified
JWT's `id`. They are independent of report-history pagination. Query parameters
(including `limit`, `offset`, status filters, or a supplied citizen ID) do not
change the summary or its owner.

Errors follow the existing report API conventions:

- Missing, expired, or invalid access token: `401 { "error": "Unauthorized" }`.
- Database/server failure: `500 { "error": "Internal Server Error" }`.

Home/Profile statistics should consume this endpoint separately from the paginated
`GET /api/reports` history. Flutter uses `ReportSummaryProvider` for both screens,
refreshes after submission and on pull-to-refresh, and clears counts on account changes.
