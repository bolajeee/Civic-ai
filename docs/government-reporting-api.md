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

## PDF export

`GET /api/gov/issue-clusters/:id/report.pdf` applies the same authentication and
current-account checks, recompiles the live report, and returns
`application/pdf` with an attachment filename based on the cluster reference.
The multi-page A4 document contains the draft warning, review status, cited
findings, disagreements, uncertainties, evidence appendix and page numbers.

The PDF contains evidence metadata and source references but does not embed the
original image bytes. Original photos remain available in the authenticated
supporting-evidence view. The live PDF is generated on demand and does not by
itself create a stored version.

## Printing

The dashboard's **Print** action uses a focused A4 layout containing only the
compiled brief. Dashboard controls and version history are omitted, report and
evidence cards avoid page breaks where possible, and the source register is
expanded. Generated PDFs repeat the cluster (and version, when applicable) in a
page header and include the cluster reference with `Page n of total` in the
footer.

## Immutable versions

`GET /api/gov/issue-clusters/:id/report-versions` lists version metadata newest
first without returning stored snapshots. `POST` to the same path compiles the
current live report and stores it as the next numbered immutable snapshot. Both
active `ADMIN` and `OPERATOR` government accounts may create versions.

`GET /api/gov/issue-clusters/:id/report-versions/:version/report.pdf` reproduces
a PDF from the stored snapshot even if cluster membership or source reports have
subsequently changed. The database serializes per-cluster number allocation and
rejects updates or deletions of version rows.

Version creation records who created the snapshot and when, but does not record
formal approval. Approval details and preservation of a specifically reviewed
and approved snapshot remain a separate milestone.

The live endpoints do not create an official record. `liveDraft: true` means that
a membership or source-report change will affect the next compilation. A saved
version freezes that compilation and remains explicitly unapproved until the
separate formal-approval workflow is implemented.

Validation:

```powershell
cd services/api
npm test
npm run build

cd ../../apps/government
npm test
npm run build
```
