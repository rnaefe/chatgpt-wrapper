import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sessionDirectory = process.env.DEMO_SESSION_DIR;
if (!sessionDirectory)
  throw Error(
    "Set DEMO_SESSION_DIR to your private, signed-in Wrapper data directory. This sends one public coding prompt.",
  );
const sessionPort = process.env.DEMO_SESSION_PORT ?? "11435";
const temporary = await mkdtemp(join(tmpdir(), "wrapper-demo-"));
const data = join(temporary, "data");
const config = join(temporary, "codex", "config.toml");
const reservation = createServer();
await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
const port = String(reservation.address().port);
await new Promise((r) => reservation.close(r));
const cli = join(root, "dist/cli.js");
const run = (args, env = {}) =>
  new Promise((accept, reject) => {
    let output = "";
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (part) => {
      output += part;
      process.stdout.write(part);
    });
    child.stderr.on("data", (part) => process.stderr.write(part));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? accept(output) : reject(Error(`CLI exited ${code}`)),
    );
  });
let client;
try {
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--ignore-scripts", "--json"], {
      cwd: root,
      encoding: "utf8",
    }),
  )[0];
  const setup = await run([
    "setup",
    "--config",
    config,
    "--data-dir",
    data,
    "--port",
    port,
    "--package",
    join(root, packed.filename),
    "--skip-login",
  ]);
  const connected = await run([
    "connect",
    "--visible",
    "--data-dir",
    resolve(sessionDirectory),
    "--port",
    sessionPort,
  ]);
  client = new Client({ name: "wrapper-public-demo", version: "1" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(root, "dist/mcp.js")],
      env: {
        ...process.env,
        DATA_DIR: resolve(sessionDirectory),
        PORT: sessionPort,
        WRAPPER_URL: `http://127.0.0.1:${sessionPort}`,
        BROWSER_HEADLESS: "false",
      },
      stderr: "pipe",
    }),
    { timeout: 15000 },
  );
  const objective =
    "Return exactly one TypeScript code fence containing only: export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value)); This is a public product demonstration.";
  const unpack = (value) => {
    if (value.isError) throw Error("MCP returned an error");
    return JSON.parse(value.content.find((item) => item.type === "text").text);
  };
  const started = Date.now();
  let task = unpack(
    await client.callTool({
      name: "submit_task",
      arguments: { capability: "code.generate", objective, timeoutSeconds: 90 },
    }),
  );
  while (["QUEUED", "RUNNING", "VALIDATING"].includes(task.status)) {
    if (Date.now() - started > 110000)
      throw Error("Demo deadline exceeded; task is not resubmitted.");
    await new Promise((r) => setTimeout(r, 1000));
    task = unpack(
      await client.callTool({ name: "get_task", arguments: { id: task.id } }),
    );
  }
  if (task.status !== "COMPLETED")
    throw Error(
      `Live task stopped at ${task.status}: ${task.error?.code ?? "unknown"}`,
    );
  const expected =
    "export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));";
  if (task.result.text.trim() !== "```typescript\n" + expected + "\n```")
    throw Error("Unexpected live output; inspect locally before recording.");
  const seconds = (
    (Date.parse(task.finishedAt) - Date.parse(task.createdAt)) /
    1000
  ).toFixed(1);
  const keep = (output) =>
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) =>
        /^(ChatGPT Wrapper|[✓→]|Ready\.|"Use Wrapper)/u.test(line),
      );
  const record = {
    capturedAt: new Date().toISOString(),
    disclosure:
      "Actual development-build CLI output and a live MCP result. Saved ChatGPT session; no first-login recording. Install chatter and local paths omitted. Idle time shortened.",
    setup: keep(setup),
    connect: keep(connected),
    task: [
      `→ Public TypeScript task submitted`,
      `✓ COMPLETED in ${seconds}s`,
      ...task.result.text.split("\n"),
      "✓ Exact requested source verified",
    ],
    seconds,
  };
  await mkdir(join(root, "video/public"), { recursive: true });
  await writeFile(
    join(root, "video/public/session.json"),
    JSON.stringify(record, null, 2) + "\n",
  );
  console.log(`Captured actual output; live task completed in ${seconds}s.`);
} finally {
  await client?.close();
  try {
    await run(["stop", "--data-dir", data, "--port", port]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
