import { it, expect } from "vitest";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
it("starts the daemon and authenticates MCP without a configured local token or provider key", async () => {
  const reservation = createServer();
  await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
  const address = reservation.address();
  if (!address || typeof address === "string") throw Error("No test port");
  const port = address.port;
  await new Promise<void>((r, j) => reservation.close((e) => (e ? j(e) : r())));
  const directory = mkdtempSync(join(tmpdir(), "wrapper-launcher-"));
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    PORT: String(port),
    DATA_DIR: directory,
    BROWSER_HEADLESS: "true",
  };
  delete env.WRAPPER_URL;
  delete env.LOCAL_API_TOKEN;
  delete env.PROVIDER_API_KEY;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/mcp.js")],
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "auto-start-test", version: "1" });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain(
      "submit_task",
    );
    expect(
      readFileSync(join(directory, "api-token"), "utf8").length,
    ).toBeGreaterThanOrEqual(24);
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect((await health.json()).service).toBe("chatgpt-wrapper");
  } finally {
    await client.close();
    const lock = join(directory, "daemon.lock");
    if (existsSync(lock)) {
      const pid = Number(readFileSync(lock, "utf8"));
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
      for (let i = 0; i < 40 && existsSync(lock); i++)
        await new Promise((r) => setTimeout(r, 50));
    }
    rmSync(directory, { recursive: true, force: true });
  }
}, 10000);
