# 2026-07-12 DeepSeek key rotation and V4 Flash lock

Status: completed

Scope:

- Rotate the shared DeepSeek production credential without recording the raw key.
- Update every production surface that already held a DeepSeek credential: `rss.qiaomu.ai`, `hn.qiaomu.ai`, `movie.qiaomu.ai`, `appreview.qiaomu.ai`, the disabled `trending.qiaomu.ai`, `blog.qiaomu.ai`, and `agent.qiaomu.ai`.
- Keep `benchmark.qiaomu.ai` without a server credential because it was already BYOK-only, while changing its site model and code defaults to Flash.
- Keep server-funded DeepSeek calls on `deepseek-v4-flash` only.
- Remove client-controlled paths that could pair a server key with a custom base URL or a V4 Pro model.
- Verify the official balance/models endpoints, systemd services, and public health endpoints.

Pre-change evidence:

- The new credential passed read-only DeepSeek `/user/balance` and `/v1/models` checks.
- The local `qiaomu-llm` secret is stored in macOS Keychain.
- The production model list currently exposes both `deepseek-v4-flash` and `deepseek-v4-pro`; the application policy for this deployment is Flash only.
- Runtime env backups must be created before service restarts.

Completed changes:

- The replacement credential was stored in macOS Keychain and deployed without logging its raw value. Its verification fingerprint is `sha256:72ce82120dced19a`.
- The five `myvps` runtimes now share that fingerprint and report `deepseek-v4-flash`; all corresponding systemd services are active.
- QMReader now keeps caller-owned provider/base/model settings only when the caller supplies a matching BYOK credential. Server-funded requests ignore those headers, force the official DeepSeek origin, and reject every model except `deepseek-v4-flash`. The official DeepSeek BYOK preset is also Flash-only.
- Movie chat no longer rewrites Flash to the legacy `deepseek-chat` alias. Its code now rejects non-official DeepSeek Base URLs and hard-locks the model to Flash.
- Benchmark normalizes server-owned official DeepSeek targets to the official origin and Flash. Production `site-deepseek` now reports Flash with `hasKey=false`.
- Blog D1 profile `id=8` was updated through the authenticated settings UI. A remote D1 readback reports `model=deepseek-v4-flash`, `has_key=1`, and `is_default=0`.
- QiaoAgent's public credential-test and unauthenticated configuration-write paths were blocked at Nginx before the new credential was installed. Its provider and workflow configs now expose only Flash, its env file is mode `0600`, and the rebuilt container is healthy.
- The DeepSeek console now lists only the replacement key; the remaining old general-purpose key was revoked, and the earlier reader key was already absent.

Verification:

- QMReader: 67 tests passed locally and in production; Node syntax checks and adversarial server-key boundary checks passed.
- Movie: static checks and hostile Base URL rejection passed locally and in production.
- Benchmark: 53 tests passed locally and in production.
- A minimal real chat smoke test returned `OK` from `deepseek-v4-flash`.
- Public checks returned HTTP 200 for RSS, Blog, Agent, Trending, and Benchmark; HN, Movie, and AppReview health payloads report Flash.
- QiaoAgent's public model test, provider writes, workflow writes, and provider-detail reads return HTTP 403, while safe metadata reads remain available.

Rollback material:

- Shared env backup: `/root/backups/deepseek-rotation-20260712T133538Z`
- QMReader code: `/root/backups/qmreader-code-before-deepseek-flash-20260712T140731Z`
- Movie code: `/root/backups/movie-code-before-deepseek-flash-20260712T140732Z`
- Benchmark DB: `/root/backups/benchmark-before-deepseek-flash-20260712T140536Z.db`
- Benchmark code: `/root/backups/benchmark-code-before-deepseek-flash-20260712T140731Z`
- QiaoAgent config: `/root/backups/qiaoagent-deepseek-rotation-20260712T135543Z`
- QiaoAgent Nginx: `/root/agent.qiaomu.ai.conf.before-deepseek-lock-20260712T135302Z`

No SEO/GEO/PWA work is included in this incident response; this change is limited to credential rotation and model/call-path safety.
