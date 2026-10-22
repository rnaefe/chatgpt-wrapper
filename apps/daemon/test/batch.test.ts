import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ConflictError, Store } from "@chatgpt-wrapper/core";
import { taskRequestSchema } from "@chatgpt-wrapper/contracts";
import { Worker } from "../src/worker.js";
import { createServer } from "../src/server.js";
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "wrapper-batch-"));
  let store = new Store(directory);
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  cleanup.push(() => store.close());
  return {
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = new Store(directory);
    },
  };
}
const request = (objective = "Review code", idempotencyKey?: string) =>
  taskRequestSchema.parse({
    capability: "code.review",
    objective,
    idempotencyKey,
  });

it("persists batch IDs and ordered tasks across reopen", () => {
  const f = fixture();
  const batch = f.store.submitBatch({
    tasks: [request("one"), request("two")],
  });
  expect(batch).toMatchObject({
    reused: false,
    terminal: false,
    counts: { QUEUED: 2 },
    missingTaskIds: [],
  });
  expect(batch.taskIds).toEqual(batch.tasks.map((task) => task.id));
  f.reopen();
  const { reused: _, ...snapshot } = batch;
  expect(f.store.getBatch(batch.id)).toEqual(snapshot);
});

it("preserves task idempotency for requests persisted before file inputs existed", () => {
  const f = fixture();
  const task = f.store.submit(request("legacy", "legacy-key")).task;
  const legacyRequest = { ...task.request };
  delete (legacyRequest as Partial<typeof legacyRequest>).files;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ ...legacyRequest, idempotencyKey: undefined }))
    .digest("hex");
  const db = new DatabaseSync(join(f.store.directory, "tasks.sqlite"));
  db.prepare("UPDATE tasks SET body=?,fingerprint=? WHERE id=?").run(
    JSON.stringify({ ...task, request: legacyRequest }),
    fingerprint,
    task.id,
  );
  db.close();
  expect(f.store.submit(request("legacy", "legacy-key"))).toMatchObject({
    reused: true,
    task: { id: task.id },
  });
  expect(
    f.store.submitBatch({ tasks: [request("legacy", "legacy-key")] }).taskIds,
  ).toEqual([task.id]);
});

it("rolls back all task and batch writes and emits no notifications on per-task conflicts", () => {
  const { store } = fixture();
  const existing = store.submit(request("existing", "shared"));
  const listener = vi.fn();
  store.onTaskChange(listener);
  expect(() =>
    store.submitBatch({
      idempotencyKey: "batch",
      tasks: [request("first", "first"), request("different", "shared")],
    }),
  ).toThrow(ConflictError);
  expect(store.list().map((task) => task.id)).toEqual([existing.task.id]);
  expect(listener).not.toHaveBeenCalled();
  const retry = store.submitBatch({
    idempotencyKey: "batch",
    tasks: [request("first", "first"), request("existing", "shared")],
  });
  expect(retry.reused).toBe(false);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(store.events(retry.taskIds[0])).toHaveLength(1);
});

it("notifies subscribers only after every batch task is visible", () => {
  const { store } = fixture();
  const visibleCounts: number[] = [];
  store.onTaskChange(() => visibleCounts.push(store.list().length));
  store.submitBatch({
    tasks: [request("one"), request("two"), request("three")],
  });
  expect(visibleCounts).toEqual([3, 3, 3]);
});

it("deduplicates normalized batches and preserves per-task idempotency", () => {
  const { store } = fixture();
  const tasks = [request("one", "task-one"), request("two")];
  const first = store.submitBatch({ tasks, idempotencyKey: "batch" });
  const listener = vi.fn();
  store.onTaskChange(listener);
  const repeated = store.submitBatch({
    tasks: [{ ...tasks[0], objective: " one " }, tasks[1]],
    idempotencyKey: "batch",
  });
  expect(repeated.taskIds).toEqual(first.taskIds);
  expect(repeated.reused).toBe(true);
  expect(listener).not.toHaveBeenCalled();
  expect(() =>
    store.submitBatch({ tasks: [request("changed")], idempotencyKey: "batch" }),
  ).toThrow(ConflictError);
  expect(store.submit(tasks[0]).task.id).toBe(first.taskIds[0]);
  const next = store.submitBatch({
    tasks: [tasks[0]],
    idempotencyKey: "other",
  });
  expect(next.taskIds).toEqual([first.taskIds[0]]);
  expect(store.list()).toHaveLength(2);
});

it("summarizes mixed states and reports retention gaps until every task expires", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
  const { store } = fixture();
  const batch = store.submitBatch({ tasks: [request("one"), request("two")] });
  store.transition(batch.taskIds[0], "CANCELLED");
  expect(store.getBatch(batch.id)).toMatchObject({
    terminal: false,
    counts: { CANCELLED: 1, QUEUED: 1 },
  });
  store.pruneOlderThan(new Date("2026-10-02T00:00:00Z"));
  expect(store.getBatch(batch.id)).toMatchObject({
    terminal: false,
    missingTaskIds: [batch.taskIds[0]],
    counts: { QUEUED: 1 },
  });
  store.transition(batch.taskIds[1], "FAILED");
  store.pruneOlderThan(new Date("2026-10-02T00:00:00Z"));
  expect(store.getBatch(batch.id)).toBeUndefined();
  const done = store.submitBatch({ tasks: [request("done")] });
  store.transition(done.taskIds[0], "CANCELLED");
  expect(store.getBatch(done.id)?.terminal).toBe(true);
});

it("exposes authenticated validated batch routes and conflicts", async () => {
  const { store } = fixture();
  const worker = new Worker(store, {
    info: () => ({ name: "test", capabilities: [] }),
  } as never);
  const server = createServer({ store, worker, token: "test" });
  cleanup.push(() => server.close());
  const headers = { host: "localhost", authorization: "Bearer test" };
  expect(
    (
      await server.inject({
        method: "POST",
        url: "/v1/batches",
        headers: { host: "localhost" },
        payload: { tasks: [request()] },
      })
    ).statusCode,
  ).toBe(401);
  for (const payload of [
    { tasks: [] },
    { tasks: Array.from({ length: 21 }, () => request()) },
    { tasks: [request()], unknown: true },
  ])
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/v1/batches",
          headers,
          payload,
        })
      ).statusCode,
    ).toBe(400);
  const payload = { tasks: [request()], idempotencyKey: "route-batch" };
  const response = await server.inject({
    method: "POST",
    url: "/v1/batches",
    headers,
    payload,
  });
  expect(response.statusCode).toBe(202);
  const id = response.json().id;
  expect(
    (
      await server.inject({ method: "GET", url: `/v1/batches/${id}`, headers })
    ).json().taskIds,
  ).toEqual(response.json().taskIds);
  expect(
    (
      await server.inject({
        method: "POST",
        url: "/v1/batches",
        headers,
        payload,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await server.inject({
        method: "POST",
        url: "/v1/batches",
        headers,
        payload: { ...payload, tasks: [request("different")] },
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await server.inject({
        method: "GET",
        url: "/v1/batches/invalid",
        headers,
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await server.inject({
        method: "GET",
        url: "/v1/batches/00000000-0000-4000-8000-000000000000",
        headers,
      })
    ).statusCode,
  ).toBe(404);
});
