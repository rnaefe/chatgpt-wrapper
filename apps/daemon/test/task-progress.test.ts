import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@chatgpt-wrapper/core";
import {
  progressStageSchema,
  taskRequestSchema,
} from "@chatgpt-wrapper/contracts";
import { Worker } from "../src/worker.js";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "wrapper-progress-"));
  const store = new Store(directory);
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  cleanups.push(() => store.close());
  return store;
}
const request = () =>
  taskRequestSchema.parse({ capability: "reason.analyze", objective: "test" });

it("defines all public progress stages and rejects unknown stages", () => {
  expect(progressStageSchema.options).toEqual([
    "queued",
    "opening_browser",
    "preparing_chat",
    "selecting_model",
    "uploading_images",
    "uploading_files",
    "preparing_research",
    "submitting_prompt",
    "waiting_response",
    "receiving_response",
    "downloading_images",
    "validating",
    "saving_result",
    "completed",
  ]);
  expect(progressStageSchema.safeParse("almost_done").success).toBe(false);
});

it("persists progress and events before notifying listeners, isolated by task", () => {
  const store = fixture();
  const first = store.submit(request()).task;
  const other = store.submit(request()).task;
  expect(first.progress).toMatchObject({ stage: "queued", revision: 0 });
  expect(first.progress?.message).toEqual(expect.any(String));
  expect(first.progress?.updatedAt).toBe(first.createdAt);
  store.transition(first.id, "RUNNING");
  const listener = vi.fn((task) => {
    expect(store.get(task.id)).toEqual(task);
    expect(store.events(task.id).at(-1)?.progress).toEqual(task.progress);
  });
  store.onTaskChange(listener);
  store.reportProgress(first.id, "opening_browser");
  expect(listener).toHaveBeenCalledOnce();
  const updated = store.get(first.id)!;
  expect(updated).toMatchObject({
    status: "RUNNING",
    progress: { stage: "opening_browser", revision: 1 },
  });
  expect(updated.progress?.message).toEqual(expect.any(String));
  expect(store.get(other.id)).toEqual(other);
  const reader = new Store(store.directory);
  try {
    expect(reader.get(first.id)).toEqual(updated);
    expect(reader.events(first.id)).toEqual(store.events(first.id));
  } finally {
    reader.close();
  }
});

it("does not write events or notify for duplicate and late progress", () => {
  const store = fixture();
  const task = store.submit(request()).task;
  store.transition(task.id, "RUNNING");
  store.reportProgress(task.id, "waiting_response");
  const snapshot = store.get(task.id);
  const events = store.events(task.id);
  const listener = vi.fn();
  store.onTaskChange(listener);
  store.reportProgress(task.id, "waiting_response");
  expect(store.get(task.id)).toEqual(snapshot);
  expect(store.events(task.id)).toEqual(events);
  expect(listener).not.toHaveBeenCalled();
  store.transition(task.id, "CANCELLED");
  const cancelled = store.get(task.id);
  const cancelledEvents = store.events(task.id);
  listener.mockClear();
  store.reportProgress(task.id, "receiving_response");
  expect(store.get(task.id)).toEqual(cancelled);
  expect(store.events(task.id)).toEqual(cancelledEvents);
  expect(listener).not.toHaveBeenCalled();
});

it("records adapter stages followed by validation, saving and completion for text tasks", async () => {
  const store = fixture();
  const task = store.submit(request()).task;
  const stages: string[] = [];
  store.onTaskChange((changed) => {
    const stage = changed.progress?.stage;
    if (stage && stages.at(-1) !== stage) stages.push(stage);
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
      execute: async (_request, _signal, onProgress) => {
        expect(onProgress).toEqual(expect.any(Function));
        onProgress?.("opening_browser");
        onProgress?.("preparing_chat");
        onProgress?.("submitting_prompt");
        onProgress?.("waiting_response");
        onProgress?.("receiving_response");
        return { text: "done", adapter: "test", model: "fixture" };
      },
    },
    0,
  );
  cleanups.push(() => worker.stop());
  await worker.tick();
  expect(stages.filter((stage) => stage !== "queued")).toEqual([
    "opening_browser",
    "preparing_chat",
    "submitting_prompt",
    "waiting_response",
    "receiving_response",
    "validating",
    "saving_result",
    "completed",
  ]);
  expect(store.get(task.id)).toMatchObject({
    status: "COMPLETED",
    progress: { stage: "completed" },
    result: { text: "done" },
  });
});

it("sets completion progress in the terminal transition and ignores later callbacks", () => {
  const store = fixture();
  const task = store.submit(request()).task;
  store.transition(task.id, "RUNNING");
  store.reportProgress(task.id, "waiting_response");
  store.transition(task.id, "VALIDATING");
  const before = store.get(task.id)!.progress!.revision;
  const completed = store.transition(task.id, "COMPLETED");
  expect(completed.progress).toMatchObject({
    stage: "completed",
    revision: before + 1,
  });
  expect(store.events(task.id).at(-1)?.progress).toEqual(completed.progress);
  const events = store.events(task.id);
  store.reportProgress(task.id, "receiving_response");
  expect(store.get(task.id)).toEqual(completed);
  expect(store.events(task.id)).toEqual(events);
});
