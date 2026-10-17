# Local task metrics

Query the same task database used by MCP:

```sh
chatgpt-wrapper metrics --hours 24
chatgpt-wrapper errors --hours 24 --limit 20
```

MCP exposes `get_metrics` and `list_errors`. The authenticated loopback endpoints are `GET /v1/metrics?hours=24` and `GET /v1/errors?hours=24&limit=20`. Queries are local; nothing is sent to ChatGPT for metrics collection.

The window includes tasks **created** in the last requested number of hours (1–720). Error lists accept 1–100 rows. Pending tasks remain visible in outcome counts but do not count as completed attempts.

## Success rate

`successRate = COMPLETED / (COMPLETED + FAILED + NEEDS_AUTH + NEEDS_HUMAN + BLOCKED_BY_PROVIDER)`.

Cancelled and unfinished tasks are excluded from that denominator. A provider block is an unsuccessful Wrapper attempt, even when it is not a software defect. No completed attempts yields `null`, not 0% or 100%. Idempotent submissions reuse the original task and do not add attempts. Verification probes are ordinary tasks and are included in these metrics.

## Durations

All durations are milliseconds. Each distribution includes count, average, nearest-rank p50, nearest-rank p95 and maximum:

- `queue`: creation to worker start, for tasks with a start timestamp.
- `execution`: worker start to terminal state, including generation, validation and applicable cancellation.
- `total`: creation to terminal state.

Missing timestamps and invalid/negative durations are omitted. Empty distributions have null statistics. The execution and total distributions include all terminal outcomes with valid timestamps, not only successful responses.

## Errors and privacy

Error summaries group by stored error code. Recent errors include task ID, status, code and timestamps. They omit prompts, generated code, file attachments and error-message text. Use `get_task` explicitly to inspect a particular task's detailed failure. Private daemon and browser-verification logs remain in the data directory; there is no external telemetry or dashboard.

These are Wrapper task metrics, not ChatGPT account quotas, provider latency telemetry or subscription-usage estimates. Metrics reflect retained task history: `TASK_RETENTION_DAYS` defaults to 30, and expired terminal tasks leave the totals after cleanup. Automatic alerts are not implemented.
