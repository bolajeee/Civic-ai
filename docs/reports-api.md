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

## Severity analysis on citizen reports

`POST /api/reports` adds `report.aiSeverityStatus`: `disabled`, `pending`, or
`skipped`. Analysis is asynchronous; a successful submission does not wait for a
model call. `GET /api/reports` adds `aiSeverity` on each owner-scoped report:

```json
{
  "aiSeverity": {
    "status": "completed",
    "model": "gpt-6-luna",
    "modelVersion": "returned-model-version",
    "estimate": {
      "level": "HIGH",
      "suggestedLevel": "HIGH",
      "score": 0.75,
      "confidence": 0.9,
      "visualEvidence": "A large section of the road is damaged.",
      "descriptionEvidence": "The citizen reports partial blockage; this is unverified.",
      "geographicContext": "No location was supplied.",
      "uncertainty": "Depth and scale cannot be measured from this photo.",
      "reviewRequired": false,
      "threshold": 0.65,
      "rubricVersion": "civic-severity-v1",
      "modelVersion": "returned-model-version"
    }
  }
}
```

`aiSeverity` is null when disabled or no job exists. Job status is one of
`pending`, `processing`, `completed`, `failed`, `skipped`. `estimate` is null
unless completed. Accepted `level` is LOW, MODERATE, HIGH, CRITICAL or null;
`suggestedLevel` additionally allows UNSURE. UNSURE or low confidence preserves
evidence but sets accepted level/score to null and `reviewRequired` to true.
CRITICAL also requires review. The score is an ordinal severity input, not
priority, and confidence is an uncalibrated model assessment. Citizen report
status and category remain unchanged. Failed/skipped analyses must never be
displayed as low severity. Flutter currently ignores these additive fields.
