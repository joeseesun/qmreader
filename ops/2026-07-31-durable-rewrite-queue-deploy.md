# 2026-07-31 durable rewrite queue deploy

Status: completed and verified in production.

## Incident

- The production AI worker remained alive without completing work for more than six hours.
- RSS fetch workers continued updating entries, while rewrite work from twelve sources accumulated behind the single in-memory worker flag.
- The old queue retained source IDs rather than changed entry IDs and later selected only the latest three entries per ordinary source or ten Hacker News entries, so a long backlog could permanently omit older changed entries.
- Product Hunt official-site fetches returned 403 and repeatedly consumed the shared batch before being skipped.

## Design

- Persist one SQLite job per `entry_id + content_hash`.
- Claim jobs with a renewable lease and recover expired leases after process or service failure.
- Run exactly one article per child process; a parent watchdog terminates a child that reports no completion within the configured deadline.
- Retry temporary failures with bounded exponential backoff and preserve terminal failure/skip reasons.
- Enqueue exact changed entry IDs from fetch results instead of collapsing them to source IDs.
- Reconcile recent missing or stale rewrites at startup.
- Expose sanitized public queue health and an authenticated admin job-detail endpoint.
- Apply a cooldown after failed original-page fetches so recurring freshness sweeps do not repeatedly request the same blocked page.

## Local verification

- `node --check server.js lib/store.js lib/background-jobs.js scripts/refresh-worker.js`
- `npm test`: 73 tests passed.
- Fault injection with a dummy provider credential and a 1-second test watchdog:
  - worker was terminated after the deadline;
  - the active lease was released;
  - the job moved to `retry` with `running=0` and a future `nextAvailableAt`;
  - the public queue state exposed no credential or full error payload.

## Production plan

- Back up the SQLite database, cache, and four changed runtime files.
- Sync only `server.js`, `lib/store.js`, `lib/background-jobs.js`, and `scripts/refresh-worker.js`.
- Run syntax and test checks on the VPS before restart.
- Restart `qmreader.service` once and verify systemd, private HTTP, and public HTTPS.
- Confirm the startup reconciliation enqueues recent missing rewrites and that queue counters make forward progress.
- Verify a watchdog/retry event is not required for normal completion, and inspect journal output for database, worker, or DeepSeek errors.

## Production result

- Rollback backup: `/opt/qiaomu-backups/qmreader/rewrite-queue-20260730T165228Z`.
- Backup contains an online SQLite snapshot, cache/state/insights data, the four pre-deploy runtime files, and `SHA256SUMS`; backup SQLite `PRAGMA quick_check` returned `ok`.
- Local and deployed SHA-256 values matched for all four runtime files before restart.
- VPS Node 22 verification passed: four syntax checks and 76/76 production-tree tests. A timing-sensitive test was corrected to use a deterministic future clock and then passed both alone and in the full suite.
- The first deployment exposed synchronous startup reconciliation. It was changed to a yielding async scan; the second restart reduced API readiness from about 50 seconds to 10.4 seconds. The remaining delay is the pre-existing synchronous cache-to-SQLite startup sync in `lib/fetcher.js`, which was intentionally not overwritten because production contains an independent James Clear freshness fix.
- Startup reconciliation persisted about 200 recent missing/stale jobs across the two controlled restarts. The queue made continuous progress with zero terminal failures during verification.
- A lease orphaned by the controlled restart expired and was recovered automatically; `running` returned to zero before the next item was claimed, proving the recovery path on the live database.
- Nine real `deepseek-v4-flash` rewrite rows were saved after deployment, including previously missing Hacker News articles. Skipped jobs retained explicit reasons rather than blocking later work.
- Final service state: `qmreader.service` active, `NRestarts=0`, loopback API healthy, public homepage and `/api/sources` HTTPS 200, 61 sources returned, SQLite `PRAGMA quick_check` `ok`, and no watchdog, SQLite-lock, unhandled, or fatal errors in the deployment journal window.
- The independent Umami script check timed out once; RSS HTML/API remained healthy and this reliability-only deployment did not change analytics, UI, SEO/GEO, PWA, reward/follow, or social-link surfaces.

## Rollback

- Stop the service, restore the four runtime files and the pre-deploy SQLite/cache backups, then start the service.
- The new `rewrite_jobs` table is additive and may remain without affecting the old runtime, but the database backup is retained for a complete rollback.
