# 2026-09-04 Remove AIHOT source

Status: in progress

- Target: `https://rss.qiaomu.ai`
- Local worktree: `/private/tmp/qmreader-remove-aihot`
- Remote app: `/opt/qiaomu-apps/qmreader`
- Runtime: systemd Node service on `127.0.0.1:3088`
- Scope: remove the AIHOT feeds and all AIHOT-backed UI/API surfaces; back up and remove their production data without affecting entries owned by other sources.
- Next: inventory the deployed code and SQLite rows, implement the removal, run the project test suite, deploy conservatively, and verify the public site/API on desktop and mobile.
