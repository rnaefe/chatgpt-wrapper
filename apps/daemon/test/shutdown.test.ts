import { expect, it, vi } from "vitest";
import { shutdownRuntime } from "../src/runtime-shutdown.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it("stops scheduling synchronously before transport close and waits for both before cleanup", async () => {
  const worker = deferred(),
    server = deferred();
  const calls: string[] = [];
  const shutdown = shutdownRuntime({
    stopWorker: () => {
      calls.push("stop");
      return worker.promise;
    },
    closeServer: () => {
      calls.push("server");
      return server.promise;
    },
    closeStore: () => {
      calls.push("store");
    },
    release: () => {
      calls.push("release");
    },
  });
  expect(calls).toEqual(["stop", "server"]);
  server.resolve();
  await Promise.resolve();
  expect(calls).toEqual(["stop", "server"]);
  worker.resolve();
  await shutdown;
  expect(calls).toEqual(["stop", "server", "store", "release"]);
});

it("breaks the cycle when transport closure awaits the active worker terminal update", async () => {
  const terminal = deferred();
  let stopping = false;
  let activeAborted = false;
  const closed = vi.fn();
  await shutdownRuntime({
    stopWorker: () => {
      stopping = true;
      activeAborted = true;
      terminal.resolve();
      return terminal.promise;
    },
    closeServer: async () => {
      expect(stopping).toBe(true);
      expect(activeAborted).toBe(true);
      await terminal.promise;
    },
    closeStore: closed,
    release: vi.fn(),
  });
  expect(closed).toHaveBeenCalledOnce();
});

it("waits for remaining shutdown work after a failure and releases even if store close throws", async () => {
  const worker = deferred();
  const release = vi.fn(),
    closeStore = vi.fn(() => {
      throw new Error("store");
    });
  const shutdown = shutdownRuntime({
    stopWorker: () => worker.promise,
    closeServer: () => {
      throw new Error("server");
    },
    closeStore,
    release,
  });
  const failed = expect(shutdown).rejects.toMatchObject({
    errors: [
      expect.objectContaining({ message: "server" }),
      expect.objectContaining({ message: "store" }),
    ],
  });
  await Promise.resolve();
  expect(closeStore).not.toHaveBeenCalled();
  worker.resolve();
  await failed;
  expect(release).toHaveBeenCalledOnce();
});

it("still closes transport and resources after synchronous worker stop failure", async () => {
  const closeServer = vi.fn(async () => {}),
    closeStore = vi.fn(),
    release = vi.fn();
  await expect(
    shutdownRuntime({
      stopWorker: () => {
        throw new Error("worker");
      },
      closeServer,
      closeStore,
      release,
    }),
  ).rejects.toBeInstanceOf(AggregateError);
  expect(closeServer).toHaveBeenCalledOnce();
  expect(closeStore).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
});
