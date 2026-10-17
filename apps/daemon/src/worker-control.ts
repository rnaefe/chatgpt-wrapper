import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function liveWorkerPid(directory: string) {
  const path = join(directory, "daemon.lock");
  if (!existsSync(path)) return undefined;
  const pid = Number(readFileSync(path, "utf8"));
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error(
      "Invalid worker lock. Inspect it before running verification.",
    );
  try {
    process.kill(pid, 0);
    return pid;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH")
      return undefined;
    throw error;
  }
}
export function assertSafeStop(
  pid: number,
  status: { runtime?: { pid: number }; counts?: Record<string, number> },
) {
  if (!status.counts)
    throw new Error(
      "Worker did not report queue state. No process was stopped.",
    );
  if (status.runtime?.pid !== pid)
    throw new Error(
      "The responding worker does not match this profile lock. No process was stopped. Older workers must be stopped from their original terminal.",
    );
  if (
    ["QUEUED", "RUNNING", "VALIDATING"].some(
      (state) => (status.counts?.[state] ?? 0) > 0,
    )
  )
    throw new Error(
      "The worker has unfinished tasks. Finish or cancel them before stopping it.",
    );
}
export async function stopWorker(directory: string, base: string) {
  const origin = new URL(base);
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(origin.hostname) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("Worker URL must be a loopback HTTP origin.");
  const pid = liveWorkerPid(directory);
  if (!pid) return false;
  const token =
    process.env.LOCAL_API_TOKEN ??
    readFileSync(join(directory, "api-token"), "utf8").trim();
  const response = await fetch(new URL("/v1/status", base), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(
      "Could not authenticate the worker. No process was stopped.",
    );
  assertSafeStop(pid, await response.json());
  if (liveWorkerPid(directory) !== pid)
    throw new Error("The worker changed while stopping. Try again.");
  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 100; i++) {
    if (liveWorkerPid(directory) !== pid) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    "The worker has not released its profile yet. Verification was not started.",
  );
}
