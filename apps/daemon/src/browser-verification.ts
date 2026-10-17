import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Task } from "@chatgpt-wrapper/contracts";
import {
  daemonEntry,
  mcpEntry,
  packageRoot,
  packageMetadata,
} from "./runtime-paths.js";
import { liveWorkerPid } from "./worker-control.js";

export type BrowserMode = "visible" | "headless";
export interface ProbeResult {
  taskId?: string;
  status: string;
  outcome: "PASS" | "BLOCKED" | "FAIL";
  durationMs: number;
  checks: { completed: boolean; expectedCode: boolean; codeFence: boolean };
  errorCode?: string;
}
export function inspectProbe(
  task: Task,
  expected: string,
  durationMs: number,
): ProbeResult {
  const block = task.result?.text
    .trim()
    .match(/^```(?:typescript|ts)\r?\n([\s\S]*?)\r?\n```$/i);
  const checks = {
    completed: task.status === "COMPLETED",
    expectedCode: block?.[1].trim() === expected,
    codeFence: !!block,
  };
  const blocked = ["NEEDS_AUTH", "NEEDS_HUMAN", "BLOCKED_BY_PROVIDER"].includes(
    task.status,
  );
  return {
    taskId: task.id,
    status: task.status,
    outcome: Object.values(checks).every(Boolean)
      ? "PASS"
      : blocked
        ? "BLOCKED"
        : "FAIL",
    durationMs,
    checks,
    ...(task.error ? { errorCode: task.error.code } : {}),
  };
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No available verification port");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
function payload(result: Awaited<ReturnType<Client["callTool"]>>) {
  if (result.isError) throw new Error("MCP returned a tool error");
  const item = result.content as Array<{ type: string; text?: string }>;
  const text = item.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("MCP returned no task");
  return JSON.parse(text) as Task;
}
async function waitForWorker(child: ChildProcess, base: string) {
  for (let i = 0; i < 80; i++) {
    if (!child.pid) throw new Error("Could not launch verification worker");
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("Verification worker exited before becoming ready");
    try {
      const response = await fetch(new URL("/health", base), {
        signal: AbortSignal.timeout(300),
      });
      if (
        response.ok &&
        ((await response.json()) as { service: string }).service ===
          "chatgpt-wrapper"
      )
        return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Verification worker did not become ready");
}
async function runMode(
  directory: string,
  mode: BrowserMode,
  timeoutSeconds: number,
  runId: string,
) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATA_DIR: directory,
    PORT: String(port),
    WRAPPER_URL: base,
    BROWSER_HEADLESS: mode === "headless" ? "true" : "false",
  };
  const log = openSync(join(directory, "browser-verification.log"), "a", 0o600);
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, [daemonEntry], {
      cwd: packageRoot,
      env,
      stdio: ["ignore", log, log],
    });
  } finally {
    closeSync(log);
  }
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const probes: ProbeResult[] = [];
  let client: Client | undefined;
  let spawnError: Error | undefined;
  child.on("error", (error) => {
    spawnError = error;
  });
  try {
    await waitForWorker(child, base);
    if (spawnError) throw spawnError;
    const token =
      env.LOCAL_API_TOKEN ??
      (await readFile(join(directory, "api-token"), "utf8")).trim();
    const status = (await (
      await fetch(new URL("/v1/status", base), {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      })
    ).json()) as {
      runtime?: { pid: number };
      browserAdapter?: { mode: string };
    };
    if (
      status.runtime?.pid !== child.pid ||
      status.browserAdapter?.mode !== mode
    )
      throw new Error(
        "Verification worker identity or browser mode did not match",
      );
    client = new Client({
      name: "wrapper-browser-verification",
      version: packageMetadata.version,
    });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [mcpEntry],
        env: Object.fromEntries(
          Object.entries(env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
        stderr: "pipe",
      }),
    );
    for (let index = 1; index <= 2; index++) {
      const expected = `export const wrapperProbe${index} = "${mode}";`;
      const began = Date.now();
      let task = payload(
        await client.callTool({
          name: "submit_task",
          arguments: {
            capability: "code.generate",
            objective: `Return only one fenced TypeScript code block containing this exact source: ${expected}`,
            acceptanceCriteria: [
              "Return the exact source in a TypeScript code fence; no explanation.",
            ],
            timeoutSeconds,
            idempotencyKey: `browser-verification:${runId}:${mode}:${index}`,
          },
        }),
      );
      const deadline = Date.now() + (timeoutSeconds + 15) * 1000;
      while (
        ["QUEUED", "RUNNING", "VALIDATING"].includes(task.status) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        task = payload(
          await client.callTool({
            name: "get_task",
            arguments: { id: task.id },
          }),
        );
      }
      if (["QUEUED", "RUNNING", "VALIDATING"].includes(task.status)) {
        await client.callTool({
          name: "cancel_task",
          arguments: { id: task.id },
        });
        task = payload(
          await client.callTool({
            name: "get_task",
            arguments: { id: task.id },
          }),
        );
      }
      const probe = inspectProbe(task, expected, Date.now() - began);
      probes.push(probe);
      console.log(
        `${mode} probe ${index}: ${probe.outcome} (${probe.status}${probe.errorCode ? `, ${probe.errorCode}` : ""}, ${probe.durationMs} ms)`,
      );
      if (probe.outcome !== "PASS") break; // No automatic retries after an ambiguous/provider-blocked task.
    }
    return {
      mode,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      outcome: probes.every((probe) => probe.outcome === "PASS")
        ? "PASS"
        : probes.some((probe) => probe.outcome === "BLOCKED")
          ? "BLOCKED"
          : "FAIL",
      probes,
    };
  } catch (error) {
    console.error(
      `${mode} verification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    return {
      mode,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      outcome: "FAIL",
      probes,
      errorCode: "VERIFICATION_INFRASTRUCTURE",
    };
  } finally {
    await client?.close();
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                "Verification worker did not close; stop it before using this profile.",
              ),
            ),
          10000,
        );
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}
export async function verifyBrowsers(options: {
  directory: string;
  mode: BrowserMode | "both";
  report?: string;
  timeoutSeconds?: number;
}) {
  const directory = resolve(options.directory);
  if (liveWorkerPid(directory))
    throw new Error(
      "A worker already owns this profile. Finish its tasks and run chatgpt-wrapper stop before verification. The test will not close an existing browser.",
    );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const runId = randomUUID();
  const results: Array<Awaited<ReturnType<typeof runMode>>> = [];
  const modes =
    options.mode === "both"
      ? (["visible", "headless"] as const)
      : [options.mode];
  let infrastructureError = false;
  try {
    for (const mode of modes) {
      if (liveWorkerPid(directory))
        throw new Error(
          "Another worker acquired the profile. Verification stopped.",
        );
      results.push(
        await runMode(directory, mode, options.timeoutSeconds ?? 90, runId),
      );
    }
  } catch (error) {
    infrastructureError = true;
    console.error(
      error instanceof Error ? error.message : "Verification stopped",
    );
  }
  const report = {
    schemaVersion: 1,
    version: packageMetadata.version,
    runId,
    platform: process.platform,
    node: process.versions.node,
    createdAt: new Date().toISOString(),
    results,
    ...(infrastructureError ? { errorCode: "VERIFICATION_INTERRUPTED" } : {}),
  };
  const path = resolve(
    options.report ?? join(directory, "verification", `${runId}.json`),
  );
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(`Verification report: ${path}`);
  return {
    path,
    report,
    passed:
      !infrastructureError &&
      results.length === modes.length &&
      results.every((result) => result.outcome === "PASS"),
  };
}
