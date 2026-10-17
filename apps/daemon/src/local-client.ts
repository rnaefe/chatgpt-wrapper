import {
  existsSync,
  readFileSync,
  mkdirSync,
  openSync,
  closeSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import {
  loadEnvironment,
  dataDirectory,
  daemonEntry,
  packageRoot,
} from "./runtime-paths.js";

export async function localClient() {
  loadEnvironment();
  const base = new URL(
    process.env.WRAPPER_URL ?? `http://127.0.0.1:${process.env.PORT ?? 11435}`,
  );
  if (
    base.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/"
  )
    throw new Error("WRAPPER_URL must be a loopback HTTP origin");
  const directory = dataDirectory();
  const tokenFile = join(directory, "api-token");
  const token = () =>
    process.env.LOCAL_API_TOKEN ??
    (existsSync(tokenFile)
      ? readFileSync(tokenFile, "utf8").trim()
      : undefined);
  async function healthy() {
    try {
      const r = await fetch(new URL("/health", base), {
        signal: AbortSignal.timeout(700),
        redirect: "error",
      });
      if (
        !r.ok ||
        ((await r.json()) as { service?: string }).service !== "chatgpt-wrapper"
      )
        throw new Error("Port is occupied by a different service");
      return true;
    } catch (error) {
      if (
        error instanceof TypeError ||
        (error instanceof Error && error.name === "TimeoutError")
      )
        return false;
      throw error;
    }
  }
  if (!(await healthy())) {
    if (base.port !== String(process.env.PORT ?? 11435))
      throw new Error(
        "Start the daemon manually for a custom WRAPPER_URL port",
      );
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const log = openSync(join(directory, "daemon.log"), "a", 0o600);
    try {
      const child = spawn(process.execPath, [daemonEntry], {
        cwd: packageRoot,
        env: process.env,
        detached: true,
        stdio: ["ignore", log, log],
      });
      child.on("error", (error) => {
        console.error("Daemon failed to start", error.message);
      });
      child.unref();
    } finally {
      closeSync(log);
    }
    let ready = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 150));
      if (await healthy()) {
        ready = true;
        break;
      }
    }
    if (!ready)
      throw new Error(
        `Daemon could not start. Check ${join(directory, "daemon.log")}`,
      );
  }
  const credential = token();
  if (!credential)
    throw new Error(
      `The running daemon uses a different data directory. Stop it or select another PORT. Expected token in ${directory}.`,
    );
  return async (path: string, body?: unknown, timeoutMs = 10_000) => {
    const response = await fetch(new URL(path, base), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        `Wrapper request failed (HTTP ${response.status}): ${await response.text()}`,
      );
    return response;
  };
}
