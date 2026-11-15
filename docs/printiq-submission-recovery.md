# PrintIQ campaign submission recovery

Applies to Type A campaign submissions. Type B orders use their separate flow.

## Deployment

Apply migrations through `044_printiq_submission_modes.sql` with the normal API migration command before accepting new submissions on the updated API:

```bash
docker compose -f infra/docker/docker-compose.yml -f infra/docker/docker-compose.do.yml exec -T api ./flowiq-api migrate
```

Take the normal pre-deployment database backup. Missing progress tables cause submission to fail closed before any PrintIQ call. No production migration or deployment is performed by these code changes.

## What a retry does

The first submission freezes its market plans, artwork URLs, PO, visuals and creator name in the existing `printiq_submission_progress` table. Each PrintIQ call is marked pending before it is sent, then its response is validated and saved. Quote creation, product creation, acceptance and successful uploads are replayed from those records on the next Submit. Successful markets are recorded once transactionally. Completed normal submissions return the saved quote/job result on repeated normal Submit, including for super admins, when inputs match. Revised normal inputs require a separate campaign.

Test Submit retains its previous workflow. Each Test Submit after a successful test starts a fresh PrintIQ quote/job set, and normal Submit after a test creates a separate normal order on the same campaign. Super admins can also test an already submitted campaign. Tests do not mark the campaign submitted. Unfinished tests resume their own saved steps when inputs match, while changed test inputs start a fresh test attempt. Replacing an unfinished test is atomic and retains its old journal for audit. Migration 044 allows one unfinished journal per campaign and mode, so testing cannot discard an unfinished normal order. Normal retries always use the normal journal, even after intervening tests.

Every confirmed unsuccessful step gets one automatic retry after a 30-second backoff, including quote creation, product pricing, proof contact, acceptance and uploads. Read failures and failures occurring before a mutation was sent are also eligible. A later Submit gives each eligible failed step another attempt plus one automatic retry. Attempts retain their payloads, timestamps and failures across process restarts, alongside the step's latest full response. A rejection containing partial quote/product/acceptance identifiers is treated as uncertain. Product-code and pricing failures retain the existing quote. On resume, current mappings can correct the ProductCode and its derived job title for the confirmed failed product operation, matching its complete saved identity including quantity, sheet code and delivery address. Ambiguous matches require reconciliation. Other payload fields and completed products remain frozen. A checkpoint write failure stops subsequent PrintIQ mutations, including later attachments.

Uploads remain sequential, with a one-second delay before each actual upload. Failed attachments do not stop later attachments in that market. Later markets start only after the current market completes. A PostgreSQL advisory lock prevents concurrent submissions for the same campaign across tabs and API instances. Each runner also claims an ownership token while atomically reloading progress. Checkpoint writes require that token, so an older runner whose lock connection disappeared cannot overwrite newer progress or send a subsequent mutation. The browser checks saved progress before submission and reuses the original visuals on resume.

Mutation network errors, HTTP failures, application timeouts and a process dying during a call leave an uncertain/pending step. A database write failure after a response is also treated as uncertain. Before stopping, and again on subsequent Submit, FlowIQ attempts read-only recovery using `GetQuoteDetails` and `GetAcceptanceDetails`. It can recover a created quote when its number survived, a product when all prior product keys and the new product details match, an acceptance when all original product keys map to existing jobs, and an upload when the exact URL and supporting-document flag match on the exact job. Recovered jobs are ordered by the original product creation checkpoints.

An empty or inconclusive lookup never authorizes replay. PrintIQ may still be processing the original request. Lost quote creation responses with no surviving quote number, uncertain proof-contact updates, transformed artwork URLs, and incomplete historical identifiers can require super-admin reconciliation. The inspected PrintIQ Swagger v0 contract provides no idempotency key or lookup of a newly created quote by external reference. Universal automatic retry therefore requires additional PrintIQ guarantees. The former automatic upload-timeout replay has been removed to avoid duplicate attachments.

## Reconcile an uncertain attachment

