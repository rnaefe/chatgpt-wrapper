import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  chmodSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Store } from "@chatgpt-wrapper/core";
import { Worker } from "./worker.js";

import { PlaywrightAdapter } from "./playwright-adapter.js";
import { loadEnvironment, dataDirectory, enginePath } from "./runtime-paths.js";

const DEFAULT_PORT = 11435;
const MIN_TOKEN_LENGTH = 24;

export function runtime() {
  loadEnvironment();
  const directory = dataDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const tokenPath = join(directory, "api-token");
  if (!process.env.LOCAL_API_TOKEN && !existsSync(tokenPath))
    writeFileSync(tokenPath, randomBytes(32).toString("hex"), {
      mode: 0o600,
      flag: "wx",
    });
  const token =
    process.env.LOCAL_API_TOKEN ?? readFileSync(tokenPath, "utf8").trim();
  if (token.length < MIN_TOKEN_LENGTH)
    throw new Error("LOCAL_API_TOKEN must have at least 24 characters");
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  const lockPath = join(directory, "daemon.lock");
  if (existsSync(lockPath)) {
    const pid = Number(readFileSync(lockPath, "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw new Error(
        "Invalid daemon lock. Review .data/daemon.lock before removing it.",
      );
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (e) {
      if (e instanceof Error && "code" in e && e.code === "ESRCH")
        alive = false;
      else throw e;
    }
    if (alive)
      throw new Error("Another daemon already owns this data directory");
    unlinkSync(lockPath);
  }
  writeFileSync(lockPath, String(process.pid), { flag: "wx", mode: 0o600 });
  const release = () => {
    if (
      existsSync(lockPath) &&
      readFileSync(lockPath, "utf8") === String(process.pid)
    )
      unlinkSync(lockPath);
  };
  process.once("exit", release);
  const store = new Store(directory);
  const adapter = new PlaywrightAdapter(
    directory,
    enginePath,
    process.env.BROWSER_HEADLESS === "true",
  );
  return {
    store,
    adapter,
    worker: new Worker(store, adapter),
    token,
    port,
    release,
  };
}
