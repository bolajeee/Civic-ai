# Government issue report compilation

`GET /api/gov/issue-clusters/:id/compilation` returns a read-only compilation of
the cluster's current membership. It requires an active `ADMIN` or `OPERATOR`
government account and sends `Cache-Control: no-store`.

The response includes the cluster reference, category, status and centroid;
observation dates; lifecycle, GPS and description coverage; conservative findings
linked to their supporting `CR-` references; each supplied source description as a
separately cited observation; and a source register. Citizen identity, private
storage keys and media URLs are not included.

This endpoint does not create an official record. `liveDraft: true` means that a
membership or source-report change will affect the next compilation. Review
status, approval, immutable evidence snapshots, report versions, PDF export and
print layout remain later reporting milestones.

Validation:

```powershell
cd services/api
npm test
npm run build

cd ../../apps/government
npm test
npm run build
```
