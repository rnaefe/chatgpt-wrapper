export interface DurationSummary {
  count: number;
  averageMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}
export function durationSummary(values: number[]): DurationSummary {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (!sorted.length)
    return { count: 0, averageMs: null, p50Ms: null, p95Ms: null, maxMs: null };
  const percentile = (fraction: number) =>
    Math.round(sorted[Math.ceil(fraction * sorted.length) - 1]);
  return {
    count: sorted.length,
    averageMs: Math.round(
      sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    ),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: Math.round(sorted.at(-1)!),
  };
}
export function elapsed(start: unknown, end: unknown) {
  if (typeof start !== "string" || typeof end !== "string") return undefined;
  const duration = Date.parse(end) - Date.parse(start);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}
export function windowStart(hours: number) {
  if (!Number.isInteger(hours) || hours < 1 || hours > 720)
    throw new Error("Metrics window must be between 1 and 720 hours");
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

export function summarizeMetrics(
  rows: Array<Record<string, unknown>>,
  since: string,
  hours: number,
) {
  const outcomes: Record<string, number> = {};
  const errors: Record<string, number> = Object.create(null);
  const queue: number[] = [],
    execution: number[] = [],
    total: number[] = [];
  for (const row of rows) {
    const status = String(row.status);
    outcomes[status] = (outcomes[status] ?? 0) + 1;
    if (row.errorCode) {
      const code = String(row.errorCode);
      errors[code] = (errors[code] ?? 0) + 1;
    }
    const queueMs = elapsed(row.createdAt, row.startedAt);
    if (queueMs !== undefined) queue.push(queueMs);
    const executionMs = elapsed(row.startedAt, row.finishedAt);
    if (executionMs !== undefined) execution.push(executionMs);
    const totalMs = elapsed(row.createdAt, row.finishedAt);
    if (totalMs !== undefined) total.push(totalMs);
  }
  const completed = outcomes.COMPLETED ?? 0;
  const terminalNonCancelled = [
    "COMPLETED",
    "FAILED",
    "NEEDS_AUTH",
    "NEEDS_HUMAN",
    "BLOCKED_BY_PROVIDER",
  ].reduce((sum, status) => sum + (outcomes[status] ?? 0), 0);
  return {
    since,
    windowHours: hours,
    generatedAt: new Date().toISOString(),
    tasks: rows.length,
    outcomes,
    completed,
    terminalNonCancelled,
    successRate: terminalNonCancelled ? completed / terminalNonCancelled : null,
    duration: {
      queue: durationSummary(queue),
      execution: durationSummary(execution),
      total: durationSummary(total),
    },
    errors,
  };
}
