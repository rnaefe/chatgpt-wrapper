# Local queue performance

Run `pnpm build` then `node scripts/benchmark-queue.mjs` from the repository root.
The benchmark uses a temporary SQLite database and an immediate local provider,
submits twelve sequential tasks and measures submission through validation and
artifact persistence. It never contacts ChatGPT or uses the saved browser profile.

On the development Mac during this change:

| Scheduler                               |    Median |       p95 |
| --------------------------------------- | --------: | --------: |
| 250 ms interval                         | 244.13 ms | 248.58 ms |
| Submission and completion notifications |   1.72 ms |   3.36 ms |

These are small local samples, not a claim about end-to-end generation speed.
The baseline reflects the benchmark's submissions arriving just after the polling
interval, not the average arrival pattern in production. Browser startup, navigation,
provider generation, verification and uploads still dominate real task durations.

The worker retains a one-second fallback for readiness changes. `wait_task` reduces
client polling round trips by waiting for committed terminal-state notifications for
up to thirty seconds. Event-history lookups use an index on task ID and sequence.
The adapter also caches its page-engine source for its lifetime and encodes downloaded
image bytes in chunks instead of appending one character at a time. Restart the daemon
after rebuilding to load a changed page engine.
