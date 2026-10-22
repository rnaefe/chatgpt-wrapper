import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@chatgpt-wrapper/core";
import { Worker } from "../src/worker.js";
import { createServer } from "../src/server.js";
import { createMcpServer } from "../src/mcp-server.js";
import type { localClient } from "../src/local-client.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

it("serves batch tools over MCP and returns durable task results through the serial worker", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wrapper-batch-mcp-"));
  let store = new Store(directory);
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  cleanup.push(() => store.close());
  const executionOrder: string[] = [];
  const worker = new Worker(store, {
    info: () => ({
      name: "test",
      configured: true,
      capabilities: ["reason.analyze"],
    }),
    execute: async (request) => {
      executionOrder.push(request.objective);
      return {
        text: `Verified result for ${request.objective}.`,
        model: "fixture",
        adapter: "test",
      };
    },
  });
  cleanup.push(() => worker.stop());
  const http = createServer({ store, worker, token: "test" });
  cleanup.push(() => http.close());
  const api: Awaited<ReturnType<typeof localClient>> = async (path, body) => {
    const response = await http.inject({
      method: body === undefined ? "GET" : "POST",
      url: path,
      headers: { host: "localhost", authorization: "Bearer test" },
      ...(body === undefined
        ? {}
        : { payload: body as Record<string, unknown> }),
    });
    if (response.statusCode >= 400) throw new Error(response.body);
    return new Response(response.body, {
      status: response.statusCode,
      headers: response.headers as HeadersInit,
    });
  };
  const mcp = createMcpServer(api, directory);
  const client = new Client({ name: "batch-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  await client.connect(clientTransport);
  cleanup.push(() => mcp.close());
  cleanup.push(() => client.close());
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining(["submit_batch", "get_batch"]),
  );
  const read = (result: Awaited<ReturnType<typeof client.callTool>>) => {
    const content = result.content as Array<{ type: string; text?: string }>;
    return JSON.parse(content.find((item) => item.type === "text")!.text!);
  };
  const submitted = read(
    await client.callTool({
      name: "submit_batch",
      arguments: {
        idempotencyKey: "mcp-batch",
        tasks: [
          { capability: "reason.analyze", objective: "first" },
          { capability: "reason.analyze", objective: "second" },
        ],
      },
    }),
  );
  expect(submitted.id).toMatch(/^[a-f0-9-]{36}$/);
  expect(submitted.counts).toEqual({ QUEUED: 2 });
  await worker.tick();
  expect(store.getBatch(submitted.id)?.counts).toEqual({
    COMPLETED: 1,
    QUEUED: 1,
  });
  await worker.tick();
  expect(executionOrder).toHaveLength(2);
  expect([...executionOrder].sort()).toEqual(["first", "second"]);
  const complete = read(
    await client.callTool({
      name: "get_batch",
      arguments: { id: submitted.id },
    }),
  );
  expect(complete).toMatchObject({
    id: submitted.id,
    terminal: true,
    counts: { COMPLETED: 2 },
    missingTaskIds: [],
  });
  expect(
    complete.tasks.map(
      (task: { result: { text: string } }) => task.result.text,
    ),
  ).toEqual(["Verified result for first.", "Verified result for second."]);
  store.close();
  store = new Store(directory);
  expect(store.getBatch(submitted.id)).toEqual(complete);
});
