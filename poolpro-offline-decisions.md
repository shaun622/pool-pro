# PoolPro offline v1: final locked decisions

> ## ⚠️ UPDATE — 2026-07-18: automatic sending now supersedes the "manual tap" model
>
> The manual model below failed in the field. Two things broke it: (1) the send had **no network timeout**, so on a pool's dead-but-up uplink the upload hung indefinitely and the button sat on "Submitting…" forever; and (2) the crew reacted the worst possible way — **refreshing** (which cancelled the in-flight upload) or **re-entering the whole visit** (creating duplicates). The operator's explicit direction: the crew cannot be relied on to wait, retry, or avoid refreshing, so the app must **send by itself, forever**.
>
> What changed (see `src/lib/outboxProcessor.js`):
> - **Automatic background sender.** A module-level singleton, started by `OutboxSyncProvider` mounted **above** the router (so it's never torn down by navigation), drains the outbox on app load, `online`, foreground/visibility, a new draft, and a **backoff timer** (10s → 5m cap), retrying forever until each visit is confirmed. This **reverses Decision 5 ("no background sync")** and **Decision 6 ("human tap is the trigger")** — deliberately, at the operator's request.
> - **Retry bookkeeping is now kept** (`attemptCount`, `nextAttemptAt`, `lastError` on the draft) to drive the backoff. This **reverses the "no retry counters" part of Decision 1.** The continue-on-failure + single-summary spirit of Decision 1 otherwise stands.
> - **Network timeouts** (`SEND_TIMEOUT_MS`, `AbortController`) wrap every upload/RPC so a dead link fails fast and retries, instead of hanging. Decision 6's insight — never *trust* `navigator.onLine` — still holds: we never gate on it; we always attempt, with a timeout.
> - **"Complete Service" is instant** — it saves the durable draft and hands off to the sender; it never blocks on the network. The pending strip is now a **calm auto-status** ("saved — sending automatically"), and a re-entry guard steers a tech away from re-doing a visit that's already saved.
>
> **What did NOT change (still load-bearing):** draft durability is still #1; the same-path model (Decision 3), sequential sends (Decision 4), org binding + server authz (Decision 7), deterministic upsert photo path before the RPC (Decision 2), conflict-clears-the-draft and delete-only-after-success (the "two points"), and `report_sent_at` email idempotency all still hold — they are exactly what makes automatic retry safe from duplicates. The **one invariant** the auto-sender must never break: a retry always reuses the existing `serviceRecordId`; it must never mint a new one.
>
> The original v1 decisions are preserved below for history.

---

Both implementation plans, and a round of review on top, converged on the same direction: manual draft and submit, no background sync, draft durability as the top property. They diverged on a handful of points, and a few details drifted in ways that quietly reintroduce the complexity we cut. This document resolves all of it, with the reasoning for each decision so it survives into the build. Each decision states the alternative that was considered and why it loses.

This is the final set. Last call for technical pushback on any single decision. Otherwise this is what we build.

## Decisions

### 1. Partial failure: continue through the rest, summarise once, no retry counters

When Submit runs through several pending drafts and one fails, keep going and attempt the remaining drafts. Show a single summary at the end ("2 sent, 1 still pending"), not an error toast per draft. Do not store `attemptCount`, `lastAttemptAt`, or any retry state on the draft.

Two approaches were on the table. Stopping the whole run on the first failure has a fatal trap for a failsafe design: one genuinely bad draft (a corrupt photo, a malformed payload) sitting first in line fails on every run and permanently blocks every draft behind it, so the jobs after it can never go up. That is the worst outcome here, work that cannot be submitted at all. Continue-on-failure avoids that, but it was paired with per-draft error toasts (noise during a real outage) and retry bookkeeping, which is exactly the operation state machine we deliberately removed. So take continue-on-failure for the safety, and drop the counters and the per-draft toasts. A draft that keeps failing every run simply shows as "1 still pending" indefinitely. That is the visible, diagnosable failure we want: the office sees one job that never sends and someone looks at it, instead of a silent jam.

### 2. Upload the photo before the RPC, to a deterministic path

For each draft, upload the photo blob to a deterministic path (`service-photos/<serviceRecordId>/<clientPhotoId>.jpg`) first, then call the RPC, which records the `service_photos` row inside the transaction. If the upload fails, do not call the RPC for that draft. Leave the draft intact.

The two plans ordered this oppositely. Uploading first means a failed upload never reaches the database, so there is nothing half-written and nothing to clean up. Calling the RPC first inserts the photo row inside the transaction and uploads the blob afterward, which leaves a window where the database holds a photo row pointing at a storage object that does not exist yet: a dead image link until a later retry fills it. The deterministic path makes a repeated upload overwrite the same object rather than create duplicates, so re-running Submit is safe. The only residue a mid-step failure can leave is one harmless storage object that the next retry overwrites, which is far better than a dangling database row.

### 3. Online and offline use the same path

Every completion writes a draft and submits it. Online, it submits immediately on the same tap and deletes the draft on success. Offline, the draft persists and goes up on the next Submit tap. One mechanism. The only difference is when the submitting tap happens.

The alternative was to have online completes bypass drafts and write direct, for a slightly snappier feel. The problem with a bypass is that the draft-and-submit machinery then only ever runs in a dead zone, which is the one place it is hard to test and the one place a bug is expensive. Routing every job, including online ones, through the same path means that machinery is exercised constantly, so the offline case is not a separate branch that was never really run. The cost is a sub-millisecond local write that is immediately deleted online, which is nothing. It also keeps the model honest: the tap is always the trigger, and offline the submitting tap just comes later.

### 4. Sequential, never parallel

Process pending drafts one at a time. Parallel submission buys nothing here (a tech has at most a handful of drafts) and adds server-side surprises and harder error handling. Sequential keeps the failure handling in decision 1 simple and predictable.

### 5. Name it "Pending", not "Sync"

Use PendingDrafts naming for the hook and the UI component: a pending count and a Submit action. Avoid "sync" or "SyncStatus" naming. Naming sets the mental model. "Sync" implies something happens automatically in the background, which is the exact thing we are not building and do not want a future contributor to assume exists. "Pending" makes it clear there is unsent work waiting for a deliberate action.

### 6. Submit is always visible when drafts exist, and is never gated on `navigator.onLine`

The Pending control shows whenever drafts exist. Tapping it while offline says "still offline." Its visibility is never tied to `navigator.onLine`. That flag reports online when the connection is technically up but actually dead, so anything keyed to it will sometimes show when sending will not work and hide when it would. The human tap is the trigger; the device's idea of connectivity is not trusted. This was in the first brief and is restated here because both plans left it implicit.

### 7. Bind drafts to the org, and enforce it on the server

A draft carries the `businessId` it was created under. At submit, the client refuses to send a draft whose `businessId` does not match the current session's business. This is backed by the RPC's server-side authz check (the payload's businessId must equal the caller's current business, or it raises), which is the guarantee that cannot be bypassed.

The app is multi-tenant: one business creates an org and invites others in. A submit that landed on the wrong org would put one business's service data inside another's, which is a data breach, not a quirk. So a draft reaching the wrong org is the failure that cannot happen, and it gets two layers. The decisive layer is the server. The RPC runs under the caller's own Supabase session, so a stale or tampered draft cannot talk its way past the businessId check the way a client-side guard theoretically could. The client-side check is the second layer, and its job is to make the failure visible and clean (refuse the draft, say "this draft belongs to another organisation") rather than fire a request that the server then rejects with a confusing error. Bind on business only, not staff: each tech has their own login on their own phone, so the shared-phone, wrong-tech case does not exist, and same-org is the property that matters.

The case this protects against, concretely: a tech in org A completes a job offline, so the draft is stamped with org A. Before they reconnect, their account is moved to org B, or they belong to two orgs and switch context. Now the session is org B and the draft is org A. The client check catches the mismatch and refuses to submit. If it somehow did not, the RPC's businessId check refuses it on the server. The draft stays put, correctly unsent, rather than landing in the wrong org.

## Two points to get exactly right

These are consequences of decisions already made, called out because they are the spots a future change tends to break. Both reviewers flagged them.

- A conflict result from the RPC clears the draft, exactly like a fresh success. The dangerous sequence is: the photo uploads, the RPC commits, the response is lost, the draft stays. The tech taps Submit again, the RPC returns conflict because it already ran. If that conflict is treated as an error and the draft is kept, the draft can never clear and sits pending forever. Conflict deletes the draft.
- Delete the draft only after both the photo upload and the RPC have returned success or conflict, never after just one. On a retry the photo is already at its deterministic path, so re-uploading simply overwrites the same object and is safe.

## Already settled (carry forward, not reopened)

These were agreed across both plans and stand:

- The RPC mirrors the current completion sequence exactly in one transaction. Authz check first (payload businessId must equal the caller's current business). Idempotent on the client-generated id. It catches `unique_violation` for both the replay case (PK conflict) and the office-won case (occurrence identity unique index) and returns a conflict result for both, treated as success by the client. It never aborts on 23505.
- The RPC never writes `next_due_at`. `recomputePoolNextDue` runs client-side after a successful submit. The single-writer guard stays green.
- Occurrence identity (`recurring_profile_id`, `occurrence_date`) is captured from the cached route snapshot at draft creation, never re-resolved with a live query.
- `is_one_off` is honoured, and `completed_visits` is bumped only when `recurring_profile_id` is set.
- Draft durability is the number one property: IndexedDB plus `navigator.storage.persist()`, a quota check before storing a photo, and a deliberate test of phone lock, app kill, phone restart, and opening the next day.
- Edge functions `complete-service` and `unable-service` are made idempotent on `report_sent_at`, so a lost-response replay cannot double-email the customer.
- `service_photos.client_photo_id` is unique, and that column exists before Submit relies on it.
- Single photo per service for v1.
- A loud, persistent pending indicator, and a warning before logout when drafts exist.

## The ask

This is the final locked set. If any single decision is wrong on a technical ground, flag it now with the reason. Otherwise build it, in the order set before: boot and read offline first, then the RPC, then drafts and submit.
