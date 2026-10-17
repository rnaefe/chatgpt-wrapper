import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { Store, ConflictError } from "@chatgpt-wrapper/core";
import { taskRequestSchema } from "@chatgpt-wrapper/contracts";
import { ProviderError, type Adapter } from "@chatgpt-wrapper/adapters";
import { Worker } from "../src/worker.js";
import { createServer } from "../src/server.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const clean of cleanup.splice(0).reverse()) await clean();
});
function fixture(adapter?: Adapter) {
  const directory = mkdtempSync(join(tmpdir(), "wrapper-test-"));
  const store = new Store(directory);
  const worker = new Worker(
    store,
    adapter ?? {
      ...success,
      execute: async () => {
        throw new ProviderError(
          "PROVIDER_NOT_CONFIGURED",
          "Connect ChatGPT first.",
          "NEEDS_AUTH",
        );
      },
    },
  );
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  cleanup.push(() => store.close());
  cleanup.push(() => worker.stop());
  return { store, worker, directory };
}
const request = (extra = {}) =>
  taskRequestSchema.parse({
    capability: "reason.analyze",
    objective: "Analyze this architecture",
    ...extra,
  });
const success: Adapter = {
  info: () => ({
    name: "test",
    configured: true,
    capabilities: ["reason.analyze"],
  }),
  execute: async () => ({
    text: "A verified test result.",
    model: "fixture",
    adapter: "test",
  }),
};
const token = "a".repeat(64);
const auth = { authorization: `Bearer ${token}` };
function http(f: ReturnType<typeof fixture>) {
  const server = createServer({ ...f, token });
  cleanup.push(() => server.close());
  return server;
}

describe("durable queue", () => {
  it("rejects unsupported request options rather than silently dropping them", () => {
    expect(
      taskRequestSchema.safeParse({
        capability: "code.generate",
        objective: "Test",
        inputArtifactId: "a".repeat(64),
      }).success,
    ).toBe(false);
  });
  it("deduplicates identical submissions and rejects conflicting input", () => {
    const { store } = fixture();
    const first = store.submit(request({ idempotencyKey: "once" }));
    expect(store.submit(request({ idempotencyKey: "once" }))).toMatchObject({
      reused: true,
      task: { id: first.task.id },
    });
    expect(() =>
      store.submit(request({ idempotencyKey: "once", objective: "Different" })),
    ).toThrow(ConflictError);
    expect(store.list()).toHaveLength(1);
  });
  it("persists across restarts and never replays interrupted execution", () => {
    const { store, directory } = fixture();
    const a = store.submit(request()).task;
    const b = store.submit(request()).task;
    store.transition(a.id, "RUNNING");
    const second = new Store(directory);
    try {
      second.recover();
      expect(second.get(a.id)).toMatchObject({
        status: "FAILED",
        error: { code: "WORKER_RESTARTED" },
      });
      expect(second.next()?.id).toBe(b.id);
      expect(second.events(a.id).map((e) => e.status)).toEqual([
        "QUEUED",
        "RUNNING",
        "FAILED",
      ]);
    } finally {
      second.close();
    }
  });
  it("protects terminal states and rejects invalid transitions", () => {
    const { store } = fixture();
    const t = store.submit(request()).task;
    expect(() => store.transition(t.id, "COMPLETED")).toThrow();
    store.transition(t.id, "CANCELLED");
    expect(store.transition(t.id, "RUNNING").status).toBe("CANCELLED");
  });
  it("fails code generation with no code fence or unified diff", async () => {
    const f = fixture({
      ...success,
      execute: async () => ({
        text: "Here is your code without a fenced block.",
        adapter: "test",
        model: "fixture",
      }),
    });
    const task = f.store.submit(request({ capability: "code.generate" })).task;
    await f.worker.tick();
    expect(f.store.get(task.id)).toMatchObject({
      status: "FAILED",
      error: { code: "VALIDATION_FAILED" },
    });
  });
  it("prunes terminal tasks and removes only unreferenced artifacts", () => {
    const { store } = fixture();
    const artifact = store.putArtifact(
      Buffer.from("old"),
      "text/plain",
      "test",
    );
    const old = store.submit(request()).task;
    store.transition(old.id, "RUNNING");
    store.transition(old.id, "VALIDATING");
    store.transition(old.id, "COMPLETED", {
      result: {
        text: "old",
        artifacts: [artifact],
        provenance: { adapter: "test", model: "test" },
        validation: { passed: true, checks: [] },
      },
    });
    const queued = store.submit(request()).task;
    expect(store.pruneOlderThan(new Date(Date.now() + 10_000))).toEqual({
      tasks: 1,
      artifacts: 1,
    });
    expect(store.get(old.id)).toBeUndefined();
    expect(store.get(queued.id)?.status).toBe("QUEUED");
    expect(() => store.artifactData(artifact.id)).toThrow("Artifact not found");
  });
  it("rejects image editing without a reference", () => {
    expect(
      taskRequestSchema.safeParse({
        capability: "image.edit",
        objective: "Change it",
      }).success,
    ).toBe(false);
  });
});

