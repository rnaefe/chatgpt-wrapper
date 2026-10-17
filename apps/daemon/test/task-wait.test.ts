import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@chatgpt-wrapper/core";
import { taskRequestSchema } from "@chatgpt-wrapper/contracts";
import { Worker } from "../src/worker.js";
import { waitForTask } from "../src/task-wait.js";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.useRealTimers();
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "wrapper-wait-"));
  const store = new Store(directory);
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  cleanups.push(() => store.close());
  return store;
}
const request = () =>
  taskRequestSchema.parse({ capability: "reason.analyze", objective: "test" });

it("wakes on a terminal change and ignores other tasks", async () => {
  const store = fixture();
  const first = store.submit(request()).task;
  const other = store.submit(request()).task;
  const finished = vi.fn();
  const waiting = waitForTask(store, first.id, 1000).then(finished);
  store.transition(other.id, "CANCELLED");
  store.transition(first.id, "RUNNING");
  await Promise.resolve();
  expect(finished).not.toHaveBeenCalled();
  store.transition(first.id, "FAILED");
  await waiting;
  expect(finished).toHaveBeenCalledWith(
    expect.objectContaining({ id: first.id, status: "FAILED" }),
  );
});

it("returns current state on timeout and unregisters the listener", async () => {
  vi.useFakeTimers();
  const store = fixture();
  const task = store.submit(request()).task;
  const get = vi.spyOn(store, "get");
  const remove = vi.fn();
  const subscribe = store.onTaskChange.bind(store);
  vi.spyOn(store, "onTaskChange").mockImplementation((callback) => {
    const unsubscribe = subscribe(callback);
    return () => {
      remove();
      unsubscribe();
    };
  });
  const waiting = waitForTask(store, task.id, 100);
  await vi.advanceTimersByTimeAsync(100);
  expect(await waiting).toMatchObject({ status: "QUEUED" });
  expect(remove).toHaveBeenCalledOnce();
  expect(get).toHaveBeenCalledTimes(2);
});

it("cleans up when the caller disconnects", async () => {
  vi.useFakeTimers();
  const store = fixture();
  const task = store.submit(request()).task;
  const controller = new AbortController();
  const waiting = waitForTask(store, task.id, 30_000, controller.signal);
  controller.abort();
  expect(await waiting).toMatchObject({ id: task.id, status: "QUEUED" });
  expect(vi.getTimerCount()).toBe(0);
});

it("returns terminal, missing and zero-wait snapshots immediately", async () => {
  const store = fixture();
  const task = store.submit(request()).task;
  expect(await waitForTask(store, task.id, 0)).toMatchObject({
    status: "QUEUED",
  });
  store.transition(task.id, "CANCELLED");
  expect(await waitForTask(store, task.id, 30_000)).toMatchObject({
    status: "CANCELLED",
  });
  expect(await waitForTask(store, "missing", 30_000)).toBeUndefined();
});

it("drains submissions immediately and serially without waiting for the fallback interval", async () => {
  vi.useFakeTimers();
  const store = fixture();
  let active = 0,
    maximum = 0;
  const execute = vi.fn(async () => {
    maximum = Math.max(maximum, ++active);
    await Promise.resolve();
    active--;
    return { text: "done", adapter: "test", model: "fixture" };
  });
  const worker = new Worker(
    store,
    {
      info: () => ({
        name: "test",
        configured: true,
        model: "fixture",
        capabilities: ["reason.analyze"],
      }),
      execute,
    },
    0,
  );
  cleanups.push(() => worker.stop());
  worker.start();
  const tasks = Array.from({ length: 5 }, () => store.submit(request()).task);
  await vi.advanceTimersByTimeAsync(0);
  expect(tasks.map((task) => store.get(task.id)?.status)).toEqual(
    Array(5).fill("COMPLETED"),
  );
  expect(maximum).toBe(1);
  expect(execute).toHaveBeenCalledTimes(5);
  await worker.stop();
  store.submit(request());
  await vi.advanceTimersByTimeAsync(1000);
  expect(execute).toHaveBeenCalledTimes(5);
});
