import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "@chatgpt-wrapper/core";
import { taskRequestSchema } from "@chatgpt-wrapper/contracts";
import { Worker } from "../src/worker.js";
import { createServer } from "../src/server.js";
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "wrapper-metrics-"));
  const store = new Store(directory);
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  cleanup.push(() => store.close());
  return store;
}
const request = () =>
  taskRequestSchema.parse({
    capability: "code.generate",
    objective: "PRIVATE_PROMPT_MARKER",
  });
it("calculates queue/execution durations and excludes cancellations from the success denominator", () => {
  vi.useFakeTimers();
  const start = Date.parse("2026-10-17T00:00:00Z");
  vi.setSystemTime(start);
  const store = fixture();
  const passed = store.submit(request()).task,
    failed = store.submit(request()).task,
    cancelled = store.submit(request()).task;
  store.transition(passed.id, "RUNNING");
  vi.setSystemTime(start + 1000);
  store.transition(passed.id, "VALIDATING");
  store.transition(passed.id, "COMPLETED");
  store.transition(failed.id, "RUNNING");
  vi.setSystemTime(start + 3000);
  store.transition(failed.id, "NEEDS_HUMAN", {
    error: { code: "BROWSER_CHALLENGE", message: "PRIVATE_ERROR_MESSAGE" },
  });
  store.transition(cancelled.id, "CANCELLED");
  const metrics = store.metrics();
  expect(metrics).toMatchObject({
    tasks: 3,
    completed: 1,
    terminalNonCancelled: 2,
    successRate: 0.5,
    errors: { BROWSER_CHALLENGE: 1 },
  });
  expect(metrics.duration.execution).toEqual({
    count: 2,
    averageMs: 1500,
    p50Ms: 1000,
    p95Ms: 2000,
    maxMs: 2000,
  });
  expect(metrics.duration.queue.averageMs).toBe(500);
  expect(store.failures()).toMatchObject([
    { id: failed.id, code: "BROWSER_CHALLENGE", status: "NEEDS_HUMAN" },
  ]);
  const serialized = JSON.stringify({ metrics, errors: store.failures() });
  expect(serialized).not.toContain("PRIVATE_PROMPT_MARKER");
  expect(serialized).not.toContain("PRIVATE_ERROR_MESSAGE");
});
it("returns null rates and distributions for no tasks, and applies the time window", () => {
  vi.useFakeTimers();
  const store = fixture();
  expect(store.metrics()).toMatchObject({
    tasks: 0,
    successRate: null,
    duration: { execution: { count: 0, averageMs: null, p95Ms: null } },
  });
  vi.setSystemTime("2026-10-15T00:00:00Z");
  store.submit(request());
  vi.setSystemTime("2026-10-17T00:00:00Z");
  expect(store.metrics(24).tasks).toBe(0);
  expect(store.metrics(72).tasks).toBe(1);
  expect(() => store.metrics(0)).toThrow("window");
  expect(() => store.failures(101)).toThrow("limit");
});
it("protects metrics and errors with local auth and validates query limits", async () => {
  const store = fixture();
  const worker = new Worker(store, {
    info: () => ({ name: "fixture", configured: false, capabilities: [] }),
    execute: async () => {
      throw Error("Not used");
    },
  });
  const server = createServer({ store, worker, token: "a".repeat(64) });
  cleanup.push(() => server.close());
  const headers = { authorization: `Bearer ${"a".repeat(64)}` };
  expect((await server.inject({ url: "/v1/metrics" })).statusCode).toBe(401);
  expect((await server.inject({ url: "/v1/errors" })).statusCode).toBe(401);
  expect(
    (await server.inject({ url: "/v1/metrics?hours=0", headers })).statusCode,
  ).toBe(400);
  expect(
    (await server.inject({ url: "/v1/errors?limit=999", headers })).statusCode,
  ).toBe(400);
  expect(
    (await server.inject({ url: "/v1/metrics", headers })).json(),
  ).toMatchObject({ tasks: 0, successRate: null });
});