The Submit/Test progress bar polls `GET /api/campaigns/{campaignId}/submission-progress` once per second while submitting. This tenant-scoped endpoint returns only counts and a display label, and is available to normal campaign users. Each completed PrintIQ call has weight 1; each attachment upload has weight 5. The denominator includes every planned market, delivery job and attachment (including PO and visuals). Preparation uses the first 5%, PrintIQ work uses 90%, and the final 5% completes only when the submit request succeeds. Failed/uncertain calls do not count as completed; saved successful steps count on resume. Percentages indicate completed work, not elapsed time or upload bytes.

Use an authenticated **super admin** session with the intended managed tenant. Both endpoints use normal FlowIQ Bearer authentication and `tenantId` query selection. They do not call PrintIQ or modify another tenant.

1. `GET /api/campaigns/{campaignId}/printiq-progress?tenantId={tenantId}` returns the normal submission ID, step keys, original payloads, states, and reconciliation history. Add `test=true` to inspect an unfinished test instead. Progress polling uses the same mode parameter.
2. Inspect the exact job and attachment in PrintIQ. HTTP status alone is not proof of success.
3. `POST /api/campaigns/{campaignId}/printiq-progress/resolve-upload?tenantId={tenantId}` with:

```json
{
  "submissionId": "ID_FROM_GET",
  "stepKey": "KEY_FROM_GET",
  "action": "confirmed_uploaded",
  "confirmedInPrintIQ": true,
  "note": "Verified the exact PDF on the specified PrintIQ job"
}
```

Use `confirmed_missing` only after checking that PrintIQ did not attach the file; the next Submit retries that upload. `confirmed_uploaded` skips it. The action, operator and note are retained. Reconciliation is rejected while a submission is running. Only unresolved UploadArtworkURL steps can be resolved this way; these endpoints cannot authorize another quote creation or acceptance.

4. Submit again to finish the saved attempt. Resuming keeps the saved original URLs even if the UI generates a new visuals document.

For any uncertain step, use `POST /api/campaigns/{campaignId}/printiq-progress/resolve-step?tenantId={tenantId}` as a super admin. Supply `submissionId`, `stepKey`, `confirmedInPrintIQ: true`, and a verification `note`. Use `action: "confirmed_completed"` with a `response` object containing the verified PrintIQ response and required quote/product/job identifiers. FlowIQ validates the response and its quote number against the saved payload before saving it. Verified pricing responses must include the product quantity key needed for resume and must identify a new product. Verified acceptance responses must include ProductKey and QuantityKey for every job. FlowIQ matches those identifiers to the original checkpoints and restores job order before resuming artwork uploads. Alternatively use `action: "confirmed_missing"` only after verifying the operation is absent and has finished processing, so the next Submit may retry it. Reconciliation retains the operator, action and note, uses the same campaign lock as submission, and revokes write access from a stale runner. Never delete progress to authorize another quote or acceptance.

## Historical failures

Older attempts have abbreviated file logs but no durable full-response checkpoints. Until a campaign has a completed durable submission, new submissions check the retained campaign logs and block a new quote if the latest historical attempt created a quote, failed, or ended during a call. An old superseded journal with no active replacement also blocks new creation. Completed database records supersede old log errors from reconciled attempts. This protection only covers retained records and logs. Historical work outside retention must still be checked manually.

For RSPCA Q51145/Q51146, resolve which existing quote to retain and finish its missing attachments with ADS/PrintIQ before any new submission. The new flow does not automatically import those historical attempts or retry existing production jobs. Do not delete historical logs to bypass this guard.

## Validation

`go test ./...` exercises retry limits across every submission operation, checkpoint replay, restart recovery, changed payload rejection, attachment failure continuation, malformed-response protection, read-only recovery, and general reconciliation against mock PrintIQ servers. Set `FLOWIQ_TEST_DATABASE_URL` to a local test database to also exercise migrations, tenant/role isolation, advisory locks, runner ownership, general reconciliation, repeated Test Submit, switching modes, preservation of unfinished normal progress during testing, and completed normal-result replay through the submit handler in disposable schemas. Never point this variable at production.
