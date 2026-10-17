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
