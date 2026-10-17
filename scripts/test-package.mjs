import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, delimiter, resolve } from "node:path";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { parse, stringify } from "smol-toml";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const exec = promisify(execFile);
const root = resolve(".");
const metadata = JSON.parse(await readFile("package.json", "utf8"));
const registry = process.argv.includes("--registry");
const spec = `${metadata.name}@${metadata.version}`;
const temp = await mkdtemp(join(tmpdir(), "wrapper package test-"));
const env = { ...process.env, HOME: join(temp, "home") };
for (const key of [
  "DATA_DIR",
  "PORT",
  "WRAPPER_URL",
  "LOCAL_API_TOKEN",
  "BROWSER_HEADLESS",
  "CODEX_HOME",
])
  delete env[key];
let client;
let directory;
const candidates = [
  process.env.npm_execpath,
  join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
  join(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
  ...(process.env.PATH ?? "").split(delimiter).map((dir) => join(dir, "npm")),
];
const npm = candidates
  .filter(Boolean)
  .filter(existsSync)
  .map((path) => realpathSync(path))
  .find((path) => path.endsWith("npm-cli.js"));
if (!npm) throw Error("npm CLI not found");
async function node(script, args = []) {
  return exec(process.execPath, [script, ...args], {
    env,
    cwd: temp,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 180000,
  });
}
try {
  const packed = JSON.parse(
    (
      await exec(
        process.execPath,
        [
          npm,
          "pack",
          ...(registry ? [spec] : []),
          "--ignore-scripts",
          "--json",
          "--pack-destination",
          temp,
        ],
        { cwd: root, maxBuffer: 4 * 1024 * 1024 },
      )
    ).stdout,
  )[0];
  assert(
    packed.files.every(
      (file) => !/(^|\/)(\.env|\.data|node_modules|test)(\/|$)/.test(file.path),
    ),
    "Package must exclude local data and tests",
  );
  const tarball = join(temp, packed.filename);
  const bootstrap = join(temp, "bootstrap install");
  await node(npm, [
    "install",
    "--prefix",
    bootstrap,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--",
    registry ? spec : tarball,
  ]);
  const initialCli = join(
    bootstrap,
    "node_modules",
    ...metadata.name.split("/"),
    "dist/cli.js",
  );
  assert.equal(
    (await node(initialCli, ["--version"])).stdout.trim(),
    metadata.version,
  );
  assert.equal(
    (
      await node(npm, [
        "exec",
        "--prefix",
        bootstrap,
        "--offline",
        "--",
        "chatgpt-wrapper",
        "--version",
      ])
    ).stdout.trim(),
    metadata.version,
  );

  const doctor = JSON.parse((await node(initialCli, ["doctor"])).stdout);
  assert.equal(doctor.daemonRunning, false);
  assert(Object.values(doctor.files).every(Boolean));
  const reservation = createServer();
  await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  directory = join(temp, "private data");
  const config = join(temp, "codex", "config.toml");
  await mkdir(dirname(config), { recursive: true });
  const original =
    'model = "test-model"\n[mcp_servers.other]\ncommand = "other-tool"\n';
  await writeFile(config, original);
  await node(initialCli, [
    "--config",
    config,
    "--data-dir",
    directory,
    "--port",
    String(port),
    ...(registry ? [] : ["--package", tarball]),
    "--skip-login",
  ]);
  const document = parse(await readFile(config, "utf8"));
  assert.equal(document.model, "test-model");
  assert.equal(document.mcp_servers.other.command, "other-tool");
  const entry = document.mcp_servers.wrapper;
  assert(entry.args[0].startsWith(directory));
  assert.equal(entry.env.BROWSER_HEADLESS, "false");
  entry.env.TASK_RETENTION_DAYS = "0";
  await writeFile(config, stringify(document));
  // Prove the client is independent of npx's temporary bootstrap package.
  await rm(bootstrap, { recursive: true, force: true });
  client = new Client({ name: "packaged-smoke-test", version: "1" });
  await client.connect(
    new StdioClientTransport({
      command: entry.command,
      args: entry.args,
      env: { ...env, ...entry.env },
      stderr: "pipe",
    }),
  );
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  assert(names.includes("submit_task"));
  assert(names.includes("get_task"));
  assert(names.includes("get_metrics"));
  assert(names.includes("list_errors"));
  const metrics = await client.callTool({
    name: "get_metrics",
    arguments: { hours: 24 },
  });
  assert.equal(JSON.parse(metrics.content[0].text).successRate, null);
  const errors = await client.callTool({
    name: "list_errors",
    arguments: { limit: 5, hours: 24 },
  });
  assert.deepEqual(JSON.parse(errors.content[0].text).errors, []);
  await client.close();
  client = undefined;
  await node(entry.args[0], [
    "update",
    "--config",
    config,
    ...(registry ? [] : ["--package", tarball]),
  ]);
  assert(
    !existsSync(join(directory, "daemon.lock")),
    "Update must stop the idle old worker",
  );
  const updated = parse(await readFile(config, "utf8"));
  assert.equal(updated.mcp_servers.other.command, "other-tool");
  assert.equal(updated.mcp_servers.wrapper.env.DATA_DIR, directory);
  assert.equal(updated.mcp_servers.wrapper.env.PORT, String(port));
  assert.equal(updated.mcp_servers.wrapper.env.TASK_RETENTION_DAYS, "0");
  const removed = await node(entry.args[0], ["uninstall", "--config", config]);
  assert(removed.stdout.includes("removed from"));
  const final = parse(await readFile(config, "utf8"));
  assert.equal(final.mcp_servers.wrapper, undefined);
  assert.equal(final.mcp_servers.other.command, "other-tool");
  assert(existsSync(directory), "Uninstall must preserve saved user data");

  console.log(
    `Verified ${metadata.name}@${metadata.version}: clean npm install, Codex config merge, persistent runtime after bootstrap removal, MCP handshake (${names.length} tools), idle-worker update, and uninstall preserving other servers and data.`,
  );
  console.log(
    `Tarball contents: ${packed.files.length} files, ${packed.unpackedSize} bytes. No browser prompt or account access was used.`,
  );
} finally {
  await client?.close();
  if (directory && existsSync(join(directory, "daemon.lock"))) {
    const pid = Number(await readFile(join(directory, "daemon.lock"), "utf8"));
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
    for (let i = 0; i < 50 && existsSync(join(directory, "daemon.lock")); i++)
      await new Promise((r) => setTimeout(r, 100));
  }
  await rm(temp, { recursive: true, force: true });
}
