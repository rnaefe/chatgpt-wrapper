import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../../../dist/cli.js", import.meta.url));
const id = "4e6045de-4121-419b-b1a6-1bf25edaa400";
const secret = "PRIVATE_TASK_CONTENT";
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(
  handle: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const directory = await mkdtemp(join(tmpdir(), "wrapper-watch-"));
  await writeFile(join(directory, "api-token"), "test-private-token", {
    mode: 0o600,
  });
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url!);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/health") {
      res.end(JSON.stringify({ service: "chatgpt-wrapper" }));
      return;
    }
    if (req.headers.authorization !== "Bearer test-private-token") {
      res.writeHead(401).end("Unauthorized");
      return;
    }
    handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  const port = address.port;
  function start(args = ["watch", id]) {
    const child = spawn(
      process.execPath,
      [cli, "--data-dir", directory, "--port", String(port), ...args],
      {
        env: {
          ...process.env,
          WRAPPER_URL: `http://127.0.0.1:${port}`,
          LOCAL_API_TOKEN: "test-private-token",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    cleanups.push(async () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    });
    const done = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      output: string;
    }>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal, output }));
    });
    return { child, done };
  }
  return { start, requests };
}

function task(status: string, revision = 1) {
  return {
    id,
    status,
    request: { prompt: secret },
    result: { text: secret },
    error: { code: "TEST_CODE", message: secret },
    progress: {
      stage: "generating",
      message: "Waiting for response",
      updatedAt: new Date().toISOString(),
      revision,
    },
  };
}

describe("built CLI watch", () => {
  it.each([["watch", "invalid"], ["watch"], ["watch", id, "extra"]])(
    "rejects invalid arguments before connecting: %j",
    async (...args) => {
      const local = await fixture((_req, res) => res.end("{}"));
      const result = await local.start(args).done;
      expect(result.code).toBe(1);
      expect(result.output).toMatch(/UUID|Usage/);
      expect(local.requests).toEqual([]);
    },
  );

  it.each([
    ["COMPLETED", 0],
    ["FAILED", 1],
    ["NEEDS_HUMAN", 1],
  ] as const)(
    "exits correctly for %s without private task text",
    async (status, code) => {
      const local = await fixture((_req, res) =>
        res.end(JSON.stringify(task(status))),
      );
      const result = await local.start().done;
      expect(result.code).toBe(code);
      expect(result.output).toContain(status);
      expect(result.output).not.toContain(secret);
      expect(local.requests).toEqual(["/health", `/v1/tasks/${id}`]);
    },
  );

  it("prints progress then aborts a pending wait on SIGINT without cancelling the task", async () => {
    let waiting!: () => void;
    const waitStarted = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    let disconnected!: () => void;
    const waitDisconnected = new Promise<void>((resolve) => {
      disconnected = resolve;
    });
    const local = await fixture((req, res) => {
      if (req.url === `/v1/tasks/${id}`)
        res.end(JSON.stringify(task("RUNNING", 3)));
      else {
        res.on("close", disconnected);
        waiting();
      }
    });
    const { child, done } = local.start();
    await waitStarted;
    child.kill("SIGINT");
    const result = await done;
    await waitDisconnected;
    expect(result.code).toBe(130);
    expect(result.signal).toBeNull();
    expect(result.output).toMatch(
      /\d{4}-\d{2}-\d{2}T\S+ RUNNING generating: Waiting for response/,
    );
    expect(result.output).not.toContain(secret);
    expect(local.requests).toEqual([
      "/health",
      `/v1/tasks/${id}`,
      `/v1/tasks/${id}/wait?waitMs=30000&afterProgressRevision=3`,
    ]);
  });
});
