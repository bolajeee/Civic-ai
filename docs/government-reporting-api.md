# Government issue report compilation

`GET /api/gov/issue-clusters/:id/compilation` returns a read-only compilation of
the cluster's current membership. It requires an active `ADMIN` or `OPERATOR`
government account and sends `Cache-Control: no-store`.

The response includes the cluster reference, category, status and centroid;
observation dates; lifecycle, GPS and description coverage; conservative findings
linked to their supporting `CR-` references; each supplied source description as a
separately cited observation; a source register; and a reviewable evidence appendix.
The appendix keeps citizen observations, grouping methods, media counts, AI category
suggestions and AI severity suggestions distinct. The dashboard's supporting-evidence
section remains the place to inspect the original photos through renewable links.
Citizen identity and private storage keys are not included.

`disagreements` currently identifies unresolved grouping proposals, accepted AI
category suggestions that differ from the cluster category, and differing accepted
severity assessments. `uncertainties` separately identifies missing GPS,
description or media and incomplete/review-required AI processing. Missing evidence
is not treated as agreement.

`review.status` is derived on every request:

- `BLOCKED`: an unresolved grouping proposal or accepted category mismatch exists.
- `NEEDS_REVIEW`: another disagreement or evidence uncertainty remains.
- `READY_FOR_REVIEW`: the compilation checks found neither.

This status is a readiness signal, not an administrator approval.

This endpoint does not create an official record. `liveDraft: true` means that a
membership or source-report change will affect the next compilation. Review
formal approval, immutable evidence snapshots, report versions, PDF export and
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