describe("HTTP and worker", () => {
  it.each(["image.generate", "image.edit"])(
    "stores %s without an empty text artifact",
    async (capability) => {
      const f = fixture({
        ...success,
        execute: async () => ({
          text: "",
          adapter: "test",
          model: "fixture",
          images: [
            {
              data: Buffer.from([137, 80, 78, 71]),
              mime: "image/png",
              source: "fixture",
            },
          ],
        }),
      });
      const task = f.store.submit(
        request({
          capability,
          images:
            capability === "image.edit"
              ? [
                  {
                    source: "base64",
                    data: "AP8=",
                    mime: "image/png",
                    name: "reference.png",
                  },
                ]
              : [],
        }),
      ).task;
      await f.worker.tick();
      const done = f.store.get(task.id)!;
      expect(done.status).toBe("COMPLETED");
      expect(done.result!.artifacts).toHaveLength(1);
      expect(done.result!.artifacts[0].kind).toBe("image");
    },
  );
  it("returns text for image analysis and requires output images for editing", async () => {
    const f = fixture(success);
    const images = [
      {
        source: "base64",
        data: "AP8=",
        mime: "image/png",
        name: "reference.png",
      },
    ];
    const analyze = f.store.submit(
      request({ capability: "image.analyze", images }),
    ).task;
    await f.worker.tick();
    expect(f.store.get(analyze.id)?.status).toBe("COMPLETED");
    const edit = f.store.submit(
      request({ capability: "image.edit", images }),
    ).task;
    await f.worker.tick();
    expect(f.store.get(edit.id)).toMatchObject({
      status: "FAILED",
      error: { code: "VALIDATION_FAILED" },
    });
  });
  it("releases pending HTTP waits before shutting down", async () => {
    const f = fixture(success);
    const server = http(f);
    const task = f.store.submit(request()).task;
    const subscribe = f.store.onTaskChange.bind(f.store);
    let registered!: () => void;
    const listening = new Promise<void>((resolve) => {
      registered = resolve;
    });
    vi.spyOn(f.store, "onTaskChange").mockImplementation((listener) => {
      const unsubscribe = subscribe(listener);
      registered();
      return unsubscribe;
    });
    const pending = server
      .inject({ url: `/v1/tasks/${task.id}/wait?waitMs=30000`, headers: auth })
      .then((response) => response);
    await listening;
    await server.close();
    expect((await pending).json().status).toBe("QUEUED");
  });
  it("validates HTTP waits and returns missing tasks promptly", async () => {
    const server = http(fixture());
    const id = "12345678-1234-4234-8234-123456789012";
    expect(
      (
        await server.inject({
          url: `/v1/tasks/${id}/wait?waitMs=0`,
          headers: auth,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await server.inject({
          url: `/v1/tasks/${id}/wait?waitMs=30001`,
          headers: auth,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await server.inject({ url: `/v1/tasks/${id}/wait?waitMs=0` }))
        .statusCode,
    ).toBe(401);
  });

  it("requires auth and rejects hostile origins and hosts", async () => {
    const server = http(fixture());
    await server.listen({ port: 0, host: "127.0.0.1" });
    const address = server.addresses()[0];
    const base = `http://127.0.0.1:${address.port}`;
    expect((await fetch(`${base}/v1/tasks`)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/v1/tasks`, {
          headers: { ...auth, Origin: "https://hostile.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await server.inject({
          url: "/v1/tasks",
          headers: { ...auth, host: "hostile.example" },
        })
      ).statusCode,
    ).toBe(403);
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(base)).status).toBe(401);
  });
  it("runs a task through HTTP, validation, artifacts and history", async () => {
    const f = fixture(success);
    const server = http(f);
    const submit = await server.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: auth,
      payload: request({ idempotencyKey: "http-key" }),
    });
    expect(submit.statusCode).toBe(202);
    const id = submit.json().id;
    await f.worker.tick();
    const task = (
      await server.inject({ url: `/v1/tasks/${id}`, headers: auth })
    ).json();
    expect(task.status).toBe("COMPLETED");
    expect(task.events.map((e: { status: string }) => e.status)).toEqual([
      "QUEUED",
      "RUNNING",
      "VALIDATING",
      "COMPLETED",
    ]);
    const artifact = await server.inject({
      url: `/v1/artifacts/${task.result.artifacts[0].id}`,
      headers: auth,
    });
    expect(artifact.body).toBe("A verified test result.");
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/v1/tasks",
          headers: auth,
          payload: request({ idempotencyKey: "http-key" }),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/v1/tasks",
          headers: auth,
          payload: request({
            idempotencyKey: "http-key",
            objective: "Different",
          }),
        })
      ).statusCode,
    ).toBe(409);
  });
  it("validates task and pagination inputs and unknown IDs", async () => {
    const server = http(fixture());
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/v1/tasks",
          headers: auth,
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await server.inject({ url: "/v1/tasks?limit=10000", headers: auth }))
        .statusCode,
    ).toBe(400);
    expect(
      (await server.inject({ url: "/v1/tasks/missing", headers: auth }))
        .statusCode,
    ).toBe(404);
  });
  it("cancels running work without accepting a late completion", async () => {
    let started!: () => void;
    const began = new Promise<void>((r) => (started = r));
    let finish!: (value: Awaited<ReturnType<Adapter["execute"]>>) => void;
    const adapter: Adapter = {
      ...success,
      execute: async () => {
        started();
        return new Promise((r) => (finish = r));
      },
    };
    const { store, worker } = fixture(adapter);
    const t = store.submit(request()).task;
    const running = worker.tick();
    await began;
    expect(worker.cancel(t.id)?.status).toBe("CANCELLED");
    finish(await success.execute(t.request, new AbortController().signal));
    await running;
    expect(store.get(t.id)?.status).toBe("CANCELLED");
    expect(store.get(t.id)?.result).toBeUndefined();
  });
  it("reports missing configuration without fabricating a result", async () => {
    const { store, worker } = fixture();
    const t = store.submit(request()).task;
    await worker.tick();
    expect(store.get(t.id)).toMatchObject({
      status: "NEEDS_AUTH",
      error: { code: "PROVIDER_NOT_CONFIGURED" },
    });
    expect(store.get(t.id)?.result).toBeUndefined();
  });
  it("bounds concurrency at one request", async () => {
    let finish!: (v: Awaited<ReturnType<Adapter["execute"]>>) => void;
    let calls = 0;
    const { store, worker } = fixture({
      ...success,
      execute: async () => {
        calls++;
        return new Promise((r) => (finish = r));
      },
    });
    store.submit(request());
    store.submit(request());
    const running = worker.tick();
    await Promise.resolve();
    await worker.tick();
    expect(calls).toBe(1);
    finish(await success.execute(request(), new AbortController().signal));
    await running;
    expect(store.counts()).toEqual({ COMPLETED: 1, QUEUED: 1 });
  });
  it("rejects a patch outside the declared output paths", async () => {
    const f = fixture({
      ...success,
      execute: async () => ({
        text: "--- a/secrets.txt\n+++ b/secrets.txt\n@@ -1 +1 @@\n-old\n+new",
        adapter: "test",
        model: "fixture",
      }),
    });
    const task = f.store.submit(request({ allowedPaths: ["src/"] })).task;
    await f.worker.tick();
    expect(f.store.get(task.id)).toMatchObject({
      status: "FAILED",
      error: { code: "VALIDATION_FAILED" },
    });
  });
});

describe("MCP protocol", () => {
  it("connects over stdio and shares the HTTP queue and artifacts", async () => {
    const f = fixture(success);
    const server = http(f);
    await server.listen({ port: 0, host: "127.0.0.1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("dist/mcp.js")],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
        WRAPPER_URL: `http://127.0.0.1:${server.addresses()[0].port}`,
        LOCAL_API_TOKEN: token,
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "integration-test", version: "1.0.0" });
    cleanup.push(() => client.close());
    await client.connect(transport);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "submit_task",
        "get_task",
        "cancel_task",
        "list_tasks",
        "get_artifact",
        "wait_task",
        "get_status",
      ]),
    );
    const submitted = await client.callTool({
      name: "submit_task",
      arguments: {
        capability: "reason.analyze",
        objective: "MCP end-to-end test",
      },
    });
    const task = JSON.parse(
      (submitted.content as Array<{ text: string }>)[0].text,
    );
    expect(f.store.get(task.id)?.status).toBe("QUEUED");
    const waiting = client.callTool({
      name: "wait_task",
      arguments: { id: task.id, waitMs: 1000 },
    });
    await f.worker.tick();
    expect(
      JSON.parse(((await waiting).content as Array<{ text: string }>)[0].text)
        .status,
    ).toBe("COMPLETED");
    const result = await client.callTool({
      name: "get_task",
      arguments: { id: task.id },
    });
    const done = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text,
    );
    expect(done.status).toBe("COMPLETED");
    const waited = await client.callTool({
      name: "wait_task",
      arguments: { id: task.id },
    });
    expect(
      JSON.parse((waited.content as Array<{ text: string }>)[0].text).status,
    ).toBe("COMPLETED");
    const status = await client.callTool({ name: "get_status", arguments: {} });
    expect(
      JSON.parse((status.content as Array<{ text: string }>)[0].text).counts
        .COMPLETED,
    ).toBe(1);

    const artifact = await client.callTool({
      name: "get_artifact",
      arguments: { id: done.result.artifacts[0].id },
    });
    expect(artifact.content).toEqual([
      { type: "text", text: "A verified test result." },
    ]);
  });

  it("delivers image artifacts as base64 MCP image content without UTF-8 corruption", async () => {
    const f = fixture(success);
    const server = http(f);
    await server.listen({ port: 0, host: "127.0.0.1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("dist/mcp.js")],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
        WRAPPER_URL: `http://127.0.0.1:${server.addresses()[0].port}`,
        LOCAL_API_TOKEN: token,
        DATA_DIR: f.directory,
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "image-test", version: "1.0.0" });
    cleanup.push(() => client.close());
    await client.connect(transport);
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128]);
    const image = f.store.putArtifact(bytes, "image/png", "fixture", "image");
    const result = await client.callTool({
      name: "get_artifact",
      arguments: { id: image.id },
    });
    expect(result.content).toEqual([
      { type: "image", data: bytes.toString("base64"), mimeType: "image/png" },
      { type: "text", text: expect.any(String) },
    ]);
    const delivery = JSON.parse(
      (result.content as Array<{ text: string }>)[1].text,
    );
    expect(delivery.localPath).toBe(
      join(f.directory, "image-exports", `${image.id}.png`),
    );
    expect(readFileSync(delivery.localPath)).toEqual(bytes);
    expect(delivery.displayMarkdown).toContain(delivery.localPath);
  });
});
