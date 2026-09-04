# 2026-09-04 Remove AIHOT source

Status: deployed and verified

- Target: `https://rss.qiaomu.ai`
- Local worktree: `/private/tmp/qmreader-remove-aihot`
- Remote app: `/opt/qiaomu-apps/qmreader`
- Runtime: systemd Node service on `127.0.0.1:3088`
- Scope: removed the AIHOT feeds and all AIHOT-backed UI/API surfaces; backed up and removed their production data without deleting entries owned by other sources.
- Code: commit `107a418` on `codex/remove-aihot`, pushed to `origin/codex/remove-aihot`.
- Backup: `/opt/qiaomu-apps/qmreader/backups/remove-aihot-20260904T010958Z` contains the previous scoped files, cache, and an online SQLite backup.
- Data: soft-deleted 103 active `aihot_selected` entries, deleted 105 AIHOT signal rows, and removed both AIHOT cache keys. Post-change checks report zero active AIHOT entries/signals and SQLite `quick_check=ok`.
- Tests: the 72 unaffected/related tests and the new source-removal regression pass; the regression also passes on the server. The full suite still has one pre-existing 15-second admin API preview timeout, reproduced unchanged on the baseline worktree.
- Production: synced only the scoped files, confirmed local/remote SHA-256 equality, then restarted `qmreader.service`. The service is active with `NRestarts=0`.
- Live checks: home, source API, and versioned assets return 200; AIHOT is absent from the 60-source response; the retired hot-topics endpoint returns 404; the filtered AIHOT entry query returns zero.
- UI checks: desktop and a 390px Chrome render both load the production feed without the former `全网热点` entry or any AIHOT text. Desktop has no horizontal overflow. Umami configuration and unrelated production-only fixes were left unchanged.
