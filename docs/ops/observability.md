# Observability Baseline for What's New

This document defines the minimum monitoring posture for the current internal surfaces.

## Current surfaces

- Reader feed: `GET /api/whats-new/posts`
- Reader detail: `GET /api/whats-new/posts/:slug`
- Reader unread: `GET /api/whats-new/unread`
- Read-state mutation: `POST /api/whats-new/seen`
- Publisher mutations:
  - `POST /api/admin/whats-new/posts`
  - `PUT /api/admin/whats-new/posts/:id`
  - `POST /api/admin/whats-new/posts/:id/publish`
  - `POST /api/admin/whats-new/posts/:id/unpublish`
- Health check: `GET /healthz` (includes DB connectivity check via `SELECT 1`)

## Golden signals (what to measure)

- Availability:
  - `5xx` rate by endpoint group (reader, publisher, read-state)
  - unexpected `4xx` spikes (especially `400`/`429`/`403`)
- Latency:
  - request duration p50 and p95 by endpoint
  - separate reader and publisher latency buckets
- Traffic:
  - request volume per endpoint
  - mutation throughput (`create/update/publish/unpublish`)
- Saturation:
  - DB pool utilization (% used connections)
  - DB query latency p95 for key read queries
- Optional anomaly signal:
  - audit log write volume deviation from baseline

## Where to look first

- Application logs (stdout JSON):
  - emitted by `appLogger` with redaction (`src/security/logger.ts`)
  - key event examples already present:
    - `whats_new_api_posts_listed`
    - `health_check_failed`
- Health endpoint:
  - `GET /healthz` should return `200 {"ok":true}`
  - returns `503 {"ok":false}` when DB check fails
- Database:
  - active connection pressure (`pg_stat_activity`)
  - query timing if `pg_stat_statements` is enabled in your environment
- Runbook tooling:
  - `npm run db:smoke-check` for fast constraint-level verification

## Suggested starter dashboards

- Service overview:
  - total RPS, 5xx %, 4xx %, p95 latency
- Reader dashboard:
  - `/api/whats-new/posts`, `/posts/:slug`, `/unread` volume + p95 + error rate
- Publisher dashboard:
  - mutation volumes + 4xx/5xx rates + p95
- Database dashboard:
  - pool utilization
  - slow query count / p95 query latency
  - DB CPU and disk (if infra metrics are available)
- Security/abuse dashboard:
  - `429` counts by route
  - unusual mutation bursts

## Alert suggestions (conservative defaults)

- High error rate:
  - trigger when `5xx rate > 2%` for `10 minutes` on any endpoint group
- Unexpected client failure spike:
  - trigger when `4xx rate > 10%` for `10 minutes` (exclude known auth misconfig windows)
- Reader latency regression:
  - trigger when reader endpoint `p95 > 800ms` for `10 minutes`
- Publisher latency regression:
  - trigger when publisher mutation `p95 > 1200ms` for `10 minutes`
- DB saturation:
  - trigger when pool utilization `> 80%` for `5 minutes`
- Optional audit anomaly:
  - trigger when audit writes exceed `3x` trailing 1-hour baseline for `15 minutes`

Adjust thresholds after collecting at least 2 weeks of baseline traffic.

## Logging guidance (safe logging rules)

- Log:
  - event type/name
  - internal IDs (post ID, tenant ID, actor ID) where needed
  - status code and timings
  - route/path template
- Do not log:
  - markdown bodies (`body_markdown`)
  - titles
  - emails
  - raw request payloads
  - secrets/tokens/cookies/DB URLs
- Include request/correlation ID when available from upstream:
  - propagate incoming `x-request-id` (or equivalent) through logs
  - if absent today, add in a future thin middleware

## Metrics integration stance

- Current repo does not include a metrics stack (for example Prometheus middleware).
- Do not add a full metrics framework in this phase.
- Future integration should attach low-cardinality route labels and avoid user/tenant identifiers in metric labels.

## Operational response quick triage

1. Check `/healthz` and recent `health_check_failed` logs.
2. Check 5xx trend and identify affected route group.
3. Check DB pool saturation and slow query indicators.
4. Validate read path with:
   - `GET /api/whats-new/unread`
   - `GET /api/whats-new/posts?limit=1`
5. If incident persists, execute restore drill from `docs/ops/backup-restore.md`.
