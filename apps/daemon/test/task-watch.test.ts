import { describe, expect, it, vi } from "vitest";
import { validateWatchTaskId, watchTask } from "../src/task-watch.js";

const id = "4e6045de-4121-419b-b1a6-1bf25edaa400";
const now = () => new Date("2026-01-01T00:00:00Z");
const progress = (revision: number) => ({
  revision,
  stage: "generating",
  message: "Waiting for response",
  updatedAt: now().toISOString(),
});

describe("task watch", () => {
  it("prints initial state and each status or revision change, without private payloads", async () => {
    const tasks = [
      { status: "RUNNING", progress: progress(1) },
      { status: "RUNNING", progress: progress(1) },
      { status: "RUNNING", progress: progress(2) },
      { status: "COMPLETED", progress: progress(2) },
    ];
    const api = vi.fn(async () =>
      Response.json({ ...tasks.shift(), request: "SECRET", result: "SECRET" }),
    );
    const write = vi.fn();
    expect(await watchTask(id, { api, write, now })).toBe(0);
    expect(write).toHaveBeenCalledTimes(3);
    expect(write.mock.calls.flat().join("\n")).not.toContain("SECRET");
    expect(api.mock.calls[1]).toEqual([
      `/v1/tasks/${id}/wait?waitMs=30000&afterProgressRevision=1`,
      undefined,
      35000,
      undefined,
    ]);
  });

  it.each([
    "FAILED",
    "CANCELLED",
    "NEEDS_AUTH",
    "NEEDS_HUMAN",
    "BLOCKED_BY_PROVIDER",
  ])("returns failure for %s", async (status) => {
    const write = vi.fn();
    expect(
      await watchTask(id, {
        api: async () =>
          Response.json({
            status,
            error: { code: "PROVIDER_ERROR", message: "SECRET" },
          }),
        write,
        now,
      }),
    ).toBe(1);
    expect(write.mock.calls[0][0]).toContain("error=PROVIDER_ERROR");
    expect(write.mock.calls[0][0]).not.toContain("SECRET");
  });

  it("uses revision zero for legacy tasks and conceals request failures", async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ status: "QUEUED" }))
      .mockRejectedValueOnce(new Error("SECRET"));
    const write = vi.fn();
    expect(await watchTask(id, { api, write, now })).toBe(1);
    expect(api.mock.calls[1][0]).toContain("afterProgressRevision=0");
    expect(write.mock.calls[1][0]).toBe("2026-01-01T00:00:00.000Z WATCH_ERROR");
  });

  it("aborts the local wait without cancelling the task", async () => {
    const controller = new AbortController();
    const api = vi.fn(async (_path, _body, _timeout, signal: AbortSignal) => {
      controller.abort();
      expect(signal.aborted).toBe(true);
      throw new Error("aborted");
    });
    const write = vi.fn();
    expect(await watchTask(id, { api, write, signal: controller.signal })).toBe(
      130,
    );
    expect(api).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });

  it("validates IDs before making requests", async () => {
    const api = vi.fn();
    expect(() => validateWatchTaskId("../bad")).toThrow("UUID");
    await expect(watchTask("bad", { api, write: vi.fn() })).rejects.toThrow(
      "UUID",
    );
    expect(api).not.toHaveBeenCalled();
  });
});
